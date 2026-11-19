/**
 * ตัวเรียก REST API ฝั่ง client
 * รวมการจัดการ error ไว้ที่เดียว เพื่อให้ view ไม่ต้องเขียน try/catch ซ้ำ ๆ
 */

import type {
  Booking,
  BookingLiveSnapshot,
  BookingWithRoom,
  CheckInResponse,
  CreateBookingRequest,
  CreateBookingResponse,
  LiveSnapshot,
  RecommendRequest,
  Recommendation,
  RoomView,
  StatsResponse,
  WaitlistEntry,
} from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json" },
    });
  } catch {
    throw new ApiError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง", 0);
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    // server ตอบ error เป็น { error: "ข้อความภาษาไทย" } เสมอ
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : "คำขอไม่สำเร็จ";
    throw new ApiError(message, response.status);
  }

  return data as T;
}

export const api = {
  /** ห้อง คิว และการจองของอุปกรณ์นี้ */
  live(userId: string): Promise<LiveSnapshot> {
    return request<LiveSnapshot>(`/api/live?userId=${encodeURIComponent(userId)}`);
  },

  /** แผนผังห้อง + สถานะล่าสุด */
  rooms(): Promise<RoomView[]> {
    return request<RoomView[]>("/api/rooms");
  },

  /** สร้างการจอง (server ตรวจห้องว่างและกันจองซ้อนให้) */
  createBooking(payload: CreateBookingRequest): Promise<CreateBookingResponse> {
    return request<CreateBookingResponse>("/api/bookings", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** เข้าคิวห้องที่กำลังถูกใช้งาน */
  joinWaitlist(payload: {
    userId: string;
    roomId: number;
    userName: string;
    durationMinutes: number;
  }): Promise<WaitlistEntry> {
    return request<WaitlistEntry>("/api/waitlist", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** รับข้อเสนอห้องจากคิว */
  acceptWaitlist(waitlistId: number, userId: string): Promise<CreateBookingResponse> {
    return request(`/api/waitlist/${waitlistId}/accept`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  },

  /** ยกเลิกคิวหรือข้ามข้อเสนอ */
  cancelWaitlist(waitlistId: number, userId: string): Promise<{ cancelled: true }> {
    return request(`/api/waitlist/${waitlistId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  },

  /** ต่อเวลาใช้งานอีก 30 นาที */
  extendBooking(token: string, expectedEndAt: number): Promise<{ booking: Booking }> {
    return request<{ booking: Booking }>(`/api/bookings/${encodeURIComponent(token)}/extend`, {
      method: "POST",
      body: JSON.stringify({ expectedEndAt }),
    });
  },

  /** แจ้งออกจากห้องก่อนกำหนด */
  leaveBooking(token: string): Promise<{ booking: Booking }> {
    return request<{ booking: Booking }>(`/api/bookings/${encodeURIComponent(token)}/leave`, {
      method: "POST",
    });
  },

  /** ขอคำแนะนำห้องตามจำนวนคนและคุณสมบัติที่ต้องการ */
  recommend(payload: RecommendRequest): Promise<{ recommendations: Recommendation[] }> {
    return request<{ recommendations: Recommendation[] }>("/api/recommend", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** สถิติสำหรับฝ่ายอาคารสถานที่ */
  stats(): Promise<StatsResponse> {
    return request<StatsResponse>("/api/stats");
  },

  /** ข้อมูลการจองจาก token (ใช้ในหน้า /checkin/:token) */
  booking(token: string): Promise<BookingWithRoom> {
    return request<BookingWithRoom>(`/api/bookings/${encodeURIComponent(token)}`);
  },

  /** รายละเอียดการจอง คิวห้อง และสถานะสำหรับหน้าเช็กอินสด */
  bookingLive(token: string): Promise<BookingLiveSnapshot> {
    return request<BookingLiveSnapshot>(`/api/bookings/${encodeURIComponent(token)}/live`);
  },

  /** เช็กอินด้วย token */
  checkIn(token: string): Promise<CheckInResponse> {
    return request<CheckInResponse>(`/api/bookings/${encodeURIComponent(token)}/checkin`, {
      method: "POST",
    });
  },
};
