export async function pushToDemoUser(text: string): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_DEMO_USER_ID;
  if (!token || !userId) {
    console.error("[LINE] ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_DEMO_USER_ID");
    return false;
  }

  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error(`[LINE] ส่งข้อความไม่สำเร็จ (HTTP ${response.status})`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[LINE] ส่งข้อความไม่สำเร็จ:", error instanceof Error ? error.message : "เกิดข้อผิดพลาด");
    return false;
  }
}

export function checkinStartMessage(roomName: string): string {
  return `ถึงเวลาจองห้อง ${roomName} แล้ว! เช็กอินภายใน 15 นาที ไม่งั้นห้องจะถูกปล่อย`;
}

export function checkinWarningMessage(roomName: string): string {
  return `อีก 5 นาทีห้อง ${roomName} จะถูกปล่อย กดเช็กอินตอนนี้เลย`;
}
