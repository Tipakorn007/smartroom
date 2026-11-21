import { checkinStartMessage, checkinWarningMessage, pushToDemoUser } from "../../lib/line.ts";
import { CHECKIN_WINDOW_MS, PRESENCE_REMINDER_WINDOW_MS } from "../shared/constants.ts";
import { query } from "./db.ts";

const RELEASE_WARNING_WINDOW_MS = 5 * 60_000;

export async function sendLineCheckinReminders(now: number): Promise<void> {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_DEMO_USER_ID) return;
  try {
    const bookings = await query<{ id: number | string; room_name: string; send_start: boolean; send_warning: boolean }>(
      `WITH due AS MATERIALIZED (
         SELECT b.id, r.name AS room_name, NOT b.notified_start AS send_start,
                (NOT b.notified_release_warning AND b.start_at + $2 - $3 <= $1) AS send_warning
         FROM bookings b JOIN rooms r ON r.id = b.room_id
         WHERE b.status = 'pending' AND b.start_at <= $1 AND b.start_at + $2 > $1
           AND (NOT b.notified_start OR (NOT b.notified_release_warning AND b.start_at + $2 - $3 <= $1))
           AND NOT EXISTS (SELECT 1 FROM waitlist w WHERE w.booking_id = b.id AND w.status <> 'accepted')
         FOR UPDATE OF b SKIP LOCKED
       )
       UPDATE bookings b
       SET notified_start = TRUE, notified_release_warning = b.notified_release_warning OR due.send_warning
       FROM due WHERE b.id = due.id
       RETURNING b.id, due.room_name, due.send_start, due.send_warning`,
      [now, CHECKIN_WINDOW_MS, RELEASE_WARNING_WINDOW_MS],
    );
    await Promise.all(bookings.map(async (booking) => {
      const stillPending = async (): Promise<boolean> => {
        const rows = await query(
          `SELECT b.id FROM bookings b WHERE b.id = $1 AND b.status = 'pending'
           AND NOT EXISTS (SELECT 1 FROM waitlist w WHERE w.booking_id = b.id AND w.status <> 'accepted')`,
          [booking.id],
        );
        return rows.length > 0;
      };
      if (booking.send_start && await stillPending()) await pushToDemoUser(checkinStartMessage(booking.room_name));
      if (booking.send_warning && await stillPending()) await pushToDemoUser(checkinWarningMessage(booking.room_name));
    }));
  } catch (error) {
    console.error("[LINE] ตรวจแจ้งเตือนเช็กอินไม่สำเร็จ:", error);
  }
}

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
