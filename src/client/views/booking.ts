/**
 * หน้าต่างจองห้อง + แสดง QR หลังจองสำเร็จ
 * ใช้ <dialog> ของ browser ซึ่งจัดการ focus และปุ่ม Esc ให้เอง
 */

import { ALLOWED_DURATIONS, CHECKIN_WINDOW_MS, MAX_NAME_LENGTH } from "../../shared/constants";
import type { CreateBookingResponse, Room } from "../../shared/types";
import { api, ApiError } from "../api";
import { el, formatClock, formatCountdown, showToast } from "../ui";

const DURATION_LABEL: Record<number, string> = {
  30: "30 นาที",
  60: "1 ชั่วโมง",
  120: "2 ชั่วโมง",
};

/**
 * เปิดหน้าต่างจองของห้องที่เลือก
 * onCreated ถูกเรียกหลังจองสำเร็จ เพื่อให้หน้าหลักดึงข้อมูลใหม่ทันที
 */
export function openBookingDialog(room: Room, userId: string, onCreated: () => void): void {
  const dialog = el("dialog", { class: "modal", attrs: { "aria-label": `จองห้อง ${room.name}` } });
  const card = el("div", { class: "modal-card" });

  const closeButton = el("button", {
    class: "icon-button",
    type: "button",
    text: "ปิด",
    attrs: { "aria-label": "ปิดหน้าต่างจอง" },
  });
  closeButton.addEventListener("click", () => dialog.close());

  const title = el("h2", { text: `จองห้อง ${room.name}` });
  const subtitle = el("p", {
    class: "muted small",
    text: `ชั้น ${room.floor} · จุ ${room.capacity} คน`,
  });

  const form = el("form", { class: "stack" });

  const nameInput = el("input", {
    type: "text",
    id: "booker-name",
    name: "userName",
    placeholder: "เช่น สมชาย ใจดี",
    autocomplete: "name",
    attrs: { maxlength: String(MAX_NAME_LENGTH), required: "" },
  });
  const nameField = el("div", { class: "field" }, [
    el("label", { text: "ชื่อผู้จอง", attrs: { for: "booker-name" } }),
    nameInput,
  ]);

  const durationFieldset = el("fieldset", { class: "field" }, [
    el("legend", { text: "ระยะเวลาการใช้งาน" }),
  ]);
  const durationGroup = el("div", { class: "chip-options" });
  for (const minutes of ALLOWED_DURATIONS) {
    const inputId = `duration-${minutes}`;
    const radio = el("input", {
      class: "sr-only",
      type: "radio",
      name: "duration",
      id: inputId,
      value: String(minutes),
      checked: minutes === 60,
    });
    const label = el("label", { class: "chip-option", attrs: { for: inputId } }, [
      el("span", { text: DURATION_LABEL[minutes] ?? `${minutes} นาที` }),
    ]);
    durationGroup.append(el("div", { class: "chip-option-wrap" }, [radio, label]));
  }
  durationFieldset.append(durationGroup);

  const errorNode = el("p", { class: "form-error", attrs: { role: "alert" } });
  const submitButton = el("button", {
    class: "button primary block",
    type: "submit",
    text: "ยืนยันการจอง",
  });

  form.append(nameField, durationFieldset, errorNode, submitButton);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitBooking();
  });

  async function submitBooking(): Promise<void> {
    errorNode.textContent = "";
    submitButton.disabled = true;
    const selectedDuration = form.querySelector<HTMLInputElement>('input[name="duration"]:checked');
    try {
      const result = await api.createBooking({
        userId,
        roomId: room.id,
        userName: nameInput.value,
        durationMinutes: Number(selectedDuration?.value ?? "60"),
      });
      onCreated();
      showSuccess(result);
    } catch (error) {
      errorNode.textContent =
        error instanceof ApiError ? error.message : "จองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    } finally {
      submitButton.disabled = false;
    }
  }

  /** แทนที่ฟอร์มด้วยผลลัพธ์ + QR (สร้างจากข้อมูลที่ server ตอบกลับเท่านั้น) */
  function showSuccess(result: CreateBookingResponse): void {
    const deadline = result.booking.startAt + CHECKIN_WINDOW_MS;
    const checkinLink = el("a", {
      class: "button ghost block",
      href: result.checkinUrl,
      target: "_blank",
      rel: "noreferrer",
      text: "เปิดหน้าเช็กอิน",
    });
    const copyButton = el("button", {
      class: "button block",
      type: "button",
      text: "คัดลอกลิงก์เช็กอิน",
    });
    copyButton.addEventListener("click", () => {
      void copyLink();
    });

    async function copyLink(): Promise<void> {
      try {
        await navigator.clipboard.writeText(result.checkinUrl);
        copyButton.textContent = "คัดลอกแล้ว ✓";
        window.setTimeout(() => {
          copyButton.textContent = "คัดลอกลิงก์เช็กอิน";
        }, 2000);
      } catch {
        showToast("คัดลอกอัตโนมัติไม่ได้ กรุณาคัดลอกลิงก์จากช่องด้านล่าง", "warn");
      }
    }

    const qrImage = el("img", {
      src: result.qrDataUrl,
      alt: `QR สำหรับเช็กอินห้อง ${result.room.name}`,
    });

    card.replaceChildren(
      el("div", { class: "modal-head" }, [
        el("div", {}, [
          el("h2", { text: "จองห้องสำเร็จ" }),
          el("p", { class: "muted small", text: `ห้อง ${result.room.name} · ชั้น ${result.room.floor}` }),
        ]),
        closeButton,
      ]),
      el("div", { class: "summary" }, [
        el("p", {}, [
          el("strong", { text: "ผู้จอง: " }),
          document.createTextNode(result.booking.userName),
        ]),
        el("p", {}, [
          el("strong", { text: "เวลา: " }),
          document.createTextNode(
            `${formatClock(result.booking.startAt)}–${formatClock(result.booking.endAt)} น.`,
          ),
        ]),
      ]),
      el("div", { class: "qr-box" }, [
        qrImage,
        el("p", { class: "small muted", text: "สแกนเพื่อเช็กอิน หรือเปิดลิงก์ด้านล่าง" }),
      ]),
      el("p", { class: "small" }, [
        document.createTextNode("ต้องเช็กอินภายใน 15 นาที เหลือเวลา "),
        el("span", {
          class: "countdown",
          attrs: { "data-deadline": String(deadline) },
          text: `อีก ${formatCountdown(deadline - Date.now())}`,
        }),
        document.createTextNode(" ไม่อย่างนั้นห้องจะถูกปล่อยคืนอัตโนมัติ"),
      ]),
      checkinLink,
      el("div", { class: "field" }, [
        el("label", { text: "ลิงก์เช็กอิน", attrs: { for: "checkin-link" } }),
        el("input", {
          id: "checkin-link",
          type: "text",
          value: result.checkinUrl,
          attrs: { readonly: "" },
        }),
      ]),
      copyButton,
    );
  }

  card.append(el("div", { class: "modal-head" }, [el("div", {}, [title, subtitle]), closeButton]));
  card.append(form);

  dialog.append(card);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
