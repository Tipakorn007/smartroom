/**
 * ชนิดข้อมูลกลางที่ใช้ร่วมกันระหว่าง server และ client
 * ทำแบบนี้เพราะทำให้ทั้งสองฝั่ง "สัญญา" ตรงกัน ถ้าแก้ field ที่นี่
 * TypeScript จะฟ้องทั้งฝั่ง server และฝั่ง browser ทันที ไม่ต้องเดา
 */

/** ระดับความเงียบของห้อง ใช้ทั้งตอนแนะนำห้องและตอนแสดงป้ายคุณสมบัติ */
export type QuietLevel = "quiet" | "normal" | "group";

/**
 * สถานะของ "ห้อง" ที่ผู้ใช้เห็น
 * - available = ว่าง
 * - in_use    = กำลังใช้งาน (มีคนเช็กอินแล้ว)
 * - pending   = จองแล้วรอเช็กอิน (ยังไม่เช็กอิน)
 * สถานะนี้คำนวณสดจากเวลา ไม่ได้เก็บลงฐานข้อมูล
 */
export type RoomStatus = "available" | "in_use" | "pending" | "offered" | "closed";

/**
 * สถานะของ "การจอง" ที่เก็บในฐานข้อมูล
 * - pending  = จองแล้ว รอเช็กอิน (มีเวลา 15 นาที)
 * - active   = เช็กอินแล้ว กำลังใช้งาน
 * - released = ถูกปล่อยคืนอัตโนมัติ (ไม่มาเช็กอิน)
 * - finished = ใช้งานจนครบเวลาแล้ว
 */
export type BookingStatus = "pending" | "active" | "released" | "finished";

/** ห้องติวหนึ่งห้อง ตรงกับตาราง rooms */
export interface Room {
  id: number;
  name: string;
  floor: number;
  capacity: number;
  hasPower: boolean;
  hasWhiteboard: boolean;
  quietLevel: QuietLevel;
}

/** การจองหนึ่งรายการ ตรงกับตาราง bookings (เวลาเก็บเป็น epoch milliseconds) */
export interface Booking {
  id: number;
  roomId: number;
  userName: string;
  startAt: number;
  endAt: number;
  status: BookingStatus;
  token: string;
  createdAt: number;
  checkedInAt: number | null;
  releasedAt: number | null;
}

/** ข้อมูลการจองขั้นต่ำที่แสดงบนแผนผังห้องสาธารณะ */
export interface CurrentBookingSummary {
  status: "pending" | "active" | "offered";
  startAt: number;
  endAt: number;
}

/** ห้อง + สถานะปัจจุบัน ใช้ส่งให้ frontend วาดแผนผังห้อง */
export interface RoomView extends Room {
  status: RoomStatus;
  currentBooking: CurrentBookingSummary | null;
  /** เวลาสุดท้ายที่ยังเช็กอินได้ (เฉพาะสถานะ pending) */
  checkinDeadline: number | null;
  waitlistCount: number;
  closureEndsAt?: number | null;
  closureReason?: string | null;
  nextBookingAt?: number | null;
}

/** ข้อมูลที่ client ส่งมาสร้างการจอง */
export interface CreateBookingRequest {
  userId: string;
  roomId: number;
  userName: string;
  durationMinutes: number;
}

export type WaitlistStatus = "waiting" | "offered" | "accepted" | "expired" | "cancelled";

/** คิวของผู้ใช้ปัจจุบัน; slot เก็บระยะเวลาใช้งานที่ขอเป็นนาที */
export interface WaitlistEntry {
  id: number;
  roomId: number;
  roomName: string;
  durationMinutes: number;
  status: WaitlistStatus;
  createdAt: number;
  position: number | null;
  offerExpiresAt: number | null;
}

/** สถานะที่ส่งให้เบราว์เซอร์ของผู้ใช้แบบไม่ระบุตัวตนรายนี้ */
export interface LiveSnapshot {
  rooms: RoomView[];
  myWaitlists: WaitlistEntry[];
  myBookings: BookingWithRoom[];
  /** Demo-only booking limits shown in the local review server. */
  bookingPolicy?: BookingPolicySnapshot;
}

export interface BookingPolicySnapshot {
  activeBookingLimit: number;
  hasActiveBooking: boolean;
  noShowsInWindow: number;
  noShowThreshold: number;
  noShowWindowMs: number;
  cooldownMs: number;
  blockedUntil: number | null;
}

export interface BookingHistoryEntry extends BookingWithRoom {
  cancelled: boolean;
}

export interface MyHistorySnapshot {
  bookings: BookingHistoryEntry[];
  waitlists: WaitlistEntry[];
}

export interface RoomMaintenance {
  id: number;
  roomId: number;
  startsAt: number;
  endsAt: number;
  reason: string;
}

export interface BookingLiveSnapshot extends BookingWithRoom {
  waitlistCount: number;
}

/** ผลลัพธ์หลังจองสำเร็จ รวม QR ให้ frontend แสดงเลย */
export interface CreateBookingResponse {
  booking: Booking;
  room: Room;
  /** QR เป็น data URL (PNG) ฝั่ง client เอาไปใส่ <img src> ได้ตรง ๆ */
  qrDataUrl: string;
  checkinUrl: string;
}

/** เงื่อนไขที่ผู้ใช้กรอกในหน้าตัวช่วยเลือกห้อง */
export interface RecommendRequest {
  people: number;
  needPower: boolean;
  needWhiteboard: boolean;
  preferQuiet: boolean;
}

/** ห้องที่ถูกแนะนำพร้อมคะแนนและเหตุผล (คะแนนน้อย = เหมาะกว่า) */
export interface Recommendation {
  room: Room;
  score: number;
  reasons: string[];
}

/** ผลลัพธ์จากการเช็กอิน */
export interface CheckInResponse {
  booking: Booking;
  room: Room;
  /** true = เคยเช็กอินแล้ว ไม่ได้เปลี่ยนข้อมูลซ้ำ */
  alreadyCheckedIn: boolean;
}

/** การจอง + ห้อง ใช้ในหน้า /checkin/:token */
export interface BookingWithRoom {
  booking: Booking;
  room: Room;
}

export interface PeakHour {
  hour: number;
  bookings: number;
}

export interface RoomUsage {
  roomId: number;
  roomName: string;
  floor: number;
  checkedInCount: number;
}

/** ตัวเลขทั้งหมดในหน้าสถิติสำหรับฝ่ายอาคารสถานที่ */
export interface StatsResponse {
  totalBookings: number;
  releasedBookings: number;
  checkedInBookings: number;
  /** อัตราการใช้ห้องจริง = คนที่มาเช็กอิน / การจองทั้งหมด (เปอร์เซ็นต์) */
  utilizationRate: number;
  availableRooms: number;
  totalRooms: number;
  peakHours: PeakHour[];
  leastUsedRooms: RoomUsage[];
}

