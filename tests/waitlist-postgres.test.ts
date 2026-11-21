import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { offerNextWaitlist } from "../src/server/waitlist.ts";

const enabled = process.env.SMARTROOM_TEST_POSTGRES === "true";

test.skipIf(!enabled)("waitlist offer accepts millisecond timestamps in PostgreSQL", async () => {
  const url = process.env.DATABASE_URL;
  const expectedBranch = process.env.SMARTROOM_TEST_NEON_BRANCH_ID;
  if (!url || !expectedBranch || expectedBranch === "br-summer-lake-bez3c4t2") {
    throw new Error("Provide DATABASE_URL and a non-production SMARTROOM_TEST_NEON_BRANCH_ID");
  }
  const sql = neon(url);
  const branch = await sql.query("SELECT current_setting('neon.branch_id', true) AS id");
  if (branch[0]?.id !== expectedBranch) {
    throw new Error("DATABASE_URL does not point to the requested Neon test branch");
  }

  const rooms = await sql.query("SELECT id FROM rooms WHERE id = $1", [-1]);
  expect(rooms).toHaveLength(0);
  await expect(offerNextWaitlist(-1, Date.now())).resolves.toBeUndefined();
}, 60_000);

test.skipIf(!enabled)("concurrent rooms cannot offer bookings to the same user", async () => {
  const url = process.env.DATABASE_URL;
  const expectedBranch = process.env.SMARTROOM_TEST_NEON_BRANCH_ID;
  if (!url || !expectedBranch || expectedBranch === "br-summer-lake-bez3c4t2") {
    throw new Error("Provide DATABASE_URL and a non-production SMARTROOM_TEST_NEON_BRANCH_ID");
  }
  const sql = neon(url);
  const branch = await sql.query("SELECT current_setting('neon.branch_id', true) AS id");
  if (branch[0]?.id !== expectedBranch) {
    throw new Error("DATABASE_URL does not point to the requested Neon test branch");
  }

  const roomIds: number[] = [];
  const userId = randomBytes(16).toString("hex");
  const backupUserId = randomBytes(16).toString("hex");
  const roomName = `Concurrent test ${userId}`;
  try {
    for (const id of [8000 + Math.floor(Math.random() * 500), 9000 + Math.floor(Math.random() * 500)]) {
      const created = await sql.query(
        `INSERT INTO rooms (id, name, floor, capacity, has_power, has_whiteboard, quiet_level)
         VALUES ($1, $2, 1, 4, TRUE, TRUE, 'quiet') ON CONFLICT DO NOTHING RETURNING id`,
        [id, roomName],
      );
      if (!created.length) throw new Error("Test room ID already exists");
      roomIds.push(id);
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      const now = Date.now();
      await sql.query(
        `INSERT INTO waitlist (room_id, user_id, user_name, slot, created_at, status)
         SELECT id, $1, 'Test queue', 30, $2, 'waiting' FROM rooms WHERE id = ANY($3::int[])
         UNION ALL
         SELECT id, $4 || id::text, 'Backup queue', 30, $2::bigint + 1, 'waiting'
         FROM rooms WHERE id = ANY($3::int[])`,
        [userId, now, roomIds, backupUserId],
      );
      await Promise.all(roomIds.map((id) => offerNextWaitlist(id, now)));
      const bookings = await sql.query(
        "SELECT COUNT(*)::integer AS count FROM bookings WHERE user_id=$1 AND status IN ('pending','active')",
        [userId],
      );
      expect(Number(bookings[0]?.count)).toBe(1);
      const offers = await sql.query(
        "SELECT user_id FROM waitlist WHERE room_id=ANY($1::int[]) AND status='offered'",
        [roomIds],
      );
      expect(offers).toHaveLength(2);
      expect(new Set(offers.map((offer) => offer.user_id)).size).toBe(2);
      await sql.query("DELETE FROM waitlist WHERE room_id=ANY($1::int[])", [roomIds]);
      await sql.query("DELETE FROM bookings WHERE room_id=ANY($1::int[])", [roomIds]);
    }
  } finally {
    if (roomIds.length) {
      await sql.query("DELETE FROM waitlist WHERE room_id=ANY($1::int[])", [roomIds]);
      await sql.query("DELETE FROM bookings WHERE room_id=ANY($1::int[])", [roomIds]);
      await sql.query("DELETE FROM rooms WHERE id=ANY($1::int[]) AND name=$2", [roomIds, roomName]);
    }
  }
}, 120_000);
