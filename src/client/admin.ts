import type { QuietLevel } from "../shared/types";
import { api } from "./api";
import { el, initTheme, showToast } from "./ui";
import { renderRoomAdminView } from "./views/room-admin";

const root = document.getElementById("admin-app");

if (root) {
  initTheme();
  const content = el("main", { class: "container" });
  const title = el("div", { class: "brand-text" }, [
    el("h1", {}, [el("span", { text: "Smart" }), el("span", { class: "brand-accent", text: "Room" })]),
    el("p", { text: "ระบบจัดการห้อง" }),
  ]);
  const accountActions = el("div", { class: "admin-account-actions" });
  const header = el("header", { class: "site-header" }, [
    el("div", { class: "header-inner" }, [
      el("a", { class: "brand admin-brand", href: "/", attrs: { "aria-label": "กลับหน้า SmartRoom" } }, [
        el("img", { class: "brand-mark", attrs: { src: "/smartroom-icon.png", alt: "" } }), title,
      ]),
      accountActions,
    ]),
  ]);
  const footer = el("footer", { class: "site-footer" }, [el("p", { text: "SmartRoom · ระบบจัดการพื้นที่ห้อง" })]);
  root.replaceChildren(header, content, footer);
  void bootstrap();

  async function bootstrap(): Promise<void> {
    try {
      const session = await api.adminSession();
      if (!session.authenticated) return showLogin();
      title.querySelector("p")!.textContent = session.demo ? "ระบบจัดการห้อง · โหมดเดโม" : "ระบบจัดการห้อง";
      if (session.demo) accountActions.replaceChildren(el("a", { class: "button ghost", href: "/", text: "ไปหน้าเว็บผู้ใช้" }));
      else {
        const logout = el("button", { class: "button ghost", type: "button", text: "ออกจากระบบ" });
        logout.addEventListener("click", () => void logoutAdmin());
        accountActions.replaceChildren(el("a", { class: "button ghost", href: "/", text: "หน้าเว็บผู้ใช้" }), logout);
      }
      await loadRooms();
    } catch (error) {
      showLogin(error instanceof Error ? error.message : "เชื่อมต่อระบบจัดการไม่ได้");
    }
  }

  function showLogin(message = ""): void {
    accountActions.replaceChildren();
    const form = document.createElement("form");
    form.className = "card stack admin-login-form";
    const heading = el("div", { class: "section-heading" }, [
      el("p", { class: "eyebrow", text: "STAFF ACCESS" }),
      el("h2", { text: "เข้าสู่ระบบจัดการ" }),
      el("p", { class: "muted", text: "ใช้บัญชีเจ้าหน้าที่เพื่อจัดการห้องและเวลาปิดปรับปรุง" }),
    ]);
    const username = document.createElement("input"); username.name = "username"; username.autocomplete = "username"; username.required = true; username.placeholder = "ชื่อผู้ใช้"; username.setAttribute("aria-label", "ชื่อผู้ใช้");
    const password = document.createElement("input"); password.type = "password"; password.name = "password"; password.autocomplete = "current-password"; password.required = true; password.placeholder = "รหัสผ่าน"; password.setAttribute("aria-label", "รหัสผ่าน");
    const error = el("p", { class: "alert", text: message });
    const submit = el("button", { class: "button primary", type: "submit", text: "เข้าสู่ระบบ" });
    const back = el("a", { class: "button ghost", href: "/", text: "กลับหน้าเว็บผู้ใช้" });
    form.append(heading, username, password);
    if (message) form.append(error);
    form.append(submit, back);
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); submit.disabled = true;
      try { await api.adminLogin(username.value, password.value); await bootstrap(); }
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
      renderRoomAdminView(content, rooms, saveRoom, toggleRoom, addMaintenance, removeMaintenance);
    } catch (error) {
      if (error instanceof Error && error.message.includes("เข้าสู่ระบบ")) return showLogin(error.message);
      content.replaceChildren(el("section", { class: "card stack" }, [
        el("h2", { text: "โหลดข้อมูลห้องไม่สำเร็จ" }),
        el("p", { class: "muted", text: error instanceof Error ? error.message : "เชื่อมต่อระบบจัดการไม่ได้" }),
        el("button", { class: "button primary", type: "button", text: "ลองอีกครั้ง" }),
      ]));
      content.querySelector("button")?.addEventListener("click", () => void loadRooms());
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
