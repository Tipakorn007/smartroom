import { expect, test } from "bun:test";
import { handleLocalDemoApi } from "../src/server/local-demo.ts";

const userIds = {
  a: "a".repeat(32),
  b: "b".repeat(32),
  c: "c".repeat(32),
  d: "d".repeat(32),
  e: "e".repeat(32),
  f: "f".repeat(32),
};

async function call<T>(
  path: string,
  method = "GET",
  body?: Record<string, unknown>,
): Promise<{ status: number; type: string | null; data: T | null; text: string }> {
  const response = await handleLocalDemoApi(
    new Request(`http://localhost${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await response.text();
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    data: isJson && text ? (JSON.parse(text) as T) : null,
    text,
  };
}

test("waitlist offers pass to the next user and presence actions obey the queue", async () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;

  try {
    const created = await call<{
      booking: { endAt: number; token: string };
    }>("/api/bookings", "POST", {
      userId: userIds.a,
      roomId: 1,
      userName: "ผู้ใช้เอ",
      durationMinutes: 30,
    });

    expect(created.status).toBe(201);
    const tokenA = created.data?.booking.token ?? "";
    expect((await call(`/api/bookings/${tokenA}/checkin`, "POST", {})).status).toBe(200);

    const queueB = await call<{ id: number; position: number }>("/api/waitlist", "POST", {
      userId: userIds.b,
      roomId: 1,
      userName: "ผู้ใช้บี",
      durationMinutes: 60,
    });
    const queueC = await call<{ id: number; position: number }>("/api/waitlist", "POST", {
      userId: userIds.c,
      roomId: 1,
      userName: "ผู้ใช้ซี",
      durationMinutes: 30,
    });
    expect(queueB.data?.position).toBe(1);
    expect(queueC.data?.position).toBe(2);

    now += 21 * 60 * 1000;
    const blockedExtension = await call(
      `/api/bookings/${tokenA}/extend`,
      "POST",
      { expectedEndAt: created.data?.booking.endAt },
    );
    expect(blockedExtension.status).toBe(409);
    expect(blockedExtension.text).toContain("รอคิว");

    expect((await call(`/api/bookings/${tokenA}/leave`, "POST", {})).status).toBe(200);
    const liveB = await call<{
      myWaitlists: Array<{ status: string }>;
      rooms: Array<{ id: number; status: string }>;
    }>(`/api/live?userId=${userIds.b}`);
    expect(liveB.data?.myWaitlists[0]?.status).toBe("offered");
    expect(liveB.data?.rooms.find((room) => room.id === 1)?.status).toBe("offered");
    const offeredHistory = await call<{ bookings: unknown[] }>(`/api/me/bookings?userId=${userIds.b}`);
    expect(offeredHistory.data?.bookings).toHaveLength(0);

    const event = await call(`/api/events?userId=${userIds.b}`);
    expect(event.type).toContain("text/event-stream");
    expect(event.text).toContain("data:");

    now += 5 * 60 * 1000 + 1;
    const liveC = await call<{
      myWaitlists: Array<{ status: string }>;
    }>(`/api/live?userId=${userIds.c}`);
    expect(liveC.data?.myWaitlists[0]?.status).toBe("offered");
    const expiredHistory = await call<{ bookings: unknown[] }>(`/api/me/bookings?userId=${userIds.b}`);
    expect(expiredHistory.data?.bookings).toHaveLength(0);

    const accepted = await call<{ booking: { status: string; token: string } }>(
      `/api/waitlist/${queueC.data?.id}/accept`,
      "POST",
      { userId: userIds.c },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.data?.booking.status).toBe("pending");
    expect(
      (await call(`/api/bookings/${accepted.data?.booking.token}/checkin`, "POST", {})).status,
    ).toBe(200);
    expect(
      (await call(`/api/bookings/${accepted.data?.booking.token}/leave`, "POST", {})).status,
    ).toBe(200);
    const cHistory = await call<{
      bookings: Array<{ booking: { token: string; status: string } }>;
    }>(`/api/me/bookings?userId=${userIds.c}`);
    expect(
      cHistory.data?.bookings.find(
        (entry) => entry.booking.token === accepted.data?.booking.token,
      )?.booking.status,
    ).toBe("finished");

    const secondRoom = await call<{ booking: { endAt: number; token: string } }>(
      "/api/bookings",
      "POST",
      {
        userId: userIds.d,
        roomId: 2,
        userName: "ผู้ใช้ดี",
        durationMinutes: 30,
      },
    );
    const tokenD = secondRoom.data?.booking.token ?? "";
    expect(secondRoom.status).toBe(201);
    expect((await call(`/api/bookings/${tokenD}/checkin`, "POST", {})).status).toBe(200);
    now += 21 * 60 * 1000;
    const extended = await call<{ booking: { endAt: number } }>(
      `/api/bookings/${tokenD}/extend`,
      "POST",
      { expectedEndAt: secondRoom.data?.booking.endAt },
    );
    expect(extended.status).toBe(200);
    expect(extended.data?.booking.endAt).toBe(
      (secondRoom.data?.booking.endAt ?? 0) + 30 * 60 * 1000,
    );

    const pending = await call<{ booking: { startAt: number } }>("/api/bookings", "POST", {
      userId: userIds.e,
      roomId: 3,
      userName: "ผู้ใช้เอ",
      durationMinutes: 30,
    });
    expect(pending.status).toBe(201);
    const queueF = await call<{ id: number }>("/api/waitlist", "POST", {
      userId: userIds.f,
      roomId: 3,
      userName: "ผู้ใช้เอฟ",
      durationMinutes: 30,
    });
    expect(queueF.status).toBe(201);
    now = (pending.data?.booking.startAt ?? now) + 15 * 60 * 1000 + 1;
    const afterNoShow = await call<{ myWaitlists: Array<{ status: string }> }>(
      `/api/live?userId=${userIds.f}`,
    );
    expect(afterNoShow.data?.myWaitlists[0]?.status).toBe("offered");
  } finally {
    Date.now = originalNow;
  }
});

test("booking extensions and waitlist acceptance respect scheduled maintenance", async () => {
  const originalNow = Date.now;
  const originalPassword = process.env.ADMIN_PASSWORD;
  const originalSecret = process.env.ADMIN_SESSION_SECRET;
  let now = 1_800_100_000_000;
  Date.now = () => now;
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.ADMIN_SESSION_SECRET = "test-session-secret-with-32-characters";

  try {
    const login = await handleLocalDemoApi(new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ password: "test-password" }),
    }));
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const maintenance = async (roomId: number, startsAt: number, endsAt: number) =>
      handleLocalDemoApi(new Request(`http://localhost/api/admin/rooms/${roomId}/maintenance`, {
        method: "POST",
        headers: { origin: "http://localhost", cookie: cookie ?? "", "content-type": "application/json" },
        body: JSON.stringify({ startsAt, endsAt, reason: "Test maintenance" }),
      }));

    const first = await call<{ booking: { token: string; endAt: number } }>("/api/bookings", "POST", {
      userId: "1".repeat(32), roomId: 16, userName: "Test booking", durationMinutes: 30,
    });

    const token = first.data?.booking.token ?? "";
    const endAt = first.data?.booking.endAt ?? 0;
    expect(first.status).toBe(201);
    expect((await call(`/api/bookings/${token}/checkin`, "POST")).status).toBe(200);
    expect((await maintenance(16, endAt + 60_000, endAt + 60 * 60_000)).status).toBe(201);
    now += 21 * 60_000;
    expect((await call(`/api/bookings/${token}/extend`, "POST", { expectedEndAt: endAt })).status).toBe(409);

    const second = await call<{ booking: { token: string } }>("/api/bookings", "POST", {
      userId: "2".repeat(32), roomId: 17, userName: "Test booking", durationMinutes: 30,
    });
    const entry = await call<{ id: number }>("/api/waitlist", "POST", {
      userId: "3".repeat(32), roomId: 17, userName: "Test queue", durationMinutes: 30,
    });
    expect((await call(`/api/bookings/${second.data?.booking.token}/cancel`, "POST")).status).toBe(200);
    expect((await maintenance(17, now + 31 * 60_000, now + 60 * 60_000)).status).toBe(201);
    now += 2 * 60_000;
    expect((await call(`/api/waitlist/${entry.data?.id}/accept`, "POST", { userId: "3".repeat(32) })).status).toBe(409);
    const live = await call<{ myWaitlists: Array<{ status: string }> }>(`/api/live?userId=${"3".repeat(32)}`);
    expect(live.data?.myWaitlists[0]?.status).toBe("offered");
  } finally {
    Date.now = originalNow;
    if (originalPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalPassword;
    if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = originalSecret;
  }
});

test("waitlist skips a user with another active booking", async () => {
  const originalNow = Date.now;
  Date.now = () => 1_800_200_000_000;
  try {
    const first = await call<{ booking: { token: string } }>("/api/bookings", "POST", {
      userId: "4".repeat(32), roomId: 18, userName: "Test booking", durationMinutes: 30,
    });
    expect(first.status).toBe(201);
    const queue = await call<{ id: number }>("/api/waitlist", "POST", {
      userId: "5".repeat(32), roomId: 18, userName: "Test queue", durationMinutes: 30,
    });
    expect(queue.status).toBe(201);
    const second = await call<{ booking: { token: string } }>("/api/bookings", "POST", {
      userId: "5".repeat(32), roomId: 19, userName: "Test booking", durationMinutes: 30,
    });
    expect(second.status).toBe(201);
    expect((await call(`/api/bookings/${first.data?.booking.token}/cancel`, "POST")).status).toBe(200);
    const waiting = await call<{ myWaitlists: Array<{ status: string }> }>(`/api/live?userId=${"5".repeat(32)}`);
    expect(waiting.data?.myWaitlists[0]?.status).toBe("waiting");
    expect((await call(`/api/bookings/${second.data?.booking.token}/cancel`, "POST")).status).toBe(200);
    const offered = await call<{ myWaitlists: Array<{ status: string }> }>(`/api/live?userId=${"5".repeat(32)}`);
    expect(offered.data?.myWaitlists[0]?.status).toBe("offered");
  } finally {
    Date.now = originalNow;
  }
});

test("waitlist offers resume after a no-show cooldown", async () => {
  const originalNow = Date.now;
  let now = 1_800_300_000_000;
  Date.now = () => now;
  try {
    const holder = await call<{ booking: { token: string } }>("/api/bookings", "POST", {
      userId: "6".repeat(32), roomId: 20, userName: "Test holder", durationMinutes: 120,
    });
    expect(holder.status).toBe(201);
    expect((await call(`/api/bookings/${holder.data?.booking.token}/checkin`, "POST")).status).toBe(200);
    expect((await call("/api/waitlist", "POST", {
      userId: "7".repeat(32), roomId: 20, userName: "Test queue", durationMinutes: 30,
    })).status).toBe(201);
    for (const roomId of [2, 3, 4]) {
      expect((await call("/api/bookings", "POST", {
        userId: "7".repeat(32), roomId, userName: "Test no show", durationMinutes: 30,
      })).status).toBe(201);
      now += 15 * 60_000 + 1;
    }
    expect((await call(`/api/bookings/${holder.data?.booking.token}/leave`, "POST")).status).toBe(200);
    const blocked = await call<{ myWaitlists: Array<{ status: string }> }>(`/api/live?userId=${"7".repeat(32)}`);
    expect(blocked.data?.myWaitlists[0]?.status).toBe("waiting");
    now += 24 * 60 * 60_000 + 1;
    const offered = await call<{ myWaitlists: Array<{ status: string }> }>(`/api/live?userId=${"7".repeat(32)}`);
    expect(offered.data?.myWaitlists[0]?.status).toBe("offered");
  } finally {
    Date.now = originalNow;
  }
});
