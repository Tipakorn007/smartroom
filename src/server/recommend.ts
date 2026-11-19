/**
 * ระบบแนะนำห้อง
 * อัลกอริทึมคือ "ให้คะแนนแล้วเรียงจากน้อยไปมาก" (คะแนนน้อย = เหมาะกว่า) ไม่ใช่ AI
 * จึงอธิบายได้ทุกบรรทัดและผลลัพธ์ซ้ำได้เสมอ
 *
 * ขั้นตอน:
 * 1) กรองห้องที่ "ใช้ได้" = ว่างตอนนี้ และ capacity >= จำนวนคน
 * 2) ให้คะแนนส่วนที่เหลือ:
 *    - ที่นั่งเกินความจำเป็น (capacity - people) คูณ 2 → เปลืองพื้นที่/เครื่องปรับอากาศ
 *    - ขาดคุณสมบัติที่ขอ (ปลั๊ก/ไวท์บอร์ด) บวกเพิ่มอย่างละ 40 คะแนน
 *    - ถ้าขอ "ความเงียบ" แต่ห้องเป็นโซนกลุ่ม +25, โซนทั่วไป +10
 * 3) เรียงคะแนนน้อย→มาก แล้วตัดเอา 3 อันดับแรก
 *
 * หมายเหตุ: เราไม่ตัดห้องที่ขาดคุณสมบัติทิ้ง แต่ "ลงโทษด้วยคะแนน"
 * เพราะบางวันห้องที่ครบทุกอย่างไม่ว่าง ผู้ใช้ยังควรได้ตัวเลือกที่ดีที่สุดเท่าที่มี
 */

import type { Recommendation, RecommendRequest } from "../shared/types";
import { listRoomViews } from "./rooms";
import { ensureDatabase } from "./db";

const MISSING_FEATURE_PENALTY = 40;
const SEAT_WASTE_WEIGHT = 2;
const QUIET_PENALTY: Record<string, number> = {
  quiet: 0,
  normal: 10,
  group: 25,
};

export async function recommendRooms(request: RecommendRequest, now: number): Promise<Recommendation[]> {
  await ensureDatabase();
  const availableRooms = (await listRoomViews(now)).filter(
    (room) => room.status === "available" && room.capacity >= request.people,
  );

  const scored: Recommendation[] = availableRooms.map((room) => {
    const reasons: string[] = [];
    const spareSeats = room.capacity - request.people;
    let score = spareSeats * SEAT_WASTE_WEIGHT;

    // เหตุผลข้อแรกอธิบายความจุเสมอ เพราะเป็นเงื่อนไขที่ผู้ใช้กรอกเอง
    if (spareSeats === 0) {
      reasons.push(`ที่นั่งพอดีกับ ${request.people} คน`);
    } else {
      reasons.push(`จุ ${room.capacity} คน (เหลือ ${spareSeats} ที่)`);
    }

    if (request.needPower) {
      if (room.hasPower) {
        reasons.push("มีปลั๊กไฟ");
      } else {
        score += MISSING_FEATURE_PENALTY;
        reasons.push("ไม่มีปลั๊กไฟ (−40)");
      }
    }

    if (request.needWhiteboard) {
      if (room.hasWhiteboard) {
        reasons.push("มีไวท์บอร์ด");
      } else {
        score += MISSING_FEATURE_PENALTY;
        reasons.push("ไม่มีไวท์บอร์ด (−40)");
      }
    }

    if (request.preferQuiet) {
      const penalty = QUIET_PENALTY[room.quietLevel] ?? 0;
      score += penalty;
      reasons.push(
        room.quietLevel === "quiet"
          ? "โซนเงียบ"
          : room.quietLevel === "normal"
            ? "โซนทั่วไป (ไม่เงียบเท่าโซนเงียบ)"
            : "โซนกลุ่ม (อาจมีเสียงคุย)",
      );
    }

    return { room, score, reasons };
  });

  return scored
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score; // คะแนนดีกว่าขึ้นก่อน
      if (a.room.capacity !== b.room.capacity) return a.room.capacity - b.room.capacity;
      return a.room.id - b.room.id; // กันลำดับสลับเมื่อคะแนนเท่ากัน
    })
    .slice(0, 3);
}
