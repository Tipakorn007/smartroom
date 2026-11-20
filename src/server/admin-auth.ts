import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http.ts";

const COOKIE_NAME = "smartroom_admin";
const SESSION_MS = 8 * 60 * 60 * 1000;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new HttpError(503, `ระบบแอดมินยังไม่ได้ตั้งค่า ${name}`);
  return value;
}

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signature(expiresAt: string): string {
  const secret = required("ADMIN_SESSION_SECRET");
  if (secret.length < 32) throw new HttpError(503, "ADMIN_SESSION_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร");
  const password = required("ADMIN_PASSWORD");
  return createHmac("sha256", secret)
    .update(`smartroom-admin:${expiresAt}:${password}`)
    .digest("hex");
}

function cookieValue(request: Request): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  const part = cookies.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${COOKIE_NAME}=`));
  return part ? decodeURIComponent(part.slice(COOKIE_NAME.length + 1)) : null;
}

export function adminSessionValid(request: Request): boolean {
  try {
    if (!process.env.ADMIN_PASSWORD) return false;
    const value = cookieValue(request);
    if (!value) return false;
    const [expiresAt, provided] = value.split(".");
    if (!expiresAt || !provided || !/^\d+$/.test(expiresAt) || Number(expiresAt) <= Date.now()) return false;
    return equalSecret(provided, signature(expiresAt));
  } catch {
    return false;
  }
}

export function requireAdmin(request: Request): void {
  if (!adminSessionValid(request)) throw new HttpError(401, "กรุณาเข้าสู่ระบบผู้ดูแลก่อน");
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new HttpError(403, "คำขอไม่ผ่านการตรวจสอบต้นทาง");
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new HttpError(403, "คำขอไม่ผ่านการตรวจสอบต้นทาง");
}

export function loginAdmin(request: Request, password: unknown): Response {
  const expectedPassword = required("ADMIN_PASSWORD");
  if (typeof password !== "string" || !equalSecret(password, expectedPassword)) {
    throw new HttpError(401, "รหัสผ่านไม่ถูกต้อง");
  }
  const expiresAt = String(Date.now() + SESSION_MS);
  const value = `${expiresAt}.${signature(expiresAt)}`;
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(JSON.stringify({ authenticated: true }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure}`,
    },
  });
}

export function logoutAdmin(): Response {
  return new Response(JSON.stringify({ authenticated: false }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
    },
  });
}
