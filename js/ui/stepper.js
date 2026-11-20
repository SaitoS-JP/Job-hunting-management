/* Arrow stepper showing a company's stage list. */
import { esc } from "./html.js";
import { isTerm, TERM_LABEL, colorAt, termColor } from "../model.js";

export function stepsHTML(stages, stage, r, large) {
  const n = stages.length;
  const term = isTerm(stage);
  const kcls = stage === "rejected" ? "rej" : stage === "declined" ? "dec" : "";
  const items = stages.map((s, i) => {
    const cls = i < r ? "on" : i === r ? "cur" : "";
    let txt = s.label;
    if (i === r && stage === "rejected") txt = "✕ " + txt;
    if (i === r && stage === "declined") txt = "辞退";
    return `<li class="${cls}"${i === r ? ' aria-current="step"' : ""} title="${esc(s.label)}"><span>${esc(txt)}</span></li>`;
  }).join("");
  const label = term ? `${TERM_LABEL[stage]}${r >= 0 ? `（${stages[r].label}で終了）` : ""}` : `${r >= 0 ? stages[r].label : ""}（${r + 1}/${n}）`;
  const col = term ? termColor(stage) : colorAt(r, stages);
  return `<ol class="steps${large ? " lg" : ""} ${kcls}" style="--sc:${col};min-width:${n * (large ? 72 : 64)}px" aria-label="選考の進み具合：${esc(label)}">${items}</ol>`;
}

/** Scroll each stepper so the current stage is visible (narrow screens). */
export function revealCurrentSteps(root) {
  root.querySelectorAll(".steps-scroll").forEach((box) => {
    const cur = box.querySelector('[aria-current="step"]');
    if (!cur || box.scrollWidth <= box.clientWidth) return;
    const target = cur.offsetLeft - (box.clientWidth - cur.offsetWidth) / 2;
    box.scrollLeft = Math.max(0, target - box.firstElementChild.offsetLeft);
  });
}
