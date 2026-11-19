import { query } from "./db.ts";
import { HttpError } from "./http.ts";

const NO_SHOW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const NO_SHOW_THRESHOLD = 3;
const NO_SHOW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function assertUserCanBook(userId: string | null, now: number, exceptBookingId?: number): Promise<void> {
  if (!userId) return;
  const active = await query<{ id: number }>(
    `SELECT id FROM bookings WHERE user_id=$1 AND status IN ('pending','active')
     AND ($2::bigint IS NULL OR id <> $2) LIMIT 1`, [userId, exceptBookingId ?? null],
  );
  if (active.length) throw new HttpError(409, "คุณมีการจองที่ยังไม่จบอยู่แล้ว ยกเลิกหรือจบรายการเดิมก่อน");
  const strikes = await query<{ count: number | string; latest: number | string | null }>(
    `SELECT COUNT(*)::integer AS count, MAX(released_at) AS latest FROM bookings
     WHERE user_id=$1 AND no_show=TRUE AND released_at > $2`, [userId, now - NO_SHOW_WINDOW_MS],
  );
  const count = Number(strikes[0]?.count ?? 0);
  const latest = strikes[0]?.latest == null ? null : Number(strikes[0].latest);
  if (count >= NO_SHOW_THRESHOLD && latest !== null && latest + NO_SHOW_COOLDOWN_MS > now) {
    throw new HttpError(429, "พักสิทธิ์จองชั่วคราวจากการไม่มาเช็กอิน กรุณาลองใหม่ภายหลัง");
  }
}
