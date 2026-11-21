import { pushToDemoUser } from "../../lib/line.ts";
import { PRESENCE_REMINDER_WINDOW_MS } from "../shared/constants.ts";
import { query } from "./db.ts";

export async function sendLineReminders(now: number): Promise<void> {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_DEMO_USER_ID) return;
  try {
    const bookings = await query<{ id: number | string; end_at: number | string; room_name: string }>(
      `UPDATE bookings b SET line_reminded_end_at = b.end_at
       FROM rooms r
       WHERE b.room_id = r.id AND b.status = 'active'
         AND b.end_at > $1 AND b.end_at <= $1 + $2
         AND b.line_reminded_end_at IS DISTINCT FROM b.end_at
       RETURNING b.id, b.end_at, r.name AS room_name`,
      [now, PRESENCE_REMINDER_WINDOW_MS],
    );
    await Promise.all(bookings.map(async (booking) => {
      const sent = await pushToDemoUser(`ห้อง ${booking.room_name} จะหมดเวลาอีก 10 นาที ยังใช้อยู่ไหม?`);
      if (!sent) {
        await query(
          "UPDATE bookings SET line_reminded_end_at = NULL WHERE id = $1 AND line_reminded_end_at = $2",
          [booking.id, booking.end_at],
        );
      }
    }));
  } catch (error) {
    console.error("[LINE] ตรวจแจ้งเตือนก่อนหมดเวลาไม่สำเร็จ:", error);
  }
}
