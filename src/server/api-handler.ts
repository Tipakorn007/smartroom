/**
 * REST API handler shared by the local Bun server and Vercel Functions.
 */

import QRCode from "qrcode";
import type { CreateBookingResponse, QuietLevel, RecommendRequest } from "../shared/types.ts";
import {
  checkIn,
  cancelPendingBooking,
  createBooking,
  editPendingBooking,
  extendBooking,
  findBookingByToken,
  getBookingLiveSnapshot,
  leaveBooking,
  releaseExpiredBookings,
} from "./bookings.ts";
import { HttpError, json, readJsonBody, sse } from "./http.ts";
import { assertSameOrigin, adminSessionValid, loginAdmin, logoutAdmin, requireAdmin } from "./admin-auth.ts";
import { addRoomMaintenance, createManagedRoom, listManagedRooms, removeRoom, removeRoomMaintenance, updateManagedRoom } from "./admin-rooms.ts";
import { recommendRooms } from "./recommend.ts";
import { listRoomViews } from "./rooms.ts";
import { getStats } from "./stats.ts";
import { getMyHistory } from "./my-history.ts";
import {
  acceptWaitlistOffer,
  cancelWaitlist,
  getLiveSnapshot,
  joinWaitlist,
} from "./waitlist.ts";
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

async function routeApi(request: Request, url: URL): Promise<Response> {
  const pathname =
    url.pathname === "/api/index" && url.searchParams.has("route")
      ? `/api/${url.searchParams.get("route")}`
      : url.pathname;
  const method = request.method;

  if (pathname === "/api/admin/session" && method === "GET") {
    return json({ authenticated: adminSessionValid(request) });
  }
  if (pathname === "/api/admin/login" && method === "POST") {
    assertSameOrigin(request);
    const body = await readJsonBody(request);
    return loginAdmin(request, body.username, body.password);
  }
  if (pathname === "/api/admin/logout" && method === "POST") {
    assertSameOrigin(request);
    return logoutAdmin();
  }
  if (pathname.startsWith("/api/admin/rooms")) {
    requireAdmin(request);
    if (method !== "GET") assertSameOrigin(request);
    if (pathname === "/api/admin/rooms" && method === "GET") {
      return json({ rooms: await listManagedRooms() });
    }
    if (pathname === "/api/admin/rooms" && method === "POST") {
      const body = await readJsonBody(request);
      const room = await createManagedRoom({
        name: validateUserName(body.name),
        floor: validateBoundedInt(body.floor, 1, 30, "ชั้น"),
        capacity: validateBoundedInt(body.capacity, 1, 50, "ความจุ"),
        hasPower: validateFlag(body.hasPower, "hasPower"),
        hasWhiteboard: validateFlag(body.hasWhiteboard, "hasWhiteboard"),
        quietLevel: validateQuietLevel(body.quietLevel),
      });
      return json(room, 201);
    }
    const roomMatch = pathname.match(/^\/api\/admin\/rooms\/(\d+)$/);
    if (roomMatch && method === "PATCH") {
      const roomId = validateRoomId(roomMatch[1]);
      const body = await readJsonBody(request);
      await updateManagedRoom(roomId, {
        ...(body.name !== undefined ? { name: validateUserName(body.name) } : {}),
        ...(body.floor !== undefined ? { floor: validateBoundedInt(body.floor, 1, 30, "ชั้น") } : {}),
        ...(body.capacity !== undefined ? { capacity: validateBoundedInt(body.capacity, 1, 50, "ความจุ") } : {}),
        ...(body.hasPower !== undefined ? { hasPower: validateFlag(body.hasPower, "hasPower") } : {}),
        ...(body.hasWhiteboard !== undefined ? { hasWhiteboard: validateFlag(body.hasWhiteboard, "hasWhiteboard") } : {}),
        ...(body.quietLevel !== undefined ? { quietLevel: validateQuietLevel(body.quietLevel) } : {}),
        ...(body.enabled !== undefined ? { enabled: validateFlag(body.enabled, "enabled") } : {}),
      });
      return json({ updated: true });
    }
    const maintenanceMatch = pathname.match(/^\/api\/admin\/rooms\/(\d+)\/maintenance(?:\/(\d+))?$/);
    if (maintenanceMatch && method === "POST" && !maintenanceMatch[2]) {
      const roomId = validateRoomId(maintenanceMatch[1]);
      const body = await readJsonBody(request);
      const startsAt = validateTimestamp(body.startsAt);
      const endsAt = validateTimestamp(body.endsAt);
      if (startsAt <= Date.now() || endsAt <= startsAt || endsAt > Date.now() + 30 * 24 * 60 * 60 * 1000) {
        throw new HttpError(400, "ช่วงปิดปรับปรุงต้องเริ่มในอนาคตและไม่เกิน 30 วัน");
      }
      return json(await addRoomMaintenance(roomId, startsAt, endsAt, validateUserName(body.reason)), 201);
    }
    if (maintenanceMatch && method === "DELETE" && maintenanceMatch[2]) {
      await removeRoomMaintenance(validateRoomId(maintenanceMatch[1]), validateRecordId(maintenanceMatch[2]));
      return json({ deleted: true });
    }
    const deleteRoomMatch = pathname.match(/^\/api\/admin\/rooms\/(\d+)\/delete$/);
    if (deleteRoomMatch && method === "POST") {
      await removeRoom(validateRoomId(deleteRoomMatch[1]));
      return json({ deleted: true });
    }
  }

  if (pathname === "/api/me/bookings" && method === "GET") {
    await releaseExpiredBookings(Date.now());
    return json(await getMyHistory(validateUserId(url.searchParams.get("userId"))));
  }

  if (pathname === "/api/rooms" && method === "GET") {
    await releaseExpiredBookings(Date.now());
    return json(await listRoomViews(Date.now()));
  }

  if (pathname === "/api/rooms/status" && method === "GET") {
    const now = Date.now();
    await releaseExpiredBookings(now);
    return json(await listRoomViews(now));
  }

  if (pathname === "/api/stats" && method === "GET") {
    requireAdmin(request);
    await releaseExpiredBookings(Date.now());
    return json(await getStats());
  }

  if ((pathname === "/api/live" || pathname === "/api/events") && method === "GET") {
    const userId = validateUserId(url.searchParams.get("userId"));
    const now = Date.now();
    await releaseExpiredBookings(now);
    const snapshot = await getLiveSnapshot(userId, now);
    return pathname === "/api/events" ? sse(snapshot) : json(snapshot);
  }

  if (pathname === "/api/bookings" && method === "POST") {
    const body = await readJsonBody(request);
    const { booking, room } = await createBooking({
      userId: body.userId === undefined ? null : validateUserId(body.userId),
      roomId: validateRoomId(body.roomId),
      userName: validateUserName(body.userName),
      durationMinutes: validateDuration(body.durationMinutes),
    });

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

  if (pathname === "/api/waitlist" && method === "POST") {
    const body = await readJsonBody(request);
    await releaseExpiredBookings(Date.now());
    const entry = await joinWaitlist({
      userId: validateUserId(body.userId),
      roomId: validateRoomId(body.roomId),
      userName: validateUserName(body.userName),
      durationMinutes: validateDuration(body.durationMinutes),
    });
    return json(entry, 201);
  }

  const waitlistMatch = pathname.match(/^\/api\/waitlist\/([^/]+)\/(accept|cancel)$/);
  if (waitlistMatch && method === "POST") {
    const waitlistId = validateRecordId(waitlistMatch[1]);
    const body = await readJsonBody(request);
    const userId = validateUserId(body.userId);
    await releaseExpiredBookings(Date.now());
    if (waitlistMatch[2] === "cancel") {
      await cancelWaitlist(waitlistId, userId);
      return json({ cancelled: true });
    }

    const { booking, room } = await acceptWaitlistOffer(waitlistId, userId, Date.now());
    const checkinUrl = `${url.origin}/checkin/${booking.token}`;
    const qrDataUrl = await QRCode.toDataURL(checkinUrl, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    const response: CreateBookingResponse = { booking, room, qrDataUrl, checkinUrl };
    return json(response);
  }

  if (pathname === "/api/recommend" && method === "POST") {
    const body = await readJsonBody(request);
    const recommendationRequest: RecommendRequest = {
      people: validatePeople(body.people),
      needPower: validateFlag(body.needPower, "needPower"),
      needWhiteboard: validateFlag(body.needWhiteboard, "needWhiteboard"),
      preferQuiet: validateFlag(body.preferQuiet, "preferQuiet"),
    };
    await releaseExpiredBookings(Date.now());
    return json({
      recommendations: await recommendRooms(recommendationRequest, Date.now()),
    });
  }

  const checkinMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/checkin$/);
  if (checkinMatch && method === "POST") {
    const token = validateToken(checkinMatch[1]);
    await releaseExpiredBookings(Date.now());
    return json(await checkIn(token));
  }

  const bookingEditMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/(edit|cancel)$/);
  if (bookingEditMatch && method === "POST") {
    const token = validateToken(bookingEditMatch[1]);
    if (bookingEditMatch[2] === "cancel") {
      return json({ booking: await cancelPendingBooking(token) });
    }
    const body = await readJsonBody(request);
    const result = await editPendingBooking(token, {
      roomId: validateRoomId(body.roomId),
      durationMinutes: validateDuration(body.durationMinutes),
      startAt: validateTimestamp(body.startAt),
    });
    return json(result);
  }

  const bookingLiveMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/(live|events)$/);
  if (bookingLiveMatch && method === "GET") {
    const token = validateToken(bookingLiveMatch[1]);
    await releaseExpiredBookings(Date.now());
    const snapshot = await getBookingLiveSnapshot(token);
    return bookingLiveMatch[2] === "events" ? sse(snapshot) : json(snapshot);
  }

  const bookingActionMatch = pathname.match(/^\/api\/bookings\/([^/]+)\/(extend|leave)$/);
  if (bookingActionMatch && method === "POST") {
    const token = validateToken(bookingActionMatch[1]);
    if (bookingActionMatch[2] === "leave") {
      return json({ booking: await leaveBooking(token) });
    }
    const body = await readJsonBody(request);
    const booking = await extendBooking(token, validateTimestamp(body.expectedEndAt));
    return json({ booking });
  }

  const bookingMatch = pathname.match(/^\/api\/bookings\/([^/]+)$/);
  if (bookingMatch && method === "GET") {
    const token = validateToken(bookingMatch[1]);
    await releaseExpiredBookings(Date.now());
    const booking = await findBookingByToken(token);
    if (!booking) throw new HttpError(404, "ไม่พบการจองนี้");
    return json(booking);
  }

  throw new HttpError(404, "ไม่พบ API นี้");
}

function validateBoundedInt(value: unknown, min: number, max: number, label: string): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, `${label}ต้องอยู่ระหว่าง ${min}-${max}`);
  }
  return number;
}

function validateQuietLevel(value: unknown): QuietLevel {
  if (value !== "quiet" && value !== "normal" && value !== "group") {
    throw new HttpError(400, "ระดับความเงียบไม่ถูกต้อง");
  }
  return value;
}

export async function handleApi(request: Request): Promise<Response> {
  try {
    return await routeApi(request, new URL(request.url));
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("[server] ข้อผิดพลาดที่ไม่คาดคิด:", error);
    return json({ error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" }, 500);
  }
}
