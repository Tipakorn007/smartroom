import type { BookingHistoryEntry, MyHistorySnapshot, WaitlistEntry } from "../shared/types.ts";
import { ensureDatabase, query, toBooking, toRoom, type BookingRow } from "./db.ts";
import { getUserWaitlists } from "./waitlist.ts";

interface HistoryBookingRow extends Omit<BookingRow, "room_id"> {
  room_id: number | string;
  room_name: string;
  room_floor: number;
  room_capacity: number;
  room_has_power: boolean;
  room_has_whiteboard: boolean;
  room_quiet_level: string;
  cancelled_at: number | string | null;
}

interface HistoryWaitlistRow {
  id: number | string;
  room_id: number | string;
  room_name: string;
  slot: number | string;
  status: WaitlistEntry["status"];
  created_at: number | string;
  offer_expires_at: number | string | null;
}

export async function getMyHistory(userId: string): Promise<MyHistorySnapshot> {
  await ensureDatabase();
  const [bookingRows, waitlistRows, activeWaitlists] = await Promise.all([
    query<HistoryBookingRow>(`SELECT b.*, r.name AS room_name, r.floor AS room_floor,
      r.capacity AS room_capacity, r.has_power AS room_has_power,
      r.has_whiteboard AS room_has_whiteboard, r.quiet_level AS room_quiet_level
      FROM bookings b JOIN rooms r ON r.id=b.room_id
      WHERE b.user_id=$1 AND NOT EXISTS (
        SELECT 1 FROM waitlist w WHERE w.booking_id=b.id AND w.status <> 'accepted'
      )
      ORDER BY b.created_at DESC`, [userId]),
    query<HistoryWaitlistRow>(`SELECT w.id,w.room_id,r.name AS room_name,w.slot,w.status,w.created_at,w.offer_expires_at
      FROM waitlist w JOIN rooms r ON r.id=w.room_id
      WHERE w.user_id=$1 ORDER BY w.created_at DESC,w.id DESC`, [userId]),
    getUserWaitlists(userId),
  ]);
  const bookings: BookingHistoryEntry[] = bookingRows.map((row) => ({
    booking: toBooking({ ...row, room_id: Number(row.room_id) }),
    room: toRoom({
      id: Number(row.room_id), name: row.room_name, floor: Number(row.room_floor),
      capacity: Number(row.room_capacity), has_power: row.room_has_power,
      has_whiteboard: row.room_has_whiteboard, quiet_level: row.room_quiet_level,
    }),
    cancelled: row.cancelled_at !== null,
  }));
  const waitlists: WaitlistEntry[] = waitlistRows.map((row) => {
    const active = activeWaitlists.find((entry) => entry.id === Number(row.id));
    return {
      id: Number(row.id), roomId: Number(row.room_id), roomName: row.room_name,
      durationMinutes: Number(row.slot), status: row.status, createdAt: Number(row.created_at),
      position: active?.position ?? null,
      offerExpiresAt: row.offer_expires_at === null ? null : Number(row.offer_expires_at),
    };
  });
  return { bookings, waitlists };
}
