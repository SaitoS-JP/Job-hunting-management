/* 就活ボード — entry point. All data stays on this device (IndexedDB). */
import { withEventState } from "./events.js";
import { matchesQuery, KINDS } from "./notes.js";
import { addMonths, localYmd, parseYmd } from "./calendar.js";
import { buildICS, selectForExport } from "./ics.js";
import { calendarHTML, todayState } from "./ui/calendar.js";
import { downloadBlob } from "./ui/download.js";
import { $, esc } from "./ui/html.js";
import { openStore, createMemoryStore } from "./store.js";
import { DEFAULT_STAGES, cloneStages, cleanStages, normalize, isTerm, isActive, colorAt, withStage, nextStageId, prevStageId, restoreStageId } from "./model.js";
import { p2, WD, ymd } from "./dates.js";
import { buildSamples } from "./samples.js";
import { IconCache, installIconFallback } from "./icons.js";
import { listHTML } from "./ui/list.js";
import { renderStats, renderUpcoming } from "./ui/summary.js";
import { revealCurrentSteps } from "./ui/stepper.js";
import { installEditorEvents } from "./ui/stage-editor.js";
import { initDialog } from "./ui/dialog.js";
import { initTemplatePanel, initBackupPanel } from "./ui/panels.js";

const LS = { sort: "shukatsu.sort", iosHint: "shukatsu.iosHintDismissed", view: "shukatsu.view" };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

const S = {
  mode: "loading", // loading | idb | memory
  docs: [], loaded: false,
  template: cloneStages(DEFAULT_STAGES),
  q: "", pri: "all", scope: "all", sort: "next", kind: "all",
  view: "list", cal: todayState(),
  editingId: null, busy: false,
  draftStages: [], tplDraft: [], draftEvents: [], draftES: [], draftIV: [],
  icon: { blob: null, url: "", removed: false },
  pendingImport: null,
};
{ const v = lsGet(LS.sort); if (["next", "priority", "stage", "updated"].includes(v)) S.sort = v; }
if (location.hash === "#calendar") S.view = "calendar";
else if (location.hash !== "#list" && lsGet(LS.view) === "calendar") S.view = "calendar";

let store = createMemoryStore();
const icons = new IconCache();

/* writes run one at a time */
let chain = Promise.resolve();
function serial(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }

let bc = null;
try { bc = new BroadcastChannel("shukatsu-board"); bc.onmessage = () => reload(); } catch (e) { bc = null; }
const notifyOthers = () => { try { bc && bc.postMessage("changed"); } catch (e) {} };

function errText(e) {
  if (e && e.name === "QuotaExceededError") return "端末の保存容量が足りません。不要な企業やアイコンを削除してください。";
  return "保存できませんでした。もう一度お試しください。";
}
function showErr(msg) { $("notice-err-text").textContent = msg; $("notice-err").hidden = false; }

async function reload() {
  try {
    const t = await store.getSetting("template").catch(() => undefined);
    S.template = cleanStages(t && t.stages) || cloneStages(DEFAULT_STAGES);
    S.docs = (await store.all()).map((r) => normalize(r, r.id));
    S.loaded = true;
    await icons.sync(store, S.docs.map((c) => c.iconId));
    render();
  } catch (e) { showErr("データを読み込めませんでした。ページを開き直してください。"); }
}
async function saveRecord(rec) { await serial(() => store.put(rec)); notifyOthers(); }
async function deleteRecord(c) {
  await serial(async () => { await store.del(c.id); if (c.iconId) await store.delIcon(c.iconId).catch(() => {}); });
  notifyOthers();
}
async function changeStage(c, stage) {
  if (!c || !stage || c.stage === stage) return;
  try { await saveRecord(withStage(c, stage)); await reload(); } catch (e) { showErr(errText(e)); }
}

const iconUrl = (id) => icons.get(id);
const app = { S, store: () => store, reload, render: () => render(), serial, notifyOthers, errText, saveRecord, deleteRecord, iconUrl, icsReminders: () => icsReminders() };

/* ---------- render ---------- */
function filtered() {
  return S.docs.filter((c) => {
    if (S.pri !== "all" && String(c.priority) !== S.pri) return false;
    if (S.scope === "active" && !isActive(c)) return false;
    if (S.kind !== "all" && c.kind !== S.kind) return false;
    return matchesQuery(c, S.q);
  });
}
/* 種類 filter: presets first, then free-text kinds found in the data */
function renderKindFilter() {
  const present = new Set(S.docs.map((c) => c.kind));
  const kinds = [...KINDS.filter((k) => present.has(k)), ...[...present].filter((k) => !KINDS.includes(k)).sort((a, b) => a.localeCompare(b, "ja"))];
  if (S.kind !== "all" && !present.has(S.kind)) S.kind = "all";
  const sel = $("f-kind");
  const html = `<option value="all">種類：すべて</option>` + kinds.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join("");
  if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
  sel.value = S.kind;
}
function emptyHTML() {
  if (!S.loaded) return `<div class="empty"><h2>読み込み中…</h2><p>この端末に保存された企業を読み込んでいます。</p></div>`;
  const n = S.template.length;
  const demo = S.template.map((s, i) => `<span style="--sc:${colorAt(i, n)}">${esc(s.label)}</span>`).join("");
  return `<div class="empty">
    <h2>応募した企業を、ひとつの一覧で</h2>
    <p>企業ごとに職種・コース、いまの選考段階、予定（締切・面接日）を記録すると、進み具合が矢印で並び、近い予定から順に確認できます。選考段階は企業ごとに変えられます。データはこの端末の中だけに保存されます。</p>
    <div class="pipe-demo" aria-label="選考段階の流れ">${demo}</div>
    <div class="row">
      <button type="button" class="btn primary" data-act="add">＋ 企業を追加</button>
      <button type="button" class="btn" data-act="samples">サンプルを入れて試す</button>
    </div>
    <p class="hint" style="margin-top:10px">社名と職種だけで登録でき、あとから段階や予定を足せます。サンプルはいつでも「サンプルを削除」で消せます。</p>
  </div>`;
}
function render() {
  $("notice-db").hidden = S.mode !== "memory";
  $("local-note").classList.toggle("mem", S.mode === "memory");
  const samples = S.docs.filter((c) => c.example).length;
  $("btn-del-samples").hidden = !samples;
  if (!samples) $("notice-samples").hidden = true;
  $("f-sort").value = S.sort;
  renderKindFilter();
  const cal = S.view === "calendar";
  $("view-list").setAttribute("aria-selected", String(!cal)); $("view-list").tabIndex = cal ? -1 : 0;
  $("view-cal").setAttribute("aria-selected", String(cal)); $("view-cal").tabIndex = cal ? 0 : -1;
  $("main").setAttribute("aria-labelledby", cal ? "view-cal" : "view-list");
  $("sort-wrap").hidden = cal;
  const now = new Date();
  renderStats(S.docs);
  renderUpcoming(S.docs, iconUrl, now);
  const main = $("main");
  // The calendar always opens, even with no companies yet (data is per device,
  // so a PC can be empty while the phone has data).
  if (cal) {
    const list = filtered();
    $("count-line").textContent = S.docs.length ? `${list.length} / ${S.docs.length} 社` : "";
    const hint = !S.loaded ? "" : !S.docs.length
      ? `<div class="notice cal-empty-note"><span class="grow">この端末にはまだ企業が登録されていません。企業を追加して「予定」を入れると、カレンダーに表示されます。データは端末ごとに別々なので、スマホのデータをこのパソコンで見たいときは「バックアップ」で書き出して読み込んでください。</span><button type="button" class="btn small primary" data-act="add">＋ 企業を追加</button><button type="button" class="btn small" data-act="samples">サンプルを入れて試す</button></div>`
      : "";
    main.innerHTML = hint + calendarHTML(list, S.cal, { iconUrl, now });
    return;
  }
  if (!S.docs.length) { main.innerHTML = emptyHTML(); $("count-line").textContent = ""; return; }
  const list = filtered();
  $("count-line").textContent = `${list.length} / ${S.docs.length} 社`;
  main.innerHTML = list.length ? listHTML(list, { sort: S.sort, iconUrl, now })
    : `<div class="empty"><h2>条件に一致する企業はありません</h2><p>検索語や志望度・種類・対象の絞り込みを変えてみてください。</p></div>`;
  revealCurrentSteps(main);
}

/* ---------- wiring ---------- */
installIconFallback();
installEditorEvents();
const { openDialog } = initDialog(app);
initTemplatePanel(app);
initBackupPanel(app);

async function insertSamples() {
  try { for (const rec of buildSamples(S.template)) await saveRecord(rec); await reload(); }
  catch (e) { showErr(errText(e)); }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const id = b.dataset.id, act = b.dataset.act;
  const c = id ? S.docs.find((x) => x.id === id) : null;
  if (act === "edit") openDialog(id);
  else if (act === "add") openDialog(null);
  else if (act === "samples") { b.disabled = true; insertSamples(); }
  else if (act === "cal-day") { S.cal.sel = b.dataset.day; const d = parseYmd(b.dataset.day); if (d) { S.cal.y = d.getFullYear(); S.cal.m = d.getMonth(); } render(); focusCal(`cal-${b.dataset.day}`); }
  else if (act === "cal-prev" || act === "cal-next") { moveMonth(act === "cal-prev" ? -1 : 1); focusCal(act); }
  else if (act === "cal-today") { S.cal = todayState(); render(); focusCal("cal-today"); }
  else if (!c) return;
  else if (act === "advance") changeStage(c, nextStageId(c));
  else if (act === "back") changeStage(c, prevStageId(c));
  else if (act === "restore") changeStage(c, restoreStageId(c));
  else if ((act === "rejected" || act === "declined") && !isTerm(c.stage)) changeStage(c, act);
  else if (act === "ev-done" || act === "ev-undone") markEventDone(c, b.dataset.ev, act === "ev-done");
});
async function markEventDone(c, eventId, done = true) {
  const keep = document.activeElement && document.activeElement.closest("[data-ev]") ? `[data-act][data-ev="${CSS.escape(eventId)}"]` : null;
  const next = withEventState(c, eventId, done);
  if (next === c) return;
  try {
    await saveRecord(next); await reload();
    const el = keep && document.querySelector(keep); if (el) el.focus();
  } catch (e) { showErr(errText(e)); }
}
$("btn-add").addEventListener("click", () => openDialog(null));

/* ---------- views ---------- */
function setView(v) {
  S.view = v; lsSet(LS.view, v);
  try { history.replaceState(null, "", v === "calendar" ? "#calendar" : "#list"); } catch (e) {}
  render();
}
$("view-list").addEventListener("click", () => setView("list"));
$("view-cal").addEventListener("click", () => setView("calendar"));
document.querySelector(".viewbar .tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  setView(S.view === "calendar" ? "list" : "calendar");
  $(S.view === "calendar" ? "view-cal" : "view-list").focus();
});
window.addEventListener("hashchange", () => {
  const v = location.hash === "#calendar" ? "calendar" : "list";
  if (v !== S.view) { S.view = v; lsSet(LS.view, v); render(); }
});
function moveMonth(delta) {
  const nm = addMonths(S.cal, delta);
  const now = new Date();
  const sel = nm.y === now.getFullYear() && nm.m === now.getMonth() ? localYmd(now) : localYmd(new Date(nm.y, nm.m, 1));
  S.cal = { ...nm, sel };
  render();
}
function focusCal(id) { const el = $(id); if (el) el.focus(); }
document.addEventListener("keydown", (e) => {
  const cell = e.target.closest && e.target.closest(".cal-day");
  if (!cell) return;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (!step) return;
  const d = parseYmd(cell.dataset.day); if (!d) return;
  const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step);
  S.cal = { y: n.getFullYear(), m: n.getMonth(), sel: localYmd(n) };
  render(); focusCal(`cal-${S.cal.sel}`); e.preventDefault();
});

/* ---------- header menu (phone) and .ics export ---------- */
$("btn-menu").addEventListener("click", () => {
  const open = $("btn-menu").getAttribute("aria-expanded") !== "true";
  $("btn-menu").setAttribute("aria-expanded", String(open));
  document.querySelector(".top-actions").classList.toggle("open", open);
});
for (const id of ["btn-ics", "btn-backup", "btn-tpl"]) $(id).addEventListener("click", () => {
  $("btn-menu").setAttribute("aria-expanded", "false");
  document.querySelector(".top-actions").classList.remove("open");
});
function icsReminders() {
  return ["week", "d3", "d1", "morning"].filter((k) => $(`ics-rem-${k}`).checked);
}
$("btn-ics").addEventListener("click", () => {
  const p = $("ics-panel"); p.hidden = !p.hidden;
  $("btn-ics").setAttribute("aria-expanded", String(!p.hidden));
  $("ics-msg").textContent = "";
  if (!p.hidden) { p.scrollIntoView({ block: "nearest" }); $("btn-ics-export").focus(); }
});
$("btn-ics-close").addEventListener("click", () => { $("ics-panel").hidden = true; $("btn-ics").setAttribute("aria-expanded", "false"); });
$("btn-ics-export").addEventListener("click", () => {
  const range = $("ics-range-all").checked ? "all" : "future";
  const items = selectForExport(S.docs, { range });
  if (!items.length) { $("ics-msg").textContent = "書き出せる未完了の予定がありません。"; return; }
  const ics = buildICS(items, { reminders: icsReminders() });
  downloadBlob(new Blob([ics], { type: "text/calendar;charset=utf-8" }), `shukatsu-events-${ymd(new Date())}.ics`);
  $("ics-msg").textContent = `${items.length} 件の予定を書き出しました。`;
});
$("f-kind").addEventListener("change", (e) => { S.kind = e.target.value; render(); });
let qt;
$("q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value; render(); }, 120); });
$("f-priority").addEventListener("change", (e) => { S.pri = e.target.value; render(); });
$("f-scope").addEventListener("change", (e) => { S.scope = e.target.value; render(); });
$("f-sort").addEventListener("change", (e) => { S.sort = e.target.value; lsSet(LS.sort, S.sort); render(); });
$("btn-err-close").addEventListener("click", () => { $("notice-err").hidden = true; });
$("btn-del-samples").addEventListener("click", () => {
  const n = S.docs.filter((c) => c.example).length;
  $("notice-samples-text").textContent = `サンプルの企業 ${n} 件を削除します。自分で追加した企業はそのまま残ります。`;
  $("notice-samples").hidden = false; $("btn-samples-no").focus();
});
$("btn-samples-no").addEventListener("click", () => { $("notice-samples").hidden = true; });
$("btn-samples-yes").addEventListener("click", async () => {
  const btn = $("btn-samples-yes"); btn.disabled = true;
  try { for (const c of S.docs.filter((x) => x.example)) await deleteRecord(c); $("notice-samples").hidden = true; await reload(); }
  catch (err) { showErr(errText(err)); }
  finally { btn.disabled = false; }
});

/* iOS install hint */
{
  const ua = navigator.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  if (ios && !standalone && lsGet(LS.iosHint) !== "1") $("ios-hint").hidden = false;
  $("btn-ios-hint-close").addEventListener("click", () => { $("ios-hint").hidden = true; lsSet(LS.iosHint, "1"); });
}

/* start */
const today = new Date();
$("today-line").innerHTML = `<span class="num">${today.getFullYear()}/${p2(today.getMonth() + 1)}/${p2(today.getDate())}</span>（${WD[today.getDay()]}）時点`;
render();
(async () => {
  store = await openStore();
  S.mode = store.kind;
  if (S.mode === "idb" && navigator.storage && navigator.storage.persist) {
    try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) {}
  }
  await reload();
})();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.loaded) render(); });

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    // updateViaCache "none": always check sw.js with the server, never the HTTP cache
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
      .then((reg) => {
        reg.update().catch(() => {});
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
      })
      .catch(() => {});
  });
}
