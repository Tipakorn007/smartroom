/**
 * แผนผังห้องแยกตามชั้น
 * การ์ดแต่ละใบบอกสถานะด้วย "ไอคอน + ข้อความ + สี" พร้อมนับถอยหลังสำหรับห้องที่รอเช็กอิน
 * เพื่อให้คนที่มองสีไม่ออกก็ยังเข้าใจสถานะได้
 */

import type { QuietLevel, RoomStatus, RoomView } from "../../shared/types";
import { el, formatClock, formatCountdown } from "../ui";

const STATUS_LABEL: Record<RoomStatus, string> = {
  available: "ว่าง",
  in_use: "กำลังใช้งาน",
  pending: "จองแล้วรอเช็กอิน",
};

const STATUS_ICON: Record<RoomStatus, string> = {
  available: "✓",
  in_use: "●",
  pending: "⏳",
};

const QUIET_LABEL: Record<QuietLevel, string> = {
  quiet: "โซนเงียบ",
  normal: "โซนทั่วไป",
  group: "โซนกลุ่ม",
};

export interface RoomsViewHandlers {
  onSelectFloor: (floor: number) => void;
  onBook: (room: RoomView) => void;
}

export function renderRoomsView(
  container: HTMLElement,
  rooms: RoomView[],
  activeFloor: number,
  handlers: RoomsViewHandlers,
): void {
  const heading = el("div", { class: "section-heading" }, [
    el("div", {}, [
      el("h2", { text: "แผนผังห้องติว" }),
      el("p", {
        class: "muted",
        text: "สถานะห้องอัปเดตอัตโนมัติทุก 10 วินาที",
      }),
    ]),
  ]);

  const floors = [...new Set(rooms.map((room) => room.floor))].sort((a, b) => a - b);
  const floorTabs = el("div", {
    class: "floor-tabs",
    attrs: { role: "tablist", "aria-label": "เลือกชั้นของอาคาร" },
  });

  for (const floor of floors) {
    const roomsOnFloor = rooms.filter((room) => room.floor === floor);
    const availableCount = roomsOnFloor.filter((room) => room.status === "available").length;
    const button = el(
      "button",
      {
        class: `floor-tab${floor === activeFloor ? " is-active" : ""}`,
        type: "button",
        attrs: { role: "tab", "aria-selected": String(floor === activeFloor) },
      },
      [
        el("span", { text: `ชั้น ${floor}` }),
        el("span", {
          class: "floor-count",
          text: `ว่าง ${availableCount}/${roomsOnFloor.length}`,
        }),
      ],
    );
    button.addEventListener("click", () => handlers.onSelectFloor(floor));
    floorTabs.append(button);
  }

  const grid = el("div", { class: "room-grid" });
  const roomsOnFloor = rooms.filter((room) => room.floor === activeFloor);
  for (const room of roomsOnFloor) {
    grid.append(buildRoomCard(room, handlers.onBook));
  }

  container.append(heading, floorTabs, buildLegend(), grid);

  if (roomsOnFloor.length === 0) {
    container.append(el("p", { class: "empty muted", text: "ยังไม่มีห้องในชั้นนี้" }));
  }
}

/** คำอธิบายสัญลักษณ์ ใช้ชุดสี/ข้อความเดียวกับการ์ดจริง */
function buildLegend(): HTMLElement {
  const legend = el("div", { class: "legend", attrs: { "aria-label": "คำอธิบายสถานะห้อง" } });
  const statuses: RoomStatus[] = ["available", "in_use", "pending"];
  for (const status of statuses) {
    legend.append(
      el("span", { class: "legend-item" }, [
        el("span", { class: `chip chip-${status}` }, [
          el("span", { class: "chip-icon", text: STATUS_ICON[status], attrs: { "aria-hidden": "true" } }),
          el("span", { text: STATUS_LABEL[status] }),
        ]),
      ]),
    );
  }
  return legend;
}

/** การ์ดห้องหนึ่งใบ */
function buildRoomCard(room: RoomView, onBook: (room: RoomView) => void): HTMLElement {
  const card = el("article", { class: `room-card status-${room.status}` }, [
    el("header", { class: "room-card-head" }, [
      el("div", {}, [
        el("h3", { text: room.name }),
        el("p", { class: "muted small", text: `ชั้น ${room.floor} · จุ ${room.capacity} คน` }),
      ]),
      buildStatusChip(room),
    ]),
    buildFeatureList(room),
    buildRoomState(room),
  ]);

  // ปุ่มจองมีเฉพาะห้องที่ว่างจริงเท่านั้น
  if (room.status === "available") {
    const button = el("button", { class: "button primary block", type: "button", text: "จองห้องนี้" });
    button.addEventListener("click", () => onBook(room));
    card.append(button);
  }

  return card;
}

/** ป้ายสถานะ: ไอคอน + ข้อความ (+ นาฬิกานับถอยหลังถ้ารอเช็กอิน) */
function buildStatusChip(room: RoomView): HTMLElement {
  const chip = el("span", { class: `chip chip-${room.status}` }, [
    el("span", { class: "chip-icon", text: STATUS_ICON[room.status], attrs: { "aria-hidden": "true" } }),
    el("span", { text: STATUS_LABEL[room.status] }),
  ]);

  if (room.status === "pending" && room.checkinDeadline !== null) {
    chip.append(
      el("span", {
        class: "countdown",
        attrs: { "data-deadline": String(room.checkinDeadline) },
        text: `อีก ${formatCountdown(room.checkinDeadline - Date.now())}`,
      }),
    );
  }

  return chip;
}

/** คุณสมบัติห้อง: ของที่ไม่มีก็แสดงแบบขีดฆ่า ไม่ใช่ซ่อนหายไป */
function buildFeatureList(room: RoomView): HTMLElement {
  const features: Array<{ label: string; present: boolean }> = [
    { label: "ปลั๊กไฟ", present: room.hasPower },
    { label: "ไวท์บอร์ด", present: room.hasWhiteboard },
  ];

  const list = el("ul", { class: "feature-list" });
  for (const feature of features) {
    list.append(
      el("li", {
        class: `feature ${feature.present ? "is-present" : "is-absent"}`,
        text: `${feature.present ? "✓" : "—"} ${feature.label}`,
      }),
    );
  }
  list.append(
    el("li", {
      class: "feature is-present",
      text: `🔈 ${QUIET_LABEL[room.quietLevel]}`,
    }),
  );
  return list;
}

/** บรรทัดอธิบายว่าเกิดอะไรขึ้นกับห้องตอนนี้ */
function buildRoomState(room: RoomView): HTMLElement {
  if (room.status === "available") {
    return el("p", { class: "room-state", text: "ห้องว่าง จองได้เลยตอนนี้" });
  }

  const booking = room.currentBooking;
  if (!booking) {
    return el("p", { class: "room-state", text: "ไม่พบข้อมูลการจอง" });
  }

  if (room.status === "pending") {
    return el("p", {
      class: "room-state",
      text: `จองโดย ${booking.userName} · เริ่ม ${formatClock(booking.startAt)} น.`,
    });
  }

  return el("p", {
    class: "room-state",
    text: `ใช้โดย ${booking.userName} · ถึง ${formatClock(booking.endAt)} น.`,
  });
}
