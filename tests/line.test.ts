import { expect, spyOn, test } from "bun:test";
import { pushToDemoUser } from "../lib/line.ts";
import { handleApi } from "../src/server/api-handler.ts";
import { handleLocalDemoApi } from "../src/server/local-demo.ts";

test("LINE sends the requested message and reports configuration and API failures", async () => {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const user = process.env.LINE_DEMO_USER_ID;
  const originalFetch = globalThis.fetch;
  const errors = spyOn(console, "error").mockImplementation(() => {});
  try {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
    process.env.LINE_DEMO_USER_ID = "test-user";
    let status = 200;
    let sent: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (input, init) => {
      sent = { url: String(input), init };
      return new Response(null, { status });
    }) as typeof fetch;
    expect(await pushToDemoUser("ข้อความทดสอบ")).toBe(true);
    expect(sent?.url).toBe("https://api.line.me/v2/bot/message/push");
    expect(sent?.init?.method).toBe("POST");
    expect(sent?.init?.headers).toEqual({ Authorization: "Bearer test-token", "Content-Type": "application/json" });
    expect(JSON.parse(String(sent?.init?.body))).toEqual({
      to: "test-user", messages: [{ type: "text", text: "ข้อความทดสอบ" }],
    });
    status = 400;
    expect(await pushToDemoUser("ข้อความทดสอบ")).toBe(false);
    globalThis.fetch = (async () => { throw new Error("network error"); }) as typeof fetch;
    expect(await pushToDemoUser("ข้อความทดสอบ")).toBe(false);
    delete process.env.LINE_DEMO_USER_ID;
    expect(await pushToDemoUser("ข้อความทดสอบ")).toBe(false);
    expect(errors).toHaveBeenCalledTimes(3);
  } finally {
    globalThis.fetch = originalFetch;
    errors.mockRestore();
    if (token === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    else process.env.LINE_CHANNEL_ACCESS_TOKEN = token;
    if (user === undefined) delete process.env.LINE_DEMO_USER_ID;
    else process.env.LINE_DEMO_USER_ID = user;
  }
});

test("LINE test endpoint requires admin and same-origin and reports delivery failure", async () => {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const user = process.env.LINE_DEMO_USER_ID;
  const originalFetch = globalThis.fetch;
  const errors = spyOn(console, "error").mockImplementation(() => {});
  try {
    process.env.ADMIN_PASSWORD = "test-password";
    process.env.ADMIN_SESSION_SECRET = "test-session-secret-with-32-characters";
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
    process.env.LINE_DEMO_USER_ID = "test-user";
    let status = 200;
    const messages: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ text: string }> };
      messages.push(body.messages[0]?.text ?? "");
      return new Response(null, { status });
    }) as typeof fetch;
    for (const handle of [handleApi, handleLocalDemoApi]) {
      const request = (path: string, cookie?: string, origin = "https://example.test", body?: string) =>
        handle(new Request(`https://example.test${path}`, {
          method: "POST",
          headers: { origin, ...(cookie ? { cookie } : {}), "content-type": "application/json" },
          ...(body ? { body } : {}),
        }));
      expect((await request("/api/admin/line-test")).status).toBe(401);
      expect((await request("/api/admin/line-test/checkin-start")).status).toBe(401);
      expect((await request("/api/admin/line-test/checkin-warning")).status).toBe(401);
      const login = await request("/api/admin/login", undefined, "https://example.test", JSON.stringify({ password: "test-password" }));
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toBeTruthy();
      expect((await request("/api/admin/line-test", cookie, "https://other.test")).status).toBe(403);
      expect((await request("/api/admin/line-test/checkin-start", cookie, "https://other.test")).status).toBe(403);
      expect((await request("/api/admin/line-test/checkin-warning", cookie, "https://other.test")).status).toBe(403);
      expect((await request("/api/admin/line-test", cookie)).status).toBe(200);
      expect((await request("/api/admin/line-test/checkin-start", cookie)).status).toBe(200);
      expect((await request("/api/admin/line-test/checkin-warning", cookie)).status).toBe(200);
      status = 500;
      expect((await request("/api/admin/line-test", cookie)).status).toBe(502);
      expect((await request("/api/admin/line-test/checkin-start", cookie)).status).toBe(502);
      expect((await request("/api/admin/line-test/checkin-warning", cookie)).status).toBe(502);
      status = 200;
    }
    expect(messages).toEqual(Array(2).fill([
      "SmartRoom ทดสอบการแจ้งเตือน ✅",
      "ถึงเวลาจองห้อง ห้องตัวอย่าง แล้ว! เช็กอินภายใน 15 นาที ไม่งั้นห้องจะถูกปล่อย",
      "อีก 5 นาทีห้อง ห้องตัวอย่าง จะถูกปล่อย กดเช็กอินตอนนี้เลย",
      "SmartRoom ทดสอบการแจ้งเตือน ✅",
      "ถึงเวลาจองห้อง ห้องตัวอย่าง แล้ว! เช็กอินภายใน 15 นาที ไม่งั้นห้องจะถูกปล่อย",
      "อีก 5 นาทีห้อง ห้องตัวอย่าง จะถูกปล่อย กดเช็กอินตอนนี้เลย",
    ]).flat());
  } finally {
    globalThis.fetch = originalFetch;
    errors.mockRestore();
    for (const [key, value] of Object.entries({
      ADMIN_PASSWORD: password, ADMIN_SESSION_SECRET: secret,
      LINE_CHANNEL_ACCESS_TOKEN: token, LINE_DEMO_USER_ID: user,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("demo polling sends check-in and end-time reminders and queue offers", async () => {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const user = process.env.LINE_DEMO_USER_ID;
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const messages: string[] = [];
  let now = 1_900_000_000_000;
  try {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
    process.env.LINE_DEMO_USER_ID = "test-user";
    Date.now = () => now;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ text: string }> };
      messages.push(body.messages[0]?.text ?? "");
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const call = (path: string, method = "GET", body?: object) =>
      handleLocalDemoApi(new Request(`http://localhost${path}`, {
        method, headers: body ? { "content-type": "application/json" } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      }));
    const created = await call("/api/bookings", "POST", {
      userId: "9".repeat(32), roomId: 20, userName: "ทดสอบ", durationMinutes: 30,
    });

    async function testCheckinReminders(): Promise<void> {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      const user = process.env.LINE_DEMO_USER_ID;
      const originalFetch = globalThis.fetch;
      const originalNow = Date.now;
      const messages: string[] = [];
      let now = 1_910_000_000_000;
      try {
        process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
        process.env.LINE_DEMO_USER_ID = "test-user";
        Date.now = () => now;
        globalThis.fetch = (async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as { messages: Array<{ text: string }> };
          messages.push(body.messages[0]?.text ?? "");
          return new Response(null, { status: 200 });
        }) as typeof fetch;
        const call = (path: string, method = "GET", body?: object) =>
          handleLocalDemoApi(new Request(`http://localhost${path}`, {
            method, headers: body ? { "content-type": "application/json" } : {},
            ...(body ? { body: JSON.stringify(body) } : {}),
          }));
        const bookings: Array<{ token: string; startAt: number }> = [];
        for (const [roomId, userId] of [[17, "1"], [18, "2"], [19, "3"]] as const) {
          const response = await call("/api/bookings", "POST", {
            userId: userId.repeat(32), roomId, userName: "ทดสอบ", durationMinutes: 30,
          });
          expect(response.status).toBe(201);
          const data = await response.json() as { booking: { token: string; startAt: number } };
          bookings.push(data.booking);
        }
        await call("/api/rooms");
        await call("/api/rooms");
        expect(messages).toHaveLength(3);
        expect((await call(`/api/bookings/${bookings[0]?.token}/checkin`, "POST", {})).status).toBe(200);
        expect((await call(`/api/bookings/${bookings[1]?.token}/cancel`, "POST", {})).status).toBe(200);
        now = (bookings[2]?.startAt ?? 0) + 10 * 60_000 - 1;
        await call("/api/rooms");
        expect(messages).toHaveLength(3);
        now++;
        await call("/api/rooms");
        await call("/api/rooms");
        expect(messages[3]).toBe("อีก 5 นาทีห้อง E503 จะถูกปล่อย กดเช็กอินตอนนี้เลย");
        expect(messages).toHaveLength(4);
        now += 5 * 60_000;
        await call("/api/rooms");
        expect(messages).toHaveLength(4);
        expect((await call(`/api/bookings/${bookings[0]?.token}/leave`, "POST", {})).status).toBe(200);
      } finally {
        Date.now = originalNow;
        globalThis.fetch = originalFetch;
        if (token === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
        else process.env.LINE_CHANNEL_ACCESS_TOKEN = token;
        if (user === undefined) delete process.env.LINE_DEMO_USER_ID;
        else process.env.LINE_DEMO_USER_ID = user;
      }
    }
    expect(created.status).toBe(201);
    const booking = await created.json() as { booking: { token: string; endAt: number } };
    expect((await call(`/api/bookings/${booking.booking.token}/checkin`, "POST", {})).status).toBe(200);
    expect(messages).toEqual(["ถึงเวลาจองห้อง E504 แล้ว! เช็กอินภายใน 15 นาที ไม่งั้นห้องจะถูกปล่อย"]);
    messages.length = 0;
    now = booking.booking.endAt - 10 * 60_000 - 1;
    await call("/api/rooms");
    expect(messages).toHaveLength(0);
    now++;
    await call("/api/rooms");
    await call("/api/rooms");
    expect(messages).toEqual(["ห้อง E504 จะหมดเวลาอีก 10 นาที ยังใช้อยู่ไหม?"]);
    const extended = await call(`/api/bookings/${booking.booking.token}/extend`, "POST", { expectedEndAt: booking.booking.endAt });
    expect(extended.status).toBe(200);
    now += 30 * 60_000;
    await call("/api/rooms");
    expect(messages).toHaveLength(2);
    const queued = await call("/api/waitlist", "POST", {
      userId: "8".repeat(32), roomId: 20, userName: "ผู้รอ", durationMinutes: 30,
    });
    expect(queued.status).toBe(201);
    const entry = await queued.json() as { id: number };
    expect((await call(`/api/bookings/${booking.booking.token}/leave`, "POST", {})).status).toBe(200);
    expect(messages[2]).toBe("ห้อง E504 ว่างแล้ว! ตอบรับภายใน 5 นาที");
    expect((await call(`/api/waitlist/${entry.id}/cancel`, "POST", { userId: "8".repeat(32) })).status).toBe(200);
    await testCheckinReminders();
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
    if (token === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    else process.env.LINE_CHANNEL_ACCESS_TOKEN = token;
    if (user === undefined) delete process.env.LINE_DEMO_USER_ID;
    else process.env.LINE_DEMO_USER_ID = user;
  }
});
