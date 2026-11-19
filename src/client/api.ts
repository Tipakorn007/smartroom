/**
 * ตัวเรียก REST API ฝั่ง client
 * รวมการจัดการ error ไว้ที่เดียว เพื่อให้ view ไม่ต้องเขียน try/catch ซ้ำ ๆ
 */

import type {
  BookingWithRoom,
  CheckInResponse,
  CreateBookingRequest,
  CreateBookingResponse,
  RecommendRequest,
  Recommendation,
  RoomView,
  StatsResponse,
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
    throw new ApiError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่าเซิร์ฟเวอร์ทำงานอยู่", 0);
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

  /** เช็กอินด้วย token */
  checkIn(token: string): Promise<CheckInResponse> {
    return request<CheckInResponse>(`/api/bookings/${encodeURIComponent(token)}/checkin`, {
      method: "POST",
    });
  },
};
