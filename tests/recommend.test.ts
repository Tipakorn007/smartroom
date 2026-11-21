import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { ensureDatabase } from "../src/server/db.ts";
import { rankRooms, recommendRooms } from "../src/server/recommend.ts";
import { listRoomViews } from "../src/server/rooms.ts";
import type { RoomView } from "../src/shared/types.ts";

test("recommendations exclude rooms reserved for a waiting queue", () => {
  const room: RoomView = {
    id: 1, name: "Test room", floor: 1, capacity: 4, hasPower: true,
    hasWhiteboard: true, quietLevel: "quiet", status: "available",
    currentBooking: null, checkinDeadline: null, waitlistCount: 1,
  };
  const request = { people: 4, needPower: true, needWhiteboard: false, preferQuiet: true };
  expect(rankRooms([room], request)).toHaveLength(0);
  expect(rankRooms([{ ...room, waitlistCount: 0 }], request)).toHaveLength(1);
  const missingPower = rankRooms([{ ...room, waitlistCount: 0, hasPower: false }], request);
  expect(missingPower[0]?.score).toBe(40);
  expect(missingPower[0]?.reasons).toContain("ไม่มีปลั๊กไฟ (+40)");
});

test("ranking keeps the best three in score, capacity and ID order", () => {
  const room: RoomView = {
    id: 1, name: "Test", floor: 1, capacity: 4, hasPower: true,
    hasWhiteboard: false, quietLevel: "normal", status: "available",
    currentBooking: null, checkinDeadline: null, waitlistCount: 0,
  };
  const rooms = [
    { ...room, id: 9, capacity: 5 },
    { ...room, id: 5 },
    { ...room, id: 2 },
    { ...room, id: 1, hasPower: false },
    { ...room, id: 3 },
    { ...room, id: 4, status: "closed" as const },
  ];
  const results = rankRooms(rooms, { people: 4, needPower: true, needWhiteboard: false, preferQuiet: false });
  expect(results.map((result) => result.room.id)).toEqual([2, 3, 5]);
  expect(results.every((result) => result.score === 0)).toBe(true);
  const tied = rankRooms([
    { ...room, id: 1, capacity: 24 },
    { ...room, id: 2, hasPower: false },
  ], { people: 4, needPower: true, needWhiteboard: false, preferQuiet: false });
  expect(tied.map((result) => result.room.id)).toEqual([2, 1]);
  expect(tied.map((result) => result.score)).toEqual([40, 40]);
});

test.skipIf(process.env.SMARTROOM_TEST_POSTGRES !== "true")(
  "database recommendations match room views using one request",
  async () => {
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
    await ensureDatabase();

    const startId = 7000 + Math.floor(Math.random() * 2000);
    const ids = Array.from({ length: 6 }, (_, index) => startId + index);
    const name = `Recommend test ${randomBytes(8).toString("hex")}`;
    const created = await sql.query(
      `INSERT INTO rooms (id, name, floor, capacity, has_power, has_whiteboard, quiet_level)
       SELECT id, $2, 1, 50, TRUE, TRUE, 'quiet' FROM unnest($1::int[]) AS id
       ON CONFLICT DO NOTHING RETURNING id`,
      [ids, name],
    );
    const ownedIds = created.map((row) => Number(row.id));
    try {
      if (ownedIds.length !== ids.length) throw new Error("Test room ID already exists");
      const now = Date.now();
      const future = now + 60 * 60_000;
      await sql.query(
        `INSERT INTO bookings (room_id, user_name, start_at, end_at, status, token, created_at)
         VALUES ($1, 'Test', $2, $3, 'pending', $4, $5),
                ($6, 'Test', $7, $8, 'active', $9, $5)`,
        [ids[1], future, future + 30 * 60_000, randomBytes(16).toString("hex"), now,
          ids[2], now - 60_000, now + 30 * 60_000, randomBytes(16).toString("hex")],
      );
      await sql.query("UPDATE rooms SET enabled=FALSE WHERE id=$1", [ids[3]]);
      await sql.query(
        `INSERT INTO waitlist (room_id, user_id, user_name, slot, created_at, status)
         VALUES ($1, $2, 'Test', 30, $3, 'waiting')`,
        [ids[4], randomBytes(16).toString("hex"), now],
      );
      await sql.query(
        "INSERT INTO room_maintenance (room_id, starts_at, ends_at, reason) VALUES ($1, $2, $3, 'Test')",
        [ids[5], now - 60_000, now + 60_000],
      );
      const request = { people: 50, needPower: true, needWhiteboard: true, preferQuiet: true };
      const expected = rankRooms(await listRoomViews(now), request);
      expect(expected.map((item) => item.room.id)).toEqual(ids.slice(0, 2));
      expect(expected[1]?.room).toHaveProperty("nextBookingAt", future);

      const originalFetch = globalThis.fetch;
      let requests = 0;
      globalThis.fetch = new Proxy(originalFetch, {
        apply(target, thisArg, args) {
          requests++;
          return Reflect.apply(target, thisArg, args);
        },
      });
      try {
        expect(await recommendRooms(request, now)).toEqual(expected);
      } finally {
        globalThis.fetch = originalFetch;
      }
      expect(requests).toBe(1);
    } finally {
      if (ownedIds.length) {
        await sql.query("DELETE FROM waitlist WHERE room_id=ANY($1::int[])", [ownedIds]);
        await sql.query("DELETE FROM bookings WHERE room_id=ANY($1::int[])", [ownedIds]);
        await sql.query("DELETE FROM room_maintenance WHERE room_id=ANY($1::int[])", [ownedIds]);
        await sql.query("DELETE FROM rooms WHERE id=ANY($1::int[]) AND name=$2", [ownedIds, name]);
      }
    }
  },
  120_000,
);
