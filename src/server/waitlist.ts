import { randomBytes } from "node:crypto";
import { pushToDemoUser } from "../../lib/line.ts";
import { WAITLIST_OFFER_WINDOW_MS } from "../shared/constants.ts";
import type {
  Booking,
  BookingWithRoom,
  LiveSnapshot,
  Room,
  WaitlistEntry,
} from "../shared/types.ts";
import {
  ensureDatabase,
  query,
  queryForRoom,
  queryForRoomAndUser,
  toBooking,
  type BookingRow,
} from "./db.ts";
import { HttpError } from "./http.ts";
import {
  assertUserCanBook,
  NO_SHOW_COOLDOWN_MS,
  NO_SHOW_THRESHOLD,
  NO_SHOW_WINDOW_MS,
} from "./booking-policy.ts";
import { getRoomById, listRoomViews } from "./rooms.ts";

interface WaitlistRow {
  id: number | string;
  room_id: number | string;
  room_name: string;
  user_id: string;
  slot: number | string;
  status: WaitlistEntry["status"];
  created_at: number | string;
  position: number | string | null;
  offer_expires_at: number | string | null;
}

interface RoomIdRow {
  room_id: number | string;
}

interface BookingWithRoomRow extends BookingRow {
  room_name: string;
  room_floor: number;
  room_capacity: number;
  room_has_power: boolean;
  room_has_whiteboard: boolean;
  room_quiet_level: string;
}

function isDatabaseError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function toWaitlistEntry(row: WaitlistRow): WaitlistEntry {
  return {
    id: Number(row.id),
    roomId: Number(row.room_id),
    roomName: row.room_name,
    durationMinutes: Number(row.slot),
    status: row.status,
    createdAt: Number(row.created_at),
    position: row.position === null ? null : Number(row.position),
    offerExpiresAt: row.offer_expires_at === null ? null : Number(row.offer_expires_at),
  };
}

export async function joinWaitlist(input: {
  roomId: number;
  userId: string;
  userName: string;
  durationMinutes: number;
}): Promise<WaitlistEntry> {
  await ensureDatabase();
  const room = await getRoomById(input.roomId);
  if (!room) throw new HttpError(404, "ไม่พบห้องที่เลือก");
  const roomControl = await query<{ enabled: boolean }>("SELECT enabled FROM rooms WHERE id=$1", [input.roomId]);
  if (roomControl[0]?.enabled === false) throw new HttpError(409, "ห้องนี้ปิดใช้งานอยู่");
  const now = Date.now();
  await assertUserCanBook(input.userId, now);
  const existingBooking = await query(
    `SELECT id FROM bookings
     WHERE room_id = $1 AND user_id = $2 AND status IN ('pending', 'active')
     LIMIT 1`,
    [input.roomId, input.userId],
  );
  if (existingBooking[0]) {
    throw new HttpError(409, "คุณมีการจองห้องนี้อยู่แล้ว");
  }

  try {
    const rows = await queryForRoom<{ id: number | string }>(
      input.roomId,
      `INSERT INTO waitlist (room_id, user_id, user_name, slot, created_at, status)
       SELECT $1, $2, $3, $4, $5, 'waiting'
       WHERE (
         EXISTS (
           SELECT 1 FROM bookings
           WHERE room_id = $1 AND status IN ('pending', 'active')
             AND end_at > $5
         ) OR EXISTS (
           SELECT 1 FROM waitlist
           WHERE room_id = $1 AND status IN ('waiting', 'offered')
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM bookings
         WHERE room_id = $1 AND user_id = $2 AND status IN ('pending', 'active')
       )
       RETURNING id`,
      [input.roomId, input.userId, input.userName, input.durationMinutes, now],
    );
    if (!rows[0]) {
      const currentBooking = await query(
        `SELECT id FROM bookings
         WHERE room_id = $1 AND user_id = $2 AND status IN ('pending', 'active')
         LIMIT 1`,
        [input.roomId, input.userId],
      );
      if (currentBooking[0]) throw new HttpError(409, "คุณมีการจองห้องนี้อยู่แล้ว");
      throw new HttpError(409, "ห้องนี้ว่างแล้ว กรุณาจองห้องแทนการเข้าคิว");
    }

    const entries = await getUserWaitlists(input.userId);
    const entry = entries.find((item) => item.id === Number(rows[0]?.id));
    if (!entry) throw new Error("Waitlist insert was not visible after creation");
    return entry;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (isDatabaseError(error, "23505")) {
      throw new HttpError(409, "คุณอยู่ในคิวของห้องนี้แล้ว");
    }
    throw error;
  }
}

export async function acceptWaitlistOffer(
  waitlistId: number,
  userId: string,
  now: number,
): Promise<{ booking: Booking; room: Room }> {
  await ensureDatabase();

  const existing = await query<BookingRow>(
    `SELECT b.*
     FROM waitlist w
     JOIN bookings b ON b.id = w.booking_id
     WHERE w.id = $1 AND w.user_id = $2 AND w.status = 'accepted'
       AND b.status IN ('pending', 'active')`,
    [waitlistId, userId],
  );
  if (existing[0]) {
    const booking = toBooking(existing[0]);
    const room = await getRoomById(booking.roomId);
    if (room) return { booking, room };
  }

  const eligible = await query<{ room_id: number | string; booking_id: number | string }>(
    `SELECT room_id, booking_id FROM waitlist
     WHERE id = $1 AND user_id = $2 AND status = 'offered' AND offer_expires_at > $3`,
    [waitlistId, userId, now],
  );
  const roomId = eligible[0] ? Number(eligible[0].room_id) : null;
  if (roomId === null) throw new HttpError(409, "ข้อเสนอหมดเวลาหรือไม่พบคิวของคุณ");

  await assertUserCanBook(userId, now, Number(eligible[0]?.booking_id));
  const rows = await queryForRoomAndUser<BookingRow>(
    roomId,
    userId,
    `WITH updated_booking AS (
       UPDATE bookings b
       SET start_at = $3, end_at = $3 + w.slot * 60000
       FROM waitlist w
       WHERE w.id = $1 AND w.user_id = $2 AND w.status = 'offered'
         AND w.offer_expires_at > $3 AND w.booking_id = b.id
         AND b.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM bookings other WHERE other.user_id=$2
             AND other.status IN ('pending','active') AND other.id<>b.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM bookings other
           WHERE other.room_id = b.room_id AND other.id <> b.id
             AND other.status IN ('pending', 'active')
             AND other.start_at < $3 + w.slot * 60000 AND other.end_at > $3
         )
         AND NOT EXISTS (
           SELECT 1 FROM room_maintenance m
           WHERE m.room_id = b.room_id
             AND m.starts_at < $3 + w.slot * 60000 AND m.ends_at > $3
         )
       RETURNING b.*
     ),
     accepted AS (
       UPDATE waitlist w
       SET status = 'accepted', offer_expires_at = NULL
       FROM updated_booking b
       WHERE w.id = $1 AND w.status = 'offered'
       RETURNING w.id
     )
     SELECT b.* FROM updated_booking b JOIN accepted ON TRUE`,
    [waitlistId, userId, now],
  );
  if (!rows[0]) throw new HttpError(409, "รับข้อเสนอไม่สำเร็จ กรุณาตรวจสอบสถานะคิวอีกครั้ง");

  const booking = toBooking(rows[0]);
  const room = await getRoomById(booking.roomId);
  if (!room) throw new HttpError(404, "ไม่พบห้องของข้อเสนอนี้");
  return { booking, room };
}

export async function cancelWaitlist(waitlistId: number, userId: string): Promise<void> {
  await ensureDatabase();
  const entry = await query<{ room_id: number | string }>(
    `SELECT room_id FROM waitlist
     WHERE id = $1 AND user_id = $2 AND status IN ('waiting', 'offered')`,
    [waitlistId, userId],
  );
  if (!entry[0]) throw new HttpError(404, "ไม่พบคิวที่ยกเลิกได้");

  const roomId = Number(entry[0].room_id);
  const now = Date.now();
  const rows = await queryForRoom<RoomIdRow>(
    roomId,
    `WITH cancelled AS (
       UPDATE waitlist
       SET status = 'cancelled', offer_expires_at = NULL
       WHERE id = $1 AND user_id = $2 AND status IN ('waiting', 'offered')
       RETURNING room_id, booking_id
     ),
     released AS (
       UPDATE bookings b
       SET status = 'released', released_at = $3
       FROM cancelled c
       WHERE b.id = c.booking_id AND b.status = 'pending'
       RETURNING b.id
     )
     SELECT room_id FROM cancelled`,
    [waitlistId, userId, now],
  );
  if (!rows[0]) throw new HttpError(409, "สถานะคิวเปลี่ยนไปแล้ว กรุณารีโหลดหน้าเว็บ");
  await offerNextWaitlist(roomId, now);
}

/** Offer the newly available room to the oldest waiting entry. */
export async function offerNextWaitlist(roomId: number, now: number): Promise<void> {
  await ensureDatabase();
  const token = randomBytes(16).toString("hex");
  const candidateQuery = `
    SELECT w.id, w.room_id, w.user_id, w.user_name, w.slot
    FROM waitlist w
    WHERE w.room_id = $1 AND w.status = 'waiting'
      AND ($6::text IS NULL OR w.user_id = $6)
      AND NOT (w.user_id = ANY($7::text[]))
      AND NOT EXISTS (
        SELECT 1 FROM bookings existing
        WHERE existing.user_id=w.user_id AND existing.status IN ('pending','active')
      )
      AND NOT EXISTS (
        SELECT 1 FROM bookings strike
        WHERE strike.user_id=w.user_id AND strike.no_show=TRUE
          AND strike.released_at > $2::bigint - $3::bigint
        GROUP BY strike.user_id
        HAVING COUNT(*) >= $5 AND MAX(strike.released_at) + $4::bigint > $2
      )
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.room_id = $1 AND b.status IN ('pending', 'active') AND b.end_at > $2
      )
      AND NOT EXISTS (
        SELECT 1 FROM rooms r WHERE r.id=$1 AND r.enabled=FALSE
      )
      AND NOT EXISTS (
        SELECT 1 FROM room_maintenance m
        WHERE m.room_id=$1 AND m.starts_at < $2 + w.slot * 60000 AND m.ends_at > $2
      )
      AND NOT EXISTS (
        SELECT 1 FROM waitlist offered
        WHERE offered.room_id = $1 AND offered.status = 'offered'
          AND offered.offer_expires_at > $2
      )
    ORDER BY w.created_at ASC, w.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED`;
  const policyParams = [roomId, now, NO_SHOW_WINDOW_MS, NO_SHOW_COOLDOWN_MS, NO_SHOW_THRESHOLD];
  try {
    const attemptedUsers: string[] = [];
    while (true) {
      const candidates = await query<{ user_id: string }>(candidateQuery, [...policyParams, null, attemptedUsers]);
      if (!candidates[0]) return;
      const userId = candidates[0].user_id;
      const offered = await queryForRoomAndUser<{ room_name: string }>(
        roomId,
        userId,
        `WITH candidate AS MATERIALIZED (${candidateQuery}),
         offered_booking AS (
           INSERT INTO bookings
             (room_id, user_id, user_name, start_at, end_at, status, token,
              created_at, checked_in_at, released_at)
           SELECT room_id, user_id, user_name, $2, $2 + slot * 60000, 'pending',
                  $8, $2, NULL, NULL
           FROM candidate
           RETURNING id, room_id
         )
         UPDATE waitlist w
         SET status = 'offered',
             offer_expires_at = $2 + $9,
             booking_id = b.id
         FROM offered_booking b
         WHERE w.id = (SELECT id FROM candidate) AND w.status = 'waiting'
         RETURNING (SELECT name FROM rooms WHERE id = w.room_id) AS room_name`,
        [...policyParams, userId, attemptedUsers, token, WAITLIST_OFFER_WINDOW_MS],
      );
      if (offered[0]) {
        await pushToDemoUser(`ห้อง ${offered[0].room_name} ว่างแล้ว! ตอบรับภายใน 5 นาที`);
        return;
      }
      attemptedUsers.push(userId);
    }
  } catch (error) {
    if (isDatabaseError(error, "23P01")) {
      console.warn(`[waitlist] ห้อง ${roomId} ถูกจองระหว่างกำลังส่งข้อเสนอ จะลองใหม่รอบถัดไป`);
      return;
    }
    throw error;
  }
}

/** Expire timed-out offers, release their holds, and offer the room to the next user. */
export async function expireWaitlistOffers(now: number): Promise<void> {
  await ensureDatabase();
  const expired = await query<RoomIdRow>(
    `SELECT DISTINCT room_id FROM waitlist
     WHERE status = 'offered' AND offer_expires_at <= $1`,
    [now],
  );

  for (const row of expired) {
    const roomId = Number(row.room_id);
    const changed = await queryForRoom<RoomIdRow>(
      roomId,
      `WITH expired AS (
         UPDATE waitlist
         SET status = 'expired', offer_expires_at = NULL
         WHERE room_id = $1 AND status = 'offered' AND offer_expires_at <= $2
         RETURNING booking_id
       )
       UPDATE bookings b
       SET status = 'released', released_at = $2
       FROM expired e
       WHERE b.id = e.booking_id AND b.status = 'pending'
       RETURNING b.room_id`,
      [roomId, now],
    );
    if (changed[0]) await offerNextWaitlist(roomId, now);
  }
}

export async function getUserWaitlists(userId: string): Promise<WaitlistEntry[]> {
  await ensureDatabase();
  const rows = await query<WaitlistRow>(
    `SELECT w.id, w.room_id, r.name AS room_name, w.user_id, w.slot, w.status,
            w.created_at, w.offer_expires_at,
            CASE WHEN w.status = 'waiting' THEN (
              SELECT COUNT(*)::integer + 1
              FROM waitlist prior
              WHERE prior.room_id = w.room_id AND prior.status = 'waiting'
                AND (prior.created_at < w.created_at
                  OR (prior.created_at = w.created_at AND prior.id < w.id))
            ) ELSE NULL END AS position
     FROM waitlist w
     JOIN rooms r ON r.id = w.room_id
     WHERE w.user_id = $1 AND w.status IN ('waiting', 'offered')
     ORDER BY w.created_at ASC, w.id ASC`,
    [userId],
  );
  return rows.map(toWaitlistEntry);
}

async function getUserBookings(userId: string): Promise<BookingWithRoom[]> {
  const rows = await query<BookingWithRoomRow>(
    `SELECT b.*, r.name AS room_name, r.floor AS room_floor,
            r.capacity AS room_capacity, r.has_power AS room_has_power,
            r.has_whiteboard AS room_has_whiteboard, r.quiet_level AS room_quiet_level
     FROM bookings b
     JOIN rooms r ON r.id = b.room_id
     WHERE b.user_id = $1 AND b.status IN ('pending', 'active')
       AND NOT EXISTS (
         SELECT 1 FROM waitlist w
         WHERE w.booking_id = b.id AND w.status = 'offered'
       )
     ORDER BY b.created_at DESC`,
    [userId],
  );
  return rows.map((row) => ({
    booking: toBooking(row),
    room: {
      id: Number(row.room_id),
      name: row.room_name,
      floor: Number(row.room_floor),
      capacity: Number(row.room_capacity),
      hasPower: row.room_has_power,
      hasWhiteboard: row.room_has_whiteboard,
      quietLevel: row.room_quiet_level as Room["quietLevel"],
    },
  }));
}

export async function getLiveSnapshot(userId: string, now: number): Promise<LiveSnapshot> {
  await ensureDatabase();
  const [rooms, myWaitlists, myBookings] = await Promise.all([
    listRoomViews(now),
    getUserWaitlists(userId),
    getUserBookings(userId),
  ]);
  return { rooms, myWaitlists, myBookings };
}
