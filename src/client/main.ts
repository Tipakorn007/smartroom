/**
 * จุดเริ่มต้นของ frontend
 * หน้าที่ของไฟล์นี้มีสามอย่างเท่านั้น:
 * 1) สร้างโครงหน้า (header + แท็บ + main)
 * 2) สลับแท็บและโหลดข้อมูลผ่าน REST
 * 3) Poll API periodically so serverless deployments receive fresh data
 * ตรรกะการวาดแต่ละหน้าแยกอยู่ในโฟลเดอร์ views/
 */

import {
  CHECKIN_WINDOW_MS,
  PRESENCE_REMINDER_WINDOW_MS,
} from "../shared/constants";
import type {
  BookingWithRoom,
  LiveSnapshot,
  Room,
  RoomView,
  StatsResponse,
  WaitlistEntry,
} from "../shared/types";
import { api } from "./api";
import {
  el,
  formatClock,
  formatCountdown,
  initTheme,
  showToast,
  toggleTheme,
  currentTheme,
} from "./ui";
import { getUserId } from "./identity";
import { openBookingDialog } from "./views/booking";
import { renderCheckinPage } from "./views/checkin";
import { renderRecommendView } from "./views/recommend";
import { renderRoomsView } from "./views/rooms";
import { renderStatsView } from "./views/stats";
import { showAcceptedOffer, openWaitlistDialog } from "./views/waitlist";

type Tab = "rooms" | "recommend" | "stats";

const state: {
  tab: Tab;
  floor: number;
  rooms: RoomView[];
  roomsError: string | null;
  stats: StatsResponse | null;
  statsError: string | null;
  userId: string;
  myWaitlists: WaitlistEntry[];
  myBookings: BookingWithRoom[];
  initialized: boolean;
} = {
  tab: "rooms",
  floor: 1,
  rooms: [],
  roomsError: null,
  stats: null,
  statsError: null,
  userId: "",
  myWaitlists: [],
  myBookings: [],
  initialized: false,
};

let noticesElement: HTMLElement | null = null;
let contentElement: HTMLElement | null = null;
let eventSource: EventSource | null = null;
let noticesKey = "";

async function bootstrap(): Promise<void> {
  initTheme();
  startCountdownTicker();

  const root = document.getElementById("app");
  if (!root) return;

  // หน้าเช็กอินเป็นหน้าเดี่ยว ไม่มีแท็บ (เปิดจาก QR บนมือถือ)
  const checkinMatch = window.location.pathname.match(/^\/checkin\/([^/]+)$/);
  if (checkinMatch) {
    await renderCheckinPage(root, checkinMatch[1] ?? "");
    return;
  }

  const identity = getUserId();
  state.userId = identity.userId;
  buildShell(root);
  if (!identity.persistent) {
    showToast("เบราว์เซอร์ไม่สามารถบันทึกคิวได้ คิวนี้จะใช้ได้เฉพาะหน้าเว็บที่เปิดอยู่นี้", "warn");
  }
  await refreshRooms();
  startLiveEvents();
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
        el("img", {
          class: "brand-mark",
          attrs: { src: "/smartroom-icon.png", alt: "", "aria-hidden": "true" },
        }),
        el("div", { class: "brand-text" }, [
          el("h1", {}, [
            el("span", { text: "Smart" }),
            el("span", { class: "brand-accent", text: "Room" }),
          ]),
          el("p", { text: "ห้องติว · อาคารเรียนรวม" }),
        ]),
      ]),
      nav,
      themeButton,
    ]),
  ]);

  const main = el("main", { class: "container" });
  noticesElement = el("div", {
    class: "live-notices",
    attrs: { "aria-label": "การแจ้งเตือนคิวและเวลาใช้งาน" },
  });
  contentElement = el("div", { class: "page-content" });
  main.append(noticesElement, contentElement);
  const footer = el("footer", { class: "site-footer" }, [
    el("p", {
      text: "SmartRoom · ห้องที่จองแล้วไม่มาใช้จะถูกปล่อยคืนอัตโนมัติใน 15 นาที",
    }),
  ]);

  root.replaceChildren(header, main, footer);
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
  if (!contentElement) return;
  contentElement.replaceChildren();
  updateLiveNotices();

  if (state.tab === "rooms") {
    if (state.roomsError && state.rooms.length === 0) {
      contentElement.append(
        retryCard("โหลดข้อมูลห้องไม่สำเร็จ", state.roomsError, () => void refreshRooms()),
      );
      return;
    }

    renderRoomsView(contentElement, state.rooms, state.floor, state.myWaitlists, {
      onSelectFloor: (floor) => {
        state.floor = floor;
        render();
      },
      onBook: (room) => openBookingDialog(room, state.userId, () => void refreshRooms()),
      onJoinWaitlist: (room) =>
        openWaitlistDialog(room, state.userId, () => void refreshRooms()),
      onAcceptWaitlist: (entry) => void acceptOffer(entry),
      onCancelWaitlist: (entry) => void cancelQueue(entry),
    });
    if (state.roomsError) {
      contentElement.prepend(
        retryCard("โหลดข้อมูลห้องไม่สำเร็จ", state.roomsError, () => void refreshRooms()),
      );
    }
    return;
  }

  if (state.tab === "recommend") {
    renderRecommendView(contentElement, (room: Room) =>
      openBookingDialog(room, state.userId, () => void refreshRooms()),
    );
    return;
  }

  renderStatsView(contentElement, state.stats, state.statsError, () => void loadStats());
}

function retryCard(title: string, message: string, onRetry: () => void): HTMLElement {
  const retryButton = el("button", {
    class: "button primary",
    type: "button",
    text: "ลองโหลดอีกครั้ง",
  });
  retryButton.addEventListener("click", onRetry);
  return el("section", { class: "card stack" }, [
    el("h2", { text: title }),
    el("p", { class: "muted", text: message }),
    retryButton,
  ]);
}

async function refreshRooms(): Promise<void> {
  try {
    const snapshot = await api.live(state.userId);
    applyLiveSnapshot(snapshot);
    state.roomsError = null;

    // ครั้งแรกให้เลือกชั้นของห้องว่างห้องแรก เพื่อให้ผู้ใช้เห็นห้องที่จองได้ทันที
    if (!state.initialized) {
      state.initialized = true;
      const firstAvailable = snapshot.rooms.find((room) => room.status === "available");
      state.floor = firstAvailable?.floor ?? snapshot.rooms[0]?.floor ?? 1;
    }

    // ถ้าอยู่แท็บอื่น ไม่ต้องวาดใหม่ทับฟอร์มที่ผู้ใช้กำลังกรอก
    if (state.tab === "rooms") render();
  } catch (error) {
    const message = error instanceof Error ? error.message : "โหลดข้อมูลห้องไม่สำเร็จ";
    const shouldNotify = state.roomsError !== message;
    state.roomsError = message;
    if (state.tab === "rooms") render();
    if (shouldNotify) showToast(message, "warn");
  }
}

async function loadStats(): Promise<void> {
  try {
    state.stats = await api.stats();
    state.statsError = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "โหลดสถิติไม่สำเร็จ";
    const shouldNotify = state.statsError !== message;
    state.statsError = message;
    if (shouldNotify) showToast(message, "warn");
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

function startLiveEvents(): void {
  eventSource?.close();
  eventSource = new EventSource(`/api/events?userId=${encodeURIComponent(state.userId)}`);
  eventSource.addEventListener("message", (event: MessageEvent<string>) => {
    try {
      applyLiveSnapshot(JSON.parse(event.data) as LiveSnapshot);
      state.roomsError = null;
    } catch (error) {
      console.error("[client] อ่านข้อมูล live update ไม่สำเร็จ:", error);
    }
  });
}

function applyLiveSnapshot(snapshot: LiveSnapshot): void {
  const roomStateChanged = JSON.stringify(snapshot.rooms) !== JSON.stringify(state.rooms);
  state.rooms = snapshot.rooms;
  state.myWaitlists = snapshot.myWaitlists;
  state.myBookings = snapshot.myBookings;
  updateLiveNotices();
  if (state.tab === "rooms" && roomStateChanged) render();
}

function updateLiveNotices(): void {
  if (!noticesElement) return;
  const nextKey = JSON.stringify({
    waitlists: state.myWaitlists.map(({ id, status, position, offerExpiresAt }) => ({
      id,
      status,
      position,
      offerExpiresAt,
    })),
    bookings: state.myBookings.map(({ booking, room }) => {
      const remaining = booking.endAt - Date.now();
      return {
        token: booking.token,
        status: booking.status,
        endAt: booking.endAt,
        roomId: room.id,
        waitlistCount: state.rooms.find((item) => item.id === room.id)?.waitlistCount ?? 0,
        // ต้องอยู่ในคีย์ด้วย ไม่อย่างนั้นการ์ด "ยังใช้ห้องอยู่ไหม?" จะไม่โผล่
        // ตอนเข้าสู่ 10 นาทีสุดท้าย ถ้าข้อมูลอื่นจาก server ไม่เปลี่ยนเลย
        // (poll ทุก 10 วินาทีจะทำให้ค่านี้พลิก false → true เอง)
        presenceDue:
          booking.status === "active" &&
          remaining > 0 &&
          remaining <= PRESENCE_REMINDER_WINDOW_MS,
      };
    }),
  });
  if (nextKey === noticesKey) return;
  noticesKey = nextKey;
  const notices: HTMLElement[] = [];

  for (const entry of state.myWaitlists) {
    if (entry.status === "offered") {
      const acceptButton = el("button", {
        class: "button primary",
        type: "button",
        text: "รับข้อเสนอ",
      });
      acceptButton.addEventListener("click", () => void acceptOffer(entry));
      const skipButton = el("button", {
        class: "button ghost",
        type: "button",
        text: "ข้ามคิวนี้",
      });
      skipButton.addEventListener("click", () => void cancelQueue(entry));
      notices.push(
        el("section", { class: "card live-notice", attrs: { role: "status" } }, [
          el("h2", { text: `ถึงคิวคุณแล้ว · ห้อง ${entry.roomName}` }),
          el("p", {
            text: `ข้อเสนอรอการยืนยัน 5 นาที · ระยะเวลาที่ขอ ${entry.durationMinutes} นาที`,
          }),
          el("span", {
            class: "room-status-countdown",
            attrs: { "data-deadline": String(entry.offerExpiresAt ?? Date.now()) },
            text: entry.offerExpiresAt
              ? `เหลือ ${formatCountdown(entry.offerExpiresAt - Date.now())}`
              : "กรุณายืนยัน",
          }),
          el("div", { class: "live-notice-actions" }, [acceptButton, skipButton]),
        ]),
      );
    } else {
      const cancelButton = el("button", {
        class: "button ghost",
        type: "button",
        text: "ออกจากคิว",
      });
      cancelButton.addEventListener("click", () => void cancelQueue(entry));
      notices.push(
        el("section", { class: "card live-notice", attrs: { role: "status" } }, [
          el("h3", { text: `คุณอยู่คิวที่ ${entry.position ?? 1} · ห้อง ${entry.roomName}` }),
          el("p", { text: `เมื่อห้องว่าง จะเสนอให้คุณใช้ ${entry.durationMinutes} นาที` }),
          el("div", { class: "live-notice-actions" }, [cancelButton]),
        ]),
      );
    }
  }

  for (const item of state.myBookings) {
    const { booking, room } = item;
    if (booking.status === "pending") {
      const checkinLink = el("a", {
        class: "button primary",
        href: `/checkin/${booking.token}`,
        text: "เปิดหน้าเช็กอิน",
      });
      notices.push(
        el("section", { class: "card live-notice", attrs: { role: "status" } }, [
          el("h3", { text: `จองห้อง ${room.name} แล้ว · กรุณาเช็กอิน` }),
          el("p", {
            text: `เช็กอินภายใน ${formatClock(booking.startAt + CHECKIN_WINDOW_MS)} น.`,
          }),
          el("div", { class: "live-notice-actions" }, [checkinLink]),
        ]),
      );
      continue;
    }

    const queueCount = state.rooms.find((item) => item.id === room.id)?.waitlistCount ?? 0;
    const leaveButton = el("button", {
      class: "button ghost",
      type: "button",
      text: "ออกจากห้องก่อนเวลา",
    });
    leaveButton.addEventListener("click", () => void leaveRoom(booking.token));
    const children: HTMLElement[] = [
      el("h3", { text: `กำลังใช้ห้อง ${room.name}` }),
      el("p", { text: `ใช้งานได้ถึง ${formatClock(booking.endAt)} น.` }),
    ];
    const remaining = booking.endAt - Date.now();
    if (remaining > 0 && remaining <= PRESENCE_REMINDER_WINDOW_MS) {
      const extendButton = el("button", {
        class: "button primary",
        type: "button",
        text: "ยืนยันต่อเวลา 30 นาที",
        disabled: queueCount > 0,
      });
      extendButton.addEventListener("click", () =>
        void extendRoom(booking.token, booking.endAt),
      );
      children.unshift(el("h2", { text: "ยังใช้ห้องอยู่ไหม?" }));
      children.push(
        el("p", {
          class: queueCount > 0 ? "alert" : "muted",
          text: queueCount > 0
            ? `มีคนรอคิว ${queueCount} คน จึงต่อเวลาไม่ได้`
            : "หากไม่มีผู้ใช้รอคิว สามารถต่อเวลาได้ครั้งละ 30 นาที",
        }),
        el("div", { class: "live-notice-actions" }, [extendButton, leaveButton]),
      );
    } else {
      children.push(el("div", { class: "live-notice-actions" }, [leaveButton]));
    }
    notices.push(
      el("section", { class: "card live-notice presence-reminder", attrs: { role: "status" } }, children),
    );
  }

  noticesElement.replaceChildren(...notices);
}

async function acceptOffer(entry: WaitlistEntry): Promise<void> {
  try {
    const result = await api.acceptWaitlist(entry.id, state.userId);
    showAcceptedOffer(result);
    await refreshRooms();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "รับข้อเสนอไม่สำเร็จ", "warn");
  }
}

async function cancelQueue(entry: WaitlistEntry): Promise<void> {
  try {
    await api.cancelWaitlist(entry.id, state.userId);
    showToast("ออกจากคิวแล้ว");
    await refreshRooms();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "ออกจากคิวไม่สำเร็จ", "warn");
  }
}

async function extendRoom(token: string, expectedEndAt: number): Promise<void> {
  try {
    await api.extendBooking(token, expectedEndAt);
    showToast("ต่อเวลาใช้งานอีก 30 นาทีแล้ว");
    await refreshRooms();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "ต่อเวลาไม่สำเร็จ", "warn");
    await refreshRooms();
  }
}

async function leaveRoom(token: string): Promise<void> {
  if (!window.confirm("ยืนยันออกจากห้องและปล่อยให้ผู้ใช้ในคิวถัดไปหรือไม่?")) return;
  try {
    await api.leaveBooking(token);
    showToast("ปล่อยห้องแล้ว ขอบคุณที่แจ้งสถานะ");
    await refreshRooms();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "ออกจากห้องไม่สำเร็จ", "warn");
  }
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
