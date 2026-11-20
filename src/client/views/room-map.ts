import type { RoomStatus, RoomView } from "../../shared/types";
import { el, formatClock } from "../ui";

const STATUS: Record<RoomStatus, { label: string; color: string }> = {
  available: { label: "ว่าง", color: "available" },
  pending: { label: "จองแล้ว · รอเช็กอิน", color: "pending" },
  offered: { label: "จองแล้ว · รอตอบรับ", color: "pending" },
  in_use: { label: "กำลังใช้งาน", color: "in-use" },
  closed: { label: "ปิดใช้งาน", color: "closed" },
};

export interface RoomMapHandlers {
  onSelectFloor: (floor: number) => void;
  onSelectRoom: (room: RoomView) => void;
}

export function renderFloorTabs(
  container: HTMLElement,
  rooms: RoomView[],
  activeFloor: number,
  onSelectFloor: (floor: number) => void,
): void {
  const floors = [...new Set(rooms.map((room) => room.floor))].sort((a, b) => a - b);
  container.replaceChildren(...floors.map((floor) => {
    const floorRooms = rooms.filter((room) => room.floor === floor);
    const available = floorRooms.filter((room) => room.status === "available").length;
    const button = el("button", {
      class: `room-map-floor${floor === activeFloor ? " is-active" : ""}`,
      type: "button",
      attrs: { role: "tab", "aria-selected": String(floor === activeFloor) },
    }, [
      el("span", { text: `ชั้น ${floor}` }),
      el("span", { class: "room-map-floor-count", text: `${available}/${floorRooms.length} ว่าง` }),
    ]);
    button.addEventListener("click", () => onSelectFloor(floor));
    return button;
  }));
}

export function renderRoomCards(
  container: HTMLElement,
  rooms: RoomView[],
  activeFloor: number,
  minCapacity: number,
  availableOnly: boolean,
  previousStatuses: Map<number, RoomStatus>,
  onSelectRoom: (room: RoomView) => void,
): void {
  const visibleRooms = rooms.filter((room) =>
    room.floor === activeFloor && room.capacity >= minCapacity && (!availableOnly || room.status === "available"),
  );
  if (!visibleRooms.length) {
    container.replaceChildren(el("div", { class: "room-map-empty card", text: "ไม่พบห้องตามตัวกรองนี้ ลองปรับจำนวนที่นั่งหรือแสดงห้องทั้งหมด" }));
    return;
  }

  const cards = visibleRooms.map((room) => {
    const status = STATUS[room.status];
    const card = el("button", {
      class: `room-map-card status-${status.color}`,
      type: "button",
      attrs: { "aria-label": `${room.name}, ${status.label}, ความจุ ${room.capacity} ที่นั่ง` },
    }, [
      el("span", { class: "room-map-card-top" }, [
        el("span", { class: "room-map-name", text: room.name }),
        el("span", { class: `room-map-status status-label-${status.color}` }, [
          el("span", { class: "room-map-status-dot", attrs: { "aria-hidden": "true" } }),
          el("span", { text: status.label }),
        ]),
      ]),
      el("span", { class: "room-map-seats", text: `${room.capacity} ที่นั่ง` }),
      el("span", { class: "room-map-availability", text: availabilityText(room) }),
      el("span", { class: "room-map-open-hint", text: "ดูรายละเอียด ›" }),
    ]);
    card.addEventListener("click", () => onSelectRoom(room));

    const previous = previousStatuses.get(room.id);
    if (previous && previous !== room.status && typeof card.animate === "function") {
      const previousColor = statusColor(previous);
      const nextColor = statusColor(room.status);
      card.animate(
        [
          { borderColor: previousColor, boxShadow: `0 0 0 3px color-mix(in srgb, ${previousColor} 30%, transparent)` },
          { borderColor: nextColor, boxShadow: "0 0 0 0 transparent" },
        ],
        { duration: 620, easing: "ease-out" },
      );
    }
    return card;
  });
  container.replaceChildren(...cards);
}

export function updateMapSummary(
  summary: HTMLElement,
  rooms: RoomView[],
  floor: number,
  minCapacity: number,
  availableOnly: boolean,
  updatedAt: number,
): void {
  const allOnFloor = rooms.filter((room) => room.floor === floor);
  const shown = allOnFloor.filter((room) => room.capacity >= minCapacity && (!availableOnly || room.status === "available"));
  const available = allOnFloor.filter((room) => room.status === "available").length;
  summary.replaceChildren(
    el("strong", { text: `ว่าง ${available}/${allOnFloor.length} ห้อง` }),
    el("span", { class: "room-map-summary-meta", text: `แสดง ${shown.length} ห้อง · อัปเดต ${formatClock(updatedAt)} น.` }),
  );
}

export function openRoomDetails(room: RoomView, onBook: () => void): void {
  const dialog = el("dialog", { class: "modal room-map-dialog", attrs: { "aria-label": `รายละเอียดห้อง ${room.name}` } });
  const close = el("button", {
    class: "icon-button room-map-dialog-close",
    type: "button",
    text: "ปิด",
    attrs: { "aria-label": "ปิดรายละเอียดห้อง" },
  });
  close.addEventListener("click", () => dialog.close());

  const status = STATUS[room.status];
  const detail = el("div", { class: "modal-card room-map-detail" }, [
    el("div", { class: "room-map-detail-heading" }, [
      el("div", {}, [
        el("p", { class: "eyebrow", text: `ชั้น ${room.floor}` }),
        el("h2", { text: room.name }),
      ]),
      close,
    ]),
    el("div", { class: "room-map-detail-status" }, [
      el("span", { class: `room-map-status-dot status-dot-${status.color}`, attrs: { "aria-hidden": "true" } }),
      el("strong", { text: status.label }),
    ]),
    el("div", { class: "room-map-detail-grid" }, [
      detailItem("ที่นั่ง", `${room.capacity} คน`),
      detailItem("ปลั๊กไฟ", room.hasPower ? "มี" : "ไม่มี"),
      detailItem("ไวท์บอร์ด", room.hasWhiteboard ? "มี" : "ไม่มี"),
      detailItem("โซน", room.quietLevel === "quiet" ? "โซนเงียบ" : room.quietLevel === "group" ? "โซนกลุ่ม" : "โซนทั่วไป"),
    ]),
    el("p", { class: "room-map-detail-availability muted", text: availabilityText(room) }),
  ]);

  if (room.status === "closed" && room.closureReason) {
    detail.append(el("p", { class: "room-map-closure muted", text: room.closureReason }));
  }
  if (room.status === "available") {
    const book = el("button", { class: "button primary block", type: "button", text: "จองห้องนี้" });
    book.addEventListener("click", () => {
      dialog.close();
      onBook();
    });
    detail.append(book);
  } else {
    detail.append(el("p", { class: "room-map-booking-note muted", text: "ห้องนี้ยังจองไม่ได้ในขณะนี้" }));
  }
  dialog.append(detail);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

function detailItem(label: string, value: string): HTMLElement {
  return el("div", { class: "room-map-detail-item" }, [
    el("span", { class: "muted small", text: label }),
    el("strong", { text: value }),
  ]);
}

function availabilityText(room: RoomView): string {
  if (room.status === "available") {
    return room.nextBookingAt
      ? `ว่างถึง ${formatClock(room.nextBookingAt)} น.`
      : "ว่างอยู่ · ยังไม่มีจองถัดไป";
  }
  if (room.status === "closed") {
    return room.closureEndsAt ? `เปิดอีกครั้ง ${formatClock(room.closureEndsAt)} น.` : "ปิดจนกว่าจะมีการเปลี่ยนแปลง";
  }
  const availableAt = room.currentBooking?.endAt ?? room.checkinDeadline;
  return availableAt ? `ว่างประมาณ ${formatClock(availableAt)} น.` : "กำลังรออัปเดตสถานะ";
}

function statusColor(status: RoomStatus): string {
  const variable = status === "available" ? "--room-map-status-available" :
    status === "pending" || status === "offered" ? "--room-map-status-pending" :
      status === "in_use" ? "--room-map-status-in-use" : "--room-map-status-closed";
  const page = document.querySelector<HTMLElement>(".room-map-page") ?? document.documentElement;
  return getComputedStyle(page).getPropertyValue(variable).trim()
    || getComputedStyle(page).getPropertyValue("--link").trim();
}
