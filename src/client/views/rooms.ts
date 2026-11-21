/**
 * Floor selector and room availability dashboard.
 */

import type { QuietLevel, RoomStatus, RoomView, WaitlistEntry } from "../../shared/types";
import { el, formatClock, formatCountdown } from "../ui";

const STATUS_LABEL: Record<RoomStatus, string> = {
  available: "ว่าง",
  in_use: "กำลังใช้งาน",
  pending: "รอเช็กอิน",
  offered: "กำลังเสนอคิว",
  closed: "ปิดใช้งาน",
};

const QUIET_LABEL: Record<QuietLevel, string> = {
  quiet: "โซนเงียบ",
  normal: "โซนทั่วไป",
  group: "โซนกลุ่ม",
};

export interface RoomsViewHandlers {
  onSelectFloor: (floor: number) => void;
  onBook: (room: RoomView) => void;
  onJoinWaitlist: (room: RoomView) => void;
  onAcceptWaitlist: (entry: WaitlistEntry) => void;
  onCancelWaitlist: (entry: WaitlistEntry) => void;
}

export function renderRoomsView(
  container: HTMLElement,
  rooms: RoomView[],
  activeFloor: number,
  waitlists: WaitlistEntry[],
  handlers: RoomsViewHandlers,
): void {
  const floors = [...new Set(rooms.map((room) => room.floor))].sort((a, b) => a - b);
  const roomsOnFloor = rooms.filter((room) => room.floor === activeFloor);
  const availableCount = roomsOnFloor.filter((room) => room.status === "available").length;
  const inUseCount = roomsOnFloor.filter((room) => room.status === "in_use").length;
  const pendingCount = roomsOnFloor.filter((room) => room.status === "pending").length;

  const heading = el("section", { class: "rooms-hero" }, [
    el("div", { class: "rooms-intro" }, [
      el("p", { class: "eyebrow", text: `อาคารเรียนรวม · ชั้น ${activeFloor}` }),
      el("h2", { text: "ห้องไหนว่างตอนนี้" }),
      el("p", {
        class: "muted",
        text: "ทุกห้องนับสถานะจากการจองจริง ถ้าไม่มีคนเช็กอินภายใน 15 นาที ห้องจะกลับมาว่างให้คนอื่นจองทันที",
      }),
    ]),
    el("div", { class: "room-kpis", attrs: { "aria-label": "สรุปสถานะห้องในชั้นนี้" } }, [
      kpi("ว่าง", `${availableCount}/${roomsOnFloor.length}`, "ห้อง", "available"),
      kpi("กำลังใช้", String(inUseCount), "ห้อง", "in_use"),
      kpi("รอเช็กอิน", String(pendingCount), "ห้อง", "pending"),
    ]),
  ]);

  const floorPicker = el("nav", {
    class: "floor-picker",
    attrs: { role: "tablist", "aria-label": "เลือกชั้นของอาคาร" },
  });
  floorPicker.append(el("p", { class: "eyebrow floor-picker-label", text: "ชั้น" }));
  for (const floor of floors) {
    const floorRooms = rooms.filter((room) => room.floor === floor);
    const freeCount = floorRooms.filter((room) => room.status === "available").length;
    const button = el(
      "button",
      {
        class: `floor-option${floor === activeFloor ? " is-active" : ""}`,
        type: "button",
        attrs: {
          role: "tab",
          "aria-selected": String(floor === activeFloor),
        },
      },
      [
        el("span", { text: `ชั้น ${floor}` }),
        el("span", { class: "floor-option-count", text: `${freeCount}/${floorRooms.length}` }),
      ],
    );
    button.addEventListener("click", () => handlers.onSelectFloor(floor));
    floorPicker.append(button);
  }
  floorPicker.append(buildLegend());

  const table = el("section", { class: "room-table", attrs: { "aria-label": `ห้องชั้น ${activeFloor}` } });
  table.append(
    el("div", { class: "room-table-head", attrs: { "aria-hidden": "true" } }, [
      el("span", { text: "ห้อง" }),
      el("span", { text: "คุณสมบัติ" }),
      el("span", { text: "สถานะ" }),
      el("span", { text: "" }),
    ]),
  );
  for (const room of roomsOnFloor) {
    const entry = waitlists.find((item) => item.roomId === room.id);
    const row = buildRoomRow(room, entry, handlers);
    table.append(row);
  }

  if (roomsOnFloor.length === 0) {
    table.append(el("p", { class: "empty muted", text: "ยังไม่มีห้องในชั้นนี้" }));
  }

  container.replaceChildren(
    heading,
    el("div", { class: "rooms-layout" }, [floorPicker, table]),
  );
}

function kpi(
  label: string,
  value: string,
  unit: string,
  status: RoomStatus,
): HTMLElement {
  return el("div", { class: `room-kpi room-kpi-${status}` }, [
    el("span", { class: "room-kpi-label", text: label }),
    el("strong", { class: "room-kpi-value", text: value }),
    el("span", { class: "room-kpi-unit", text: unit }),
  ]);
}

function buildLegend(): HTMLElement {
  const legend = el("div", { class: "room-legend", attrs: { "aria-label": "คำอธิบายสถานะห้อง" } });
  for (const status of ["available", "in_use", "pending", "offered", "closed"] as const) {
    legend.append(
      el("div", { class: "room-legend-item" }, [
        el("span", {
          class: `status-dot status-dot-${status}`,
          attrs: { "aria-hidden": "true" },
        }),
        el("span", { text: STATUS_LABEL[status] }),
      ]),
    );
  }
  return legend;
}

function buildRoomRow(
  room: RoomView,
  entry: WaitlistEntry | undefined,
  handlers: RoomsViewHandlers,
): HTMLElement {
  const features = el("div", { class: "room-features" }, [
    feature("ปลั๊กไฟ", room.hasPower),
    feature("ไวท์บอร์ด", room.hasWhiteboard),
    el("span", { class: "room-feature quiet-feature", text: QUIET_LABEL[room.quietLevel] }),
  ]);

  const children: HTMLElement[] = [
    el("div", { class: "room-name" }, [
      el("strong", { text: room.name }),
      el("span", { class: "muted small", text: `จุ ${room.capacity} คน` }),
    ]),
    features,
    buildRoomStatus(room, entry),
  ];

  if (room.status === "closed") {
    // Closed rooms are informational and do not expose booking or queue actions.
  } else if (entry?.status === "offered") {
    const acceptButton = el("button", {
      class: "button primary room-book-button",
      type: "button",
      text: "รับข้อเสนอ",
      attrs: { "aria-label": `รับข้อเสนอห้อง ${room.name}` },
    });
    acceptButton.addEventListener("click", () => handlers.onAcceptWaitlist(entry));
    children.push(acceptButton);
  } else if (entry?.status === "waiting") {
    const cancelButton = el("button", {
      class: "button ghost room-book-button",
      type: "button",
      text: "ออกจากคิว",
      attrs: { "aria-label": `ออกจากคิวห้อง ${room.name}` },
    });
    cancelButton.addEventListener("click", () => handlers.onCancelWaitlist(entry));
    children.push(cancelButton);
  } else if (room.status === "available" && room.waitlistCount === 0) {
    const button = el("button", {
      class: "button primary room-book-button",
      type: "button",
      text: "จอง",
      attrs: { "aria-label": `จองห้อง ${room.name}` },
    });
    button.addEventListener("click", () => handlers.onBook(room));
    children.push(button);
  } else {
    const button = el("button", {
      class: "button ghost room-book-button",
      type: "button",
      text: "เข้าคิว",
      attrs: { "aria-label": `เข้าคิวห้อง ${room.name}` },
    });
    button.addEventListener("click", () => handlers.onJoinWaitlist(room));
    children.push(button);
  }

  return el("article", { class: `room-row status-${room.status}` }, children);
}

function feature(label: string, present: boolean): HTMLElement {
  return el("span", {
    class: `room-feature${present ? " is-present" : " is-absent"}`,
    text: `${present ? "✓" : "—"} ${label}`,
  });
}

function buildRoomStatus(room: RoomView, entry: WaitlistEntry | undefined): HTMLElement {
  const booking = room.currentBooking;
  const statusContent: HTMLElement[] = [
    el("div", { class: `room-status-label status-text-${room.status}` }, [
      el("span", {
        class: `status-dot status-dot-${room.status}`,
        attrs: { "aria-hidden": "true" },
      }),
      el("span", { text: STATUS_LABEL[room.status] }),
    ]),
  ];

  if (room.status === "closed") {
    statusContent.push(el("span", { class: "room-status-detail", text: room.closureReason ?? "ปิดใช้งานชั่วคราว" }));
  } else if (room.status === "available") {
    statusContent.push(el("span", {
      class: "room-status-detail",
      text: room.nextBookingAt
        ? `ว่างถึง ${formatClock(room.nextBookingAt)} น. · คิวจะได้รับข้อเสนอหลังการจองถัดไป`
        : room.waitlistCount > 0
          ? "มีผู้ใช้รอคิวอยู่"
          : "จองได้เลยตอนนี้",
    }));
  } else if (room.status === "offered") {
    statusContent.push(
      el("span", { class: "room-status-detail", text: "กำลังรอผู้ใช้ในคิวตอบรับ" }),
    );
  } else if (!booking) {
    statusContent.push(el("span", { class: "room-status-detail", text: "ไม่พบข้อมูลการจอง" }));
  } else if (room.status === "pending") {
    statusContent.push(
      el("span", {
        class: "room-status-detail",
        text: `จองแล้ว · เริ่ม ${formatClock(booking.startAt)} น.`,
      }),
    );
    if (room.checkinDeadline !== null) {
      statusContent.push(
        el("span", {
          class: "room-status-countdown",
          attrs: { "data-deadline": String(room.checkinDeadline) },
          text: `เหลือ ${formatCountdown(room.checkinDeadline - Date.now())}`,
        }),
      );
    }
  } else {
    statusContent.push(
      el("span", {
        class: "room-status-detail",
        text: `กำลังใช้งาน · ถึง ${formatClock(booking.endAt)} น.`,
      }),
    );
    if (room.nextBookingAt) statusContent.push(el("span", {
      class: "room-status-detail",
      text: `มีการจองถัดไป ${formatClock(room.nextBookingAt)} น. · คิวจะได้รับข้อเสนอหลังจากนั้น`,
    }));
  }

  if (room.waitlistCount > 0) {
    statusContent.push(
      el("span", {
        class: "room-status-detail",
        text: `คิวรอห้อง ${room.waitlistCount} คน`,
      }),
    );
  }
  if (entry?.status === "waiting") {
    statusContent.push(
      el("span", {
        class: "room-status-countdown",
        text: `คุณอยู่คิวที่ ${entry.position ?? 1}`,
      }),
    );
  } else if (entry?.status === "offered") {
    statusContent.push(
      el("span", { class: "room-status-countdown", text: "ถึงคิวคุณแล้ว" }),
    );
  }

  return el("div", { class: "room-status" }, statusContent);
}
