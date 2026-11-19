import type { QuietLevel, Room, RoomMaintenance } from "../../shared/types";
import { el, formatDateTime } from "../ui";

export interface ManagedRoom extends Room {
  enabled: boolean;
  maintenance: RoomMaintenance[];
}

type RoomForm = {
  name: string; floor: number; capacity: number; hasPower: boolean; hasWhiteboard: boolean;
  quietLevel: QuietLevel;
};

export function renderRoomAdminView(
  container: HTMLElement,
  rooms: ManagedRoom[],
  onSave: (roomId: number | null, payload: RoomForm) => void,
  onToggle: (roomId: number, enabled: boolean) => void,
  onMaintenance: (roomId: number, startsAt: number, endsAt: number, reason: string) => void,
  onRemoveMaintenance: (roomId: number, maintenanceId: number) => void,
): void {
  const active = rooms.filter((room) => room.enabled).length;
  const maintenanceCount = rooms.reduce((sum, room) => sum + room.maintenance.length, 0);
  const heading = el("section", { class: "admin-page-heading" }, [
    el("div", {}, [
      el("p", { class: "eyebrow", text: "SMARTROOM · STAFF" }),
      el("h2", { text: "จัดการพื้นที่ห้อง" }),
      el("p", { class: "muted", text: "ตั้งค่าห้องและช่วงปิดปรับปรุงจากหน้ารวมเดียว" }),
    ]),
    el("div", { class: "admin-summary" }, [
      summary("เปิดใช้งาน", String(active)),
      summary("ปิดใช้งาน", String(rooms.length - active)),
      summary("ช่วงปรับปรุง", String(maintenanceCount)),
    ]),
  ]);

  const toolbar = el("div", { class: "admin-toolbar" });
  const search = document.createElement("input");
  search.type = "search"; search.placeholder = "ค้นหาชื่อห้องหรือชั้น…"; search.setAttribute("aria-label", "ค้นหาห้อง");
  const floorSelect = document.createElement("select"); floorSelect.setAttribute("aria-label", "กรองตามชั้น");
  const all = document.createElement("option"); all.value = "all"; all.textContent = "ทุกชั้น"; floorSelect.append(all);
  for (const floor of [...new Set(rooms.map((room) => room.floor))].sort((a, b) => a - b)) {
    const option = document.createElement("option"); option.value = String(floor); option.textContent = `ชั้น ${floor}`; floorSelect.append(option);
  }
  const addDetails = document.createElement("details"); addDetails.className = "admin-add-room";
  const addSummary = document.createElement("summary"); addSummary.className = "button primary"; addSummary.textContent = "+ เพิ่มห้อง";
  addDetails.append(addSummary, createRoomForm(onSave));
  toolbar.append(search, floorSelect, addDetails);

  const list = el("section", { class: "admin-room-list", attrs: { "aria-label": "รายการห้อง" } });
  const roomDetails: Array<{ element: HTMLDetailsElement; room: ManagedRoom }> = [];
  for (const room of rooms) {
    const details = document.createElement("details"); details.className = "admin-room-item";
    const summaryLine = document.createElement("summary"); summaryLine.className = "admin-room-summary";
    const identity = el("span", { class: "admin-room-identity" }, [
      el("strong", { text: room.name }),
      el("span", { class: "muted small", text: `ชั้น ${room.floor} · ${room.capacity} ที่นั่ง` }),
    ]);
    const state = el("span", { class: `admin-state${room.enabled ? " is-open" : " is-closed"}`, text: room.enabled ? "เปิดใช้" : "ปิดใช้" });
    const maintenance = el("span", { class: "muted small", text: room.maintenance.length ? `ปรับปรุง ${room.maintenance.length} ช่วง` : "ไม่มีแผนปรับปรุง" });
    summaryLine.append(identity, state, maintenance, el("span", { class: "admin-expand", text: "จัดการ  ›" }));
    details.append(summaryLine);

    const edit = createRoomForm((_, payload) => onSave(room.id, payload), room);
    const toggle = el("button", { class: room.enabled ? "button ghost" : "button primary", type: "button", text: room.enabled ? "ปิดใช้งานห้อง" : "เปิดใช้งานห้อง" });
    toggle.addEventListener("click", () => onToggle(room.id, !room.enabled));
    const controls = el("div", { class: "admin-room-controls" }, [edit, toggle]);
    details.append(controls, buildMaintenance(room, onMaintenance, onRemoveMaintenance));
    list.append(details);
    roomDetails.push({ element: details, room });
  }

  const applyFilter = (): void => {
    const term = search.value.trim().toLowerCase();
    const floor = floorSelect.value;
    for (const { element, room } of roomDetails) {
      element.hidden = !(room.name.toLowerCase().includes(term) && (floor === "all" || String(room.floor) === floor));
    }
  };
  search.addEventListener("input", applyFilter); floorSelect.addEventListener("change", applyFilter);
  container.replaceChildren(heading, toolbar, list);
}

function createRoomForm(onSave: (roomId: number | null, payload: RoomForm) => void, room?: ManagedRoom): HTMLFormElement {
  const form = document.createElement("form"); form.className = "admin-room-form";
  const name = input("text", "ชื่อห้อง", room?.name ?? "");
  const floor = input("number", "ชั้น", String(room?.floor ?? 1)); floor.min = "1"; floor.max = "30";
  const capacity = input("number", "จำนวนที่นั่ง", String(room?.capacity ?? 4)); capacity.min = "1"; capacity.max = "50";
  const power = checkbox("ปลั๊กไฟ", room?.hasPower ?? true);
  const board = checkbox("ไวท์บอร์ด", room?.hasWhiteboard ?? false);
  const quiet = document.createElement("select"); quiet.setAttribute("aria-label", "ระดับความเงียบ");
  for (const [value, label] of [["quiet", "โซนเงียบ"], ["normal", "โซนทั่วไป"], ["group", "โซนกลุ่ม"]]) {
    const option = document.createElement("option"); option.value = value; option.textContent = label; option.selected = (room?.quietLevel ?? "quiet") === value; quiet.append(option);
  }
  const save = el("button", { class: "button primary", type: "submit", text: room ? "บันทึกการเปลี่ยนแปลง" : "เพิ่มห้อง" });
  form.append(name, floor, capacity, power, board, quiet, save);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSave(room?.id ?? null, { name: name.value, floor: Number(floor.value), capacity: Number(capacity.value), hasPower: power.checked, hasWhiteboard: board.checked, quietLevel: quiet.value as QuietLevel });
  });
  return form;
}

function buildMaintenance(
  room: ManagedRoom,
  onAdd: (roomId: number, startsAt: number, endsAt: number, reason: string) => void,
  onRemove: (roomId: number, maintenanceId: number) => void,
): HTMLElement {
  const section = el("section", { class: "admin-maintenance" }, [el("h4", { text: "ปิดปรับปรุง" })]);
  const form = document.createElement("form"); form.className = "admin-maintenance-form";
  const start = input("datetime-local", "เริ่ม", "");
  const end = input("datetime-local", "สิ้นสุด", "");
  const reason = input("text", "เหตุผล", "ซ่อมบำรุง");
  const add = el("button", { class: "button ghost", type: "submit", text: "เพิ่มช่วงเวลา" });
  form.append(start, end, reason, add);
  form.addEventListener("submit", (event) => {
    event.preventDefault(); onAdd(room.id, new Date(start.value).getTime(), new Date(end.value).getTime(), reason.value);
  });
  section.append(form);
  if (!room.maintenance.length) section.append(el("p", { class: "muted small", text: "ไม่มีช่วงปิดปรับปรุงที่กำลังจะมาถึง" }));
  for (const item of room.maintenance) {
    const remove = el("button", { class: "button link-button", type: "button", text: `ยกเลิก · ${item.reason} · ${formatDateTime(item.startsAt)} – ${formatDateTime(item.endsAt)}` });
    remove.addEventListener("click", () => onRemove(room.id, item.id));
    section.append(remove);
  }
  return section;
}

function summary(label: string, value: string): HTMLElement {
  return el("div", { class: "admin-summary-item" }, [el("span", { class: "muted small", text: label }), el("strong", { text: value })]);
}

function input(type: string, label: string, value: string): HTMLInputElement {
  const element = document.createElement("input"); element.type = type; element.value = value;
  element.placeholder = label; element.setAttribute("aria-label", label);
  element.required = true;
  return element;
}

function checkbox(label: string, checked: boolean): HTMLLabelElement & { checked: boolean } {
  const wrapper = document.createElement("label") as HTMLLabelElement & { checked: boolean };
  wrapper.className = "admin-checkbox";
  const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked;
  wrapper.append(input, document.createTextNode(label));
  Object.defineProperty(wrapper, "checked", { get: () => input.checked });
  return wrapper;
}
