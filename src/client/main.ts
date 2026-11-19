/**
 * จุดเริ่มต้นของ frontend
 * หน้าที่ของไฟล์นี้มีสามอย่างเท่านั้น:
 * 1) สร้างโครงหน้า (header + แท็บ + main)
 * 2) สลับแท็บและโหลดข้อมูลผ่าน REST
 * 3) Poll API periodically so serverless deployments receive fresh data
 * ตรรกะการวาดแต่ละหน้าแยกอยู่ในโฟลเดอร์ views/
 */

import type { Room, RoomView, StatsResponse } from "../shared/types";
import { api } from "./api";
import { el, formatCountdown, initTheme, showToast, toggleTheme, currentTheme } from "./ui";
import { openBookingDialog } from "./views/booking";
import { renderCheckinPage } from "./views/checkin";
import { renderRecommendView } from "./views/recommend";
import { renderRoomsView } from "./views/rooms";
import { renderStatsView } from "./views/stats";

type Tab = "rooms" | "recommend" | "stats";

const state: {
  tab: Tab;
  floor: number;
  rooms: RoomView[];
  stats: StatsResponse | null;
  initialized: boolean;
} = {
  tab: "rooms",
  floor: 1,
  rooms: [],
  stats: null,
  initialized: false,
};

let mainElement: HTMLElement | null = null;

async function bootstrap(): Promise<void> {
  initTheme();
  startCountdownTicker();

  const root = document.getElementById("app");
  if (!root) return;

  // หน้าเช็กอินเป็นหน้าเดี่ยว ไม่มีแท็บ (เปิดจาก QR บนมือถือ)
  const checkinMatch = window.location.pathname.match(/^\/checkin\/([^/]+)$/);
  if (checkinMatch) {
    await renderCheckinPage(root, decodeURIComponent(checkinMatch[1] ?? ""));
    return;
  }

  buildShell(root);
  await refreshRooms();
  startPolling();
}

/** สร้าง header + แท็บ + พื้นที่เนื้อหา แล้วเก็บ main ไว้ใช้วาดซ้ำ */
function buildShell(root: HTMLElement): void {
  const themeButton = el("button", {
    class: "icon-button",
    type: "button",
    attrs: { "aria-label": "สลับโหมดสว่างและโหมดมืด" },
  });
  const updateThemeLabel = (): void => {
    themeButton.textContent = currentTheme() === "dark" ? "☀️ โหมดสว่าง" : "🌙 โหมดมืด";
  };
  updateThemeLabel();
  themeButton.addEventListener("click", () => {
    toggleTheme();
    updateThemeLabel();
  });

  const nav = el("nav", { class: "tabs", attrs: { "aria-label": "เมนูหลัก" } });
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "rooms", label: "แผนผังห้อง" },
    { id: "recommend", label: "แนะนำห้อง" },
    { id: "stats", label: "สถิติ" },
  ];
  for (const tab of tabs) {
    const button = el("button", {
      class: `tab${state.tab === tab.id ? " is-active" : ""}`,
      type: "button",
      text: tab.label,
      attrs: {
        "data-tab": tab.id,
        role: "tab",
        "aria-selected": String(state.tab === tab.id),
      },
    });
    button.addEventListener("click", () => {
      void switchTab(tab.id, nav);
    });
    nav.append(button);
  }

  const header = el("header", { class: "site-header" }, [
    el("div", { class: "header-inner" }, [
      el("div", { class: "brand" }, [
        el("span", { class: "brand-mark", text: "SR", attrs: { "aria-hidden": "true" } }),
        el("div", { class: "brand-text" }, [
          el("h1", { text: "SmartRoom" }),
          el("p", { text: "ห้องติว · อาคารเรียนรวม" }),
        ]),
      ]),
      nav,
      themeButton,
    ]),
  ]);

  const main = el("main", { class: "container" });
  const footer = el("footer", { class: "site-footer" }, [
    el("p", {
      text: "SmartRoom · ห้องที่จองแล้วไม่มาใช้จะถูกปล่อยคืนอัตโนมัติใน 15 นาที",
    }),
  ]);

  root.replaceChildren(header, main, footer);
  mainElement = main;
}

async function switchTab(tab: Tab, nav: HTMLElement): Promise<void> {
  state.tab = tab;
  nav.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  render();
  if (tab === "stats") {
    await loadStats();
  } else {
    await refreshRooms();
  }
}

/** วาดเนื้อหาตามแท็บปัจจุบันจาก state (ไม่ยิง network เอง) */
function render(): void {
  if (!mainElement) return;
  mainElement.replaceChildren();

  if (state.tab === "rooms") {
    renderRoomsView(mainElement, state.rooms, state.floor, {
      onSelectFloor: (floor) => {
        state.floor = floor;
        render();
      },
      onBook: (room) => openBookingDialog(room, () => void refreshRooms()),
    });
    return;
  }

  if (state.tab === "recommend") {
    renderRecommendView(mainElement, (room: Room) =>
      openBookingDialog(room, () => void refreshRooms()),
    );
    return;
  }

  renderStatsView(mainElement, state.stats);
}

async function refreshRooms(): Promise<void> {
  try {
    const rooms = await api.rooms();
    state.rooms = rooms;

    // ครั้งแรกให้เลือกชั้นของห้องว่างห้องแรก เพื่อให้ผู้ใช้เห็นห้องที่จองได้ทันที
    if (!state.initialized) {
      state.initialized = true;
      const firstAvailable = rooms.find((room) => room.status === "available");
      state.floor = firstAvailable?.floor ?? rooms[0]?.floor ?? 1;
    }

    // ถ้าอยู่แท็บอื่น ไม่ต้องวาดใหม่ทับฟอร์มที่ผู้ใช้กำลังกรอก
    if (state.tab === "rooms") render();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "โหลดข้อมูลห้องไม่สำเร็จ", "warn");
  }
}

async function loadStats(): Promise<void> {
  try {
    state.stats = await api.stats();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "โหลดสถิติไม่สำเร็จ", "warn");
  }
  if (state.tab === "stats") render();
}

/**
 * Vercel Functions are stateless, so refresh data periodically instead of
 * keeping a WebSocket connection open.
 */
function startPolling(): void {
  let refreshing = false;
  window.setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    void refreshAfterChange().finally(() => {
      refreshing = false;
    });
  }, 10_000);
}

async function refreshAfterChange(): Promise<void> {
  await refreshRooms();
  if (state.tab === "stats") await loadStats();
}

/**
 * อัปเดตนาฬิกานับถอยหลังทุกวินาที
 * ใช้ attribute data-deadline เป็นจุดร่วม ทำให้ทุกหน้าที่มี countdown อัปเดตพร้อมกัน
 */
function startCountdownTicker(): void {
  window.setInterval(() => {
    document.querySelectorAll<HTMLElement>("[data-deadline]").forEach((node) => {
      const deadline = Number(node.dataset.deadline);
      if (!Number.isFinite(deadline)) return;
      const remaining = deadline - Date.now();
      node.textContent = remaining > 0 ? `อีก ${formatCountdown(remaining)}` : "กำลังปล่อยคืน…";
    });
  }, 1000);
}

void bootstrap();
