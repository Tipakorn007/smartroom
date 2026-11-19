/**
 * Booking operations. PostgreSQL's exclusion constraint is the final guard
 * against overlapping reservations, including concurrent serverless requests.
 */

import { randomBytes } from "node:crypto";
import { CHECKIN_WINDOW_MS } from "../shared/constants.ts";
import type { Booking, BookingWithRoom, Room } from "../shared/types.ts";
import { ensureDatabase, query, toBooking, type BookingRow, type RoomRow } from "./db.ts";
import { HttpError } from "./http.ts";
import { getRoomById } from "./rooms.ts";

interface CreateBookingInput {
  roomId: number;
  userName: string;
  durationMinutes: number;
}

interface BookingRoomRow extends BookingRow {
  room_name: string;
}

const MINUTE = 60 * 1000;

export async function getBookingByToken(token: string): Promise<Booking | null> {
  await ensureDatabase();
  const rows = await query<BookingRow>("SELECT * FROM bookings WHERE token = $1", [token]);
  return rows[0] ? toBooking(rows[0]) : null;
}

export async function findBookingByToken(token: string): Promise<BookingWithRoom | null> {
  const booking = await getBookingByToken(token);
  if (!booking) return null;
  const room = await getRoomById(booking.roomId);
  return room ? { booking, room } : null;
}

export async function createBooking(
  input: CreateBookingInput,
): Promise<{ booking: Booking; room: Room }> {
  await ensureDatabase();
  await releaseExpiredBookings(Date.now());

  const room = await getRoomById(input.roomId);
  if (!room) throw new HttpError(404, "ไม่พบห้องที่เลือก");

  const startAt = Math.floor(Date.now() / 1000) * 1000;
  const endAt = startAt + input.durationMinutes * MINUTE;
  const token = randomBytes(16).toString("hex");

  try {
    const rows = await query<BookingRow>(
      `INSERT INTO bookings
         (room_id, user_name, start_at, end_at, status, token, created_at, checked_in_at, released_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, NULL, NULL)
       RETURNING *`,
      [room.id, input.userName, startAt, endAt, token, Date.now()],
    );
    if (!rows[0]) throw new Error("Booking insert returned no row");
    return { booking: toBooking(rows[0]), room };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23P01") {
      throw new HttpError(409, "ห้องนี้ถูกจองอยู่ในช่วงเวลานี้ กรุณาเลือกห้องอื่นหรือรอให้ห้องว่าง");
    }
    throw error;
  }
}

export async function checkIn(
  token: string,
): Promise<{ booking: Booking; room: Room; alreadyCheckedIn: boolean }> {
  await ensureDatabase();
  const booking = await getBookingByToken(token);
  if (!booking) throw new HttpError(404, "ไม่พบการจองนี้");

  const room = await getRoomById(booking.roomId);
  if (!room) throw new HttpError(404, "ไม่พบห้องของการจองนี้");
  if (booking.status === "active") return { booking, room, alreadyCheckedIn: true };
  if (booking.status === "released") {
    throw new HttpError(409, "การจองนี้ถูกปล่อยคืนแล้ว เพราะไม่ได้เช็กอินภายใน 15 นาที");
  }
  if (booking.status === "finished") {
    throw new HttpError(409, "การจองนี้สิ้นสุดเวลาใช้งานแล้ว");
  }

  const now = Date.now();
  if (now >= booking.startAt + CHECKIN_WINDOW_MS) {
    await query(
      `UPDATE bookings SET status = 'released', released_at = $1
       WHERE id = $2 AND status = 'pending'`,
      [now, booking.id],
    );
    throw new HttpError(409, "เลยเวลาเช็กอิน 15 นาทีแล้ว ห้องนี้ถูกปล่อยคืน");
  }

  const rows = await query<BookingRow>(
    `UPDATE bookings SET status = 'active', checked_in_at = $1
     WHERE id = $2 AND status = 'pending'
     RETURNING *`,
    [now, booking.id],
  );
  if (rows[0]) return { booking: toBooking(rows[0]), room, alreadyCheckedIn: false };

  const latest = await getBookingByToken(token);
  if (latest?.status === "active") return { booking: latest, room, alreadyCheckedIn: true };
  if (latest?.status === "released") {
    throw new HttpError(409, "การจองนี้ถูกปล่อยคืนแล้ว เพราะไม่ได้เช็กอินภายใน 15 นาที");
  }
  throw new HttpError(409, "ไม่สามารถเช็กอินการจองนี้ได้");
}

export async function releaseExpiredBookings(
  now: number,
): Promise<Array<{ booking: Booking; roomName: string }>> {
  await ensureDatabase();
  const rows = await query<BookingRoomRow>(
    `UPDATE bookings AS b
     SET status = 'released', released_at = $1
     FROM rooms AS r
     WHERE b.room_id = r.id
       AND b.status = 'pending'
       AND b.start_at + $2 <= $1
     RETURNING b.*, r.name AS room_name`,
    [now, CHECKIN_WINDOW_MS],
  );
  return rows.map((row) => ({
    booking: { ...toBooking(row), status: "released", releasedAt: now },
    roomName: row.room_name,
  }));
}
