import type { BookingHistoryEntry, RoomView, WaitlistEntry } from "../../shared/types";
import { el, formatDateTime } from "../ui";

function localDateValue(timestamp: number): string {
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function renderMyBookingsView(
  container: HTMLElement,
  entries: BookingHistoryEntry[],
  waitlists: WaitlistEntry[],
  rooms: RoomView[],
  onEdit: (token: string, roomId: number, durationMinutes: number, startAt: number) => void,
  onCancel: (token: string) => void,
): void {
  const page = el("section", { class: "stack" }, [
    el("div", { class: "section-heading" }, [
      el("p", { class: "eyebrow", text: "บัญชีในอุปกรณ์นี้" }),
      el("h2", { text: "การจองของฉัน" }),
      el("p", { class: "muted", text: "ดูสถานะและประวัติการจอง แก้ไขหรือยกเลิกรายการที่ยังไม่เช็กอินได้" }),
    ]),
  ]);

  if (!entries.length) page.append(el("section", { class: "card empty muted", text: "ยังไม่มีประวัติการจอง" }));

  for (const entry of entries) {
    const { booking, room } = entry;
    const status = entry.cancelled ? "ยกเลิกแล้ว" : booking.status === "pending" ? "รอเช็กอิน"
      : booking.status === "active" ? "กำลังใช้งาน" : booking.status === "released" ? "ไม่มาเช็กอิน" : "เสร็จสิ้น";
    const card = el("article", { class: "card stack" }, [
      el("div", { class: "card-heading-row" }, [
        el("h3", { text: `ห้อง ${room.name}` }),
        el("span", { class: `badge${entry.cancelled ? " muted" : ""}`, text: status }),
      ]),
      el("p", { class: "muted", text: `${formatDateTime(booking.startAt)} – ${formatDateTime(booking.endAt)}` }),
    ]);

    if (booking.status === "pending" && !entry.cancelled) {
      const editForm = document.createElement("form");
      editForm.className = "booking-edit-form";
      const roomSelect = document.createElement("select");
      roomSelect.name = "roomId";
      roomSelect.setAttribute("aria-label", "ห้อง");
      for (const candidate of rooms.filter((item) => item.id === room.id || item.status === "available")) {
        const option = document.createElement("option");
        option.value = String(candidate.id);
        option.textContent = `${candidate.name} · ชั้น ${candidate.floor}`;
        option.selected = candidate.id === room.id;
        roomSelect.append(option);
      }
      const duration = document.createElement("select");
      duration.name = "duration";
      duration.setAttribute("aria-label", "ระยะเวลา");
      for (const minutes of [30, 60, 120]) {
        const option = document.createElement("option");
        option.value = String(minutes);
        option.textContent = `${minutes} นาที`;
        option.selected = booking.endAt - booking.startAt === minutes * 60_000;
        duration.append(option);
      }
      const start = document.createElement("input");
      start.type = "datetime-local";
      start.name = "startAt";
      start.value = localDateValue(Math.max(booking.startAt, Date.now() + 5 * 60_000));
      start.min = localDateValue(Date.now() + 5 * 60_000);
      start.max = localDateValue(Date.now() + 7 * 24 * 60 * 60_000);
      start.setAttribute("aria-label", "เวลาเริ่ม");
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "button primary";
      save.textContent = "บันทึกการแก้ไข";
      editForm.append(roomSelect, duration, start, save);
      editForm.addEventListener("submit", (event) => {
        event.preventDefault();
        onEdit(booking.token, Number(roomSelect.value), Number(duration.value), new Date(start.value).getTime());
      });
      const cancel = el("button", { class: "button ghost", type: "button", text: "ยกเลิกการจอง" });
      cancel.addEventListener("click", () => onCancel(booking.token));
      card.append(editForm, cancel);
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
