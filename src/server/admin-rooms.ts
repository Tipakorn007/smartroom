import type { QuietLevel, Room, RoomMaintenance } from "../shared/types.ts";
import { ensureDatabase, query, queryForRoom, toRoom, type MaintenanceRow, type RoomRow } from "./db.ts";
import { HttpError } from "./http.ts";

export interface ManagedRoom extends Room {
  enabled: boolean;
  maintenance: RoomMaintenance[];
}

function toMaintenance(row: MaintenanceRow): RoomMaintenance {
  return {
    id: Number(row.id), roomId: Number(row.room_id),
    startsAt: Number(row.starts_at), endsAt: Number(row.ends_at), reason: row.reason,
  };
}

export async function listManagedRooms(): Promise<ManagedRoom[]> {
  await ensureDatabase();
  const [roomRows, maintenanceRows] = await Promise.all([
    query<RoomRow>("SELECT * FROM rooms ORDER BY floor, name"),
    query<MaintenanceRow>("SELECT * FROM room_maintenance WHERE ends_at > $1 ORDER BY starts_at", [Date.now()]),
  ]);
  return roomRows.map((row) => ({
    ...toRoom(row),
    enabled: row.enabled !== false,
    maintenance: maintenanceRows.filter((item) => Number(item.room_id) === Number(row.id)).map(toMaintenance),
  }));
}

export async function createManagedRoom(input: {
  name: string; floor: number; capacity: number; hasPower: boolean; hasWhiteboard: boolean; quietLevel: QuietLevel;
}): Promise<Room> {
  await ensureDatabase();
  const rows = await queryForRoom<RoomRow>(10_001, `
    INSERT INTO rooms (id, name, floor, capacity, has_power, has_whiteboard, quiet_level)
    SELECT COALESCE(MAX(id), 0) + 1, $1, $2, $3, $4, $5, $6 FROM rooms
    RETURNING *
  `, [input.name, input.floor, input.capacity, input.hasPower, input.hasWhiteboard, input.quietLevel]);
  if (!rows[0]) throw new Error("Room was not created");
  return toRoom(rows[0]);
}

export async function updateManagedRoom(roomId: number, input: Partial<{
  name: string; floor: number; capacity: number; hasPower: boolean; hasWhiteboard: boolean;
  quietLevel: QuietLevel; enabled: boolean;
}>): Promise<void> {
  await ensureDatabase();
  const now = Date.now();
  const existing = await query<RoomRow>("SELECT * FROM rooms WHERE id=$1", [roomId]);
  if (!existing[0]) throw new HttpError(404, "ไม่พบห้องนี้");
  const current = toRoom(existing[0]);
  const enabled = input.enabled ?? existing[0].enabled !== false;
  if (!enabled) {
    const active = await query("SELECT id FROM bookings WHERE room_id = $1 AND status IN ('pending','active') AND end_at > $2 LIMIT 1", [roomId, now]);
    if (active.length) throw new HttpError(409, "ยังมีการจองในห้องนี้ จึงปิดใช้งานไม่ได้");
  }
  const rows = await queryForRoom<RoomRow>(roomId, `UPDATE rooms SET name=$2, floor=$3, capacity=$4, has_power=$5,
      has_whiteboard=$6, quiet_level=$7, enabled=$8 WHERE id=$1
      AND ($8=TRUE OR NOT EXISTS (SELECT 1 FROM bookings WHERE room_id=$1 AND status IN ('pending','active') AND end_at>$9))
      RETURNING *`,
  [roomId, input.name ?? current.name, input.floor ?? current.floor, input.capacity ?? current.capacity,
   input.hasPower ?? current.hasPower, input.hasWhiteboard ?? current.hasWhiteboard,
   input.quietLevel ?? current.quietLevel, enabled, now]);
  if (!rows[0]) throw new HttpError(409, "ยังมีการจองในห้องนี้ จึงปิดใช้งานไม่ได้");
}

export async function addRoomMaintenance(roomId: number, startsAt: number, endsAt: number, reason: string): Promise<RoomMaintenance> {
  await ensureDatabase();
  const room = await query("SELECT id FROM rooms WHERE id=$1", [roomId]);
  if (!room.length) throw new HttpError(404, "ไม่พบห้องนี้");
  const rows = await queryForRoom<MaintenanceRow>(roomId, `
    INSERT INTO room_maintenance (room_id, starts_at, ends_at, reason)
    SELECT $1, $2, $3, $4
    WHERE NOT EXISTS (
      SELECT 1 FROM bookings WHERE room_id=$1 AND status IN ('pending','active')
        AND start_at < $3 AND end_at > $2
    )
    AND NOT EXISTS (
      SELECT 1 FROM room_maintenance WHERE room_id=$1 AND starts_at < $3 AND ends_at > $2
    )
    RETURNING *
  `, [roomId, startsAt, endsAt, reason]);
  if (!rows[0]) throw new HttpError(409, "ช่วงเวลานี้มีการจองหรือช่วงปิดปรับปรุงอยู่แล้ว");
  return toMaintenance(rows[0]);
}

export async function removeRoomMaintenance(roomId: number, maintenanceId: number): Promise<void> {
  await ensureDatabase();
  const rows = await queryForRoom<{ id: number }>(roomId,
    "DELETE FROM room_maintenance WHERE id=$1 AND room_id=$2 RETURNING id", [maintenanceId, roomId]);
  if (!rows.length) throw new HttpError(404, "ไม่พบช่วงปิดปรับปรุงนี้");
}

export async function removeRoom(roomId: number): Promise<void> {
  await ensureDatabase();
  const bookings = await query("SELECT id FROM bookings WHERE room_id=$1 LIMIT 1", [roomId]);
  const maintenance = await query("SELECT id FROM room_maintenance WHERE room_id=$1 LIMIT 1", [roomId]);
  const waitlists = await query("SELECT id FROM waitlist WHERE room_id=$1 LIMIT 1", [roomId]);
  if (bookings.length || maintenance.length || waitlists.length) {
    throw new HttpError(409, "ห้องนี้มีประวัติหรือคิวแล้ว ให้ปิดใช้งานแทนการลบ");
  }
  const rows = await query("DELETE FROM rooms WHERE id=$1 RETURNING id", [roomId]);
  if (!rows.length) throw new HttpError(404, "ไม่พบห้องนี้");
}
