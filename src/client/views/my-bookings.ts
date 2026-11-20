import type { BookingHistoryEntry, WaitlistEntry } from "../../shared/types";
import { el, formatDateTime } from "../ui";

export function renderMyBookingsView(
  container: HTMLElement,
  entries: BookingHistoryEntry[],
  waitlists: WaitlistEntry[],
  onCancel: (token: string) => void,
): void {
  const page = el("section", { class: "stack my-bookings-page" }, [
    el("div", { class: "section-heading" }, [
      el("p", { class: "eyebrow", text: "บัญชีในอุปกรณ์นี้" }),
      el("h2", { text: "การจองของฉัน" }),
      el("p", { class: "muted", text: "ดูสถานะและประวัติการจอง ยืนยันหรือยกเลิกรายการที่ยังไม่เช็กอินได้" }),
    ]),
  ]);

  if (!entries.length) page.append(el("section", { class: "card empty muted", text: "ยังไม่มีประวัติการจอง" }));

  for (const entry of entries) {
    const { booking, room } = entry;
    const status = entry.cancelled ? "ยกเลิกแล้ว" : booking.status === "pending" ? "รอเช็กอิน"
      : booking.status === "active" ? "กำลังใช้งาน" : booking.status === "released" ? "ไม่มาเช็กอิน" : "เสร็จสิ้น";
    const card = el("article", { class: "card stack my-booking-card" }, [
      el("div", { class: "card-heading-row my-booking-heading" }, [
        el("h3", { text: `ห้อง ${room.name}` }),
        el("span", { class: `badge${entry.cancelled ? " muted" : ""}`, text: status }),
      ]),
      el("p", { class: "muted my-booking-time", text: `${formatDateTime(booking.startAt)} – ${formatDateTime(booking.endAt)}` }),
    ]);

    if (booking.status === "pending" && !entry.cancelled) {
      const confirm = el("a", {
        class: "button primary",
        href: `/checkin/${booking.token}`,
        text: "ยืนยัน/เช็กอิน",
      });
      const cancel = el("button", { class: "button ghost booking-cancel-button", type: "button", text: "ยกเลิกการจอง" });
      cancel.addEventListener("click", () => onCancel(booking.token));
      card.append(el("div", { class: "live-notice-actions" }, [confirm, cancel]));
    }
    page.append(card);
  }

  page.append(el("h3", { text: "คิวของฉัน" }));
  if (!waitlists.length) page.append(el("section", { class: "card empty muted", text: "ยังไม่มีประวัติคิว" }));
  for (const entry of waitlists) {
    const state = entry.status === "waiting" ? `รอคิวที่ ${entry.position ?? "—"}`
      : entry.status === "offered" ? "ได้รับข้อเสนอแล้ว"
      : entry.status === "accepted" ? "รับข้อเสนอแล้ว"
      : entry.status === "expired" ? "ข้อเสนอหมดเวลา"
      : "ยกเลิกคิวแล้ว";
    page.append(el("article", { class: "card card-heading-row" }, [
      el("h4", { text: `ห้อง ${entry.roomName} · ${entry.durationMinutes} นาที` }),
      el("span", { class: "badge", text: state }),
    ]));
  }

  container.replaceChildren(page);
}
