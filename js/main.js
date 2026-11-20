/* 就活ボード — entry point. All data stays on this device (IndexedDB). */
import { withEventState } from "./events.js";
import { matchesQuery, KINDS } from "./notes.js";
import { addMonths, localYmd, parseYmd } from "./calendar.js";
import { buildICS, selectForExport } from "./ics.js";
import { diffExport, planExport, cleanSnapshot, exportedChanges, acknowledgeDiff } from "./ics-sync.js";
import { compareSelection } from "./compare.js";
import { compareHTML } from "./ui/compare.js";
import { calendarHTML, todayState } from "./ui/calendar.js";
import { downloadBlob } from "./ui/download.js";
import { $, esc } from "./ui/html.js";
import { openStore, createMemoryStore } from "./store.js";
import { DEFAULT_STAGES, cloneStages, cleanStages, normalize, isTerm, isActive, isOffer, colorAt, withStage, nextStageId, prevStageId, restoreStageId } from "./model.js";
import { p2, WD, ymd, fmtFull, fmtDate } from "./dates.js";
import { backupReminder } from "./backup.js";
import { buildSamples } from "./samples.js";
import { IconCache, installIconFallback } from "./icons.js";
import { listHTML } from "./ui/list.js";
import { renderStats, renderUpcoming } from "./ui/summary.js";
import { revealCurrentSteps } from "./ui/stepper.js";
import { installEditorEvents } from "./ui/stage-editor.js";
import { initDialog } from "./ui/dialog.js";
import { initTemplatePanel, initBackupPanel } from "./ui/panels.js";

const LS = { sort: "shukatsu.sort", iosHint: "shukatsu.iosHintDismissed", view: "shukatsu.view", backupSnooze: "shukatsu.backupSnoozeUntil", obDismissed: "shukatsu.onboardDismissed", icsDismiss: "shukatsu.icsHintDismissed", obDoneSeen: "shukatsu.onboardDoneSeen" };
import { renderOnboarding } from "./ui/onboarding-card.js";
import { createTour } from "./ui/tour.js";
import { latestOwnCompany } from "./onboarding.js";
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
const VIEWS = { list: "#list", calendar: "#calendar", compare: "#compare" };
const VIEW_TAB = { list: "view-list", calendar: "view-cal", compare: "view-cmp" };
const viewFromHash = () => Object.keys(VIEWS).find((v) => VIEWS[v] === location.hash) || null;
S.view = viewFromHash() || (VIEWS[lsGet(LS.view)] ? lsGet(LS.view) : "list");
S.icsExport = cleanSnapshot(null);
S.compareIds = null; // null = default selection
S.cmpPicker = false;

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
    S.lastBackupAt = (await store.getSetting("lastBackupAt").catch(() => "")) || "";
    S.icsExport = cleanSnapshot(await store.getSetting("icsExport").catch(() => null));
    const ids = await store.getSetting("compareIds").catch(() => null);
    S.compareIds = Array.isArray(ids) ? ids.filter((x) => typeof x === "string").slice(0, 50) : null;
    S.loaded = true;
    await icons.sync(store, S.docs.map((c) => c.iconId));
    render();
  } catch (e) { showErr("データを読み込めませんでした。ページを開き直してください。"); }
}
async function saveRecord(rec) {
  const before = S.docs.find((c) => c.id === rec.id) || null;
  hideChangeNotice();
  await serial(() => store.put(rec)); notifyOthers();
  if (before) noteExportChanges(before, normalize(rec, rec.id));
}
async function deleteRecord(c) {
  hideChangeNotice();
  await serial(async () => { await store.del(c.id); if (c.iconId) await store.delIcon(c.iconId).catch(() => {}); });
  notifyOthers();
  noteExportChanges(c, null);
}

/* ---------- 書き出し済みの予定が変わったときのお知らせ ---------- */
const pendingChanges = [];
function noteExportChanges(before, after) {
  const ch = exportedChanges(before, after, S.icsExport);
  if (!ch.length) return;
  pendingChanges.push(...ch);
  showChangeNotice(pendingChanges);
}
function hideChangeNotice() { pendingChanges.length = 0; $("change-notice").hidden = true; }
function showChangeNotice(list) {
  const fmt = (iso) => fmtDate(new Date(iso));
  const lines = list.slice(0, 2).map((x) => x.type === "changed"
    ? `書き出し済みの予定が変わりました：${fmt(x.before.at)} ${x.before.label} → ${fmt(x.after.at)}${x.after.label !== x.before.label ? ` ${x.after.label}` : ""}（${x.before.company}）`
    : `${x.before.company}の「${x.before.label}」（${fmt(x.before.at)}）の予定がなくなりました（${x.reason}）`);
  if (list.length > 2) lines.push(`ほか ${list.length - 2}件`);
  const tips = [];
  if (list.some((x) => x.type === "changed")) tips.push("iPhone などのカレンダーに取り込んだ予定は自動では変わりません。カレンダー側の予定も確認してください。");
  if (list.some((x) => x.type === "removed")) tips.push("カレンダー側の予定は残っています。不要なら削除してください。");
  const p = (cls, t) => Object.assign(document.createElement("p"), { className: cls, textContent: t });
  $("cn-body").replaceChildren(...lines.map((t) => p("cn-line", t)), ...tips.map((t) => p("cn-tip", t)));
  $("change-notice").hidden = false;
}
$("btn-cn-close").addEventListener("click", () => hideChangeNotice());
$("btn-cn-open").addEventListener("click", () => { hideChangeNotice(); openIcsPanel(true); });
async function changeStage(c, stage) {
  if (!c || !stage || c.stage === stage) return;
  try { await saveRecord(withStage(c, stage)); await reload(); } catch (e) { showErr(errText(e)); }
}

const iconUrl = (id) => icons.get(id);
const UA = navigator.userAgent || "";
const IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const STANDALONE = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const OB = { forced: false, doneSeenAtLoad: lsGet(LS.obDoneSeen) === "1", visible: false };

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
  const demo = S.template.map((s, i) => `<span style="--sc:${colorAt(i, S.template)}">${esc(s.label)}</span>`).join("");
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
  const cal = S.view === "calendar", cmp = S.view === "compare";
  for (const [v, id] of Object.entries(VIEW_TAB)) { $(id).setAttribute("aria-selected", String(S.view === v)); $(id).tabIndex = S.view === v ? 0 : -1; }
  $("main").setAttribute("aria-labelledby", VIEW_TAB[S.view]);
  $("sort-wrap").hidden = cal;
  document.querySelector(".toolbar").hidden = cmp; // the comparison has its own picker
  const now = new Date();
  renderBackupReminder(now);
  renderFirstRun();
  renderIcsHint(now);
  renderStats(S.docs);
  renderUpcoming(S.docs, iconUrl, now);
  const main = $("main");
  if (cmp) {
    const selectedIds = compareSelection(S.docs, S.compareIds, isOffer);
    main.innerHTML = compareHTML(S.docs, { selectedIds, pickerOpen: S.cmpPicker }, { iconUrl });
    return;
  }
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

/* 「はじめかた」: while the card is shown, the install hint and backup banner
   stay hidden (its last step covers both). */
function renderFirstRun() {
  if (!S.loaded) { $("onboard").hidden = true; return; }
  const ob = renderOnboarding({
    companies: S.docs, lastBackupAt: S.lastBackupAt, ios: IOS, standalone: STANDALONE,
    dismissed: lsGet(LS.obDismissed) === "1", doneSeen: OB.doneSeenAtLoad, forced: OB.forced,
  }, { hasSamples: S.docs.some((c) => c.example) });
  OB.visible = ob.visible;
  if (ob.visible && ob.all) lsSet(LS.obDoneSeen, "1");
  $("ios-hint").hidden = !(IOS && !STANDALONE && lsGet(LS.iosHint) !== "1" && !ob.visible);
  if (ob.visible) $("notice-backup").hidden = true;
}
function renderBackupReminder(now) {
  const last = S.lastBackupAt ? new Date(S.lastBackupAt) : null;
  $("backup-last").textContent = last && !isNaN(last) ? `前回の書き出し：${fmtFull(last)}` : "まだ書き出していません";
  const r = S.loaded ? backupReminder({ companies: S.docs, lastBackupAt: S.lastBackupAt, snoozeUntil: lsGet(LS.backupSnooze) || "", now }) : null;
  $("notice-backup").hidden = !r;
  if (r) $("notice-backup-text").textContent = r.never
    ? "まだバックアップを書き出していません。データはこの端末の中にしかないため、端末の故障やブラウザのデータ削除で消えてしまいます。"
    : `最後のバックアップから${r.days}日たち、その後に変更があります。念のため書き出しておきましょう。`;
}

/* ---------- wiring ---------- */
installIconFallback();
installEditorEvents();
const { openDialog } = initDialog(app);
const tour = createTour({
  hasCompanies: () => S.docs.length > 0,
  insertSamples: () => insertSamples(),
  beforeStart: () => { closeMenu(); if (S.view !== "list") setView("list"); },
  fallbackFocus: () => $("btn-menu").focus(),
});
initTemplatePanel(app);
initBackupPanel(app);
$("btn-backup-now").addEventListener("click", () => app.exportBackup && app.exportBackup());
$("btn-backup-later").addEventListener("click", () => {
  lsSet(LS.backupSnooze, new Date(Date.now() + 3 * 86400000).toISOString());
  $("notice-backup").hidden = true;
});

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
  else if (act === "cmp-picker" || act === "cmp-picker-open") { S.cmpPicker = act === "cmp-picker-open" ? true : !S.cmpPicker; render(); const f = S.cmpPicker && $("cmp-picker").querySelector("button"); (f || $("btn-cmp-pick")).focus(); }
  else if (act === "cmp-toggle") {
    const cur = compareSelection(S.docs, S.compareIds, isOffer);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    saveCompareIds(next).then(() => { const el = $("cmp-picker").querySelector(`[data-id="${CSS.escape(id)}"]`); if (el) el.focus(); });
  }
  else if (act === "cmp-open") openDialog(id, null, { tab: "cond" });
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
  try { history.replaceState(null, "", VIEWS[v]); } catch (e) {}
  render();
}
$("view-list").addEventListener("click", () => setView("list"));
$("view-cal").addEventListener("click", () => setView("calendar"));
$("view-cmp").addEventListener("click", () => setView("compare"));
document.querySelector(".viewbar .tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const order = Object.keys(VIEWS);
  const i = order.indexOf(S.view);
  const v = order[(i + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
  setView(v); $(VIEW_TAB[v]).focus();
});
window.addEventListener("hashchange", () => {
  const v = viewFromHash() || "list";
  if (v !== S.view) { S.view = v; lsSet(LS.view, v); render(); }
});

/* ---------- 比較 ---------- */
async function saveCompareIds(ids) {
  S.compareIds = ids;
  render();
  try { await serial(() => store.putSetting("compareIds", ids)); } catch (e) { showErr(errText(e)); }
}
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
function closeMenu() {
  $("btn-menu").setAttribute("aria-expanded", "false");
  document.querySelector(".top-actions").classList.remove("open");
}
$("btn-menu").addEventListener("click", () => {
  const open = $("btn-menu").getAttribute("aria-expanded") !== "true";
  $("btn-menu").setAttribute("aria-expanded", String(open));
  document.querySelector(".top-actions").classList.toggle("open", open);
  if (open) $("btn-ics").focus();
});
document.addEventListener("click", (e) => {
  if ($("btn-menu").getAttribute("aria-expanded") === "true" && !e.target.closest(".top-actions")) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("btn-menu").getAttribute("aria-expanded") === "true") { closeMenu(); $("btn-menu").focus(); }
});
for (const id of ["btn-ics", "btn-backup", "btn-tpl", "btn-onboard", "btn-tour", "btn-help"]) $(id).addEventListener("click", () => {
  $("btn-menu").setAttribute("aria-expanded", "false");
  document.querySelector(".top-actions").classList.remove("open");
});
function icsReminders() {
  return ["week", "d3", "d1", "morning"].filter((k) => $(`ics-rem-${k}`).checked);
}
function openIcsPanel(open = $("ics-panel").hidden) {
  const p = $("ics-panel"); p.hidden = !open;
  $("btn-ics").setAttribute("aria-expanded", String(open));
  $("ics-msg").textContent = "";
  if (open) { renderIcsDiff(); p.scrollIntoView({ block: "nearest" }); $(S.icsExport.at ? "btn-ics-new" : "btn-ics-export").focus(); }
}
$("btn-ics").addEventListener("click", () => openIcsPanel());
$("btn-ics-close").addEventListener("click", () => { $("ics-panel").hidden = true; $("btn-ics").setAttribute("aria-expanded", "false"); });
/* .ics export with a record of what was exported (see ics-sync.js) */
function exportIcs(items, mode, message) {
  const plan = planExport(items, S.icsExport, { mode });
  const ics = buildICS(items, { reminders: icsReminders(), seq: plan.seq });
  downloadBlob(new Blob([ics], { type: "text/calendar;charset=utf-8" }), `shukatsu-events-${ymd(new Date())}.ics`);
  saveIcsSnapshot(plan.snapshot);
  $("ics-msg").textContent = message;
}
function saveIcsSnapshot(snap) {
  S.icsExport = cleanSnapshot(snap);
  serial(() => store.putSetting("icsExport", S.icsExport)).catch(() => {});
  render();
}
app.saveIcsSnapshot = saveIcsSnapshot;
$("btn-ics-export").addEventListener("click", () => {
  const range = $("ics-range-all").checked ? "all" : "future";
  const items = selectForExport(S.docs, { range });
  if (!items.length) { $("ics-msg").textContent = "書き出せる未完了の予定がありません。"; return; }
  exportIcs(items, "full", `${items.length} 件の予定を書き出しました。前に取り込んだものがあるときは、専用カレンダーを作り直してから取り込んでください。`);
});
$("btn-ics-new").addEventListener("click", () => {
  const d = diffExport(S.docs, S.icsExport);
  const items = d.added.map(({ company, event }) => ({ company, event }));
  if (!items.length) { $("ics-msg").textContent = "新しい予定はありません。"; return; }
  exportIcs(items, "merge", `新しい予定 ${items.length} 件を書き出しました。前回と同じカレンダーに取り込めば、重複しません。`);
});
const fmtAt = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? fmtDate(d) : "—"; };
function diffList(title, list, line) {
  if (!list.length) return "";
  return `<details class="ics-dl"><summary>${title}（${list.length}件）</summary><ul>${list.map((x) => `<li>${line(x)}</li>`).join("")}</ul></details>`;
}
function renderIcsDiff() {
  const box = $("ics-diff");
  const d = diffExport(S.docs, S.icsExport);
  if (!d.exported) {
    box.innerHTML = `<p class="ics-sum">まだ書き出していません。はじめは「すべて書き出す」を、専用のカレンダーに取り込むのがおすすめです（下の「取り込み方」）。</p>`;
    $("btn-ics-new").hidden = true;
    return;
  }
  $("btn-ics-new").hidden = false;
  const minor = d.changed.filter((x) => !x.major).length;
  const parts = [`新しい予定 ${d.added.length}件`, `変更 ${d.changed.length - minor}件`, `なくなった予定 ${d.removed.length}件`];
  const ev = (x) => `${esc(fmtAt(x.fp.at))}　${esc(x.fp.company)}｜${esc(x.fp.label)}`;
  const changedLine = (x) => x.major
    ? `${esc(x.fp.company)}：${esc(fmtAt(x.before.at))} ${esc(x.before.label)} → <b>${esc(fmtAt(x.fp.at))} ${esc(x.fp.label)}</b>`
    : `${ev(x)}（説明欄のみ：選考段階など）`;
  const advice = d.notable
    ? `<p class="ics-adv">取り込み済みの予定は自動では変わりません。日時の変更やなくなった予定を反映するには、専用カレンダーを作り直して「すべて書き出す」を取り込むか、カレンダーアプリで直接直してください。</p>
       <p class="row"><button type="button" class="btn small" data-act="ics-ack">カレンダー側も直したので、確認済みにする</button></p>`
    : d.added.length ? `<p class="ics-adv ok">追加だけなので「新しい予定だけ書き出す」で大丈夫です（重複しません）。</p>` : `<p class="ics-adv ok">カレンダーに取り込んだ内容と同じです。</p>`;
  box.innerHTML = `<p class="ics-sum">前回の書き出し（${esc(fmtFull(new Date(S.icsExport.at)))}）以降：${parts.join("・")}${minor ? `<span class="hint">（ほかに説明欄だけの変更 ${minor}件）</span>` : ""}</p>
    ${diffList("新しい予定", d.added, ev)}
    ${diffList("変更", d.changed, changedLine)}
    ${diffList("なくなった予定（削除・完了・不合格/辞退）", d.removed, (x) => `${esc(fmtAt(x.before.at))}　${esc(x.before.company)}｜${esc(x.before.label)}`)}
    ${advice}`;
}
/* small line on the main screen when the calendar copy is out of date */
function renderIcsHint(now) {
  const el = $("notice-ics");
  if (!S.loaded || !S.icsExport.at || OB.visible) { el.hidden = true; return; }
  const d = diffExport(S.docs, S.icsExport, now);
  const sig = [...d.changed.filter((x) => x.major).map((x) => x.uid + x.fp.k), ...d.removed.map((x) => x.uid)].sort().join("|");
  el.hidden = !d.notable || lsGet(LS.icsDismiss) === sig;
  el.dataset.sig = sig;
  if (!el.hidden) $("notice-ics-text").textContent = `カレンダーに取り込んだ予定と違いがあります（${d.notable}件）。カレンダー側の予定も確認してください。`;
  if (!$("ics-panel").hidden) renderIcsDiff();
}
$("btn-ics-check").addEventListener("click", () => openIcsPanel(true));
function acknowledgeIcs() {
  const before = diffExport(S.docs, S.icsExport).notable;
  S.icsExport = acknowledgeDiff(S.docs, S.icsExport);
  serial(() => store.putSetting("icsExport", S.icsExport)).catch(() => {});
  $("notice-ics").hidden = true;
  render();
  if (!$("ics-panel").hidden) { renderIcsDiff(); $("ics-msg").textContent = before ? `${before}件の違いを確認済みにしました。` : ""; }
}
$("btn-ics-ack").addEventListener("click", acknowledgeIcs);
document.addEventListener("click", (e) => { if (e.target.closest('[data-act="ics-ack"]')) acknowledgeIcs(); });
$("btn-ics-dismiss").addEventListener("click", () => { lsSet(LS.icsDismiss, $("notice-ics").dataset.sig || ""); $("notice-ics").hidden = true; });
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

/* ---------- 「就活ボード」(title) → home ----------
   Closes the menu, every panel, the change sheet and the tour, drops a
   half-finished import, switches to 一覧 and scrolls to the top. Search and
   filters stay. An open dialog is modal, so the title cannot be tapped then;
   unsaved edits are never discarded from here. */
const PANELS = [["backup-panel", "btn-backup"], ["ics-panel", "btn-ics"], ["tpl-panel", "btn-tpl"], ["help-panel", "btn-help"]];
function goHome() {
  closeMenu();
  for (const [panel, btn] of PANELS) { $(panel).hidden = true; $(btn).setAttribute("aria-expanded", "false"); }
  hideChangeNotice();
  if (app.resetBackupUI) app.resetBackupUI();
  if (tour.isOpen()) tour.end();
  S.cmpPicker = false;
  setView("list");
  window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  $("home-link").focus({ preventScroll: true });
}
$("home-link").addEventListener("click", (e) => { e.preventDefault(); goHome(); });

/* iOS install hint (shown by renderFirstRun once the checklist is out of the way) */
$("btn-ios-hint-close").addEventListener("click", () => { $("ios-hint").hidden = true; lsSet(LS.iosHint, "1"); });

/* ---------- はじめかた / ツアー / 使い方 ---------- */
function obMsg(id, text) { const m = $(`ob-msg-${id}`); if (m) m.textContent = text; }
function showAdvanceButton() {
  if (!S.docs.some((c) => !c.example)) { obMsg("advance", "先に企業を1社登録してください。"); return; }
  if (S.view !== "list") setView("list");
  S.q = ""; $("q").value = ""; S.pri = "all"; $("f-priority").value = "all"; S.kind = "all"; S.scope = "all"; $("f-scope").value = "all";
  render();
  const btn = $("main").querySelector('[data-act="advance"]');
  if (!btn) { obMsg("advance", "「次へ →」は選考中の企業の行に表示されます。"); return; }
  btn.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  btn.classList.add("spot"); btn.focus({ preventScroll: true });
  setTimeout(() => btn.classList.remove("spot"), 3000);
}
$("onboard").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ob], #btn-ob-close");
  if (!b) return;
  if (b.id === "btn-ob-close") { lsSet(LS.obDismissed, "1"); OB.forced = false; render(); $("btn-add").focus(); return; }
  const k = b.dataset.ob;
  if (k === "add") openDialog(null);
  else if (k === "event") {
    const c = latestOwnCompany(S.docs);
    if (c) openDialog(c.id, null, { tab: "events" });
    else { openDialog(null); setTimeout(() => $("c-first-date").focus(), 0); }
  } else if (k === "advance") showAdvanceButton();
  else if (k === "protect") { if (app.exportBackup) app.exportBackup(); }
  else if (k === "samples") { b.disabled = true; insertSamples(); }
  else if (k === "tour") tour.start();
});
function openChecklist() {
  OB.forced = true; lsSet(LS.obDismissed, ""); render();
  $("onboard").scrollIntoView({ block: "start" });
  const t = $("ob-title"); if (t) { t.tabIndex = -1; t.focus(); }
}
function toggleHelp(open = $("help-panel").hidden) {
  $("help-panel").hidden = !open;
  $("btn-help").setAttribute("aria-expanded", String(open));
  if (open) { $("help-panel").scrollIntoView({ block: "nearest" }); $("help-panel").querySelector("summary").focus(); }
}
$("btn-onboard").addEventListener("click", openChecklist);
$("btn-tour").addEventListener("click", () => tour.start());
$("btn-help").addEventListener("click", () => toggleHelp());
$("btn-help-close").addEventListener("click", () => { toggleHelp(false); $("btn-menu").focus(); });
$("help-panel").addEventListener("click", (e) => {
  const b = e.target.closest("[data-help]"); if (!b) return;
  const k = b.dataset.help;
  if (k === "onboard") openChecklist();
  else if (k === "tour") tour.start();
  else if (k === "backup") { if ($("backup-panel").hidden) $("btn-backup").click(); $("backup-panel").scrollIntoView({ block: "nearest" }); }
  else if (k === "ics") openIcsPanel(true);
  else if (k === "compare") { toggleHelp(false); setView("compare"); $("view-cmp").focus(); }
  else if (k === "tpl") { if ($("tpl-panel").hidden) $("btn-tpl").click(); }
});

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
