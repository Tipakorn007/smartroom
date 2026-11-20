import type { LiveSnapshot, RoomStatus, RoomView } from "../shared/types";
import { api } from "./api";
import { getUserId } from "./identity";
import {
  currentTheme,
  el,
  initTheme,
  showToast,
  toggleTheme,
} from "./ui";
import { openBookingDialog } from "./views/booking";
import {
  openRoomDetails,
  renderFloorTabs,
  renderRoomCards,
  updateMapSummary,
} from "./views/room-map";

const app = document.getElementById("room-map-app");
if (app) startRoomMap(app);

function startRoomMap(root: HTMLElement): void {
  initTheme();
  const { userId } = getUserId();
  let rooms: RoomView[] = [];
  let activeFloor = 1;
  let minCapacity = 1;
  let availableOnly = false;
  let updatedAt = Date.now();
  let hasLoaded = false;
  let errorMessage: string | null = null;
  let previousStatuses = new Map<number, RoomStatus>();

  const themeButton = el("button", {
    class: "icon-button",
    type: "button",
    attrs: { "aria-label": "สลับโหมดสว่างและโหมดมืด" },
  });
  const updateThemeLabel = (): void => {
    const theme = currentTheme();
    themeButton.textContent = theme === "dark" ? "☀️ โหมดสว่าง" : "🌙 โหมดมืด";
    themeButton.title = `เปลี่ยนเป็นโหมด${theme === "dark" ? "สว่าง" : "มืด"}`;
    themeButton.setAttribute("aria-label", themeButton.title);
  };
  updateThemeLabel();
  themeButton.addEventListener("click", () => {
    toggleTheme();
    updateThemeLabel();
  });

  const header = el("header", { class: "site-header" }, [
    el("div", { class: "header-inner room-map-header" }, [
      el("a", { class: "brand room-map-brand", attrs: { href: "/", "aria-label": "กลับหน้าหลัก SmartRoom" } }, [
        el("img", { class: "brand-mark", attrs: { src: "/smartroom-icon.png", alt: "" } }),
        el("div", { class: "brand-text" }, [
          el("h1", {}, [el("span", { text: "Smart" }), el("span", { class: "brand-accent", text: "Room" })]),
          el("p", { text: "แผนผังห้องแบบสด" }),
        ]),
      ]),
      el("a", { class: "button ghost room-map-back", attrs: { href: "/" }, text: "กลับหน้าจอง" }),
      themeButton,
    ]),
  ]);

  const title = el("section", { class: "room-map-intro" }, [
    el("div", {}, [
      el("p", { class: "eyebrow", text: "SMARTROOM · LIVE ROOM MAP" }),
      el("h2", { text: "ดูสถานะห้องทุกชั้น" }),
      el("p", { class: "muted", text: "เลือกชั้น แตะห้องเพื่อดูรายละเอียด และจองห้องว่างได้ทันที" }),
    ]),
    el("div", { class: "room-map-live-indicator" }, [
      el("span", { class: "room-map-live-dot", attrs: { "aria-hidden": "true" } }),
      el("span", { text: "อัปเดตอัตโนมัติ" }),
    ]),
  ]);

  const minSeats = el("input", {
    class: "room-map-seat-input",
    type: "number",
    value: String(minCapacity),
    attrs: { min: "1", max: "50", inputmode: "numeric", "aria-label": "จำนวนที่นั่งขั้นต่ำ" },
  });
  const availableCheckbox = el("input", {
    type: "checkbox",
    attrs: { "aria-label": "แสดงเฉพาะห้องว่าง" },
  });
  const filters = el("section", { class: "room-map-filters card", attrs: { "aria-label": "ตัวกรองห้อง" } }, [
    el("label", { class: "room-map-filter-capacity" }, [
      el("span", { text: "จำนวนที่นั่งขั้นต่ำ" }),
      minSeats,
    ]),
    el("label", { class: "room-map-filter-available" }, [
      availableCheckbox,
      el("span", { text: "แสดงเฉพาะห้องว่าง" }),
    ]),
  ]);

  const floorTabs = el("div", { class: "room-map-floors", attrs: { role: "tablist", "aria-label": "เลือกชั้น" } });
  const summary = el("div", { class: "room-map-summary", attrs: { "aria-live": "polite" } });
  const cards = el("div", { class: "room-map-grid", attrs: { "aria-label": "สถานะห้อง" } });
  const roomSection = el("section", { class: "room-map-main" }, [
    floorTabs,
    summary,
    cards,
  ]);
  const legend = el("aside", { class: "room-map-legend card", attrs: { "aria-label": "คำอธิบายสีสถานะ" } }, [
    el("h3", { text: "สถานะห้อง" }),
    legendItem("available", "ว่าง"),
    legendItem("pending", "จองแล้ว · ยังไม่เช็กอิน"),
    legendItem("in-use", "กำลังใช้งาน · เช็กอินแล้ว"),
    legendItem("closed", "ปิดใช้งาน"),
  ]);
  const main = el("main", { class: "container room-map-page" }, [
    title,
    filters,
    el("div", { class: "room-map-layout" }, [roomSection, legend]),
  ]);
  const footer = el("footer", { class: "site-footer", text: "SmartRoom · แสดงสถานะจากข้อมูลห้องและการจองล่าสุด" });
  root.replaceChildren(header, main, footer);

  minSeats.addEventListener("input", () => {
    minCapacity = Math.max(1, Number(minSeats.value) || 1);
    render();
  });
  availableCheckbox.addEventListener("change", () => {
    availableOnly = availableCheckbox.checked;
    render();
  });

  function render(): void {
    const floors = [...new Set(rooms.map((room) => room.floor))].sort((a, b) => a - b);
    if (floors.length && !floors.includes(activeFloor)) activeFloor = floors[0] ?? 1;
    renderFloorTabs(floorTabs, rooms, activeFloor, (floor) => {
      activeFloor = floor;
      render();
    });
    updateMapSummary(summary, rooms, activeFloor, minCapacity, availableOnly, updatedAt);
    if (errorMessage && !hasLoaded) {
      const retry = el("button", { class: "button primary", type: "button", text: "ลองโหลดอีกครั้ง" });
      retry.addEventListener("click", () => void loadRooms());
      cards.replaceChildren(el("div", { class: "card room-map-error" }, [
        el("strong", { text: "โหลดสถานะห้องไม่สำเร็จ" }),
        el("p", { class: "muted", text: errorMessage }),
        retry,
      ]));
      return;
    }
    if (!hasLoaded) {
      cards.replaceChildren(el("div", { class: "card room-map-empty", text: "กำลังโหลดสถานะห้อง…" }));
      return;
    }
    renderRoomCards(cards, rooms, activeFloor, minCapacity, availableOnly, previousStatuses, (room) => {
      openRoomDetails(room, () => openBookingDialog(room, userId, () => void loadRooms()));
    });
    previousStatuses = new Map(rooms.map((room) => [room.id, room.status]));
  }

  async function loadRooms(): Promise<void> {
    try {
      rooms = await api.roomStatus();
      updatedAt = Date.now();
      hasLoaded = true;
      errorMessage = null;
      render();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
      render();
    }
  }

  const events = new EventSource(`/api/events?userId=${encodeURIComponent(userId)}`);
  events.addEventListener("message", (event: MessageEvent<string>) => {
    try {
      const snapshot = JSON.parse(event.data) as LiveSnapshot;
      rooms = snapshot.rooms;
      updatedAt = Date.now();
      hasLoaded = true;
      errorMessage = null;
      render();
    } catch {
      showToast("รับข้อมูลสถานะห้องไม่สำเร็จ กำลังเชื่อมต่อใหม่", "warn");
    }
  });
  events.addEventListener("error", () => {
    // EventSource reconnects automatically; the status endpoint is also polled as a fallback.
  });
  window.setInterval(() => void loadRooms(), 15_000);

  render();
  void loadRooms();
}

function legendItem(color: string, label: string): HTMLElement {
  return el("div", { class: "room-map-legend-item" }, [
    el("span", { class: `room-map-legend-swatch ${color}`, attrs: { "aria-hidden": "true" } }),
    el("span", { text: label }),
  ]);
}
