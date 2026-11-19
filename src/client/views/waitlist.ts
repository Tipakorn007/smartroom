import { ALLOWED_DURATIONS, MAX_NAME_LENGTH } from "../../shared/constants";
import type { CreateBookingResponse, Room, WaitlistEntry } from "../../shared/types";
import { api, ApiError } from "../api";
import { el, formatClock } from "../ui";

const DURATION_LABEL: Record<number, string> = {
  30: "30 นาที",
  60: "1 ชั่วโมง",
  120: "2 ชั่วโมง",
};

export function openWaitlistDialog(
  room: Room,
  userId: string,
  onJoined: () => void,
): void {
  const dialog = el("dialog", { class: "modal", attrs: { "aria-label": `เข้าคิวห้อง ${room.name}` } });
  const card = el("div", { class: "modal-card" });
  const closeButton = el("button", {
    class: "icon-button",
    type: "button",
    text: "ปิด",
    attrs: { "aria-label": "ปิดหน้าต่างเข้าคิว" },
  });
  closeButton.addEventListener("click", () => dialog.close());

  const title = el("h2", { text: `เข้าคิวห้อง ${room.name}` });
  const subtitle = el("p", {
    class: "muted small",
    text: `ชั้น ${room.floor} · เมื่อห้องว่าง ระบบจะส่งข้อเสนอให้ตามลำดับคิว`,
  });
  const form = el("form", { class: "stack" });
  const nameInput = el("input", {
    type: "text",
    id: "waitlist-name",
    name: "userName",
    placeholder: "เช่น สมชาย ใจดี",
    autocomplete: "name",
    attrs: { maxlength: String(MAX_NAME_LENGTH), required: "" },
  });
  const nameField = el("div", { class: "field" }, [
    el("label", { text: "ชื่อผู้ใช้คิว", attrs: { for: "waitlist-name" } }),
    nameInput,
  ]);
  const durationFieldset = el("fieldset", { class: "field" }, [
    el("legend", { text: "ระยะเวลาที่ต้องการใช้" }),
  ]);
  const durationGroup = el("div", { class: "chip-options" });
  for (const minutes of ALLOWED_DURATIONS) {
    const inputId = `waitlist-duration-${minutes}`;
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
    text: "ยืนยันเข้าคิว",
  });
  form.append(
    nameField,
    durationFieldset,
    el("p", {
      class: "small muted",
      text: "คิวผูกกับเบราว์เซอร์นี้ หากเปลี่ยนอุปกรณ์หรือเคลียร์ข้อมูลเว็บ อาจเรียกคืนคิวไม่ได้",
    }),
    errorNode,
    submitButton,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });

  async function submit(): Promise<void> {
    const selectedDuration = form.querySelector<HTMLInputElement>('input[name="duration"]:checked');
    errorNode.textContent = "";
    submitButton.disabled = true;
    try {
      const entry = await api.joinWaitlist({
        userId,
        roomId: room.id,
        userName: nameInput.value,
        durationMinutes: Number(selectedDuration?.value ?? "60"),
      });
      form.replaceChildren(
        el("p", { class: "alert", text: positionMessage(entry) }),
        el("button", {
          class: "button primary block",
          type: "button",
          text: "เรียบร้อย",
        }),
      );
      form.querySelector("button")?.addEventListener("click", () => dialog.close());
      onJoined();
    } catch (error) {
      errorNode.textContent =
        error instanceof ApiError ? error.message : "เข้าคิวไม่สำเร็จ กรุณาลองใหม่";
      submitButton.disabled = false;
    }
  }

  card.append(el("div", { class: "modal-head" }, [el("div", {}, [title, subtitle]), closeButton]));
  card.append(form);
  dialog.append(card);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  nameInput.focus();
}

function positionMessage(entry: WaitlistEntry): string {
  if (entry.status === "offered") return "ถึงคิวคุณแล้ว ข้อเสนอรอการยืนยัน 5 นาที";
  return `เข้าคิวแล้ว · คุณอยู่คิวที่ ${entry.position ?? 1}`;
}

export function showAcceptedOffer(result: CreateBookingResponse): void {
  const dialog = el("dialog", { class: "modal", attrs: { "aria-label": "รับข้อเสนอสำเร็จ" } });
  const closeButton = el("button", {
    class: "icon-button",
    type: "button",
    text: "ปิด",
    attrs: { "aria-label": "ปิดหน้าต่าง" },
  });
  closeButton.addEventListener("click", () => dialog.close());
  const checkinLink = el("a", {
    class: "button primary block",
    href: result.checkinUrl,
    text: "เปิดหน้าเช็กอิน",
  });
  const card = el("div", { class: "modal-card" }, [
    el("div", { class: "modal-head" }, [
      el("div", {}, [
        el("h2", { text: "รับข้อเสนอสำเร็จ" }),
        el("p", { class: "muted small", text: `ห้อง ${result.room.name} · ชั้น ${result.room.floor}` }),
      ]),
      closeButton,
    ]),
    el("p", { text: `เวลาใช้งาน ${formatClock(result.booking.startAt)}–${formatClock(result.booking.endAt)} น.` }),
    el("div", { class: "qr-box" }, [
      el("img", { src: result.qrDataUrl, alt: `QR เช็กอินห้อง ${result.room.name}` }),
      el("p", { class: "small muted", text: "กรุณาเช็กอินภายใน 15 นาทีเพื่อเริ่มใช้งาน" }),
    ]),
    checkinLink,
  ]);
  dialog.append(card);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
