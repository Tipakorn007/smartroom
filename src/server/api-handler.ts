/**
 * REST API handler shared by the local Bun server and Vercel Functions.
 */

import QRCode from "qrcode";
import type { CreateBookingResponse, RecommendRequest } from "../shared/types.ts";
import {
  checkIn,
  createBooking,
  findBookingByToken,
  releaseExpiredBookings,
} from "./bookings.ts";
import { HttpError, json, readJsonBody } from "./http.ts";
import { recommendRooms } from "./recommend.ts";
import { listRoomViews } from "./rooms.ts";
import { getStats } from "./stats.ts";
import {
  validateDuration,
  validateFlag,
  validatePeople,
  validateRoomId,
  validateToken,
  validateUserName,
} from "./validation.ts";

async function routeApi(request: Request, url: URL): Promise<Response> {
  const pathname =
    url.pathname === "/api/index" && url.searchParams.has("route")
      ? `/api/${url.searchParams.get("route")}`
      : url.pathname;
  const method = request.method;

  if (pathname === "/api/rooms" && method === "GET") {
    await releaseExpiredBookings(Date.now());
    return json(await listRoomViews(Date.now()));
  }

  if (pathname === "/api/stats" && method === "GET") {
    await releaseExpiredBookings(Date.now());
    return json(await getStats());
  }

  if (pathname === "/api/bookings" && method === "POST") {
    const body = await readJsonBody(request);
    const { booking, room } = await createBooking({
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

export async function handleApi(request: Request): Promise<Response> {
  try {
    return await routeApi(request, new URL(request.url));
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("[server] ข้อผิดพลาดที่ไม่คาดคิด:", error);
    return json({ error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" }, 500);
  }
}
