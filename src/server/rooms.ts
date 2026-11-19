/**
 * Room data and current status. Status is derived from active bookings and time.
 */

import { CHECKIN_WINDOW_MS } from "../shared/constants.ts";
import type { Room, RoomView } from "../shared/types.ts";
import { ensureDatabase, query, toBooking, toRoom, type BookingRow, type RoomRow } from "./db.ts";

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
  const [rooms, rows] = await Promise.all([
    query<RoomRow>("SELECT * FROM rooms ORDER BY floor ASC, name ASC"),
    query<BookingRow>(
      `SELECT * FROM bookings
       WHERE status IN ('pending', 'active') AND start_at <= $1 AND end_at > $1
       ORDER BY start_at ASC`,
      [now],
    ),
  ]);
  const currentBookings = rows.map(toBooking);

  return rooms.map((row) => {
    const room = toRoom(row);
    const currentBooking = currentBookings.find((booking) => booking.roomId === room.id) ?? null;
    if (!currentBooking) {
      return { ...room, status: "available", currentBooking: null, checkinDeadline: null };
    }

    const isPending = currentBooking.status === "pending";
    return {
      ...room,
      status: isPending ? "pending" : "in_use",
      currentBooking,
      checkinDeadline: isPending ? currentBooking.startAt + CHECKIN_WINDOW_MS : null,
    };
  });
}
