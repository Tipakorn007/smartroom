/**
 * Facility statistics, computed directly from persisted booking data.
 */

import type { PeakHour, RoomUsage, StatsResponse } from "../shared/types";
import { ensureDatabase, query } from "./db";
import { listRoomViews } from "./rooms";

async function countRows(statement: string): Promise<number> {
  const rows = await query<{ value: number | string }>(statement);
  return Number(rows[0]?.value ?? 0);
}

export async function getStats(now: number = Date.now()): Promise<StatsResponse> {
  await ensureDatabase();
  const [
    totalBookings,
    releasedBookings,
    checkedInBookings,
    totalRooms,
    rooms,
    peakHours,
    leastUsedRooms,
  ] = await Promise.all([
    countRows("SELECT COUNT(*) AS value FROM bookings"),
    countRows("SELECT COUNT(*) AS value FROM bookings WHERE status = 'released'"),
    countRows("SELECT COUNT(*) AS value FROM bookings WHERE checked_in_at IS NOT NULL"),
    countRows("SELECT COUNT(*) AS value FROM rooms"),
    listRoomViews(now),
    query<PeakHour>(
      `SELECT EXTRACT(HOUR FROM to_timestamp(start_at / 1000.0) AT TIME ZONE 'Asia/Bangkok')::integer AS hour,
              COUNT(*)::integer AS bookings
       FROM bookings
       GROUP BY hour
       ORDER BY bookings DESC, hour ASC
       LIMIT 3`,
    ),
    query<RoomUsage>(
      `SELECT r.id AS "roomId", r.name AS "roomName", r.floor,
              COUNT(b.id)::integer AS "checkedInCount"
       FROM rooms r
       LEFT JOIN bookings b ON b.room_id = r.id AND b.checked_in_at IS NOT NULL
       GROUP BY r.id
       ORDER BY "checkedInCount" ASC, r.floor ASC, r.name ASC
       LIMIT 3`,
    ),
  ]);
  const availableRooms = rooms.filter((room) => room.status === "available").length;

  return {
    totalBookings,
    releasedBookings,
    checkedInBookings,
    utilizationRate:
      totalBookings === 0 ? 0 : Math.round((checkedInBookings / totalBookings) * 1000) / 10,
    totalRooms,
    availableRooms,
    peakHours: peakHours.map((row) => ({ hour: Number(row.hour), bookings: Number(row.bookings) })),
    leastUsedRooms: leastUsedRooms.map((row) => ({
      ...row,
      roomId: Number(row.roomId),
      floor: Number(row.floor),
      checkedInCount: Number(row.checkedInCount),
    })),
  };
}
