/**
 * ตัวตั้งเวลาฝั่ง server (background job)
 * ตรวจทุก 30 วินาทีว่ามีการจองที่เลยเวลาเช็กอินหรือยัง ถ้ามีก็ปล่อยคืนและแจ้งทุกหน้าจอ
 * ทำไมต้องมี: ถ้ารอให้ผู้ใช้เปิดหน้าเว็บก่อน ห้องที่ไม่มีคนมาก็จะถูกบล็อกต่อไปเรื่อย ๆ
 */

import { CHECKIN_WINDOW_MS, SWEEP_INTERVAL_MS } from "../shared/constants";
import { releaseExpiredBookings } from "./bookings";

/**
 * ตรวจหนึ่งรอบ แล้วคืนจำนวนห้องที่ถูกปล่อย
 * แยกออกจาก startSweeper เพื่อให้เรียกทดสอบด้วยมือได้
 */
export async function runSweep(now: number = Date.now()): Promise<number> {
  const released = await releaseExpiredBookings(now);
  for (const item of released) {
    console.log(
      `[sweeper] ปล่อยคืนห้อง ${item.roomName} (ผู้จอง: ${item.booking.userName}) เพราะไม่เช็กอินภายใน 15 นาที`,
    );
  }
  return released.length;
}

/**
 * เริ่มตัวตั้งเวลา: ตรวจทันทีหนึ่งครั้งตอนบูต แล้วตรวจซ้ำทุก 30 วินาที
 * คืน timer เผื่อผู้เรียกอยากหยุด (เช่นตอนทดสอบ)
 */
export function startSweeper(): ReturnType<typeof setInterval> {
  void runSweep().catch((error: unknown) => {
    console.error("[sweeper] ตรวจการจองไม่สำเร็จ:", error);
  });
  const timer = setInterval(() => {
    void runSweep().catch((error: unknown) => {
      console.error("[sweeper] ตรวจการจองไม่สำเร็จ:", error);
    });
  }, SWEEP_INTERVAL_MS);
  console.log(
    `[sweeper] เริ่มทำงานแล้ว ตรวจทุก ${SWEEP_INTERVAL_MS / 1000} วินาที (สิทธิ์เช็กอิน ${CHECKIN_WINDOW_MS / 60000} นาที)`,
  );
  return timer;
}
