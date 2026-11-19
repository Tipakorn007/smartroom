/**
 * ตัวช่วยเรื่อง HTTP ที่ใช้ร่วมกันทุก route
 * แยกออกมาเพื่อไม่ให้โค้ดจัดการ JSON ไปปนกับตรรกะการจองห้อง
 */

/** error ที่ "ตั้งใจ" ให้ตอบกลับผู้ใช้ได้ พร้อม HTTP status ที่เหมาะสม */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * ตอบกลับเป็น JSON พร้อม cache-control: no-store
 * เพราะข้อมูลห้องเปลี่ยนตลอดเวลา ไม่ควรให้ browser cache คำตอบเก่า
 */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * อ่าน body เป็น JSON แบบตรวจชนิดให้แล้ว
 * ถ้า client ส่ง JSON เสียหรือส่ง array มา จะได้ 400 พร้อมข้อความภาษาไทย
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "รูปแบบ JSON ไม่ถูกต้อง");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "ข้อมูลที่ส่งมาต้องเป็นออบเจกต์ JSON");
  }
  return body as Record<string, unknown>;
}
