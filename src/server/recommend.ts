/**
 * ระบบแนะนำห้อง
 * อัลกอริทึมคือ "ให้คะแนนแล้วเรียงจากน้อยไปมาก" (คะแนนน้อย = เหมาะกว่า) ไม่ใช่ AI
 * จึงอธิบายได้ทุกบรรทัดและผลลัพธ์ซ้ำได้เสมอ
 *
 * ขั้นตอน:
 * 1) กรองห้องที่ "ใช้ได้" = ว่างตอนนี้ ไม่มีคิว และ capacity >= จำนวนคน
 * 2) ให้คะแนนส่วนที่เหลือ:
 *    - ที่นั่งเกินความจำเป็น (capacity - people) คูณ 2 → เปลืองพื้นที่/เครื่องปรับอากาศ
 *    - ขาดคุณสมบัติที่ขอ (ปลั๊ก/ไวท์บอร์ด) บวกเพิ่มอย่างละ 40 คะแนน
 *    - ถ้าขอ "ความเงียบ" แต่ห้องเป็นโซนกลุ่ม +25, โซนทั่วไป +10
 * 3) เรียงคะแนนน้อย→มาก แล้วตัดเอา 3 อันดับแรก
 *
 * หมายเหตุ: เราไม่ตัดห้องที่ขาดคุณสมบัติทิ้ง แต่ "ลงโทษด้วยคะแนน"
 * เพราะบางวันห้องที่ครบทุกอย่างไม่ว่าง ผู้ใช้ยังควรได้ตัวเลือกที่ดีที่สุดเท่าที่มี
 */

import type { Recommendation, RecommendRequest, RoomView } from "../shared/types.ts";
import { ensureDatabase, query, toRoom, type RoomRow } from "./db.ts";

const MISSING_FEATURE_PENALTY = 40;
const SEAT_WASTE_WEIGHT = 2;
const QUIET_PENALTY: Record<string, number> = {
  quiet: 0,
  normal: 10,
  group: 25,
};

export function rankRooms(rooms: RoomView[], request: RecommendRequest): Recommendation[] {
  const best: Array<{ room: RoomView; score: number }> = [];
  for (const room of rooms) {
    if (room.status !== "available" || room.waitlistCount !== 0 || room.capacity < request.people) continue;
    let score = (room.capacity - request.people) * SEAT_WASTE_WEIGHT;
    if (request.needPower && !room.hasPower) score += MISSING_FEATURE_PENALTY;
    if (request.needWhiteboard && !room.hasWhiteboard) score += MISSING_FEATURE_PENALTY;
    if (request.preferQuiet) score += QUIET_PENALTY[room.quietLevel] ?? 0;

    const position = best.findIndex((item) =>
      score < item.score ||
      (score === item.score && (room.capacity < item.room.capacity ||
        (room.capacity === item.room.capacity && room.id < item.room.id))),
    );
    if (position === -1) {
      if (best.length < 3) best.push({ room, score });
    } else {
      best.splice(position, 0, { room, score });
      if (best.length > 3) best.pop();
    }
  }

  return best.map(({ room, score }) => {
    const spareSeats = room.capacity - request.people;
    const reasons = [spareSeats === 0
      ? `ที่นั่งพอดีกับ ${request.people} คน`
      : `จุ ${room.capacity} คน (เหลือ ${spareSeats} ที่)`];
    if (request.needPower) reasons.push(room.hasPower ? "มีปลั๊กไฟ" : "ไม่มีปลั๊กไฟ (+40)");
    if (request.needWhiteboard) reasons.push(room.hasWhiteboard ? "มีไวท์บอร์ด" : "ไม่มีไวท์บอร์ด (+40)");
    if (request.preferQuiet) reasons.push(
      room.quietLevel === "quiet"
        ? "โซนเงียบ"
        : room.quietLevel === "normal"
          ? "โซนทั่วไป (ไม่เงียบเท่าโซนเงียบ)"
          : "โซนกลุ่ม (อาจมีเสียงคุย)",
    );
    return { room, score, reasons };
  });
}

export async function recommendRooms(
  request: RecommendRequest,
  now: number,
): Promise<Recommendation[]> {
  await ensureDatabase();
  // Keep the availability and next-booking rules in sync with listRoomViews.
  const rows = await query<RoomRow & { next_booking_at: number | string | null }>(
    `SELECT r.*, next_booking.start_at AS next_booking_at
     FROM rooms r
     LEFT JOIN LATERAL (
       SELECT b.start_at FROM bookings b
       WHERE b.room_id = r.id AND b.status IN ('pending', 'active') AND b.start_at > $1
       ORDER BY b.start_at ASC LIMIT 1
     ) next_booking ON TRUE
     WHERE r.enabled IS NOT FALSE AND r.capacity >= $2
       AND NOT EXISTS (
         SELECT 1 FROM bookings b WHERE b.room_id = r.id
           AND b.status IN ('pending', 'active') AND b.start_at <= $1 AND b.end_at > $1
       )
       AND NOT EXISTS (
         SELECT 1 FROM waitlist w WHERE w.room_id = r.id AND w.status IN ('waiting', 'offered')
       )
       AND NOT EXISTS (
         SELECT 1 FROM room_maintenance m WHERE m.room_id = r.id AND m.starts_at <= $1 AND m.ends_at > $1
       )
     ORDER BY r.floor ASC, r.name ASC`,
    [now, request.people],
  );
  return rankRooms(rows.map((row) => ({
    ...toRoom(row),
    status: "available",
    currentBooking: null,
    checkinDeadline: null,
    waitlistCount: 0,
    nextBookingAt: row.next_booking_at === null ? null : Number(row.next_booking_at),
  })), request);
}
