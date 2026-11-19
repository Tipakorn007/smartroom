/**
 * หน้าตัวช่วยเลือกห้อง
 * ผู้ใช้กรอกจำนวนคน + ติ๊กคุณสมบัติ แล้วแสดง 3 ห้องที่คะแนนดีที่สุดพร้อมเหตุผล
 * เหตุผลสำคัญกว่ารายละเอียดอัลกอริทึม เพราะช่วยให้ผู้ใช้ตัดสินใจได้จริง
 */

import { MAX_PEOPLE, MIN_PEOPLE } from "../../shared/constants";
import type { Recommendation, Room } from "../../shared/types";
import { api, ApiError } from "../api";
import { el } from "../ui";

export function renderRecommendView(container: HTMLElement, onBook: (room: Room) => void): void {
  const heading = el("div", { class: "section-heading" }, [
    el("div", {}, [
      el("h2", { text: "แนะนำห้องให้เหมาะกับงานคุณ" }),
      el("p", {
        class: "muted",
        text: "ระบบเลือกจากห้องที่ว่างอยู่ตอนนี้ โดยคำนึงถึงจำนวนคน คุณสมบัติ และความเงียบ",
      }),
    ]),
  ]);

  const form = el("form", { class: "card stack" });
  const peopleInput = el("input", {
    type: "number",
    id: "people-count",
    name: "people",
    value: "4",
    attrs: {
      min: String(MIN_PEOPLE),
      max: String(MAX_PEOPLE),
      step: "1",
      inputmode: "numeric",
      required: "",
    },
  });

  const peopleField = el("div", { class: "field" }, [
    el("label", { text: "จำนวนคนที่จะใช้ห้อง", attrs: { for: "people-count" } }),
    peopleInput,
    el("p", { class: "muted small", text: `รองรับ ${MIN_PEOPLE}–${MAX_PEOPLE} คน` }),
  ]);

  const powerInput = el("input", { type: "checkbox", id: "need-power", name: "needPower" });
  const whiteboardInput = el("input", {
    type: "checkbox",
    id: "need-whiteboard",
    name: "needWhiteboard",
  });
  const quietInput = el("input", { type: "checkbox", id: "prefer-quiet", name: "preferQuiet" });

  const options = el("div", { class: "field" }, [
    el("span", { text: "สิ่งที่ต้องใช้", class: "field-title" }),
    el("div", { class: "checkbox-row" }, [
      el("label", { attrs: { for: "need-power" } }, [powerInput, el("span", { text: "ปลั๊กไฟ" })]),
      el("label", { attrs: { for: "need-whiteboard" } }, [
        whiteboardInput,
        el("span", { text: "ไวท์บอร์ด" }),
      ]),
      el("label", { attrs: { for: "prefer-quiet" } }, [
        quietInput,
        el("span", { text: "ต้องการความเงียบ" }),
      ]),
    ]),
  ]);

  const errorNode = el("p", { class: "form-error", attrs: { role: "alert" } });
  const submitButton = el("button", {
    class: "button primary",
    type: "submit",
    text: "ค้นหาห้องที่เหมาะที่สุด",
  });

  form.append(peopleField, options, errorNode, submitButton);

  const results = el("div", { class: "results" });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void findRooms();
  });

  async function findRooms(): Promise<void> {
    errorNode.textContent = "";
    submitButton.disabled = true;
    try {
      const { recommendations } = await api.recommend({
        people: Number(peopleInput.value),
        needPower: powerInput.checked,
        needWhiteboard: whiteboardInput.checked,
        preferQuiet: quietInput.checked,
      });
      renderResults(results, recommendations, Number(peopleInput.value), onBook);
    } catch (error) {
      errorNode.textContent =
        error instanceof ApiError ? error.message : "ขอคำแนะนำไม่สำเร็จ กรุณาลองใหม่";
    } finally {
      submitButton.disabled = false;
    }
  }

  container.append(heading, form, results);
}

function renderResults(
  container: HTMLElement,
  recommendations: Recommendation[],
  people: number,
  onBook: (room: Room) => void,
): void {
  if (recommendations.length === 0) {
    container.replaceChildren(
      el("p", {
        class: "empty muted",
        text: `ยังไม่มีห้องว่างที่จุ ${people} คนได้ ลองลดจำนวนคน เปลี่ยนชั้น หรือรอสักครู่`,
      }),
    );
    return;
  }

  const cards: HTMLElement[] = [];
  recommendations.forEach((recommendation, index) => {
    const room = recommendation.room;
    const bookButton = el("button", {
      class: "button primary",
      type: "button",
      text: "จองห้องนี้",
    });
    bookButton.addEventListener("click", () => onBook(room));

    const reasons = el(
      "ul",
      { class: "reasons" },
      recommendation.reasons.map((reason) => el("li", { text: reason })),
    );

    cards.push(
      el("article", { class: "card result-card" }, [
        el("header", { class: "result-head" }, [
          el("div", {}, [
            el("h4", { text: `${index + 1}. ห้อง ${room.name}` }),
            el("p", { class: "muted small", text: `ชั้น ${room.floor} · จุ ${room.capacity} คน` }),
          ]),
          el("span", { class: "score", text: `คะแนน ${recommendation.score}` }),
        ]),
        reasons,
        bookButton,
      ]),
    );
  });

  container.replaceChildren(
    el("h3", { text: "ผลลัพธ์", class: "results-title" }),
    el("p", {
      class: "muted small",
      text: "คะแนนน้อยกว่า = เหมาะกว่า (ที่นั่งเกินความจำเป็นและคุณสมบัติที่ขาดจะบวกคะแนน)",
    }),
    ...cards,
  );
}
