import { expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { ensureDatabase } from "../src/server/db.ts";
import { sendLineCheckinReminders, sendLineReminders } from "../src/server/line-reminders.ts";
import { offerNextWaitlist } from "../src/server/waitlist.ts";

test.skipIf(process.env.SMARTROOM_TEST_POSTGRES !== "true")(
  "database LINE reminders and queue offers respect timing and delivery rules",
  async () => {
    const url = process.env.DATABASE_URL;
    const branchId = process.env.SMARTROOM_TEST_NEON_BRANCH_ID;
    if (!url || !branchId || branchId === "br-summer-lake-bez3c4t2") {
      throw new Error("Provide DATABASE_URL and a non-production SMARTROOM_TEST_NEON_BRANCH_ID");
    }
    const sql = neon(url);
    const branch = await sql.query("SELECT current_setting('neon.branch_id', true) AS id");
    if (branch[0]?.id !== branchId) throw new Error("DATABASE_URL does not point to the requested Neon test branch");
    await ensureDatabase();

    const roomId = 7000 + Math.floor(Math.random() * 2000);
    const roomName = `LINE test ${randomBytes(8).toString("hex")}`;
    const created = await sql.query(
      `INSERT INTO rooms (id, name, floor, capacity, has_power, has_whiteboard, quiet_level)
       VALUES ($1, $2, 1, 4, TRUE, TRUE, 'quiet') ON CONFLICT DO NOTHING RETURNING id`,
      [roomId, roomName],
    );

    async function testCheckinReminders(): Promise<void> {
        const url = process.env.DATABASE_URL;
        const branchId = process.env.SMARTROOM_TEST_NEON_BRANCH_ID;
        if (!url || !branchId || branchId === "br-summer-lake-bez3c4t2") {
          throw new Error("Provide DATABASE_URL and a non-production SMARTROOM_TEST_NEON_BRANCH_ID");
        }
        const sql = neon(url);
        const branch = await sql.query("SELECT current_setting('neon.branch_id', true) AS id");
        if (branch[0]?.id !== branchId) throw new Error("DATABASE_URL does not point to the requested Neon test branch");
        await ensureDatabase();
        const roomId = 7000 + Math.floor(Math.random() * 2000);
        const roomName = `LINE checkin ${randomBytes(8).toString("hex")}`;
        const created = await sql.query(
          `INSERT INTO rooms (id, name, floor, capacity, has_power, has_whiteboard, quiet_level)
           VALUES ($1, $2, 1, 4, TRUE, TRUE, 'quiet') ON CONFLICT DO NOTHING RETURNING id`,
          [roomId, roomName],
        );
        if (!created.length) throw new Error("Test room ID already exists");
        const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        const user = process.env.LINE_DEMO_USER_ID;
        const originalFetch = globalThis.fetch;
        const errors = spyOn(console, "error").mockImplementation(() => {});
        try {
          process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
          process.env.LINE_DEMO_USER_ID = "test-user";
          const messages: string[] = [];
          let fail = false;
          globalThis.fetch = (async (input, init) => {
            if (String(input) !== "https://api.line.me/v2/bot/message/push") return originalFetch(input, init);
            const body = JSON.parse(String(init?.body)) as { messages: Array<{ text: string }> };
            messages.push(body.messages[0]?.text ?? "");
            return new Response(null, { status: fail ? 500 : 200 });
          }) as typeof fetch;
          const start = Date.now() + 60_000;
          const inserted = await sql.query(
            `INSERT INTO bookings (room_id, user_name, start_at, end_at, status, token, created_at)
             VALUES ($1, 'Test', $2, $3, 'pending', $4, $2) RETURNING id`,
            [roomId, start, start + 30 * 60_000, randomBytes(16).toString("hex")],
          );
          await sendLineCheckinReminders(start - 1);
          expect(messages).toHaveLength(0);
          await Promise.all([sendLineCheckinReminders(start), sendLineCheckinReminders(start)]);
          await sendLineCheckinReminders(start + 10 * 60_000 - 1);
          expect(messages).toEqual([`ถึงเวลาจองห้อง ${roomName} แล้ว! เช็กอินภายใน 15 นาที ไม่งั้นห้องจะถูกปล่อย`]);
          await Promise.all([sendLineCheckinReminders(start + 10 * 60_000), sendLineCheckinReminders(start + 10 * 60_000)]);
          expect(messages).toEqual([
            `ถึงเวลาจองห้อง ${roomName} แล้ว! เช็กอินภายใน 15 นาที ไม่งั้นห้องจะถูกปล่อย`,
            `อีก 5 นาทีห้อง ${roomName} จะถูกปล่อย กดเช็กอินตอนนี้เลย`,
          ]);
          await sql.query("UPDATE bookings SET notified_start=FALSE, notified_release_warning=FALSE, status='active' WHERE id=$1", [inserted[0]?.id]);
          await sendLineCheckinReminders(start + 10 * 60_000);
          await sql.query("UPDATE bookings SET status='released' WHERE id=$1", [inserted[0]?.id]);
          await sendLineCheckinReminders(start + 10 * 60_000);
          await sql.query("UPDATE bookings SET status='pending' WHERE id=$1", [inserted[0]?.id]);
          await sendLineCheckinReminders(start + 15 * 60_000);
          expect(messages).toHaveLength(2);
          await sql.query(
            `INSERT INTO waitlist (room_id, user_id, user_name, slot, created_at, status, booking_id, offer_expires_at)
             VALUES ($1, $2, 'Test', 30, $3, 'offered', $4, $5)`,
            [roomId, randomBytes(16).toString("hex"), start, inserted[0]?.id, start + 5 * 60_000],
          );
          await sendLineCheckinReminders(start);
          expect(messages).toHaveLength(2);
          await sql.query("UPDATE waitlist SET status='accepted' WHERE room_id=$1", [roomId]);
          fail = true;
          await sendLineCheckinReminders(start + 10 * 60_000);
          fail = false;
          await sendLineCheckinReminders(start + 10 * 60_000);
          expect(messages).toHaveLength(4);
          await sql.query("UPDATE bookings SET notified_start=FALSE, notified_release_warning=FALSE WHERE id=$1", [inserted[0]?.id]);
          const mockedFetch = globalThis.fetch;
          globalThis.fetch = (async (input, init) => {
            const response = await mockedFetch(input, init);
            if (String(input) === "https://api.line.me/v2/bot/message/push") {
              await sql.query("UPDATE bookings SET status='active' WHERE id=$1", [inserted[0]?.id]);
            }
            return response;
          }) as typeof fetch;
          await sendLineCheckinReminders(start + 10 * 60_000);
          expect(messages).toHaveLength(5);
        } finally {
          globalThis.fetch = originalFetch;
          errors.mockRestore();
          if (token === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
          else process.env.LINE_CHANNEL_ACCESS_TOKEN = token;
          if (user === undefined) delete process.env.LINE_DEMO_USER_ID;
          else process.env.LINE_DEMO_USER_ID = user;
          await sql.query("DELETE FROM waitlist WHERE room_id=$1", [roomId]);
          await sql.query("DELETE FROM bookings WHERE room_id=$1", [roomId]);
          await sql.query("DELETE FROM rooms WHERE id=$1 AND name=$2", [roomId, roomName]);
        }
    }
    if (!created.length) throw new Error("Test room ID already exists");

    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const user = process.env.LINE_DEMO_USER_ID;
    const originalFetch = globalThis.fetch;
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
      process.env.LINE_DEMO_USER_ID = "test-user";
      const messages: string[] = [];
      let fail = false;
      globalThis.fetch = (async (input, init) => {
        if (String(input) !== "https://api.line.me/v2/bot/message/push") return originalFetch(input, init);
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ text: string }> };
        messages.push(body.messages[0]?.text ?? "");
        return new Response(null, { status: fail ? 500 : 200 });
      }) as typeof fetch;
      const now = Date.now();
      const endAt = now + 30 * 60_000;
      await sql.query(
        `INSERT INTO bookings (room_id, user_name, start_at, end_at, status, token, created_at)
         VALUES ($1, 'Test', $2, $3, 'active', $4, $2)`,
        [roomId, now, endAt, randomBytes(16).toString("hex")],
      );
      await sendLineReminders(endAt - 10 * 60_000 - 1);
      expect(messages).toHaveLength(0);
      await Promise.all([sendLineReminders(endAt - 10 * 60_000), sendLineReminders(endAt - 10 * 60_000)]);
      expect(messages).toEqual([`ห้อง ${roomName} จะหมดเวลาอีก 10 นาที ยังใช้อยู่ไหม?`]);
      await sql.query("UPDATE bookings SET end_at = end_at + 1800000 WHERE room_id=$1", [roomId]);
      fail = true;
      await sendLineReminders(endAt + 20 * 60_000);
      expect(messages).toHaveLength(2);
      fail = false;
      await sendLineReminders(endAt + 20 * 60_000);
      await sendLineReminders(endAt + 20 * 60_000);
      expect(messages).toHaveLength(3);

      await sql.query("UPDATE bookings SET status='finished' WHERE room_id=$1", [roomId]);
      await sql.query(
        `INSERT INTO waitlist (room_id, user_id, user_name, slot, created_at, status)
         VALUES ($1, $2, 'Test', 30, $3, 'waiting')`,
        [roomId, randomBytes(16).toString("hex"), now],
      );
      await offerNextWaitlist(roomId, now);
      expect(messages[3]).toBe(`ห้อง ${roomName} ว่างแล้ว! ตอบรับภายใน 5 นาที`);
      await sql.query("UPDATE waitlist SET status='expired' WHERE room_id=$1", [roomId]);
      await sql.query("UPDATE bookings SET status='released' WHERE room_id=$1 AND status='pending'", [roomId]);
      await sql.query(
        `INSERT INTO waitlist (room_id, user_id, user_name, slot, created_at, status)
         VALUES ($1, $2, 'Test', 30, $3, 'waiting')`,
        [roomId, randomBytes(16).toString("hex"), now],
      );
      fail = true;
      await expect(offerNextWaitlist(roomId, now)).resolves.toBeUndefined();
      const offered = await sql.query("SELECT id FROM waitlist WHERE room_id=$1 AND status='offered'", [roomId]);
      expect(offered).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
      errors.mockRestore();
      if (token === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
      else process.env.LINE_CHANNEL_ACCESS_TOKEN = token;
      if (user === undefined) delete process.env.LINE_DEMO_USER_ID;
      else process.env.LINE_DEMO_USER_ID = user;
      await sql.query("DELETE FROM waitlist WHERE room_id=$1", [roomId]);
      await sql.query("DELETE FROM bookings WHERE room_id=$1", [roomId]);
      await sql.query("DELETE FROM rooms WHERE id=$1 AND name=$2", [roomId, roomName]);
    }
    await testCheckinReminders();
  },
  120_000,
);
