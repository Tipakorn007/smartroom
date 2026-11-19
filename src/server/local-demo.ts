import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { CHECKIN_WINDOW_MS } from "../shared/constants.ts";
import type {
  Booking,
  BookingWithRoom,
  CheckInResponse,
  CreateBookingResponse,
  RecommendRequest,
  Room,
  RoomView,
  StatsResponse,
} from "../shared/types.ts";
import { HttpError, json, readJsonBody } from "./http.ts";
import { rankRooms } from "./recommend.ts";
import {
  validateDuration,
  validateFlag,
  validatePeople,
  validateRoomId,
  validateToken,
  validateUserName,
} from "./validation.ts";

const MINUTE = 60 * 1000;

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

let bookings: Booking[] = [];
let nextBookingId = 1;

function releaseExpiredBookings(now: number): void {
  for (const booking of bookings) {
    if (booking.status === "pending" && now >= booking.startAt + CHECKIN_WINDOW_MS) {
      booking.status = "released";
      booking.releasedAt = now;
    } else if (booking.status === "active" && booking.endAt <= now) {
      booking.status = "finished";
    }
  }
}

function listRoomViews(now: number): RoomView[] {
  releaseExpiredBookings(now);
  return DEMO_ROOMS.map((room) => {
    const booking = bookings.find(
      (item): item is Booking & { status: "pending" | "active" } =>
        item.roomId === room.id &&
        (item.status === "pending" || item.status === "active") &&
        item.startAt <= now &&
        item.endAt > now,
    );
    if (!booking) {
      return { ...room, status: "available", currentBooking: null, checkinDeadline: null };
    }
    return {
      ...room,
      status: booking.status === "pending" ? "pending" : "in_use",
      currentBooking: {
        status: booking.status,
        startAt: booking.startAt,
        endAt: booking.endAt,
      },
      checkinDeadline: booking.status === "pending" ? booking.startAt + CHECKIN_WINDOW_MS : null,
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
  return { booking, room: getRoom(booking.roomId) };
}

function getStats(now: number): StatsResponse {
  const rooms = listRoomViews(now);
  const checkedInBookings = bookings.filter((booking) => booking.checkedInAt !== null).length;
  const totalBookings = bookings.length;
  const checkInsByRoom = new Map<number, number>();
  for (const booking of bookings) {
    if (booking.checkedInAt !== null) {
      checkInsByRoom.set(booking.roomId, (checkInsByRoom.get(booking.roomId) ?? 0) + 1);
    }
  }
  return {
    totalBookings,
    releasedBookings: bookings.filter((booking) => booking.status === "released").length,
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

  if (pathname === "/api/rooms" && method === "GET") {
    return json(listRoomViews(now));
  }

  if (pathname === "/api/stats" && method === "GET") {
    return json(getStats(now));
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

  if (pathname === "/api/bookings" && method === "POST") {
    const body = await readJsonBody(request);
    const roomId = validateRoomId(body.roomId);
    const userName = validateUserName(body.userName);
    const durationMinutes = validateDuration(body.durationMinutes);
    const room = getRoom(roomId);
    const startAt = Math.floor(now / 1000) * 1000;
    const endAt = startAt + durationMinutes * MINUTE;
    releaseExpiredBookings(now);
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

    const booking: Booking = {
      id: nextBookingId++,
      roomId,
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
    const checkinUrl = `${url.origin}/checkin/${booking.token}`;
    const qrDataUrl = await QRCode.toDataURL(checkinUrl, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    const response: CreateBookingResponse = { booking, room, qrDataUrl, checkinUrl };
    return json(response, 201);
  }

  const checkinMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/checkin$/);
  if (checkinMatch && method === "POST") {
    const token = validateToken(checkinMatch[1]);
    releaseExpiredBookings(now);
    const { booking, room } = getBooking(token);
    if (booking.status === "active") {
      const response: CheckInResponse = { booking, room, alreadyCheckedIn: true };
      return json(response);
    }
    if (booking.status === "released") {
      throw new HttpError(409, "การจองนี้ถูกปล่อยคืนแล้ว เพราะไม่ได้เช็กอินภายใน 15 นาที");
    }
    if (booking.status === "finished") {
      throw new HttpError(409, "การจองนี้สิ้นสุดเวลาใช้งานแล้ว");
    }
    if (now >= booking.startAt + CHECKIN_WINDOW_MS) {
      booking.status = "released";
      booking.releasedAt = now;
      throw new HttpError(409, "เลยเวลาเช็กอิน 15 นาทีแล้ว ห้องนี้ถูกปล่อยคืน");
    }
    booking.status = "active";
    booking.checkedInAt = now;
    const response: CheckInResponse = { booking, room, alreadyCheckedIn: false };
    return json(response);
  }

  const bookingMatch = pathname.match(/^\/api\/bookings\/([^/]+)$/);
  if (bookingMatch && method === "GET") {
    const token = validateToken(bookingMatch[1]);
    releaseExpiredBookings(now);
    return json(getBooking(token));
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
