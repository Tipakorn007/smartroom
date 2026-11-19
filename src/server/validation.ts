/**
 * ตรวจสอบ input ทุกจุดที่ server (ไม่เชื่อ frontend เลย)
 * ทุกฟังก์ชันคืนค่าที่ "ผ่านการทำความสะอาดแล้ว" หรือ throw HttpError 400
 * การตรวจที่นี่สำคัญเพราะเราต้องกันทั้งข้อมูลเสียและ SQL/HTML ที่เป็นอันตราย
 */

import {
  ALLOWED_DURATIONS,
  MAX_NAME_LENGTH,
  MAX_PEOPLE,
  MIN_NAME_LENGTH,
  MIN_PEOPLE,
} from "../shared/constants.ts";
import { HttpError } from "./http.ts";

/**
 * ชื่อผู้จอง: ตัดช่องว่างหัวท้าย ยุบช่องว่างซ้ำ และจำกัดอักขระ
 * อนุญาตไทย อังกฤษ ตัวเลข ช่องว่าง จุด ขีดกลาง ขีดล่าง เท่านั้น
 * (กันอักขระควบคุมที่อาจไปทำให้ log หรือหน้าจอเพี้ยน)
 */
export function validateUserName(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "กรุณากรอกชื่อผู้จอง");
  }
  const name = value.trim().replace(/\s+/g, " ");
  const length = Array.from(name).length; // นับเป็นตัวอักษรจริง ไม่ใช่ byte
  if (length < MIN_NAME_LENGTH || length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `ชื่อผู้จองต้องยาว ${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} ตัวอักษร`);
  }
  if (!/^[\u0E00-\u0E7FA-Za-z0-9 .\-_]+$/.test(name)) {
    throw new HttpError(400, "ชื่อผู้จองมีอักขระที่ไม่อนุญาต");
  }
  return name;
}

/** รหัสห้องต้องเป็นจำนวนเต็มบวก และอยู่ในช่วงที่สมเหตุสมผล */
export function validateRoomId(value: unknown): number {
  const roomId = typeof value === "string" ? Number(value) : value;
  if (typeof roomId !== "number" || !Number.isInteger(roomId) || roomId < 1 || roomId > 10_000) {
    throw new HttpError(400, "รหัสห้องไม่ถูกต้อง");
  }
  return roomId;
}

/**
 * ระยะเวลาต้องเป็นหนึ่งใน ALLOWED_DURATIONS เท่านั้น
 * ถ้าปล่อยให้รับค่าอะไรก็ได้ ผู้ใช้จะจองยาวเป็นวันและบล็อกห้องทั้งวัน
 */
export function validateDuration(value: unknown): number {
  const minutes = typeof value === "string" ? Number(value) : value;
  if (
    typeof minutes !== "number" ||
    !(ALLOWED_DURATIONS as readonly number[]).includes(minutes)
  ) {
    throw new HttpError(400, "ระยะเวลาต้องเป็น 30, 60 หรือ 120 นาที");
  }
  return minutes;
}

/** จำนวนคนที่ใช้ห้อง ต้องเป็นจำนวนเต็มในช่วงที่ห้องรองรับได้จริง */
export function validatePeople(value: unknown): number {
  const people = typeof value === "string" ? Number(value) : value;
  if (
    typeof people !== "number" ||
    !Number.isInteger(people) ||
    people < MIN_PEOPLE ||
    people > MAX_PEOPLE
  ) {
    throw new HttpError(400, `จำนวนคนต้องเป็นจำนวนเต็ม ${MIN_PEOPLE}-${MAX_PEOPLE} คน`);
  }
  return people;
}

/** ค่าตัวเลือก (ปลั๊ก/ไวท์บอร์ด/ความเงียบ) ต้องเป็น boolean จริง ๆ */
export function validateFlag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `ค่า "${label}" ต้องเป็น true หรือ false`);
  }
  return value;
}

/**
 * token ของการจอง: ค่าที่เราสร้างจาก randomBytes(16) แปลงเป็น hex
 * จึงต้องเป็น hex 32 ตัวเท่านั้น การตรวจรูปแบบก่อนแตะฐานข้อมูลคือด่านแรกกัน injection
 */
export function validateToken(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) {
    throw new HttpError(400, "token ไม่ถูกต้อง");
  }
  return value;
}
