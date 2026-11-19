/**
 * Room data and current status. Status is derived from active bookings and time.
 */

import { CHECKIN_WINDOW_MS } from "../shared/constants.ts";
import type { CurrentBookingSummary, Room, RoomView } from "../shared/types.ts";
import { ensureDatabase, query, toRoom, type RoomRow } from "./db.ts";

interface CurrentBookingRow {
  room_id: number;
  start_at: number | string;
  end_at: number | string;
  status: "pending" | "active";
  waitlist_status: "offered" | null;
}

interface WaitlistCountRow {
  room_id: number;
  waitlist_count: number | string;
}

interface MaintenanceStatusRow {
  room_id: number | string;
  ends_at: number | string;
  reason: string;
}

interface NextBookingRow {
  room_id: number | string;
  start_at: number | string;
}

export async function listRooms(): Promise<Room[]> {
  await ensureDatabase();
  const rows = await query<RoomRow>("SELECT * FROM rooms ORDER BY floor ASC, name ASC");
  return rows.map(toRoom);
}

export async function getRoomById(roomId: number): Promise<Room | null> {
  await ensureDatabase();
  const rows = await query<RoomRow>("SELECT * FROM rooms WHERE id = $1", [roomId]);
  return rows[0] ? toRoom(rows[0]) : null;
}

export async function listRoomViews(now: number): Promise<RoomView[]> {
  await ensureDatabase();
  const [rooms, rows, waitlistRows, maintenanceRows, nextBookingRows] = await Promise.all([
    query<RoomRow>("SELECT * FROM rooms ORDER BY floor ASC, name ASC"),
    query<CurrentBookingRow>(
      `SELECT b.room_id, b.start_at, b.end_at, b.status,
              CASE WHEN w.status = 'offered' AND w.offer_expires_at > $1
                   THEN 'offered' ELSE NULL END AS waitlist_status
       FROM bookings b
       LEFT JOIN waitlist w ON w.booking_id = b.id AND w.status = 'offered'
       WHERE b.status IN ('pending', 'active') AND b.start_at <= $1 AND b.end_at > $1
       ORDER BY b.start_at ASC`,
      [now],
    ),
    query<WaitlistCountRow>(
      `SELECT room_id, COUNT(*)::integer AS waitlist_count
       FROM waitlist
       WHERE status IN ('waiting', 'offered')
       GROUP BY room_id`,
    ),
    query<MaintenanceStatusRow>(
      `SELECT DISTINCT ON (room_id) room_id, ends_at, reason
       FROM room_maintenance WHERE starts_at <= $1 AND ends_at > $1
       ORDER BY room_id, ends_at ASC`, [now],
    ),
    query<NextBookingRow>(
      `SELECT DISTINCT ON (room_id) room_id, start_at FROM bookings
       WHERE status IN ('pending','active') AND start_at > $1
       ORDER BY room_id, start_at ASC`, [now],
    ),
  ]);
  const currentBookings = rows.map((row) => ({
    roomId: Number(row.room_id),
    booking: {
      status: row.waitlist_status === "offered" ? "offered" : row.status,
      startAt: Number(row.start_at),
      endAt: Number(row.end_at),
    } satisfies CurrentBookingSummary,
  }));
  const waitlistCounts = new Map(
    waitlistRows.map((row) => [Number(row.room_id), Number(row.waitlist_count)]),
  );
  const activeMaintenance = new Map(maintenanceRows.map((row) => [Number(row.room_id), row]));
  const nextBookings = new Map(nextBookingRows.map((row) => [Number(row.room_id), Number(row.start_at)]));

  return rooms.map((row) => {
    const room = toRoom(row);
    const currentBooking =
      currentBookings.find((booking) => booking.roomId === room.id)?.booking ?? null;
    const maintenance = activeMaintenance.get(room.id);
    if (row.enabled === false || maintenance) {
      return {
        ...room,
        status: "closed",
        currentBooking: null,
        checkinDeadline: null,
        waitlistCount: waitlistCounts.get(room.id) ?? 0,
        closureEndsAt: row.enabled === false ? null : Number(maintenance?.ends_at),
        closureReason: row.enabled === false ? "ปิดใช้งานชั่วคราว" : maintenance?.reason ?? null,
        nextBookingAt: nextBookings.get(room.id) ?? null,
      };
    }
    if (!currentBooking) {
      return {
        ...room,
        status: "available",
        currentBooking: null,
        checkinDeadline: null,
        waitlistCount: waitlistCounts.get(room.id) ?? 0,
        nextBookingAt: nextBookings.get(room.id) ?? null,
      };
    }

    const isPending = currentBooking.status === "pending";
    return {
      ...room,
      status: currentBooking.status === "offered" ? "offered" : isPending ? "pending" : "in_use",
      currentBooking,
      checkinDeadline: isPending ? currentBooking.startAt + CHECKIN_WINDOW_MS : null,
      waitlistCount: waitlistCounts.get(room.id) ?? 0,
      nextBookingAt: nextBookings.get(room.id) ?? null,
    };
  });
}
