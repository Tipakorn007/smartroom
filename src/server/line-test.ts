import { checkinStartMessage, checkinWarningMessage, pushToDemoUser } from "../../lib/line.ts";
import { assertSameOrigin, requireAdmin } from "./admin-auth.ts";
import { HttpError, json } from "./http.ts";

export async function handleLineTest(request: Request, pathname: string): Promise<Response> {
  requireAdmin(request);
  assertSameOrigin(request);
  let message: string;
  if (pathname === "/api/admin/line-test") message = "SmartRoom ทดสอบการแจ้งเตือน ✅";
  else if (pathname === "/api/admin/line-test/checkin-start") message = checkinStartMessage("ห้องตัวอย่าง");
  else if (pathname === "/api/admin/line-test/checkin-warning") message = checkinWarningMessage("ห้องตัวอย่าง");
  else throw new HttpError(404, "ไม่พบข้อความทดสอบนี้");
  if (!await pushToDemoUser(message)) throw new HttpError(502, "ส่งข้อความทดสอบไป LINE ไม่สำเร็จ");
  return json({ sent: true });
}
