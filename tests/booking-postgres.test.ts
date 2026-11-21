import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { addRoomMaintenance, removeRoomMaintenance, updateManagedRoom } from "../src/server/admin-rooms.ts";
import { cancelPendingBooking, checkIn, createBooking, editPendingBooking, extendBooking, leaveBooking } from "../src/server/bookings.ts";
import { ensureDatabase } from "../src/server/db.ts";
import { HttpError } from "../src/server/http.ts";
import { getMyHistory } from "../src/server/my-history.ts";
import { acceptWaitlistOffer, joinWaitlist } from "../src/server/waitlist.ts";

const enabled = process.env.SMARTROOM_TEST_POSTGRES === "true";
const minute = 60_000;

test.skipIf(!enabled)("PostgreSQL booking times respect check-in and maintenance boundaries", async () => {
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

  const roomId = 8000 + Math.floor(Math.random() * 2000);
  const roomName = `Test ${randomBytes(8).toString("hex")}`;
  const created = await sql.query(
    `INSERT INTO rooms (id, name, floor, capacity, has_power, has_whiteboard, quiet_level)
     VALUES ($1, $2, 1, 4, TRUE, TRUE, 'normal')
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [roomId, roomName],
  );
  if (!created.length) throw new Error("Test room ID already exists; no data was changed");

  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const user = () => randomBytes(16).toString("hex");
  const expectConflict = async (operation: Promise<unknown>) => {
    try {
      await operation;
      throw new Error("Expected a conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(409);
    }
  };

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      await sql.query("UPDATE rooms SET floor=1, capacity=4 WHERE id=$1", [roomId]);
      await Promise.all([
        updateManagedRoom(roomId, { floor: 2 }),
        updateManagedRoom(roomId, { capacity: 8 }),
      ]);
      const updatedRoom = await sql.query("SELECT floor, capacity FROM rooms WHERE id = $1", [roomId]);
      expect(updatedRoom[0]).toMatchObject({ floor: 2, capacity: 8 });
    }

    const future = await createBooking({ roomId, userId: user(), userName: "Test future", durationMinutes: 30 });
    await editPendingBooking(future.booking.token, { roomId, startAt: now + 10 * minute, durationMinutes: 30 });
    await expectConflict(checkIn(future.booking.token));
    now += 10 * minute;
    expect((await checkIn(future.booking.token)).booking.status).toBe("active");
    await leaveBooking(future.booking.token);

    const booking = await createBooking({ roomId, userId: user(), userName: "Test extension", durationMinutes: 30 });
    await checkIn(booking.booking.token);
    const maintenance = await addRoomMaintenance(roomId, booking.booking.endAt + minute, booking.booking.endAt + 60 * minute, "Test maintenance");
    now += 21 * minute;
    await expectConflict(extendBooking(booking.booking.token, booking.booking.endAt));

    const extension = await sql.query("SELECT end_at FROM bookings WHERE token = $1", [booking.booking.token]);
    expect(Number(extension[0]?.end_at)).toBe(booking.booking.endAt);
    await removeRoomMaintenance(roomId, maintenance.id);
    await addRoomMaintenance(roomId, booking.booking.endAt + 30 * minute, booking.booking.endAt + 60 * minute, "Test maintenance");
    expect((await extendBooking(booking.booking.token, booking.booking.endAt)).endAt).toBe(booking.booking.endAt + 30 * minute);
    await leaveBooking(booking.booking.token);
    const late = await createBooking({ roomId, userId: user(), userName: "Test late", durationMinutes: 30 });
    now = late.booking.startAt + 15 * minute;
    await expectConflict(checkIn(late.booking.token));
    const missed = await sql.query("SELECT status, no_show FROM bookings WHERE token = $1", [late.booking.token]);
    expect(missed[0]).toMatchObject({ status: "released", no_show: true });
  } finally {
    Date.now = originalNow;
    await sql.query("DELETE FROM waitlist WHERE room_id = $1", [roomId]);
    await sql.query("DELETE FROM bookings WHERE room_id = $1", [roomId]);
    await sql.query("DELETE FROM room_maintenance WHERE room_id = $1", [roomId]);
    await sql.query("DELETE FROM rooms WHERE id = $1 AND name = $2", [roomId, roomName]);
  }
}, 120_000);

test.skipIf(!enabled)("PostgreSQL waitlist acceptance does not overlap maintenance", async () => {
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

  const roomId = 8000 + Math.floor(Math.random() * 2000);
  const roomName = `Test ${randomBytes(8).toString("hex")}`;
  const created = await sql.query(
    `INSERT INTO rooms (id, name, floor, capacity, has_power, has_whiteboard, quiet_level)
     VALUES ($1, $2, 1, 4, TRUE, TRUE, 'normal')
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [roomId, roomName],
  );
  if (!created.length) throw new Error("Test room ID already exists; no data was changed");

  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const userId = randomBytes(16).toString("hex");
    const booking = await createBooking({ roomId, userId: randomBytes(16).toString("hex"), userName: "Test booking", durationMinutes: 30 });
    const entry = await joinWaitlist({ roomId, userId, userName: "Test queue", durationMinutes: 30 });
    await cancelPendingBooking(booking.booking.token);
    expect((await getMyHistory(userId)).bookings).toHaveLength(0);
    const hold = await sql.query(
      "SELECT b.token FROM bookings b JOIN waitlist w ON w.booking_id = b.id WHERE w.id = $1",
      [entry.id],
    );
    await expect(cancelPendingBooking(String(hold[0]?.token))).rejects.toMatchObject({ status: 409 });
    await expect(editPendingBooking(String(hold[0]?.token), {
      roomId, startAt: now + 10 * minute, durationMinutes: 30,
    })).rejects.toMatchObject({ status: 409 });
    const maintenance = await addRoomMaintenance(roomId, now + 31 * minute, now + 60 * minute, "Test maintenance");
    now += 2 * minute;
    try {
      await acceptWaitlistOffer(entry.id, userId, now);
      throw new Error("Expected a conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(409);
    }
    const rows = await sql.query("SELECT status FROM waitlist WHERE id = $1", [entry.id]);
    expect(rows[0]?.status).toBe("offered");
    await removeRoomMaintenance(roomId, maintenance.id);
    expect((await acceptWaitlistOffer(entry.id, userId, now)).booking.status).toBe("pending");
    expect((await getMyHistory(userId)).bookings).toHaveLength(1);
  } finally {
    Date.now = originalNow;
    await sql.query("DELETE FROM waitlist WHERE room_id = $1", [roomId]);
    await sql.query("DELETE FROM bookings WHERE room_id = $1", [roomId]);
    await sql.query("DELETE FROM room_maintenance WHERE room_id = $1", [roomId]);
    await sql.query("DELETE FROM rooms WHERE id = $1 AND name = $2", [roomId, roomName]);
  }
}, 120_000);
