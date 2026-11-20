/* 就活ボード — entry point. All data stays on this device (IndexedDB). */
import { $, esc } from "./ui/html.js";
import { openStore, createMemoryStore } from "./store.js";
import { DEFAULT_STAGES, cloneStages, cleanStages, normalize, isTerm, isActive, colorAt, withStage, nextStageId, prevStageId, restoreStageId } from "./model.js";
import { p2, WD } from "./dates.js";
import { buildSamples } from "./samples.js";
import { IconCache, installIconFallback } from "./icons.js";
import { listHTML } from "./ui/list.js";
import { renderStats, renderUpcoming } from "./ui/summary.js";
import { revealCurrentSteps } from "./ui/stepper.js";
import { installEditorEvents } from "./ui/stage-editor.js";
import { initDialog } from "./ui/dialog.js";
import { initTemplatePanel, initBackupPanel } from "./ui/panels.js";

const LS = { sort: "shukatsu.sort", iosHint: "shukatsu.iosHintDismissed" };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

const S = {
  mode: "loading", // loading | idb | memory
  docs: [], loaded: false,
  template: cloneStages(DEFAULT_STAGES),
  q: "", pri: "all", scope: "all", sort: "next",
  editingId: null, busy: false,
  draftStages: [], tplDraft: [], draftEvents: [],
  icon: { blob: null, url: "", removed: false },
  pendingImport: null,
};
{ const v = lsGet(LS.sort); if (["next", "priority", "stage", "updated"].includes(v)) S.sort = v; }

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
const app = { S, store: () => store, reload, render: () => render(), serial, notifyOthers, errText, saveRecord, deleteRecord, iconUrl };

/* ---------- render ---------- */
function filtered() {
  const q = S.q.trim().toLowerCase();
  return S.docs.filter((c) => {
    if (S.pri !== "all" && String(c.priority) !== S.pri) return false;
    if (S.scope === "active" && !isActive(c)) return false;
    if (q && !(`${c.name} ${c.position} ${c.industry}`.toLowerCase().includes(q))) return false;
    return true;
  });
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
  const now = new Date();
  renderStats(S.docs);
  renderUpcoming(S.docs, iconUrl, now);
  const main = $("main");
  if (!S.docs.length) { main.innerHTML = emptyHTML(); $("count-line").textContent = ""; return; }
  const list = filtered();
  $("count-line").textContent = `${list.length} / ${S.docs.length} 社`;
  main.innerHTML = list.length ? listHTML(list, { sort: S.sort, iconUrl, now })
    : `<div class="empty"><h2>条件に一致する企業はありません</h2><p>検索語や志望度・対象の絞り込みを変えてみてください。</p></div>`;
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
  else if (!c) return;
  else if (act === "advance") changeStage(c, nextStageId(c));
  else if (act === "back") changeStage(c, prevStageId(c));
  else if (act === "restore") changeStage(c, restoreStageId(c));
  else if ((act === "rejected" || act === "declined") && !isTerm(c.stage)) changeStage(c, act);
});
$("btn-add").addEventListener("click", () => openDialog(null));
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
  window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
}
