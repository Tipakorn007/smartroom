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

    const event = await call(`/api/events?userId=${userIds.b}`);
    expect(event.type).toContain("text/event-stream");
    expect(event.text).toContain("data:");

    now += 5 * 60 * 1000 + 1;
    const liveC = await call<{
      myWaitlists: Array<{ status: string }>;
    }>(`/api/live?userId=${userIds.c}`);
    expect(liveC.data?.myWaitlists[0]?.status).toBe("offered");

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
