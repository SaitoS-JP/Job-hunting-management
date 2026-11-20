/* Add / edit dialog: fields, per-company stages, events, icon, history. */
import { $, esc } from "./html.js";
import { iconHTML, squareImage } from "../icons.js";
import { putIconBlob } from "../store.js";
import { stepsHTML, revealCurrentSteps } from "./stepper.js";
import { defineEditor, renderEditor, editorOp } from "./stage-editor.js";
import { parseDate, fmtFull, toInputs, fromInputs } from "../dates.js";
import { newEventId, eventsFromRows, MAX_EVENTS, MAX_EVENT_LABEL } from "../events.js";
import {
  TERM_LABEL, isTerm, labelIn, colorAt, termColor, reachedFrom, cloneStages, checkStages, newId,
} from "../model.js";

const ICON_HINT = "未設定のときは社名の頭文字を表示します。画像の貼り付けもできます。";

export function initDialog(app) {
  const { S } = app;
  const dlg = $("dlg");
  const byId = (id) => S.docs.find((c) => c.id === id);
  const editing = () => (S.editingId ? byId(S.editingId) : null);

  /* ---------- stages ---------- */
  defineEditor("cs", {
    box: "cs-editor", err: "cs-err",
    get: () => S.draftStages, set: (a) => { S.draftStages = a; },
    currentId: () => $("c-stage").value,
    changed: () => updateVisuals(true),
  });
  function rebuildStageSelect(value) {
    const sel = $("c-stage");
    sel.innerHTML =
      `<optgroup label="選考段階">${S.draftStages.map((s) => `<option value="${esc(s.id)}">${esc(String(s.label).trim() || "（名前なし）")}</option>`).join("")}</optgroup>` +
      `<optgroup label="終了">${Object.entries(TERM_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</optgroup>`;
    const ok = isTerm(value) || S.draftStages.some((s) => s.id === value);
    sel.value = ok ? value : S.draftStages[0].id;
  }
  function setStageEditorOpen(open) {
    $("cs-box").hidden = !open;
    $("btn-cs-toggle").setAttribute("aria-expanded", String(open));
    $("btn-cs-toggle").textContent = open ? "選考段階の編集を閉じる" : "この企業の選考段階を編集";
    if (open) renderEditor("cs");
  }
  $("btn-cs-toggle").addEventListener("click", () => setStageEditorOpen($("cs-box").hidden));
  $("btn-cs-add").addEventListener("click", () => editorOp("cs", "add", 0));
  $("btn-cs-reload").addEventListener("click", () => {
    const sel = $("c-stage").value;
    const oldLabel = labelIn(S.draftStages, sel);
    S.draftStages = cloneStages(S.template);
    let note = "テンプレートの段階を読み込みました。保存すると反映されます。";
    if (!isTerm(sel) && !S.draftStages.some((s) => s.id === sel)) {
      const same = S.draftStages.find((s) => s.label === oldLabel) || S.draftStages[0];
      rebuildStageSelect(same.id);
      if (same.label !== oldLabel) note = `いまの段階「${oldLabel}」はテンプレートにないため「${same.label}」にしました。確認してから保存してください。`;
    } else rebuildStageSelect(sel);
    renderEditor("cs");
    updateVisuals(false);
    $("cs-err").textContent = note;
  });

  /* ---------- events ---------- */
  const rowEl = (id) => $("ev-list").querySelector(`li[data-ev="${CSS.escape(id)}"]`);
  function sortDraftEvents() {
    const key = (r) => (r.date ? fromInputs(r.date, r.time) || "9" : "9");
    S.draftEvents.sort((a, b) => key(a).localeCompare(key(b)));
  }
  function renderEvents() {
    const list = $("ev-list");
    if (!S.draftEvents.length) { list.innerHTML = `<li class="ev-empty hint">予定はまだありません。締切や面接日を追加すると、一覧と「直近の予定」に表示されます。</li>`; return; }
    list.innerHTML = S.draftEvents.map((r) => {
      const id = esc(r.id);
      return `<li class="ev-row${r.done ? " is-done" : ""}" data-ev="${id}">
        <input type="date" class="input ev-date" id="ev-date-${id}" value="${esc(r.date)}" aria-label="予定の日付" data-evf="date">
        <input type="time" class="input ev-time" id="ev-time-${id}" value="${esc(r.time)}" aria-label="予定の時刻（任意）" data-evf="time">
        <input class="input ev-label" id="ev-label-${id}" value="${esc(r.label)}" list="label-suggest" maxlength="${MAX_EVENT_LABEL}" autocomplete="off" placeholder="内容（例：一次面接）" aria-label="予定の内容" data-evf="label">
        <label class="ev-done"><input type="checkbox" id="ev-done-${id}" data-evf="done"${r.done ? " checked" : ""}>完了</label>
        <button type="button" class="sed-b del ev-del" id="ev-del-${id}" data-evdel="${id}" aria-label="この予定を削除" title="削除">✕</button>
      </li>`;
    }).join("");
  }
  $("ev-list").addEventListener("input", (e) => {
    const f = e.target.dataset.evf; const li = e.target.closest("li[data-ev]");
    if (!f || !li) return;
    const r = S.draftEvents.find((x) => x.id === li.dataset.ev); if (!r) return;
    r[f] = f === "done" ? e.target.checked : e.target.value;
    if (f === "done") li.classList.toggle("is-done", r.done);
    $("ev-err").textContent = "";
  });
  $("ev-list").addEventListener("change", (e) => {
    if (e.target.dataset.evf !== "date" && e.target.dataset.evf !== "time") return;
    const focusId = e.target.id;
    const before = S.draftEvents.map((r) => r.id).join();
    sortDraftEvents();
    if (S.draftEvents.map((r) => r.id).join() !== before) { renderEvents(); const el = $(focusId); if (el) el.focus(); }
  });
  $("ev-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-evdel]"); if (!b) return;
    const i = S.draftEvents.findIndex((r) => r.id === b.dataset.evdel); if (i < 0) return;
    S.draftEvents.splice(i, 1);
    renderEvents();
    const near = S.draftEvents[Math.min(i, S.draftEvents.length - 1)];
    ($(near ? `ev-del-${near.id}` : "btn-ev-add") || $("btn-ev-add")).focus();
  });
  $("btn-ev-add").addEventListener("click", () => {
    if (S.draftEvents.length >= MAX_EVENTS) { $("ev-err").textContent = `予定は${MAX_EVENTS}件までです。`; return; }
    const r = { id: newEventId(), date: "", time: "", label: "", done: false };
    S.draftEvents.push(r);
    renderEvents();
    $(`ev-date-${r.id}`).focus();
  });

  /* ---------- icon ---------- */
  function resetIcon() {
    if (S.icon.url) { try { URL.revokeObjectURL(S.icon.url); } catch (e) {} }
    S.icon = { blob: null, url: "", removed: false };
    const f = $("c-icon-file"); if (f) f.value = "";
  }
  function currentIconSrc() {
    if (S.icon.url) return S.icon.url;
    const c = editing();
    return !S.icon.removed && c && c.iconId ? app.iconUrl(c.iconId) : "";
  }
  async function pickIcon(file) {
    if (!file || !/^image\//.test(file.type)) return;
    if (file.size > 20 * 1024 * 1024) { $("icon-hint").textContent = "画像が大きすぎます（20MBまで）。"; return; }
    try {
      const blob = await squareImage(file);
      resetIcon();
      S.icon.blob = blob; S.icon.url = URL.createObjectURL(blob);
      $("icon-hint").textContent = "保存すると反映されます。";
      updateVisuals();
    } catch (e) { $("icon-hint").textContent = "この画像は読み込めませんでした。別の画像を選んでください。"; }
  }
  $("c-icon-file").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) pickIcon(f); });
  $("btn-icon-remove").addEventListener("click", () => {
    resetIcon(); S.icon.removed = true;
    $("icon-hint").textContent = "保存すると画像が外れ、頭文字の表示に戻ります。";
    updateVisuals();
  });
  dlg.addEventListener("paste", (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.kind === "file" && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) { e.preventDefault(); pickIcon(f); } return; }
    }
  });

  /* ---------- visuals ---------- */
  function updateVisuals(stagesChanged) {
    if (stagesChanged) rebuildStageSelect($("c-stage").value);
    const stage = $("c-stage").value;
    const c = editing();
    const r = reachedFrom(S.draftStages, stage, c ? c.history : []);
    $("dlg-steps").innerHTML = stepsHTML(S.draftStages.map((s) => ({ id: s.id, label: String(s.label).trim() || "…" })), stage, r, true);
    requestAnimationFrame(() => revealCurrentSteps($("dlg-steps").parentElement));
    const name = $("c-name").value || "";
    const src = currentIconSrc();
    $("dlg-icon").innerHTML = iconHTML(name, src, 48);
    $("icon-preview").innerHTML = iconHTML(name, src, 40);
    $("btn-icon-remove").hidden = !(S.icon.url || (!S.icon.removed && c && c.iconId));
  }
  $("c-name").addEventListener("input", () => updateVisuals());
  $("c-stage").addEventListener("change", () => { $("cs-err").textContent = ""; updateVisuals(); });
  function updateUrlLink() {
    const v = $("c-url").value.trim(); const a = $("c-url-open");
    if (/^https?:\/\/[^\s]+$/i.test(v)) { a.href = v; a.hidden = false; } else { a.removeAttribute("href"); a.hidden = true; }
  }
  $("c-url").addEventListener("input", updateUrlLink);

  /* ---------- open / close ---------- */
  function openDialog(id) {
    const c = id ? byId(id) : null;
    S.editingId = c ? c.id : null;
    S.draftStages = cloneStages(c ? c.stages : S.template);
    S.draftEvents = (c ? c.events : []).map((e) => ({ id: e.id, ...toInputs(e.at), label: e.label, done: e.done }));
    sortDraftEvents();
    $("dlg-title").textContent = c ? "企業を編集" : "企業を追加";
    $("c-name").value = c ? c.name : "";
    $("c-position").value = c ? c.position : "";
    $("c-industry").value = c ? c.industry : "";
    $("c-priority").value = String(c ? c.priority : 2);
    const def = S.draftStages.find((s) => s.id === "entry") || S.draftStages[0];
    rebuildStageSelect(c ? c.stage : def.id);
    $("c-url").value = c ? c.url : "";
    $("c-memo").value = c ? c.memo : "";
    for (const k of ["form-err", "cs-err", "ev-err"]) $(k).textContent = "";
    $("del-confirm").hidden = true;
    $("btn-delete").hidden = !c;
    setStageEditorOpen(false);
    renderEvents();
    const hist = c ? c.history.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))) : [];
    $("hist-wrap").hidden = !hist.length;
    $("hist").innerHTML = hist.map((h) => {
      const t = parseDate(h.at);
      const k = c.stages.findIndex((s) => s.id === h.stage);
      const col = isTerm(h.stage) ? termColor(h.stage) : colorAt(k, c.stages.length);
      return `<li style="--sc:${col}"><span class="num">${t ? esc(fmtFull(t)) : "—"}</span><span>${esc(h.label || labelIn(c.stages, h.stage))}</span></li>`;
    }).join("");
    resetIcon();
    $("icon-hint").textContent = ICON_HINT;
    updateVisuals();
    updateUrlLink();
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    if (!matchMedia("(pointer: coarse)").matches) setTimeout(() => $("c-name").focus(), 0);
  }
  function closeDialog() { if (dlg.open) dlg.close(); S.editingId = null; resetIcon(); }
  $("btn-cancel").addEventListener("click", closeDialog);
  $("btn-dlg-close").addEventListener("click", closeDialog);
  dlg.addEventListener("close", () => { S.editingId = null; resetIcon(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDialog(); });

  /* ---------- save / delete ---------- */
  $("form-company").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (S.busy) return;
    const fail = (msg, focusId) => { $("form-err").textContent = msg; if (focusId && $(focusId)) $(focusId).focus(); };
    const name = $("c-name").value.trim();
    if (!name) return fail("社名を入力してください。", "c-name");
    const url = $("c-url").value.trim();
    if (url && !/^https?:\/\//i.test(url)) return fail("マイページURLは http:// または https:// から始めてください。", "c-url");
    const chk = checkStages(S.draftStages);
    if (chk.error) { setStageEditorOpen(true); $("cs-err").textContent = chk.error; return fail("選考段階の編集欄を確認してください。"); }
    const ev = eventsFromRows(S.draftEvents, fromInputs);
    if (ev.error) { $("ev-err").textContent = ev.error; return fail("「予定」の欄を確認してください。", ev.id ? `ev-date-${ev.id}` : null); }
    const stages = chk.stages;
    const stage = $("c-stage").value;
    if (!isTerm(stage) && !stages.some((s) => s.id === stage)) return fail("選考段階を選び直してください。");
    const now = new Date().toISOString();
    const old = editing();
    const history = old ? old.history.slice() : [];
    if (!old || old.stage !== stage) history.push({ stage, at: now, label: labelIn(stages, stage) });
    const rec = {
      id: old ? old.id : newId("c"),
      name, position: $("c-position").value.trim(), industry: $("c-industry").value.trim(),
      stages, stage, priority: Number($("c-priority").value) || 2,
      events: ev.events,
      url, memo: $("c-memo").value, history, updatedAt: now, example: old ? old.example : false,
      iconId: old && !S.icon.removed ? old.iconId : "",
    };
    S.busy = true; $("btn-save").disabled = true; $("form-err").textContent = "";
    let newIcon = "";
    try {
      if (S.icon.blob) { newIcon = newId("i"); await app.serial(() => putIconBlob(app.store(), newIcon, S.icon.blob)); rec.iconId = newIcon; }
      await app.saveRecord(rec);
      if (old && old.iconId && old.iconId !== rec.iconId) await app.serial(() => app.store().delIcon(old.iconId)).catch(() => {});
      closeDialog();
      await app.reload();
    } catch (err) {
      if (newIcon) app.serial(() => app.store().delIcon(newIcon)).catch(() => {});
      fail(app.errText(err));
    } finally { S.busy = false; $("btn-save").disabled = false; }
  });
  $("btn-delete").addEventListener("click", () => { $("del-confirm").hidden = false; $("btn-delete-cancel").focus(); });
  $("btn-delete-cancel").addEventListener("click", () => { $("del-confirm").hidden = true; $("btn-delete").focus(); });
  $("btn-delete-confirm").addEventListener("click", async () => {
    const c = editing(); if (!c) return;
    $("btn-delete-confirm").disabled = true;
    try { await app.deleteRecord(c); closeDialog(); await app.reload(); }
    catch (err) { $("form-err").textContent = app.errText(err); }
    finally { $("btn-delete-confirm").disabled = false; }
  });

  return { openDialog };
}
