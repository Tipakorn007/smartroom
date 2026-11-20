import type { QuietLevel } from "../shared/types";
import { api } from "./api";
import { currentTheme, el, initTheme, showToast, toggleTheme } from "./ui";
import { renderRoomAdminView } from "./views/room-admin";
import { renderStatsView } from "./views/stats";

const root = document.getElementById("admin-app");

if (root) {
  initTheme();
  const content = el("main", { class: "container" });
  const sectionContent = el("section", { class: "admin-section-content" });
  let activeSection: "rooms" | "stats" = "rooms";
  const roomsTab = el("button", { class: "admin-section-tab is-active", type: "button" });
  roomsTab.append(
    el("span", { class: "admin-section-icon", text: "▦", attrs: { "aria-hidden": "true" } }),
    el("span", { text: "จัดการห้อง" }),
  );
  const statsTab = el("button", { class: "admin-section-tab", type: "button" });
  statsTab.append(
    el("span", { class: "admin-section-icon", text: "▥", attrs: { "aria-hidden": "true" } }),
    el("span", { text: "สถิติการใช้งาน" }),
  );
  const sectionNav = el("nav", { class: "admin-section-tabs", attrs: { "aria-label": "เมนูระบบจัดการ" } }, [roomsTab, statsTab]);
  roomsTab.addEventListener("click", () => {
    activeSection = "rooms";
    updateSectionTabs();
    void loadRooms();
  });
  statsTab.addEventListener("click", () => {
    activeSection = "stats";
    updateSectionTabs();
    void loadStats();
  });
  const title = el("div", { class: "brand-text" }, [
    el("h1", {}, [el("span", { text: "Smart" }), el("span", { class: "brand-accent", text: "Room" })]),
    el("p", { text: "ระบบจัดการห้อง" }),
  ]);
  const accountActions = el("div", { class: "admin-account-actions" });
  const themeButton = el("button", { class: "icon-button", type: "button", attrs: { "aria-label": "สลับโหมดสว่างและโหมดมืด" } });
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
  const headerTools = el("div", { class: "admin-header-tools" }, [themeButton, accountActions]);
  const header = el("header", { class: "site-header" }, [
    el("div", { class: "header-inner" }, [
      el("div", { class: "brand admin-brand" }, [
        el("img", { class: "brand-mark", attrs: { src: "/smartroom-icon.png", alt: "" } }), title,
      ]),
      headerTools,
    ]),
  ]);
  const footer = el("footer", { class: "site-footer" }, [el("p", { text: "SmartRoom · ระบบจัดการพื้นที่ห้อง" })]);
  root.replaceChildren(header, content, footer);
  void bootstrap();

  async function bootstrap(): Promise<void> {
    try {
      const session = await api.adminSession();
      if (!session.authenticated) return showLogin();
      activeSection = "rooms";
      updateSectionTabs();
      title.querySelector("p")!.textContent = session.demo ? "ระบบจัดการห้อง · โหมดเดโม" : "ระบบจัดการห้อง";
      const logout = el("button", { class: "button ghost", type: "button", text: "ออกจากระบบ" });
      logout.addEventListener("click", () => void logoutAdmin());
      accountActions.replaceChildren(logout);
      content.replaceChildren(sectionNav, sectionContent);
      await loadRooms();
    } catch (error) {
      showLogin(error instanceof Error ? error.message : "เชื่อมต่อระบบจัดการไม่ได้");
    }
  }

  function updateSectionTabs(): void {
    roomsTab.classList.toggle("is-active", activeSection === "rooms");
    statsTab.classList.toggle("is-active", activeSection === "stats");
    roomsTab.setAttribute("aria-current", String(activeSection === "rooms"));
    statsTab.setAttribute("aria-current", String(activeSection === "stats"));
  }

  function showLogin(message = ""): void {
    accountActions.replaceChildren();
    const form = document.createElement("form");
    form.className = "card stack admin-login-form";
    const heading = el("div", { class: "section-heading" }, [
      el("p", { class: "eyebrow", text: "STAFF ACCESS" }),
      el("h2", { text: "เข้าสู่ระบบจัดการ" }),
      el("p", { class: "muted", text: "กรอกรหัสผ่านผู้ดูแลเพื่อจัดการห้องและเวลาปิดปรับปรุง" }),
    ]);
    const password = document.createElement("input"); password.type = "password"; password.name = "password"; password.autocomplete = "current-password"; password.required = true; password.placeholder = "รหัสผ่าน"; password.setAttribute("aria-label", "รหัสผ่าน");
    const error = el("p", { class: "alert", text: message });
    const submit = el("button", { class: "button primary", type: "submit", text: "เข้าสู่ระบบ" });
    form.append(heading, password);
    if (message) form.append(error);
    form.append(submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); submit.disabled = true;
      try { await api.adminLogin(password.value); await bootstrap(); }
      catch (cause) { showLogin(cause instanceof Error ? cause.message : "เข้าสู่ระบบไม่สำเร็จ"); }
    });
    content.replaceChildren(form);
  }

  async function logoutAdmin(): Promise<void> {
    try { await api.adminLogout(); showLogin("ออกจากระบบแล้ว"); }
    catch (error) { showToast(error instanceof Error ? error.message : "ออกจากระบบไม่สำเร็จ", "warn"); }
  }

  async function loadRooms(): Promise<void> {
    try {
      const { rooms } = await api.adminRooms();
      if (activeSection !== "rooms") return;
      renderRoomAdminView(sectionContent, rooms, saveRoom, toggleRoom, addMaintenance, removeMaintenance);
    } catch (error) {
      if (activeSection !== "rooms") return;
      if (error instanceof Error && error.message.includes("เข้าสู่ระบบ")) return showLogin(error.message);
      sectionContent.replaceChildren(el("section", { class: "card stack" }, [
        el("h2", { text: "โหลดข้อมูลห้องไม่สำเร็จ" }),
        el("p", { class: "muted", text: error instanceof Error ? error.message : "เชื่อมต่อระบบจัดการไม่ได้" }),
        el("button", { class: "button primary", type: "button", text: "ลองอีกครั้ง" }),
      ]));
      sectionContent.querySelector("button")?.addEventListener("click", () => void loadRooms());
    }
  }

  async function loadStats(): Promise<void> {
    try {
      const stats = await api.stats();
      if (activeSection === "stats") {
        sectionContent.replaceChildren();
        renderStatsView(sectionContent, stats);
      }
    } catch (error) {
      if (activeSection !== "stats") return;
      if (error instanceof Error && error.message.includes("เข้าสู่ระบบ")) return showLogin(error.message);
      const message = error instanceof Error ? error.message : "โหลดสถิติไม่สำเร็จ";
      sectionContent.replaceChildren();
      renderStatsView(sectionContent, null, message, () => void loadStats());
    }
  }

  async function saveRoom(roomId: number | null, payload: {
    name: string; floor: number; capacity: number; hasPower: boolean; hasWhiteboard: boolean; quietLevel: QuietLevel;
  }): Promise<void> {
    try {
      if (roomId === null) await api.createRoom(payload); else await api.updateRoom(roomId, payload);
      showToast(roomId === null ? "เพิ่มห้องแล้ว" : "บันทึกข้อมูลห้องแล้ว"); await loadRooms();
    } catch (error) { showToast(error instanceof Error ? error.message : "บันทึกห้องไม่สำเร็จ", "warn"); }
  }

  async function toggleRoom(roomId: number, enabled: boolean): Promise<void> {
    try { await api.updateRoom(roomId, { enabled }); showToast(enabled ? "เปิดใช้งานห้องแล้ว" : "ปิดใช้งานห้องแล้ว"); await loadRooms(); }
    catch (error) { showToast(error instanceof Error ? error.message : "เปลี่ยนสถานะห้องไม่สำเร็จ", "warn"); }
  }

  async function addMaintenance(roomId: number, startsAt: number, endsAt: number, reason: string): Promise<void> {
    try { await api.addMaintenance(roomId, { startsAt, endsAt, reason }); showToast("เพิ่มช่วงปิดปรับปรุงแล้ว"); await loadRooms(); }
    catch (error) { showToast(error instanceof Error ? error.message : "เพิ่มช่วงปิดปรับปรุงไม่สำเร็จ", "warn"); }
  }

  async function removeMaintenance(roomId: number, maintenanceId: number): Promise<void> {
    try { await api.removeMaintenance(roomId, maintenanceId); showToast("ยกเลิกช่วงปิดปรับปรุงแล้ว"); await loadRooms(); }
    catch (error) { showToast(error instanceof Error ? error.message : "ยกเลิกรายการไม่สำเร็จ", "warn"); }
  }
}
