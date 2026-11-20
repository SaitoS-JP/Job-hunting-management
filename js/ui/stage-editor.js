/* Editable stage list, used by the template panel and the company dialog. */
import { $, esc } from "./html.js";
import { MAX_LABEL, MAX_STAGES, moveStage, insertStage, deleteStage } from "../model.js";

const editors = new Map();

/**
 * Register an editor. cfg: {box, err, get(), set(list), currentId?(), changed?()}
 * Controls carry data-ed=<kind>; one delegated listener handles them all.
 */
export function defineEditor(kind, cfg) { editors.set(kind, cfg); }

export function renderEditor(kind) {
  const cfg = editors.get(kind);
  const list = cfg.get();
  const n = list.length;
  $(cfg.box).innerHTML = `<ol class="sed" aria-label="選考段階の並び">${list.map((s, i) => {
    const sid = esc(s.id), lab = esc(s.label);
    return `
    <li class="sed-row">
      <span class="sed-n num">${i + 1}</span>
      <input class="input sed-in" id="${kind}-label-${sid}" value="${lab}" maxlength="${MAX_LABEL}" autocomplete="off" aria-label="${i + 1}番目の段階名" data-ed="${kind}" data-op="rename" data-i="${i}">
      <button type="button" class="sed-b" id="${kind}-up-${sid}" data-ed="${kind}" data-op="up" data-i="${i}" aria-label="${lab}を上へ"${i === 0 ? " disabled" : ""}>↑</button>
      <button type="button" class="sed-b" id="${kind}-down-${sid}" data-ed="${kind}" data-op="down" data-i="${i}" aria-label="${lab}を下へ"${i === n - 1 ? " disabled" : ""}>↓</button>
      <button type="button" class="sed-b" id="${kind}-ins-${sid}" data-ed="${kind}" data-op="ins" data-i="${i}" aria-label="${lab}の下に段階を追加" title="この下に追加"${n >= MAX_STAGES ? " disabled" : ""}>＋</button>
      <button type="button" class="sed-b del" id="${kind}-del-${sid}" data-ed="${kind}" data-op="del" data-i="${i}" aria-label="${lab}を削除" title="削除"${n <= 1 ? " disabled" : ""}>✕</button>
    </li>`;
  }).join("")}</ol>`;
}

export function editorOp(kind, op, i, value) {
  const cfg = editors.get(kind);
  const list = cfg.get();
  const err = $(cfg.err);
  err.textContent = "";
  const changed = () => cfg.changed && cfg.changed();
  if (op === "rename") { const out = list.slice(); out[i] = { ...out[i], label: value }; cfg.set(out); changed(); return; }
  let r; let focusId = null;
  if (op === "up" || op === "down") {
    const dir = op === "up" ? -1 : 1;
    r = moveStage(list, i, dir);
    const moved = r.list[i + dir];
    if (moved) {
      const j = i + dir;
      const edge = (op === "up" && j === 0) || (op === "down" && j === r.list.length - 1);
      focusId = `${kind}-${edge ? (op === "up" ? "down" : "up") : op}-${moved.id}`;
    }
  } else if (op === "ins" || op === "add") {
    r = insertStage(list, op === "add" ? list.length : i + 1);
    if (r.added) focusId = `${kind}-label-${r.added.id}`;
  } else if (op === "del") {
    r = deleteStage(list, i, cfg.currentId ? cfg.currentId() : null);
    if (r.list) focusId = `${kind}-del-${r.list[Math.min(i, r.list.length - 1)].id}`;
  } else return;
  if (r.error) { err.textContent = r.error; return; }
  cfg.set(r.list);
  renderEditor(kind);
  changed();
  const el = focusId && $(focusId);
  if (el) { el.focus(); if (el.select && (op === "ins" || op === "add")) el.select(); }
}

export function installEditorEvents() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ed]");
    if (!b || b.disabled) return;
    editorOp(b.dataset.ed, b.dataset.op, Number(b.dataset.i));
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t && t.matches && t.matches("input[data-ed]")) editorOp(t.dataset.ed, "rename", Number(t.dataset.i), t.value);
  });
}
