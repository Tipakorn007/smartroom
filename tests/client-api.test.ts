import { expect, test } from "bun:test";
import { api, ApiError } from "../src/client/api.ts";

test("client reports invalid successful API responses instead of returning null", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const body of ["", "not json", "null"]) {
      globalThis.fetch = Object.assign(
        async () => new Response(body, { status: 200 }),
        { preconnect: originalFetch.preconnect },
      );
      await expect(api.rooms()).rejects.toThrow("เซิร์ฟเวอร์ส่งข้อมูลไม่ถูกต้อง");
    }

    globalThis.fetch = Object.assign(
      async () => new Response(JSON.stringify({ error: "ห้องไม่ว่าง" }), { status: 409 }),
      { preconnect: originalFetch.preconnect },
    );
    await expect(api.rooms()).rejects.toBeInstanceOf(ApiError);
    await expect(api.rooms()).rejects.toThrow("ห้องไม่ว่าง");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
