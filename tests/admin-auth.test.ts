import { expect, test } from "bun:test";
import { handleApi } from "../src/server/api-handler.ts";
import { handleLocalDemoApi } from "../src/server/local-demo.ts";

test("admin login protects demo and database routes", async () => {
  const originalPassword = process.env.ADMIN_PASSWORD;
  const originalSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.ADMIN_SESSION_SECRET = "test-session-secret-with-32-characters";

  try {
    for (const handle of [handleLocalDemoApi, handleApi]) {
      const request = (path: string, method = "GET", cookie?: string, body?: unknown, origin = "https://example.test") =>
        handle(new Request(`https://example.test${path}`, {
          method,
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(method !== "GET" ? { origin } : {}),
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }));

      expect((await request("/api/admin/session")).status).toBe(200);
      expect(await (await request("/api/admin/session")).json()).toMatchObject({ authenticated: false });
      expect((await request("/api/admin/rooms")).status).toBe(401);
      expect((await request("/api/stats")).status).toBe(401);
      expect((await request("/api/admin/rooms/1", "PATCH", undefined, { enabled: false })).status).toBe(401);
      expect((await request("/api/admin/rooms/1/delete", "POST")).status).toBe(401);
      expect((await request("/api/admin/login", "POST", undefined, { password: "wrong" })).status).toBe(401);
      expect((await request("/api/admin/login", "POST", undefined, { password: "test-password" }, "https://other.test")).status).toBe(403);

      const login = await request("/api/admin/login", "POST", undefined, { password: "test-password" });
      expect(login.status).toBe(200);
      const setCookie = login.headers.get("set-cookie");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).toContain("Secure");
      const cookie = setCookie?.split(";")[0];
      expect(cookie).toBeTruthy();
      expect(await (await request("/api/admin/session", "GET", cookie)).json()).toMatchObject({ authenticated: true });
      if (handle === handleLocalDemoApi) {
        expect((await request("/api/admin/rooms", "GET", cookie)).status).toBe(200);
        expect((await request("/api/stats", "GET", cookie)).status).toBe(200);
        expect((await request("/api/admin/rooms/1", "PATCH", cookie, {}, "https://other.test")).status).toBe(403);
        expect((await request("/api/admin/rooms/1/delete", "POST", cookie, undefined, "https://other.test")).status).toBe(403);
        const newRoom = await request("/api/admin/rooms", "POST", cookie, {
          name: "Delete test", floor: 1, capacity: 4, hasPower: true, hasWhiteboard: false, quietLevel: "normal",
        });
        expect(newRoom.status).toBe(201);
        const { id: roomId } = await newRoom.json() as { id: number };
        const maintenance = await request(`/api/admin/rooms/${roomId}/maintenance`, "POST", cookie, {
          startsAt: Date.now() + 60_000, endsAt: Date.now() + 120_000, reason: "Test",
        });
        expect(maintenance.status).toBe(201);
        const { id: maintenanceId } = await maintenance.json() as { id: number };
        expect((await request(`/api/admin/rooms/${roomId}/delete`, "POST", cookie)).status).toBe(409);
        expect((await request(`/api/admin/rooms/${roomId}/maintenance/${maintenanceId}`, "DELETE", cookie)).status).toBe(200);
        expect((await request(`/api/admin/rooms/${roomId}/delete`, "POST", cookie)).status).toBe(200);
        expect((await request(`/api/admin/rooms/${roomId}/delete`, "POST", cookie)).status).toBe(404);
        const invalidUpdate = await request("/api/admin/rooms/1", "PATCH", cookie, {
          enabled: false,
          name: "A102",
        });
        expect(invalidUpdate.status).toBe(409);
        const rooms = await (await request("/api/admin/rooms", "GET", cookie)).json() as {
          rooms: Array<{ id: number; enabled: boolean }>;
        };
        expect(rooms.rooms.find((room) => room.id === 1)?.enabled).toBe(true);
        const invalidFloor = await request("/api/admin/rooms/1", "PATCH", cookie, {
          name: "Test room",
          floor: 99,
        });
        expect(invalidFloor.status).toBe(400);
        const afterInvalidFloor = await (await request("/api/admin/rooms", "GET", cookie)).json() as {
          rooms: Array<{ id: number; name: string }>;
        };
        expect(afterInvalidFloor.rooms.find((room) => room.id === 1)?.name).toBe("A101");
        const validUpdate = await request("/api/admin/rooms/1", "PATCH", cookie, {
          name: "Test room",
          floor: 2,
          enabled: false,
        });
        expect(validUpdate.status).toBe(200);
        expect(await validUpdate.json()).toMatchObject({ name: "Test room", floor: 2, enabled: false });
        expect((await request("/api/admin/rooms/1", "PATCH", cookie, {
          name: "A101",
          floor: 1,
          enabled: true,
        })).status).toBe(200);
      }

      process.env.ADMIN_PASSWORD = "new-test-password";
      expect(await (await request("/api/admin/session", "GET", cookie)).json()).toMatchObject({ authenticated: false });
      process.env.ADMIN_PASSWORD = "test-password";
      expect((await request("/api/admin/logout", "POST", cookie)).headers.get("set-cookie")).toContain("Max-Age=0");

      delete process.env.ADMIN_PASSWORD;
      expect((await request("/api/admin/login", "POST", undefined, { password: "test-password" })).status).toBe(503);
      process.env.ADMIN_PASSWORD = "test-password";
      process.env.ADMIN_SESSION_SECRET = "too-short";
      expect((await request("/api/admin/login", "POST", undefined, { password: "test-password" })).status).toBe(503);
      expect(await (await request("/api/admin/session", "GET", cookie)).json()).toMatchObject({ authenticated: false });
      process.env.ADMIN_SESSION_SECRET = "test-session-secret-with-32-characters";
    }
  } finally {
    if (originalPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalPassword;
    if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = originalSecret;
  }
});
