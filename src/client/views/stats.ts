/**
 * หน้าสถิติสำหรับฝ่ายอาคารสถานที่
 * แสดงตัวเลขที่คำนวณจากฐานข้อมูลจริง ไม่ได้ hardcode
 * ทุกค่ามีคำอธิบายสั้น ๆ ว่าหมายถึงอะไร เพื่อให้อ่านรายงานได้ถูก
 */

import type { StatsResponse } from "../../shared/types";
import { el, formatHourRange } from "../ui";

export function renderStatsView(
  container: HTMLElement,
  stats: StatsResponse | null,
  error: string | null = null,
  onRetry?: () => void,
): void {
  const heading = el("div", { class: "section-heading" }, [
    el("div", {}, [
      el("h2", { text: "สถิติการใช้งานห้อง" }),
      el("p", { class: "muted", text: "ข้อมูลจากประวัติการจองจริงในฐานข้อมูล อัปเดตอัตโนมัติ" }),
    ]),
  ]);
  container.append(heading);

  if (error) {
    const retryButton = el("button", {
      class: "button primary",
      type: "button",
      text: "ลองโหลดอีกครั้ง",
    });
    retryButton.addEventListener("click", () => onRetry?.());
    container.append(
      el("section", { class: "alert stack" }, [
        el("p", { text: error }),
        retryButton,
      ]),
    );
  }

  if (!stats) {
    if (!error) container.append(el("p", { class: "empty muted", text: "กำลังโหลดสถิติ…" }));
    return;
  }

  container.append(
    el("div", { class: "kpi-grid" }, [
      kpi("การจองทั้งหมด", `${stats.totalBookings}`, "ครั้ง (รวมที่ถูกปล่อยคืน)"),
      kpi("ปล่อยคืนอัตโนมัติ", `${stats.releasedBookings}`, "ครั้งที่จองแล้วไม่มาเช็กอิน"),
      kpi(
        "อัตราการใช้ห้องจริง",
        `${stats.utilizationRate.toFixed(1)}%`,
        `${stats.checkedInBookings} ครั้งที่มีคนเช็กอิน`,
      ),
      kpi("ห้องว่างตอนนี้", `${stats.availableRooms}/${stats.totalRooms}`, "ห้อง"),
    ]),
  );

  const peakCard = el("section", { class: "card" }, [
    el("h3", { text: "ช่วงเวลาที่คนใช้เยอะที่สุด" }),
    el("p", { class: "muted small", text: "นับจากเวลาที่การจองเริ่ม (3 อันดับแรก)" }),
  ]);
  const maxPeak = Math.max(...stats.peakHours.map((peak) => peak.bookings), 1);
  for (const peak of stats.peakHours) {
    peakCard.append(
      el("div", { class: "bar-row" }, [
        el("span", { text: formatHourRange(peak.hour) }),
        el("span", { class: "bar-track" }, [
          el("span", {
            class: "bar-fill",
            attrs: {
              style: `width: ${Math.round((peak.bookings / maxPeak) * 100)}%`,
            },
          }),
        ]),
        el("span", { class: "bar-value", text: String(peak.bookings) }),
      ]),
    );
  }
  if (stats.peakHours.length === 0) {
    peakCard.append(el("p", { class: "muted small", text: "ยังไม่มีข้อมูลการจอง" }));
  }

  const roomsCard = el("section", { class: "card" }, [
    el("h3", { text: "ห้องที่ถูกใช้น้อยที่สุด" }),
    el("p", { class: "muted small", text: "นับเฉพาะครั้งที่มีการเช็กอินจริง" }),
  ]);
  const usageList = el("ul", { class: "usage-list" });
  for (const room of stats.leastUsedRooms) {
    usageList.append(
      el("li", {}, [
        el("span", { text: `${room.roomName} · ชั้น ${room.floor}` }),
        el("span", { class: "muted", text: `${room.checkedInCount} ครั้ง` }),
      ]),
    );
  }
  roomsCard.append(usageList);

  container.append(
    el("div", { class: "stats-columns" }, [peakCard, roomsCard]),
    el("p", {
      class: "footnote",
      text: "อัตราการใช้ห้องจริง = จำนวนครั้งที่มีการเช็กอิน ÷ จำนวนการจองทั้งหมด การจองที่ถูกปล่อยคืนจึงถูกนับเป็นการใช้ทรัพยากรที่สูญเปล่า",
    }),
  );
}

function kpi(label: string, value: string, hint: string): HTMLElement {
  return el("div", { class: "kpi" }, [
    el("p", { class: "kpi-label", text: label }),
    el("p", { class: "kpi-value", text: value }),
    el("p", { class: "kpi-hint", text: hint }),
  ]);
}
