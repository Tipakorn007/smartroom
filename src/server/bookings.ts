/**
 * Booking operations. PostgreSQL's exclusion constraint is the final guard
 * against overlapping reservations, including concurrent serverless requests.
 */

import { randomBytes } from "node:crypto";
import {
  CHECKIN_WINDOW_MS,
  PRESENCE_EXTENSION_MS,
  PRESENCE_REMINDER_WINDOW_MS,
} from "../shared/constants.ts";
import type { Booking, BookingLiveSnapshot, BookingWithRoom, Room } from "../shared/types.ts";
import {
  ensureDatabase,
  query,
  queryForRoom,
  toBooking,
  type BookingRow,
  type RoomRow,
} from "./db.ts";
import { HttpError } from "./http.ts";
import { getRoomById } from "./rooms.ts";
import { expireWaitlistOffers, offerNextWaitlist } from "./waitlist.ts";

interface CreateBookingInput {
  userId: string | null;
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

export async function getBookingLiveSnapshot(token: string): Promise<BookingLiveSnapshot> {
  const bookingWithRoom = await findBookingByToken(token);
  if (!bookingWithRoom) throw new HttpError(404, "ไม่พบการจองนี้");
  const rows = await query<{ waitlist_count: number | string }>(
    `SELECT COUNT(*)::integer AS waitlist_count FROM waitlist
     WHERE room_id = $1 AND status IN ('waiting', 'offered')`,
    [bookingWithRoom.room.id],
  );
  return {
    ...bookingWithRoom,
    waitlistCount: Number(rows[0]?.waitlist_count ?? 0),
  };
}

export async function createBooking(
  input: CreateBookingInput,
): Promise<{ booking: Booking; room: Room }> {
  await ensureDatabase();
  const now = Date.now();
  await releaseExpiredBookings(now);

  const room = await getRoomById(input.roomId);
  if (!room) throw new HttpError(404, "ไม่พบห้องที่เลือก");

  const startAt = Math.floor(now / 1000) * 1000;
  const endAt = startAt + input.durationMinutes * MINUTE;
  const token = randomBytes(16).toString("hex");

  try {
    const rows = await queryForRoom<BookingRow>(
      room.id,
      `INSERT INTO bookings
         (room_id, user_id, user_name, start_at, end_at, status, token,
          created_at, checked_in_at, released_at)
       SELECT $1, $2, $3, $4, $5, 'pending', $6, $7, NULL, NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM waitlist
         WHERE room_id = $1 AND status IN ('waiting', 'offered')
       )
       RETURNING *`,
      [room.id, input.userId, input.userName, startAt, endAt, token, now],
    );
    if (!rows[0]) throw new HttpError(409, "มีผู้ใช้รอคิวห้องนี้อยู่ กรุณาเข้าคิวแทนการจอง");
    return { booking: toBooking(rows[0]), room };
  } catch (error) {
    if (error instanceof HttpError) throw error;
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
  const offer = await query(
    `SELECT id FROM waitlist
     WHERE booking_id = $1 AND status = 'offered'`,
    [booking.id],
  );
  if (offer[0]) {
    throw new HttpError(409, "กรุณากดยอมรับข้อเสนอจากหน้าเว็บก่อนเช็กอิน");
  }

  const now = Date.now();
  if (now >= booking.startAt + CHECKIN_WINDOW_MS) {
    const released = await query(
      `UPDATE bookings SET status = 'released', released_at = $1
       WHERE id = $2 AND status = 'pending'
       RETURNING id`,
      [now, booking.id],
    );
    if (released.length > 0) await offerNextWaitlist(booking.roomId, now);
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

export async function leaveBooking(token: string): Promise<Booking> {
  await ensureDatabase();
  const now = Date.now();
  await releaseExpiredBookings(now);
  const booking = await getBookingByToken(token);
  if (!booking) throw new HttpError(404, "ไม่พบการจองนี้");
  if (booking.status !== "active") {
    throw new HttpError(409, "ออกจากห้องได้เฉพาะการจองที่กำลังใช้งาน");
  }

  const rows = await queryForRoom<BookingRow>(
    booking.roomId,
    `UPDATE bookings
     SET status = 'finished'
     WHERE id = $1 AND token = $2 AND status = 'active'
     RETURNING *`,
    [booking.id, token],
  );
  if (!rows[0]) throw new HttpError(409, "สถานะห้องเปลี่ยนแล้ว กรุณารีโหลดหน้าเว็บ");
  await offerNextWaitlist(booking.roomId, now);
  return toBooking(rows[0]);
}

export async function extendBooking(
  token: string,
  expectedEndAt: number,
): Promise<Booking> {
  await ensureDatabase();
  const now = Date.now();
  await releaseExpiredBookings(now);
  const booking = await getBookingByToken(token);
  if (!booking) throw new HttpError(404, "ไม่พบการจองนี้");
  if (booking.status !== "active") {
    throw new HttpError(409, "ต่อเวลาได้เฉพาะห้องที่กำลังใช้งาน");
  }
  if (booking.endAt !== expectedEndAt) {
    throw new HttpError(409, "เวลาการจองเปลี่ยนไปแล้ว กรุณาตรวจสอบข้อมูลล่าสุด");
  }
  if (now < booking.endAt - PRESENCE_REMINDER_WINDOW_MS) {
    throw new HttpError(409, "ยังไม่ถึงเวลาแจ้งเตือนก่อนหมดเวลา");
  }

  try {
    const rows = await queryForRoom<BookingRow>(
      booking.roomId,
      `UPDATE bookings b
       SET end_at = b.end_at + $4
       WHERE b.id = $1 AND b.token = $2 AND b.status = 'active'
         AND b.end_at = $3
         AND b.end_at > $5
         AND NOT EXISTS (
           SELECT 1 FROM waitlist w
           WHERE w.room_id = b.room_id AND w.status IN ('waiting', 'offered')
         )
       RETURNING b.*`,
      [booking.id, token, expectedEndAt, PRESENCE_EXTENSION_MS, now],
    );
    if (rows[0]) return toBooking(rows[0]);

    const queued = await query(
      `SELECT id FROM waitlist
       WHERE room_id = $1 AND status IN ('waiting', 'offered')
       LIMIT 1`,
      [booking.roomId],
    );
    if (queued[0]) throw new HttpError(409, "มีคนรอคิวห้องนี้อยู่ จึงต่อเวลาไม่ได้");
    throw new HttpError(409, "ต่อเวลาไม่สำเร็จ สถานะการจองอาจเปลี่ยนไปแล้ว");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23P01") {
      throw new HttpError(409, "มีการจองถัดไปแล้ว จึงต่อเวลาไม่ได้");
    }
    throw error;
  }
}

export async function releaseExpiredBookings(
  now: number,
): Promise<Array<{ booking: Booking; roomName: string }>> {
  await ensureDatabase();
  await expireWaitlistOffers(now);
  const rows = await query<BookingRoomRow>(
    `UPDATE bookings AS b
     SET status = CASE WHEN b.status = 'pending' THEN 'released' ELSE 'finished' END,
         released_at = CASE WHEN b.status = 'pending' THEN $1 ELSE b.released_at END
     FROM rooms AS r
     WHERE b.room_id = r.id
       AND (
         (b.status = 'pending' AND b.start_at + $2 <= $1)
         OR (b.status = 'active' AND b.end_at <= $1)
       )
     RETURNING b.*, r.name AS room_name`,
    [now, CHECKIN_WINDOW_MS],
  );
  const changedRoomIds = new Set(rows.map((row) => Number(row.room_id)));
  for (const roomId of changedRoomIds) {
     await offerNextWaitlist(roomId, now);
  }
  return rows.filter((row) => row.status === "released").map((row) => ({
    booking: { ...toBooking(row), status: "released", releasedAt: now },
    roomName: row.room_name,
  }));
}
