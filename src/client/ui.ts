/**
 * ตัวช่วยสร้าง DOM และจัดการรูปแบบข้อความ
 * จุดสำคัญด้านความปลอดภัย: ทุกข้อความผู้ใช้ถูกใส่ด้วย textContent / createTextNode
 * ไม่มี innerHTML ที่ไหนในโปรเจกต์ ข้อความอย่าง <script> จึงถูกแสดงเป็นตัวอักษรธรรมดา
 */

export type Child = Node | string;

export interface ElementOptions {
  class?: string;
  text?: string;
  id?: string;
  type?: string;
  name?: string;
  value?: string;
  placeholder?: string;
  href?: string;
  target?: string;
  rel?: string;
  src?: string;
  alt?: string;
  title?: string;
  autocomplete?: string;
  disabled?: boolean;
  checked?: boolean;
  /** attribute อื่น ๆ เช่น aria-selected หรือ data-deadline */
  attrs?: Record<string, string>;
}

/**
 * สร้าง element พร้อมลูก ๆ
 * ใช้แทน innerHTML ทั้งโปรเจกต์ เพื่อกัน XSS โดยไม่ต้องจำว่าจุดไหนต้อง escape
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (options.class) node.className = options.class;
  if (options.id) node.id = options.id;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.title) node.title = options.title;

  if (options.type) node.setAttribute("type", options.type);
  if (options.name) node.setAttribute("name", options.name);
  if (options.value !== undefined) node.setAttribute("value", options.value);
  if (options.placeholder) node.setAttribute("placeholder", options.placeholder);
  if (options.href) node.setAttribute("href", options.href);
  if (options.target) node.setAttribute("target", options.target);
  if (options.rel) node.setAttribute("rel", options.rel);
  if (options.src) node.setAttribute("src", options.src);
  if (options.alt) node.setAttribute("alt", options.alt);
  if (options.autocomplete) node.setAttribute("autocomplete", options.autocomplete);
  if (options.disabled) node.setAttribute("disabled", "");
  if (options.checked) node.setAttribute("checked", "");

  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    node.setAttribute(name, value);
  }

  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }

  return node;
}

const BANGKOK_CLOCK = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  calendar: "buddhist",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** แสดงเวลาแบบ 24 ชั่วโมง เช่น 14:05 */
export function formatClock(timestamp: number): string {
  return BANGKOK_CLOCK.format(new Date(timestamp));
}

/** แสดงวันที่แบบไทย + เวลา เช่น 19 พ.ย. 2569 · 14:05 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${BANGKOK_DATE.format(date)} · ${formatClock(timestamp)}`;
}

/** แปลงมิลลิวินาทีที่เหลือเป็น mm:ss (ใช้กับนาฬิกานับถอยหลัง) */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** แสดงจำนวนชั่วโมงแบบช่วงเวลา เช่น 14:00–14:59 */
export function formatHourRange(hour: number): string {
  return `${pad(hour)}:00–${pad(hour)}:59`;
}

/** แจ้งเตือนมุมล่างจอ แล้วลบเองใน 6 วินาที */
export function showToast(message: string, tone: "info" | "warn" = "info"): void {
  const area = document.getElementById("toast-area");
  if (!area) return;
  const toast = el("div", { class: `toast toast-${tone}`, text: message });
  area.append(toast);
  window.setTimeout(() => toast.remove(), 6000);
}

/* ---------- ธีมสว่าง/มืด ---------- */

const THEME_KEY = "smartroom:theme";

/**
 * ตั้งธีมตอนเปิดหน้า: ใช้ค่าที่ผู้ใช้เคยเลือกไว้ ถ้าไม่เคยเลือกให้ตามระบบ
 * เราเขียน data-theme ลง <html> ทุกครั้ง CSS จึงมีชุดสีเดียวต่อโหมด
 */
export function initTheme(): void {
  let theme: "light" | "dark" = "light";
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "merchant") theme = "dark";
    else if (saved === "light") theme = "light";
    else if (saved === "system") theme = "light";
    else if (saved === "freudian" || saved === "intro" || saved === "north-block") theme = "light";
  } catch {
    // Keep the page usable when browser storage is unavailable.
  }
  applyTheme(theme);
}

/** สลับธีมแล้วคืนธีมใหม่ เพื่อให้ปุ่มอัปเดตข้อความได้ */
function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
  const background = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor && background) themeColor.content = background;
}

export function toggleTheme(): "light" | "dark" {
  const current = currentTheme();
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Theme still applies for this page when persistence is unavailable.
  }
  return next;
}

export function currentTheme(): "light" | "dark" {
  const theme = document.documentElement.dataset.theme;
  return theme === "dark" ? "dark" : "light";
}
