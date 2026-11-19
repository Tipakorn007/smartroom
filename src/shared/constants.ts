/**
 * ค่าคงที่ที่ทั้ง server และ client ต้องรู้เหมือนกัน
 * เก็บไว้ที่เดียวเพื่อไม่ให้ตัวเลขไปกระจายอยู่ในหลายไฟล์
 */

/** ผู้จองต้องเช็กอินภายใน 15 นาทีหลังเวลาเริ่ม ไม่อย่างนั้นห้องจะถูกปล่อยคืน */
export const CHECKIN_WINDOW_MS = 15 * 60 * 1000;

/** ตัวตั้งเวลาฝั่ง server ตรวจห้องที่หมดสิทธิ์ทุก 30 วินาที */
export const SWEEP_INTERVAL_MS = 30 * 1000;

/** ระยะเวลาจองที่อนุญาต (นาที) — server ตรวจจากรายการนี้เท่านั้น */
export const ALLOWED_DURATIONS = [30, 60, 120] as const;

export const MIN_PEOPLE = 1;
export const MAX_PEOPLE = 12;

export const MIN_NAME_LENGTH = 2;
export const MAX_NAME_LENGTH = 60;
