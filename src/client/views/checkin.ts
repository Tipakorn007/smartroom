/**
 * หน้า /checkin/:token (เปิดจาก QR หรือลิงก์ที่แนบมากับการจอง)
 * หน้านี้เป็นหน้าเดียวที่อยู่นอก shell หลัก เพราะผู้ใช้อาจเปิดจากมือถือตอนเดินมาถึงหน้าห้อง
 */

import {
  CHECKIN_WINDOW_MS,
  PRESENCE_REMINDER_WINDOW_MS,
} from "../../shared/constants";
import type { BookingLiveSnapshot, BookingStatus } from "../../shared/types";
import { api, ApiError } from "../api";
import { el, formatClock, formatCountdown, formatDateTime, showToast } from "../ui";

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "จองแล้ว รอเช็กอิน",
  active: "กำลังใช้งาน",
  released: "ถูกปล่อยคืน",
  finished: "สิ้นสุดแล้ว",
};

const STATUS_ICON: Record<BookingStatus, string> = {
  pending: "⏳",
  active: "✓",
  released: "↩",
  finished: "■",
};

/** สถานะการจอง → คลาสสีเดียวกับป้ายในแผนผังห้อง */
const STATUS_CHIP_CLASS: Record<BookingStatus, string> = {
  pending: "chip-pending",
  active: "chip-in_use",
  released: "chip-released",
  finished: "chip-released",
};

export async function renderCheckinPage(root: HTMLElement, token: string): Promise<void> {
  const header = el("header", { class: "site-header" }, [
    el("div", { class: "header-inner" }, [
      el("a", {
        class: "brand",
        href: "/",
        attrs: { "aria-label": "กลับหน้าหลัก SmartRoom" },
      }, [
        el("img", {
          class: "brand-mark",
          attrs: { src: "/smartroom-icon.png", alt: "", "aria-hidden": "true" },
        }),
        el("span", { class: "brand-text" }, [
          el("h1", {}, [
            el("span", { text: "Smart" }),
            el("span", { class: "brand-accent", text: "Room" }),
          ]),
          el("p", { text: "เช็กอินห้องติว" }),
        ]),
      ]),
    ]),
  ]);

  const main = el("main", { class: "container narrow" });
  root.replaceChildren(header, main);

  const card = el("section", { class: "card stack" });
  main.append(card);

  // ตรวจรูปแบบ token ฝั่ง client เพื่อไม่ต้องยิง request ที่รู้อยู่แล้วว่าไม่ถูกต้อง
  if (!/^[a-f0-9]{32}$/.test(token)) {
    card.append(
      el("h2", { text: "ลิงก์เช็กอินไม่ถูกต้อง" }),
      el("p", { class: "muted", text: "กรุณาสแกน QR จากหน้าจองอีกครั้ง" }),
      backLink(),
    );
    return;
  }

  card.append(el("p", { class: "muted", text: "กำลังโหลดข้อมูลการจอง…" }));

  let lastSnapshotKey = "";
  const renderSnapshot = (data: BookingLiveSnapshot): void => {
    const remaining = data.booking.endAt - Date.now();
    const reminderVisible =
      data.booking.status === "active" &&
      remaining > 0 &&
      remaining <= PRESENCE_REMINDER_WINDOW_MS;
    const key = [
      data.booking.status,
      data.booking.startAt,
      data.booking.endAt,
      data.waitlistCount,
      reminderVisible,
    ].join(":");
    if (key === lastSnapshotKey) return;
    lastSnapshotKey = key;
    showBooking(card, data, token, renderSnapshot);
  };

  try {
    renderSnapshot(await api.bookingLive(token));
    const source = new EventSource(`/api/bookings/${encodeURIComponent(token)}/events`);
    source.addEventListener("message", (event: MessageEvent<string>) => {
      try {
        renderSnapshot(JSON.parse(event.data) as BookingLiveSnapshot);
      } catch (error) {
        console.error("[client] อ่านสถานะการจองแบบ live ไม่สำเร็จ:", error);
      }
    });
    window.addEventListener("pagehide", () => source.close(), { once: true });
  } catch (error) {
    card.replaceChildren(
      el("h2", { text: "เปิดการจองนี้ไม่ได้" }),
      el("p", { class: "muted", text: error instanceof ApiError ? error.message : "โหลดข้อมูลไม่สำเร็จ" }),
      backLink(),
    );
  }
}

/** วาดข้อมูลการจอง + ปุ่มเช็กอิน (เรียกซ้ำได้หลังเช็กอินสำเร็จ) */
function showBooking(
  card: HTMLElement,
  data: BookingLiveSnapshot,
  token: string,
  onUpdated: (snapshot: BookingLiveSnapshot) => void,
): void {
  const { booking, room } = data;
  const deadline = booking.startAt + CHECKIN_WINDOW_MS;

  const chip = el("span", { class: `chip ${STATUS_CHIP_CLASS[booking.status]}` }, [
    el("span", {
      class: "chip-icon",
      text: STATUS_ICON[booking.status],
      attrs: { "aria-hidden": "true" },
    }),
    el("span", { text: STATUS_LABEL[booking.status] }),
  ]);

  const details = el("div", { class: "checkin-detail" }, [
    detailRow("ห้อง", `${room.name} · ชั้น ${room.floor} · จุ ${room.capacity} คน`),
    detailRow("ผู้จอง", booking.userName),
    detailRow("เวลา", `${formatDateTime(booking.startAt)} – ${formatClock(booking.endAt)} น.`),
  ]);

  if (booking.status === "pending") {
    details.append(
      detailRow(
        "เช็กอินก่อน",
        el("span", {}, [
          document.createTextNode(`${formatClock(deadline)} น. (`),
          el("span", {
            class: "countdown",
            attrs: { "data-deadline": String(deadline) },
            text: `อีก ${formatCountdown(deadline - Date.now())}`,
          }),
          document.createTextNode(")"),
        ]),
      ),
    );
  }

  const message = buildMessage(data);
  const checkInButton = el("button", {
    class: "button primary block",
    type: "button",
    text: "ยืนยันเช็กอินเข้าห้อง",
  });
  checkInButton.addEventListener("click", () => {
    void runCheckIn(checkInButton);
  });

  const leaveButton = el("button", {
    class: "button ghost block",
    type: "button",
    text: "ออกจากห้องก่อนเวลา",
  });
  leaveButton.addEventListener("click", () => {
    void runLeave(leaveButton);
  });

  async function runCheckIn(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      const result = await api.checkIn(token);
      showToast(
        result.alreadyCheckedIn ? "การจองนี้เช็กอินไว้แล้ว" : `เช็กอินห้อง ${result.room.name} สำเร็จ`,
        "info",
      );
      onUpdated({ ...data, booking: result.booking, room: result.room });
    } catch (error) {
      button.disabled = false;
      // แสดงข้อความจริงจาก server (เช่น "เลยเวลาเช็กอิน 15 นาทีแล้ว")
      card.prepend(
        el("p", {
          class: "alert",
          text: error instanceof ApiError ? error.message : "เช็กอินไม่สำเร็จ กรุณาลองใหม่",
        }),
      );
    }
  }

  async function runLeave(button: HTMLButtonElement): Promise<void> {
    if (!window.confirm("ยืนยันออกจากห้องและปล่อยให้ผู้ใช้ในคิวถัดไปหรือไม่?")) return;
    button.disabled = true;
    try {
      const result = await api.leaveBooking(token);
      showToast("ปล่อยห้องแล้ว ขอบคุณที่แจ้งสถานะ");
      onUpdated({ ...data, booking: result.booking });
    } catch (error) {
      button.disabled = false;
      card.prepend(
        el("p", {
          class: "alert",
          text: error instanceof ApiError ? error.message : "ออกจากห้องไม่สำเร็จ กรุณาลองใหม่",
        }),
      );
    }
  }

  async function runExtend(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      const result = await api.extendBooking(token, booking.endAt);
      showToast("ต่อเวลาใช้งานอีก 30 นาทีแล้ว");
      onUpdated({ ...data, booking: result.booking });
    } catch (error) {
      button.disabled = false;
      card.prepend(
        el("p", {
          class: "alert",
          text: error instanceof ApiError ? error.message : "ต่อเวลาไม่สำเร็จ กรุณาลองใหม่",
        }),
      );
    }
  }

  const children: HTMLElement[] = [
    el("div", { class: "checkin-hero" }, [
      el("div", {
        class: "checkin-icon",
        text: STATUS_ICON[booking.status],
        attrs: { "aria-hidden": "true" },
      }),
      el("h2", { text: `ห้อง ${room.name}` }),
      chip,
    ]),
    el("p", { class: "muted", text: message }),
    details,
  ];

  // ให้กดเช็กอินได้เฉพาะการจองที่ยัง pending (server ตรวจซ้ำอีกชั้นเสมอ)
  if (booking.status === "pending") {
    children.push(checkInButton);
  } else if (booking.status === "active") {
    const remaining = booking.endAt - Date.now();
    if (remaining > 0 && remaining <= PRESENCE_REMINDER_WINDOW_MS) {
      const extendButton = el("button", {
        class: "button primary block",
        type: "button",
        text: "ยืนยันต่อเวลา 30 นาที",
        disabled: data.waitlistCount > 0,
      });
      extendButton.addEventListener("click", () => void runExtend(extendButton));
      children.push(
        el("section", { class: "alert presence-prompt", attrs: { role: "status" } }, [
          el("strong", { text: "ยังใช้ห้องอยู่ไหม?" }),
          el("p", {
            text: data.waitlistCount > 0
              ? `มีคนรอคิว ${data.waitlistCount} คน จึงต่อเวลาไม่ได้`
              : "หากไม่มีผู้ใช้รอคิว สามารถต่อเวลาได้ครั้งละ 30 นาที",
          }),
          extendButton,
        ]),
      );
    }
    children.push(leaveButton);
  }
  children.push(backLink());

  card.replaceChildren(...children);
}

function buildMessage(data: BookingLiveSnapshot): string {
  switch (data.booking.status) {
    case "pending":
      return "กดปุ่มด้านล่างเพื่อยืนยันว่าคุณมาใช้ห้องจริง ระบบจึงจะเริ่มนับเวลาใช้งาน";
    case "active":
      return `เช็กอินเรียบร้อยแล้ว ใช้งานได้จนถึง ${formatClock(data.booking.endAt)} น.`;
    case "released":
      return "การจองนี้ถูกปล่อยคืนอัตโนมัติ เพราะไม่ได้เช็กอินภายใน 15 นาทีหลังเวลาเริ่ม กรุณาจองห้องใหม่";
    case "finished":
      return "การจองนี้สิ้นสุดเวลาใช้งานแล้ว";
  }
}

function detailRow(label: string, value: string | HTMLElement): HTMLElement {
  return el("div", { class: "detail-row" }, [
    el("span", { class: "muted", text: label }),
    typeof value === "string" ? el("span", { text: value }) : value,
  ]);
}

function backLink(): HTMLElement {
  return el("a", { class: "button ghost block", href: "/", text: "กลับไปหน้าแผนผังห้อง" });
}
