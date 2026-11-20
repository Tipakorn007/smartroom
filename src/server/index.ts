/**
 * Local development server: Bun.serve + shared REST API
 * ไม่ใช้เฟรมเวิร์กใด ๆ เพื่อให้เห็นเส้นทางของ request ครบทุกขั้น
 *
 * เส้นทางทั้งหมด:
 *   GET  /api/rooms                        แผนผังห้อง + สถานะปัจจุบัน
 *   POST /api/bookings                     สร้างการจอง + คืน QR
 *   GET  /api/bookings/:token              ข้อมูลการจอง (หน้าเช็กอิน)
 *   POST /api/bookings/:token/checkin      เช็กอิน
 *   POST /api/recommend                    แนะนำห้อง
 *   GET  /api/stats                        สถิติสำหรับอาคารสถานที่
 */

import { join } from "node:path";
import { CHECKIN_WINDOW_MS } from "../shared/constants";
import { handleApi } from "./api-handler";
import { HttpError, json } from "./http";
import { handleLocalDemoApi } from "./local-demo";
import { startSweeper } from "./sweeper";

const PORT = Number(process.env.PORT ?? 3000);
const LOCAL_DEMO_MODE = process.env.SMARTROOM_LOCAL_DEMO === "true";
const CLIENT_DIR = join(import.meta.dir, "../client");
const PUBLIC_DIR = join(import.meta.dir, "../../public");

/**
 * ให้ไฟล์ static จากโปรเจกต์โดยตรง
 * - "/" และ "/checkin/..." ได้ index.html (frontend จัดการเส้นทางต่อเอง)
 * - "/main.js" คือไฟล์ที่ bun build สร้างไว้ใน public/
 */
async function serveStatic(pathname: string): Promise<Response> {
  if (pathname === "/admin" || pathname === "/admin/") {
    return new Response(Bun.file(join(PUBLIC_DIR, "admin.html")), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (pathname === "/map" || pathname === "/map/") {
    return new Response(Bun.file(join(PUBLIC_DIR, "map.html")), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (pathname === "/" || pathname.startsWith("/checkin/")) {
    return new Response(Bun.file(join(CLIENT_DIR, "index.html")), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (pathname === "/styles.css") {
    return new Response(Bun.file(join(CLIENT_DIR, "styles.css")), {
      headers: { "content-type": "text/css; charset=utf-8" },
    });
  }
  if (pathname === "/main.js" || pathname === "/admin.js" || pathname === "/map.js") {
    const bundle = Bun.file(join(PUBLIC_DIR, pathname.slice(1)));
    if (await bundle.exists()) {
      return new Response(bundle, {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }
    return new Response("ยังไม่ได้ build ฝั่ง client — รัน `bun run build` ก่อน", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (pathname === "/smartroom-icon.png" || pathname === "/smartroom-logo.png") {
    const image = Bun.file(join(PUBLIC_DIR, pathname.slice(1)));
    if (await image.exists()) {
      return new Response(image, {
        headers: { "content-type": "image/png" },
      });
    }
  }
  return new Response("ไม่พบหน้านี้", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  // dev mode ทำให้ error ที่เกิดขึ้นแสดง stack trace ที่อ่านง่าย
  development: true,

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        return LOCAL_DEMO_MODE ? handleLocalDemoApi(request) : handleApi(request);
      }
      return await serveStatic(url.pathname);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, error.status);
      }
      console.error("[server] ข้อผิดพลาดที่ไม่คาดคิด:", error);
      return json({ error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" }, 500);
    }
  },

});

if (!LOCAL_DEMO_MODE) startSweeper();

console.log(`SmartRoom พร้อมใช้งานที่ http://localhost:${server.port}`);
if (LOCAL_DEMO_MODE) console.log("โหมดเดโมในเครื่อง: ข้อมูลการจองจะหายเมื่อปิดเซิร์ฟเวอร์");
console.log(`สิทธิ์เช็กอิน ${CHECKIN_WINDOW_MS / 60000} นาที · ตัวตั้งเวลาตรวจทุก 30 วินาที`);
