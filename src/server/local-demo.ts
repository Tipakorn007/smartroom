import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { checkinStartMessage, checkinWarningMessage, pushToDemoUser } from "../../lib/line.ts";
import {
  CHECKIN_WINDOW_MS,
  PRESENCE_EXTENSION_MS,
  PRESENCE_REMINDER_WINDOW_MS,
  WAITLIST_OFFER_WINDOW_MS,
} from "../shared/constants.ts";
import type {
  Booking,
  BookingHistoryEntry,
  BookingWithRoom,
  CheckInResponse,
  CreateBookingResponse,
  LiveSnapshot,
  MyHistorySnapshot,
  RecommendRequest,
  Room,
  RoomMaintenance,
  RoomView,
  StatsResponse,
  WaitlistEntry,
} from "../shared/types.ts";
import { HttpError, json, readJsonBody, sse } from "./http.ts";
import { adminSessionValid, assertSameOrigin, loginAdmin, logoutAdmin, requireAdmin } from "./admin-auth.ts";
import { rankRooms } from "./recommend.ts";
import { handleLineTest } from "./line-test.ts";
import {
  validateDuration,
  validateFlag,
  validatePeople,
  validateRecordId,
  validateRoomId,
  validateToken,
  validateTimestamp,
  validateUserId,
  validateUserName,
} from "./validation.ts";

const MINUTE = 60 * 1000;
const NO_SHOW_WINDOW_MS = 30 * 24 * 60 * MINUTE;
const NO_SHOW_THRESHOLD = 3;
const NO_SHOW_COOLDOWN_MS = 24 * 60 * MINUTE;
const ACTIVE_BOOKING_LIMIT = 1;

interface DemoBooking extends Booking {
  userId: string | null;
  lineRemindedEndAt?: number;
  notifiedStart?: boolean;
  notifiedReleaseWarning?: boolean;
}

interface DemoWaitlist extends WaitlistEntry {
  userId: string;
  userName: string;
  bookingId: number | null;
}

const DEMO_ROOMS: Room[] = [
  { id: 1, name: "A101", floor: 1, capacity: 2, hasPower: true, hasWhiteboard: false, quietLevel: "quiet" },
  { id: 2, name: "A102", floor: 1, capacity: 4, hasPower: true, hasWhiteboard: true, quietLevel: "normal" },
  { id: 3, name: "A103", floor: 1, capacity: 6, hasPower: false, hasWhiteboard: true, quietLevel: "group" },
  { id: 4, name: "A104", floor: 1, capacity: 8, hasPower: true, hasWhiteboard: true, quietLevel: "normal" },
  { id: 5, name: "B201", floor: 2, capacity: 4, hasPower: true, hasWhiteboard: true, quietLevel: "quiet" },
  { id: 6, name: "B202", floor: 2, capacity: 8, hasPower: true, hasWhiteboard: false, quietLevel: "group" },
  { id: 7, name: "B203", floor: 2, capacity: 2, hasPower: false, hasWhiteboard: true, quietLevel: "normal" },
  { id: 8, name: "B204", floor: 2, capacity: 6, hasPower: true, hasWhiteboard: true, quietLevel: "quiet" },
  { id: 9, name: "C301", floor: 3, capacity: 12, hasPower: true, hasWhiteboard: true, quietLevel: "group" },
  { id: 10, name: "C302", floor: 3, capacity: 6, hasPower: true, hasWhiteboard: false, quietLevel: "quiet" },
  { id: 11, name: "C303", floor: 3, capacity: 10, hasPower: true, hasWhiteboard: true, quietLevel: "normal" },
  { id: 12, name: "C304", floor: 3, capacity: 4, hasPower: false, hasWhiteboard: true, quietLevel: "group" },
  { id: 13, name: "D401", floor: 4, capacity: 2, hasPower: true, hasWhiteboard: true, quietLevel: "quiet" },
  { id: 14, name: "D402", floor: 4, capacity: 6, hasPower: true, hasWhiteboard: false, quietLevel: "normal" },
  { id: 15, name: "D403", floor: 4, capacity: 8, hasPower: false, hasWhiteboard: true, quietLevel: "group" },
  { id: 16, name: "D404", floor: 4, capacity: 12, hasPower: true, hasWhiteboard: true, quietLevel: "normal" },
  { id: 17, name: "E501", floor: 5, capacity: 4, hasPower: true, hasWhiteboard: false, quietLevel: "quiet" },
  { id: 18, name: "E502", floor: 5, capacity: 8, hasPower: true, hasWhiteboard: true, quietLevel: "group" },
  { id: 19, name: "E503", floor: 5, capacity: 6, hasPower: false, hasWhiteboard: true, quietLevel: "normal" },
  { id: 20, name: "E504", floor: 5, capacity: 10, hasPower: true, hasWhiteboard: true, quietLevel: "quiet" },
];

let bookings: DemoBooking[] = [];
let waitlists: DemoWaitlist[] = [];
const noShowsByUser = new Map<string, number[]>();
const cancelledBookingIds = new Set<number>();
const disabledRoomIds = new Set<number>();
const roomMaintenance: RoomMaintenance[] = [];
let nextBookingId = 1;
let nextWaitlistId = 1;
let nextMaintenanceId = 1;
let nextRoomId = 21;

function roomUnavailableUntil(roomId: number, now: number): number | null {
  if (disabledRoomIds.has(roomId)) return Number.MAX_SAFE_INTEGER;
  const active = roomMaintenance
    .filter((item) => item.roomId === roomId && item.startsAt <= now && item.endsAt > now)
    .sort((a, b) => a.endsAt - b.endsAt)[0];
  return active?.endsAt ?? null;
}

function overlapsMaintenance(roomId: number, startAt: number, endAt: number): boolean {
  return roomMaintenance.some(
    (item) => item.roomId === roomId && startAt < item.endsAt && endAt > item.startsAt,
  );
}

function hasScheduledBooking(roomId: number, now: number): boolean {
  return bookings.some(
    (booking) => booking.roomId === roomId &&
      (booking.status === "pending" || booking.status === "active") && booking.endAt > now,
  );
}

function getNoShowTimes(userId: string, now: number): number[] {
  const recent = (noShowsByUser.get(userId) ?? []).filter((at) => at > now - NO_SHOW_WINDOW_MS);
  if (recent.length) noShowsByUser.set(userId, recent);
  else noShowsByUser.delete(userId);
  return recent;
}

function getBookingBlock(userId: string, now: number): number | null {
  const recent = getNoShowTimes(userId, now);
  return recent.length >= NO_SHOW_THRESHOLD
    ? (recent[recent.length - 1] ?? now) + NO_SHOW_COOLDOWN_MS
    : null;
}

function enforceBookingPolicy(userId: string, now: number, exceptBookingId?: number): void {
  const blockedUntil = getBookingBlock(userId, now);
  if (blockedUntil !== null && blockedUntil > now) {
    throw new HttpError(429, `พักสิทธิ์จองชั่วคราวจากการไม่มาใช้ห้อง ลองจองอีกครั้ง ${new Date(blockedUntil).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} น.`);
  }
  const activeBooking = bookings.some(
    (booking) => booking.userId === userId && booking.id !== exceptBookingId &&
      (booking.status === "pending" || booking.status === "active"),
  );
  if (activeBooking) throw new HttpError(409, "คุณมีการจองที่ยังใช้งานอยู่ได้ครั้งละ 1 รายการ กรุณาเช็กอินหรือจบการจองเดิมก่อน");
}

function releaseExpiredBookings(now: number): void {
  const expiredRoomIds = new Set<number>();
  for (const entry of waitlists) {
    if (entry.status === "offered" && entry.offerExpiresAt !== null && now >= entry.offerExpiresAt) {
      entry.status = "expired";
      const offeredBooking = bookings.find((booking) => booking.id === entry.bookingId);
      if (offeredBooking && offeredBooking.status === "pending") {
        offeredBooking.status = "released";
        offeredBooking.releasedAt = now;
      }
      expiredRoomIds.add(entry.roomId);
    }
  }

  for (const booking of bookings) {
    if (booking.status === "pending" && now >= booking.startAt + CHECKIN_WINDOW_MS) {
      booking.status = "released";
      booking.releasedAt = now;
      const queueEntry = waitlists.find((entry) => entry.bookingId === booking.id);
      if (booking.userId && (!queueEntry || queueEntry.status === "accepted")) {
        noShowsByUser.set(booking.userId, [...getNoShowTimes(booking.userId, now), now]);
      }
      expiredRoomIds.add(booking.roomId);
    } else if (booking.status === "active" && booking.endAt <= now) {
      booking.status = "finished";
      expiredRoomIds.add(booking.roomId);
    }
  }
  for (const roomId of expiredRoomIds) offerNextWaitlist(roomId, now);
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_DEMO_USER_ID) {
    for (const booking of bookings) {
      if (booking.status === "pending" && booking.startAt <= now &&
          now < booking.startAt + CHECKIN_WINDOW_MS &&
          !waitlists.some((entry) => entry.bookingId === booking.id && entry.status !== "accepted")) {
        const room = DEMO_ROOMS.find((item) => item.id === booking.roomId);
        if (room && !booking.notifiedStart) {
          booking.notifiedStart = true;
          void pushToDemoUser(checkinStartMessage(room.name));
        }
        if (room && !booking.notifiedReleaseWarning && now >= booking.startAt + CHECKIN_WINDOW_MS - 5 * MINUTE) {
          booking.notifiedReleaseWarning = true;
          void pushToDemoUser(checkinWarningMessage(room.name));
        }
      }
      if (booking.status !== "active" || booking.endAt <= now ||
          booking.endAt > now + PRESENCE_REMINDER_WINDOW_MS || booking.lineRemindedEndAt === booking.endAt) continue;
      const room = DEMO_ROOMS.find((item) => item.id === booking.roomId);
      if (!room) continue;
      const endAt = booking.endAt;
      booking.lineRemindedEndAt = endAt;
      void pushToDemoUser(`ห้อง ${room.name} จะหมดเวลาอีก 10 นาที ยังใช้อยู่ไหม?`).then((sent) => {
        if (!sent && booking.lineRemindedEndAt === endAt) delete booking.lineRemindedEndAt;
      });
    }
  }
}

function listRoomViews(now: number): RoomView[] {
  releaseExpiredBookings(now);
  for (const room of DEMO_ROOMS) offerNextWaitlist(room.id, now);
  return DEMO_ROOMS.map((room) => {
    const booking = bookings.find(
      (item): item is DemoBooking & { status: "pending" | "active" } =>
        item.roomId === room.id &&
        (item.status === "pending" || item.status === "active") &&
        item.startAt <= now &&
        item.endAt > now,
    );
    const offer = booking
      ? waitlists.find((entry) => entry.bookingId === booking.id && entry.status === "offered")
      : undefined;
    const waitlistCount = waitlists.filter(
      (entry) => entry.roomId === room.id && (entry.status === "waiting" || entry.status === "offered"),
    ).length;
    const nextBookingAt = bookings
      .filter((item) => item.roomId === room.id && (item.status === "pending" || item.status === "active") && item.startAt > now)
      .sort((a, b) => a.startAt - b.startAt)[0]?.startAt ?? null;
    const closedUntil = roomUnavailableUntil(room.id, now);
    if (closedUntil !== null) {
      const activeMaintenance = roomMaintenance.find(
        (item) => item.roomId === room.id && item.startsAt <= now && item.endsAt > now,
      );
      return {
        ...room,
        status: "closed",
        currentBooking: null,
        checkinDeadline: null,
        waitlistCount,
        closureEndsAt: closedUntil === Number.MAX_SAFE_INTEGER ? null : closedUntil,
        closureReason: activeMaintenance?.reason ?? "ปิดใช้งานชั่วคราว",
        nextBookingAt,
      };
    }
    if (!booking) {
      return {
        ...room,
        status: "available",
        currentBooking: null,
        checkinDeadline: null,
        waitlistCount,
        nextBookingAt,
      };
    }
    return {
      ...room,
      status: offer ? "offered" : booking.status === "pending" ? "pending" : "in_use",
      currentBooking: {
        status: offer ? "offered" : booking.status,
        startAt: booking.startAt,
        endAt: booking.endAt,
      },
      checkinDeadline: booking.status === "pending" ? booking.startAt + CHECKIN_WINDOW_MS : null,
      waitlistCount,
      nextBookingAt,
    };
  });
}

function getRoom(roomId: number): Room {
  const room = DEMO_ROOMS.find((item) => item.id === roomId);
  if (!room) throw new HttpError(404, "ไม่พบห้องที่เลือก");
  return room;
}

function getBooking(token: string): BookingWithRoom {
  const booking = bookings.find((item) => item.token === token);
  if (!booking) throw new HttpError(404, "ไม่พบการจองนี้");
  return { booking: publicBooking(booking), room: getRoom(booking.roomId) };
}

function publicBooking(booking: DemoBooking): Booking {
  return {
    id: booking.id,
    roomId: booking.roomId,
    userName: booking.userName,
    startAt: booking.startAt,
    endAt: booking.endAt,
    status: booking.status,
    token: booking.token,
    createdAt: booking.createdAt,
    checkedInAt: booking.checkedInAt,
    releasedAt: booking.releasedAt,
  };
}

function offerNextWaitlist(roomId: number, now: number): void {
  if (roomUnavailableUntil(roomId, now) !== null || hasScheduledBooking(roomId, now)) return;
  if (waitlists.some((entry) => entry.roomId === roomId && entry.status === "offered")) return;

  const next = waitlists
    .filter((entry) => {
      const blockedUntil = getBookingBlock(entry.userId, now);
      return entry.roomId === roomId && entry.status === "waiting" &&
        !bookings.some((booking) => booking.userId === entry.userId &&
          (booking.status === "pending" || booking.status === "active")) &&
        (blockedUntil === null || blockedUntil <= now) &&
        !overlapsMaintenance(roomId, now, now + entry.durationMinutes * MINUTE);
    })
    .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)[0];
  if (!next) return;

  const booking: DemoBooking = {
    id: nextBookingId++,
    roomId,
    userId: next.userId,
    userName: next.userName,
    startAt: now,
    endAt: now + next.durationMinutes * MINUTE,
    status: "pending",
    token: randomBytes(16).toString("hex"),
    createdAt: now,
    checkedInAt: null,
    releasedAt: null,
  };
  bookings.push(booking);
  next.status = "offered";
  next.bookingId = booking.id;
  next.offerExpiresAt = now + WAITLIST_OFFER_WINDOW_MS;
  const room = DEMO_ROOMS.find((item) => item.id === roomId);
  if (room) void pushToDemoUser(`ห้อง ${room.name} ว่างแล้ว! ตอบรับภายใน 5 นาที`);
}

function getUserWaitlists(userId: string): WaitlistEntry[] {
  const active = waitlists
    .filter(
      (entry) =>
        entry.userId === userId && (entry.status === "waiting" || entry.status === "offered"),
    )
    .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  return active.map((entry) => {
    const position =
      entry.status === "waiting"
        ? waitlists.filter(
            (prior) =>
              prior.roomId === entry.roomId &&
              prior.status === "waiting" &&
              (prior.createdAt < entry.createdAt ||
                (prior.createdAt === entry.createdAt && prior.id < entry.id)),
          ).length + 1
        : null;
    return {
      id: entry.id,
      roomId: entry.roomId,
      roomName: entry.roomName,
      durationMinutes: entry.durationMinutes,
      status: entry.status,
      createdAt: entry.createdAt,
      position,
      offerExpiresAt: entry.offerExpiresAt,
    };
  });
}

function getLiveSnapshot(userId: string, now: number): LiveSnapshot {
  const rooms = listRoomViews(now);
  const myBookings = bookings
    .filter(
      (booking) =>
        booking.userId === userId &&
        (booking.status === "pending" || booking.status === "active") &&
        !waitlists.some((entry) => entry.bookingId === booking.id && entry.status === "offered"),
    )
    .map((booking) => ({ booking: publicBooking(booking), room: getRoom(booking.roomId) }));
  const noShows = getNoShowTimes(userId, now);
  return {
    rooms,
    myWaitlists: getUserWaitlists(userId),
    myBookings,
    bookingPolicy: {
      activeBookingLimit: ACTIVE_BOOKING_LIMIT,
      hasActiveBooking: myBookings.length > 0,
      noShowsInWindow: noShows.length,
      noShowThreshold: NO_SHOW_THRESHOLD,
      noShowWindowMs: NO_SHOW_WINDOW_MS,
      cooldownMs: NO_SHOW_COOLDOWN_MS,
      blockedUntil: getBookingBlock(userId, now),
    },
  };
}

function buildBookingResponse(
  booking: DemoBooking,
  room: Room,
  origin: string,
): Promise<CreateBookingResponse> {
  const publicValue = publicBooking(booking);
  const checkinUrl = `${origin}/checkin/${booking.token}`;
  return QRCode.toDataURL(checkinUrl, {
    width: 320,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0f172a", light: "#ffffff" },
  }).then((qrDataUrl) => ({
    booking: publicValue,
    room,
    qrDataUrl,
    checkinUrl,
  }));
}

function getStats(now: number): StatsResponse {
  const rooms = listRoomViews(now);
  const countedBookings = bookings.filter(
    (booking) =>
      !waitlists.some(
        (entry) =>
          entry.bookingId === booking.id &&
          (entry.status === "offered" || entry.status === "expired" || entry.status === "cancelled"),
      ) && !cancelledBookingIds.has(booking.id),
  );
  const checkedInBookings = countedBookings.filter((booking) => booking.checkedInAt !== null).length;
  const totalBookings = countedBookings.length;
  const checkInsByRoom = new Map<number, number>();
  for (const booking of countedBookings) {
    if (booking.checkedInAt !== null) {
      checkInsByRoom.set(booking.roomId, (checkInsByRoom.get(booking.roomId) ?? 0) + 1);
    }
  }
  return {
    totalBookings,
    releasedBookings: countedBookings.filter((booking) => booking.status === "released").length,
    checkedInBookings,
    utilizationRate:
      totalBookings === 0 ? 0 : Math.round((checkedInBookings / totalBookings) * 1000) / 10,
    availableRooms: rooms.filter((room) => room.status === "available").length,
    totalRooms: DEMO_ROOMS.length,
    peakHours: [],
    leastUsedRooms: DEMO_ROOMS.map((room) => ({
      roomId: room.id,
      roomName: room.name,
      floor: room.floor,
      checkedInCount: checkInsByRoom.get(room.id) ?? 0,
    }))
      .sort((a, b) => a.checkedInCount - b.checkedInCount || a.floor - b.floor || a.roomName.localeCompare(b.roomName))
      .slice(0, 3),
  };
}

async function routeApi(request: Request, url: URL): Promise<Response> {
  const pathname =
    url.pathname === "/api/index" && url.searchParams.has("route")
      ? `/api/${url.searchParams.get("route")}`
      : url.pathname;
  const method = request.method;
  const now = Date.now();

  if (pathname === "/api/admin/session" && method === "GET") {
    return json({ authenticated: adminSessionValid(request), demo: true });
  }
  if (pathname === "/api/admin/login" && method === "POST") {
    assertSameOrigin(request);
    const body = await readJsonBody(request);
    return loginAdmin(request, body.password);
  }
  if (pathname === "/api/admin/logout" && method === "POST") {
    assertSameOrigin(request);
    return logoutAdmin();
  }
  if ((pathname === "/api/admin/line-test" || pathname.startsWith("/api/admin/line-test/")) && method === "POST") {
    return handleLineTest(request, pathname);
  }
  if (pathname.startsWith("/api/admin/rooms")) {
    requireAdmin(request);
    if (method !== "GET") assertSameOrigin(request);
  }

  if ((pathname === "/api/live" || pathname === "/api/events") && method === "GET") {
    const userId = validateUserId(url.searchParams.get("userId"));
    const snapshot = getLiveSnapshot(userId, now);
    return pathname === "/api/events" ? sse(snapshot) : json(snapshot);
  }

  if (pathname === "/api/rooms" && method === "GET") {
    return json(listRoomViews(now));
  }

  if (pathname === "/api/rooms/status" && method === "GET") {
    return json(listRoomViews(now));
  }

  if (pathname === "/api/stats" && method === "GET") {
    requireAdmin(request);
    return json(getStats(now));
  }

  if (pathname === "/api/me/bookings" && method === "GET") {
    const userId = validateUserId(url.searchParams.get("userId"));
    const history: BookingHistoryEntry[] = bookings
      .filter((booking) => booking.userId === userId && !waitlists.some(
        (entry) => entry.bookingId === booking.id && entry.status !== "accepted",
      ))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((booking) => ({
        booking: publicBooking(booking),
        room: getRoom(booking.roomId),
        cancelled: cancelledBookingIds.has(booking.id),
      }));
    const activeWaitlists = getUserWaitlists(userId);
    const queueHistory = waitlists
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
      .map((entry) => activeWaitlists.find((active) => active.id === entry.id) ?? ({
        id: entry.id,
        roomId: entry.roomId,
        roomName: entry.roomName,
        durationMinutes: entry.durationMinutes,
        status: entry.status,
        createdAt: entry.createdAt,
        position: null,
        offerExpiresAt: entry.offerExpiresAt,
      }));
    const result: MyHistorySnapshot = { bookings: history, waitlists: queueHistory };
    return json(result);
  }

  if (pathname === "/api/admin/rooms" && method === "GET") {
    return json({
      rooms: DEMO_ROOMS.map((room) => ({
        ...room,
        enabled: !disabledRoomIds.has(room.id),
        maintenance: roomMaintenance.filter((item) => item.roomId === room.id),
      })),
    });
  }

  if (pathname === "/api/admin/rooms" && method === "POST") {
    const body = await readJsonBody(request);
    const name = validateUserName(body.name);
    const floor = Number(body.floor);
    const capacity = Number(body.capacity);
    if (!Number.isInteger(floor) || floor < 1 || floor > 30) throw new HttpError(400, "ชั้นต้องอยู่ระหว่าง 1-30");
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) throw new HttpError(400, "ความจุต้องอยู่ระหว่าง 1-50 คน");
    if (DEMO_ROOMS.some((room) => room.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpError(409, "มีชื่อห้องนี้แล้ว");
    }
    if (typeof body.hasPower !== "boolean" || typeof body.hasWhiteboard !== "boolean") {
      throw new HttpError(400, "กรุณาระบุคุณสมบัติห้องให้ครบ");
    }
    if (!["quiet", "normal", "group"].includes(String(body.quietLevel))) {
      throw new HttpError(400, "ระดับความเงียบไม่ถูกต้อง");
    }
    const room: Room = {
      id: nextRoomId++, name, floor, capacity,
      hasPower: body.hasPower, hasWhiteboard: body.hasWhiteboard,
      quietLevel: body.quietLevel as Room["quietLevel"],
    };
    DEMO_ROOMS.push(room);
    return json({ ...room, enabled: true, maintenance: [] }, 201);
  }

  const deleteRoomMatch = pathname.match(/^\/api\/admin\/rooms\/(\d+)\/delete$/);
  if (deleteRoomMatch && method === "POST") {
    const roomId = validateRoomId(deleteRoomMatch[1]);
    const index = DEMO_ROOMS.findIndex((room) => room.id === roomId);
    if (index < 0) throw new HttpError(404, "ไม่พบห้องนี้");
    if (bookings.some((booking) => booking.roomId === roomId) ||
        waitlists.some((entry) => entry.roomId === roomId) ||
        roomMaintenance.some((item) => item.roomId === roomId)) {
      throw new HttpError(409, "ห้องนี้มีประวัติ คิว หรือช่วงปิดปรับปรุง ให้ปิดใช้งานแทนการลบ");
    }
    DEMO_ROOMS.splice(index, 1);
    disabledRoomIds.delete(roomId);
    return json({ deleted: true });
  }

  const adminRoomMatch = pathname.match(/^\/api\/admin\/rooms\/(\d+)(?:\/(maintenance))?$/);
  if (adminRoomMatch && method === "PATCH" && !adminRoomMatch[2]) {
    const roomId = validateRoomId(adminRoomMatch[1]);
    const room = getRoom(roomId);
    const body = await readJsonBody(request);
    const updatedRoom = { ...room };
    if (body.enabled === false && hasScheduledBooking(roomId, now)) {
      throw new HttpError(409, "ยังมีการจองในห้องนี้ จึงปิดใช้งานไม่ได้");
    }
    if (body.name !== undefined) {
      const name = validateUserName(body.name);
      if (DEMO_ROOMS.some((item) => item.id !== roomId && item.name.toLowerCase() === name.toLowerCase())) {
        throw new HttpError(409, "มีชื่อห้องนี้แล้ว");
      }
      updatedRoom.name = name;
    }
    if (body.floor !== undefined) {
      const floor = Number(body.floor);
      if (!Number.isInteger(floor) || floor < 1 || floor > 30) throw new HttpError(400, "ชั้นต้องอยู่ระหว่าง 1-30");
      updatedRoom.floor = floor;
    }
    if (body.capacity !== undefined) {
      const capacity = Number(body.capacity);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) throw new HttpError(400, "ความจุต้องอยู่ระหว่าง 1-50 คน");
      updatedRoom.capacity = capacity;
    }
    if (typeof body.hasPower === "boolean") updatedRoom.hasPower = body.hasPower;
    if (typeof body.hasWhiteboard === "boolean") updatedRoom.hasWhiteboard = body.hasWhiteboard;
    if (body.quietLevel !== undefined) {
      if (!["quiet", "normal", "group"].includes(String(body.quietLevel))) throw new HttpError(400, "ระดับความเงียบไม่ถูกต้อง");
      updatedRoom.quietLevel = body.quietLevel as Room["quietLevel"];
    }
    Object.assign(room, updatedRoom);
    if (typeof body.enabled === "boolean") {
      if (body.enabled) disabledRoomIds.delete(roomId);
      else disabledRoomIds.add(roomId);
    }
    return json({ ...room, enabled: !disabledRoomIds.has(roomId) });
  }

  if (adminRoomMatch && method === "POST" && adminRoomMatch[2] === "maintenance") {
    const roomId = validateRoomId(adminRoomMatch[1]);
    getRoom(roomId);
    const body = await readJsonBody(request);
    const startsAt = validateTimestamp(body.startsAt);
    const endsAt = validateTimestamp(body.endsAt);
    const reason = validateUserName(body.reason);
    if (startsAt <= now || endsAt <= startsAt || endsAt > now + 30 * 24 * 60 * MINUTE) {
      throw new HttpError(400, "ช่วงปิดปรับปรุงต้องเริ่มในอนาคตและไม่เกิน 30 วัน");
    }
    if (hasScheduledBooking(roomId, startsAt) && bookings.some((booking) =>
      booking.roomId === roomId && (booking.status === "pending" || booking.status === "active") &&
      startsAt < booking.endAt && endsAt > booking.startAt,
    )) throw new HttpError(409, "ช่วงเวลานี้มีการจองอยู่ จึงปิดปรับปรุงไม่ได้");
    if (overlapsMaintenance(roomId, startsAt, endsAt)) throw new HttpError(409, "ช่วงปิดปรับปรุงซ้อนกับรายการเดิม");
    const maintenance: RoomMaintenance = { id: nextMaintenanceId++, roomId, startsAt, endsAt, reason };
    roomMaintenance.push(maintenance);
    return json(maintenance, 201);
  }

  const maintenanceMatch = pathname.match(/^\/api\/admin\/rooms\/(\d+)\/maintenance\/(\d+)$/);
  if (maintenanceMatch && method === "DELETE") {
    const roomId = validateRoomId(maintenanceMatch[1]);
    const maintenanceId = validateRecordId(maintenanceMatch[2]);
    const index = roomMaintenance.findIndex((item) => item.id === maintenanceId && item.roomId === roomId);
    if (index < 0) throw new HttpError(404, "ไม่พบช่วงปิดปรับปรุงนี้");
    roomMaintenance.splice(index, 1);
    offerNextWaitlist(roomId, now);
    return json({ deleted: true });
  }

  if (pathname === "/api/recommend" && method === "POST") {
    const body = await readJsonBody(request);
    const recommendationRequest: RecommendRequest = {
      people: validatePeople(body.people),
      needPower: validateFlag(body.needPower, "needPower"),
      needWhiteboard: validateFlag(body.needWhiteboard, "needWhiteboard"),
      preferQuiet: validateFlag(body.preferQuiet, "preferQuiet"),
    };
    return json({
      recommendations: rankRooms(listRoomViews(now), recommendationRequest),
    });
  }

  if (pathname === "/api/waitlist" && method === "POST") {
    const body = await readJsonBody(request);
    const userId = validateUserId(body.userId);
    const roomId = validateRoomId(body.roomId);
    const userName = validateUserName(body.userName);
    const durationMinutes = validateDuration(body.durationMinutes);
    listRoomViews(now);

    if (
      bookings.some(
        (booking) =>
          booking.roomId === roomId &&
          booking.userId === userId &&
          (booking.status === "pending" || booking.status === "active"),
      )
    ) {
      throw new HttpError(409, "คุณมีการจองห้องนี้อยู่แล้ว");
    }
    enforceBookingPolicy(userId, now);
    if (waitlists.some((entry) => entry.roomId === roomId && entry.userId === userId && (
      entry.status === "waiting" || entry.status === "offered"
    ))) {
      throw new HttpError(409, "คุณอยู่ในคิวของห้องนี้แล้ว");
    }
    const occupied = hasScheduledBooking(roomId, now);
    if (roomUnavailableUntil(roomId, now) !== null) throw new HttpError(409, "ห้องปิดใช้งานหรือปิดปรับปรุงอยู่");
    const hasQueue = waitlists.some(
      (entry) =>
        entry.roomId === roomId && (entry.status === "waiting" || entry.status === "offered"),
    );
    if (!occupied && !hasQueue) {
      throw new HttpError(409, "ห้องนี้ว่างแล้ว กรุณาจองห้องแทนการเข้าคิว");
    }

    const entry: DemoWaitlist = {
      id: nextWaitlistId++,
      roomId,
      roomName: getRoom(roomId).name,
      userId,
      userName,
      durationMinutes,
      status: "waiting",
      createdAt: now,
      position: null,
      offerExpiresAt: null,
      bookingId: null,
    };
    waitlists.push(entry);
    offerNextWaitlist(roomId, now);
    const publicEntry = getUserWaitlists(userId).find((item) => item.id === entry.id);
    if (!publicEntry) throw new Error("Waitlist insert was not visible after creation");
    return json(publicEntry, 201);
  }

  if (pathname === "/api/bookings" && method === "POST") {
    const body = await readJsonBody(request);
    const userId = body.userId === undefined ? null : validateUserId(body.userId);
    const roomId = validateRoomId(body.roomId);
    const userName = validateUserName(body.userName);
    const durationMinutes = validateDuration(body.durationMinutes);
    const room = getRoom(roomId);
    const startAt = Math.floor(now / 1000) * 1000;
    const endAt = startAt + durationMinutes * MINUTE;
    releaseExpiredBookings(now);
    if (userId) enforceBookingPolicy(userId, now);
    if (roomUnavailableUntil(roomId, now) !== null) throw new HttpError(409, "ห้องปิดใช้งานหรือปิดปรับปรุงอยู่");
    if (
      waitlists.some(
        (entry) =>
          entry.roomId === roomId && (entry.status === "waiting" || entry.status === "offered"),
      )
    ) {
      throw new HttpError(409, "มีผู้ใช้รอคิวห้องนี้อยู่ กรุณาเข้าคิวแทนการจอง");
    }
    if (
      bookings.some(
        (booking) =>
          booking.roomId === roomId &&
          (booking.status === "pending" || booking.status === "active") &&
          booking.startAt < endAt &&
          booking.endAt > startAt,
      )
    ) {
      throw new HttpError(409, "ห้องนี้ถูกจองอยู่ในช่วงเวลานี้ กรุณาเลือกห้องอื่นหรือรอให้ห้องว่าง");
    }
    if (overlapsMaintenance(roomId, startAt, endAt)) throw new HttpError(409, "ช่วงเวลานี้ห้องปิดปรับปรุงอยู่");

    const booking: DemoBooking = {
      id: nextBookingId++,
      roomId,
      userId,
      userName,
      startAt,
      endAt,
      status: "pending",
      token: randomBytes(16).toString("hex"),
      createdAt: now,
      checkedInAt: null,
      releasedAt: null,
    };
    bookings.push(booking);
    return json(await buildBookingResponse(booking, room, url.origin), 201);
  }

  const bookingEditMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/(edit|cancel)$/);
  if (bookingEditMatch && method === "POST") {
    const token = validateToken(bookingEditMatch[1]);
    releaseExpiredBookings(now);
    const booking = bookings.find((item) => item.token === token);
    if (!booking) throw new HttpError(404, "ไม่พบการจองนี้");
    if (booking.status !== "pending") throw new HttpError(409, "แก้ไขหรือยกเลิกได้เฉพาะรายการที่ยังไม่เช็กอิน");
    if (waitlists.some((entry) => entry.bookingId === booking.id && entry.status === "offered")) {
      throw new HttpError(409, "กรุณาจัดการข้อเสนอจากคิวก่อน");
    }
    if (bookingEditMatch[2] === "cancel") {
      booking.status = "released";
      booking.releasedAt = now;
      cancelledBookingIds.add(booking.id);
      offerNextWaitlist(booking.roomId, now);
      return json({ cancelled: true });
    }
    const body = await readJsonBody(request);
    const roomId = validateRoomId(body.roomId);
    const durationMinutes = validateDuration(body.durationMinutes);
    const startAt = validateTimestamp(body.startAt);
    const endAt = startAt + durationMinutes * MINUTE;
    if (startAt < now + 5 * MINUTE || startAt > now + 7 * 24 * 60 * MINUTE) {
      throw new HttpError(400, "เวลาเริ่มต้องอยู่ระหว่างอีก 5 นาทีถึง 7 วัน");
    }
    if (waitlists.some((entry) => entry.roomId === roomId && (entry.status === "waiting" || entry.status === "offered"))) {
      throw new HttpError(409, "มีผู้ใช้รอคิวห้องนี้อยู่ จึงย้ายการจองเข้าห้องนี้ไม่ได้");
    }
    if (roomUnavailableUntil(roomId, startAt) !== null || overlapsMaintenance(roomId, startAt, endAt)) {
      throw new HttpError(409, "ห้องปิดใช้งานหรือปิดปรับปรุงในช่วงเวลาที่เลือก");
    }
    if (bookings.some((item) => item.id !== booking.id && item.roomId === roomId &&
      (item.status === "pending" || item.status === "active") && startAt < item.endAt && endAt > item.startAt,
    )) throw new HttpError(409, "เวลาที่เลือกชนกับการจองอื่น");
    booking.roomId = roomId;
    booking.startAt = startAt;
    booking.endAt = endAt;
    return json({ booking: publicBooking(booking), room: getRoom(roomId) });
  }

  const waitlistMatch = pathname.match(/^\/api\/waitlist\/([^/]+)\/(accept|cancel)$/);
  if (waitlistMatch && method === "POST") {
    const waitlistId = validateRecordId(waitlistMatch[1]);
    const body = await readJsonBody(request);
    const userId = validateUserId(body.userId);
    releaseExpiredBookings(now);
    const entry = waitlists.find(
      (item) => item.id === waitlistId && item.userId === userId,
    );
    if (waitlistMatch[2] === "cancel") {
      if (!entry || (entry.status !== "waiting" && entry.status !== "offered")) {
        throw new HttpError(404, "ไม่พบคิวที่ยกเลิกได้");
      }
      entry.status = "cancelled";
      if (entry.bookingId !== null) {
        const heldBooking = bookings.find((booking) => booking.id === entry.bookingId);
        if (heldBooking?.status === "pending") {
          heldBooking.status = "released";
          heldBooking.releasedAt = now;
        }
      }
      offerNextWaitlist(entry.roomId, now);
      return json({ cancelled: true });
    }

    if (
      entry?.status === "accepted" &&
      entry.bookingId !== null
    ) {
      const acceptedBooking = bookings.find((booking) => booking.id === entry.bookingId);
      if (acceptedBooking && (acceptedBooking.status === "pending" || acceptedBooking.status === "active")) {
        return json(await buildBookingResponse(acceptedBooking, getRoom(entry.roomId), url.origin));
      }
    }
    if (
      !entry ||
      entry.status !== "offered" ||
      entry.offerExpiresAt === null ||
      entry.offerExpiresAt <= now ||
      entry.bookingId === null
    ) {
      throw new HttpError(409, "ข้อเสนอหมดเวลาหรือไม่พบคิวของคุณ");
    }
    const booking = bookings.find((item) => item.id === entry.bookingId);
    if (!booking || booking.status !== "pending") {
      throw new HttpError(409, "ห้องนี้ไม่พร้อมรับข้อเสนอแล้ว");
    }
    enforceBookingPolicy(userId, now, booking.id);
    const newEndAt = now + entry.durationMinutes * MINUTE;
    if (overlapsMaintenance(entry.roomId, now, newEndAt) || bookings.some((item) =>
      item.id !== booking.id && item.roomId === entry.roomId &&
      (item.status === "pending" || item.status === "active") &&
      item.startAt < newEndAt && item.endAt > now,
    )) throw new HttpError(409, "รับข้อเสนอไม่สำเร็จ กรุณาตรวจสอบสถานะคิวอีกครั้ง");
    booking.startAt = now;
    booking.endAt = newEndAt;
    entry.status = "accepted";
    entry.offerExpiresAt = null;
    return json(await buildBookingResponse(booking, getRoom(entry.roomId), url.origin));
  }

  const checkinMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/checkin$/);
  if (checkinMatch && method === "POST") {
    const token = validateToken(checkinMatch[1]);
    releaseExpiredBookings(now);
    const storedBooking = bookings.find((item) => item.token === token);
    if (!storedBooking) throw new HttpError(404, "ไม่พบการจองนี้");
    const room = getRoom(storedBooking.roomId);
    const offer = waitlists.find(
      (entry) => entry.bookingId === storedBooking.id && entry.status === "offered",
    );
    if (offer) throw new HttpError(409, "กรุณากดยอมรับข้อเสนอจากหน้าเว็บก่อนเช็กอิน");
    if (storedBooking.status === "active") {
      const response: CheckInResponse = {
        booking: publicBooking(storedBooking),
        room,
        alreadyCheckedIn: true,
      };
      return json(response);
    }
    if (storedBooking.status === "released") {
      if (cancelledBookingIds.has(storedBooking.id)) throw new HttpError(409, "การจองนี้ถูกยกเลิกแล้ว");
      throw new HttpError(409, "การจองนี้ถูกปล่อยคืนแล้ว เพราะไม่ได้เช็กอินภายใน 15 นาที");
    }
    if (storedBooking.status === "finished") {
      throw new HttpError(409, "การจองนี้สิ้นสุดเวลาใช้งานแล้ว");
    }
    if (now < storedBooking.startAt) throw new HttpError(409, "ยังไม่ถึงเวลาเริ่มจอง จึงยังเช็กอินไม่ได้");
    if (now >= storedBooking.startAt + CHECKIN_WINDOW_MS) {
      storedBooking.status = "released";
      storedBooking.releasedAt = now;
      offerNextWaitlist(storedBooking.roomId, now);
      throw new HttpError(409, "เลยเวลาเช็กอิน 15 นาทีแล้ว ห้องนี้ถูกปล่อยคืน");
    }
    storedBooking.status = "active";
    storedBooking.checkedInAt = now;
    const response: CheckInResponse = {
      booking: publicBooking(storedBooking),
      room,
      alreadyCheckedIn: false,
    };
    return json(response);
  }

  const bookingActionMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/(extend|leave)$/);
  if (bookingActionMatch && method === "POST") {
    const token = validateToken(bookingActionMatch[1]);
    releaseExpiredBookings(now);
    const booking = bookings.find((item) => item.token === token);
    if (!booking) throw new HttpError(404, "ไม่พบการจองนี้");

    if (bookingActionMatch[2] === "leave") {
      if (booking.status !== "active") {
        throw new HttpError(409, "ออกจากห้องได้เฉพาะการจองที่กำลังใช้งาน");
      }
      booking.status = "finished";
      offerNextWaitlist(booking.roomId, now);
      return json({ booking: publicBooking(booking) });
    }

    const body = await readJsonBody(request);
    const expectedEndAt = validateTimestamp(body.expectedEndAt);
    if (booking.status !== "active") {
      throw new HttpError(409, "ต่อเวลาได้เฉพาะห้องที่กำลังใช้งาน");
    }
    if (booking.endAt !== expectedEndAt) {
      throw new HttpError(409, "เวลาการจองเปลี่ยนไปแล้ว กรุณาตรวจสอบข้อมูลล่าสุด");
    }
    if (now < booking.endAt - PRESENCE_REMINDER_WINDOW_MS) {
      throw new HttpError(409, "ยังไม่ถึงเวลาแจ้งเตือนก่อนหมดเวลา");
    }
    const hasQueue = waitlists.some(
      (entry) =>
        entry.roomId === booking.roomId &&
        (entry.status === "waiting" || entry.status === "offered"),
    );
    if (hasQueue) throw new HttpError(409, "มีคนรอคิวห้องนี้อยู่ จึงต่อเวลาไม่ได้");
    if (bookings.some((item) => item.id !== booking.id && item.roomId === booking.roomId &&
      (item.status === "pending" || item.status === "active") &&
      booking.startAt < item.endAt && booking.endAt + PRESENCE_EXTENSION_MS > item.startAt,
    )) throw new HttpError(409, "มีการจองถัดไปในช่วงเวลานั้น จึงต่อเวลาไม่ได้");
    if (overlapsMaintenance(booking.roomId, booking.endAt, booking.endAt + PRESENCE_EXTENSION_MS)) {
      throw new HttpError(409, "ห้องปิดปรับปรุงในช่วงเวลาที่ต้องการต่อ");
    }
    booking.endAt += PRESENCE_EXTENSION_MS;
    return json({ booking: publicBooking(booking) });
  }

  const bookingMatch = pathname.match(/^\/api\/bookings\/([^/]+)$/);
  if (bookingMatch && method === "GET") {
    const token = validateToken(bookingMatch[1]);
    releaseExpiredBookings(now);
    return json(getBooking(token));
  }

  const bookingLiveMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/(live|events)$/);
  if (bookingLiveMatch && method === "GET") {
    const token = validateToken(bookingLiveMatch[1]);
    releaseExpiredBookings(now);
    const bookingWithRoom = getBooking(token);
    const waitlistCount = waitlists.filter(
      (entry) =>
        entry.roomId === bookingWithRoom.room.id &&
        (entry.status === "waiting" || entry.status === "offered"),
    ).length;
    const snapshot = { ...bookingWithRoom, waitlistCount };
    return bookingLiveMatch[2] === "events" ? sse(snapshot) : json(snapshot);
  }

  throw new HttpError(404, "ไม่พบ API นี้");
}

export async function handleLocalDemoApi(request: Request): Promise<Response> {
  try {
    return await routeApi(request, new URL(request.url));
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("[local-demo] เกิดข้อผิดพลาดที่ไม่คาดคิด:", error);
    return json({ error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" }, 500);
  }
}
