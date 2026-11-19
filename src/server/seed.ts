/**
 * Seed data: nine sample rooms and sample booking history.
 * Deterministic tokens keep initialization idempotent across serverless instances.
 */

import { CHECKIN_WINDOW_MS } from "../shared/constants";
import type { QuietLevel } from "../shared/types";
import { query } from "./db";

interface SeedRoom {
  id: number;
  name: string;
  floor: number;
  capacity: number;
  hasPower: boolean;
  hasWhiteboard: boolean;
  quietLevel: QuietLevel;
}

const SEED_ROOMS: SeedRoom[] = [
  { id: 1, name: "A101", floor: 1, capacity: 2, hasPower: true, hasWhiteboard: false, quietLevel: "quiet" },
  { id: 2, name: "A102", floor: 1, capacity: 4, hasPower: true, hasWhiteboard: true, quietLevel: "normal" },
  { id: 3, name: "A103", floor: 1, capacity: 6, hasPower: false, hasWhiteboard: true, quietLevel: "group" },
  { id: 4, name: "B201", floor: 2, capacity: 4, hasPower: true, hasWhiteboard: true, quietLevel: "quiet" },
  { id: 5, name: "B202", floor: 2, capacity: 8, hasPower: true, hasWhiteboard: false, quietLevel: "group" },
  { id: 6, name: "B203", floor: 2, capacity: 2, hasPower: false, hasWhiteboard: true, quietLevel: "normal" },
  { id: 7, name: "C301", floor: 3, capacity: 12, hasPower: true, hasWhiteboard: true, quietLevel: "group" },
  { id: 8, name: "C302", floor: 3, capacity: 6, hasPower: true, hasWhiteboard: false, quietLevel: "quiet" },
  { id: 9, name: "C303", floor: 3, capacity: 10, hasPower: true, hasWhiteboard: true, quietLevel: "normal" },
];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HISTORY = [
  { roomId: 1, daysAgo: 6, hour: 9, minutes: 60, status: "finished" },
  { roomId: 2, daysAgo: 5, hour: 10, minutes: 120, status: "finished" },
  { roomId: 5, daysAgo: 4, hour: 13, minutes: 60, status: "released" },
  { roomId: 4, daysAgo: 3, hour: 9, minutes: 30, status: "finished" },
  { roomId: 7, daysAgo: 2, hour: 14, minutes: 120, status: "finished" },
  { roomId: 8, daysAgo: 1, hour: 16, minutes: 60, status: "released" },
  { roomId: 9, daysAgo: 0, hour: 13, minutes: 120, status: "finished" },
] as const;
const SAMPLE_NAMES = ["ธนกร ศรีสุข", "ปุณยวีร์ ใจดี", "ณัฐพล วงศ์ทอง", "พิมพ์ชนก แก้วใส"];

export async function seedIfEmpty(): Promise<void> {
  const roomValues = SEED_ROOMS.map((_, index) => {
    const offset = index * 7;
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
  }).join(", ");
  await query(
    `INSERT INTO rooms (id, name, floor, capacity, has_power, has_whiteboard, quiet_level)
     VALUES ${roomValues}
     ON CONFLICT (id) DO NOTHING`,
    SEED_ROOMS.flatMap((room) => [
      room.id,
      room.name,
      room.floor,
      room.capacity,
      room.hasPower,
      room.hasWhiteboard,
      room.quietLevel,
    ]),
  );

  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const datePart = (type: "year" | "month" | "day"): string => {
    const part = dateParts.find((item) => item.type === type);
    if (!part) throw new Error(`ไม่สามารถอ่านวันที่ส่วน ${type} ได้`);
    return part.value;
  };
  const todayStart = Date.parse(
    `${datePart("year")}-${datePart("month")}-${datePart("day")}T00:00:00+07:00`,
  );
  const bookingValues = HISTORY.map((_, index) => {
    const offset = index * 9;
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`;
  }).join(", ");
  const bookingParameters = HISTORY.flatMap((item, index) => {
    const startAt = todayStart - item.daysAgo * DAY + item.hour * HOUR;
    const token = (index + 1).toString(16).padStart(32, "0");
    const checkedInAt = item.status === "finished" ? startAt + 3 * MINUTE : null;
    const releasedAt = item.status === "released" ? startAt + CHECKIN_WINDOW_MS : null;
    return [
      item.roomId,
      SAMPLE_NAMES[index % SAMPLE_NAMES.length],
      startAt,
      startAt + item.minutes * MINUTE,
      item.status,
      token,
      startAt - 2 * HOUR,
      checkedInAt,
      releasedAt,
    ];
  });
  await query(
    `INSERT INTO bookings
       (room_id, user_name, start_at, end_at, status, token, created_at, checked_in_at, released_at)
     VALUES ${bookingValues}
     ON CONFLICT (token) DO NOTHING`,
    bookingParameters,
  );
}
