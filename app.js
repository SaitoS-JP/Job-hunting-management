/* 就活ボード — standalone app. All data stays on this device (IndexedDB). */
(() => {
  "use strict";
  /* Default stage list. The old fixed keys are kept as ids so records saved
     before per-company stages existed keep working unchanged. */
  const DEFAULT_STAGES = [
    { id: "interest", label: "気になる" },
    { id: "entry", label: "エントリー" },
    { id: "es", label: "ES・書類選考" },
    { id: "test", label: "適性検査・Webテスト" },
    { id: "gd", label: "GD・一次面接" },
    { id: "interview2", label: "二次面接" },
    { id: "final", label: "最終面接" },
    { id: "offer", label: "内定" },
  ];
  const DEFAULT_LABEL = Object.fromEntries(DEFAULT_STAGES.map((s) => [s.id, s.label]));
  const TERM_LABEL = { rejected: "不合格", declined: "辞退" };
  const isTerm = (k) => k === "rejected" || k === "declined";
  const PALETTE = ["interest", "entry", "es", "test", "gd", "interview2", "final"];
  const PRI = { 1: "第一志望群", 2: "第二志望群", 3: "第三志望群" };
  const WD = "日月火水木金土";
  const LS = { sort: "shukatsu.sort", iosHint: "shukatsu.iosHintDismissed" };
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const STAGE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
  const MAX_LABEL = 16;
  const MAX_STAGES = 30;
  const BACKUP_VERSION = 2;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const cloneStages = (a) => a.map((s) => ({ id: s.id, label: s.label }));

  const S = {
    mode: "loading", // loading | idb | memory
    docs: [], loaded: false,
    template: cloneStages(DEFAULT_STAGES),
    q: "", pri: "all", scope: "all", sort: "next",
    editingId: null, busy: false,
    draftStages: [], tplDraft: [],
    icon: { blob: null, url: "", removed: false },
    iconUrls: new Map(), // iconId -> objectURL
    pendingImport: null,
  };
  { const v = lsGet(LS.sort); if (["next", "priority", "stage", "updated"].includes(v)) S.sort = v; }

  /* ================= storage (IndexedDB, in-memory fallback) ================= */
  const Store = (() => {
    let db = null; let mem = null;
    const clone = (o) => JSON.parse(JSON.stringify(o));
    function open() {
      return new Promise((resolve, reject) => {
        if (!("indexedDB" in window) || !window.indexedDB) return reject(new Error("no indexedDB"));
        let req;
        try { req = indexedDB.open("shukatsu-board", 2); } catch (e) { return reject(e); }
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains("companies")) d.createObjectStore("companies", { keyPath: "id" });
          if (!d.objectStoreNames.contains("icons")) d.createObjectStore("icons");
          if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error("blocked"));
      });
    }
    function run(stores, mode, fn) {
      return new Promise((resolve, reject) => {
        let t;
        try { t = db.transaction(stores, mode); } catch (e) { return reject(e); }
        let out;
        const r = fn(t);
        if (r && "onsuccess" in r) r.onsuccess = () => { out = r.result; };
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error("abort"));
      });
    }
    return {
      async init() {
        try {
          db = await open();
          // probe a write so private modes that open-but-fail are caught early
          await run(["settings"], "readwrite", (t) => t.objectStore("settings").put(1, "__probe"));
          await run(["settings"], "readwrite", (t) => t.objectStore("settings").delete("__probe"));
          db.onversionchange = () => { try { db.close(); } catch (e) {} };
          return "idb";
        } catch (e) {
          db = null; mem = { companies: new Map(), icons: new Map(), settings: new Map() };
          return "memory";
        }
      },
      async all() {
        if (mem) return [...mem.companies.values()].map(clone);
        return (await run(["companies"], "readonly", (t) => t.objectStore("companies").getAll())) || [];
      },
      async put(rec) {
        if (mem) { mem.companies.set(rec.id, clone(rec)); return; }
        await run(["companies"], "readwrite", (t) => t.objectStore("companies").put(rec));
      },
      async del(id) {
        if (mem) { mem.companies.delete(id); return; }
        await run(["companies"], "readwrite", (t) => t.objectStore("companies").delete(id));
      },
      async getSetting(key) {
        if (mem) { const v = mem.settings.get(key); return v === undefined ? undefined : clone(v); }
        return run(["settings"], "readonly", (t) => t.objectStore("settings").get(key));
      },
      async putSetting(key, value) {
        if (mem) { mem.settings.set(key, clone(value)); return; }
        await run(["settings"], "readwrite", (t) => t.objectStore("settings").put(value, key));
      },
      async getIcon(id) {
        const v = mem ? mem.icons.get(id) : await run(["icons"], "readonly", (t) => t.objectStore("icons").get(id));
        if (!v) return null;
        if (v instanceof Blob) return v;
        if (v.data) return new Blob([v.data], { type: v.type || "image/png" });
        return null;
      },
      async putIcon(id, blob) {
        // stored as ArrayBuffer + type: avoids Blob-in-IndexedDB quirks on older Safari
        const data = await blob.arrayBuffer();
        const v = { type: blob.type || "image/png", data };
        if (mem) { mem.icons.set(id, v); return; }
        await run(["icons"], "readwrite", (t) => t.objectStore("icons").put(v, id));
      },
      async delIcon(id) {
        if (!id) return;
        if (mem) { mem.icons.delete(id); return; }
        await run(["icons"], "readwrite", (t) => t.objectStore("icons").delete(id));
      },
      async clearAll() {
        if (mem) { mem.companies.clear(); mem.icons.clear(); return; }
        await run(["companies", "icons"], "readwrite", (t) => { t.objectStore("companies").clear(); t.objectStore("icons").clear(); });
      },
    };
  })();

  // other open tabs/windows of the app reload when data changes
  let bc = null;
  try { bc = new BroadcastChannel("shukatsu-board"); bc.onmessage = () => reload(); } catch (e) { bc = null; }
  const notifyOthers = () => { try { bc && bc.postMessage("changed"); } catch (e) {} };

  /* ================= dates ================= */
  function parseDate(iso) { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : d; }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function dayDiff(d) { return Math.round((dayStart(d) - dayStart(new Date())) / 86400000); }
  function hasTime(d) { return d.getHours() !== 0 || d.getMinutes() !== 0; }
  const p2 = (n) => String(n).padStart(2, "0");
  function fmtDate(d, withTime = true) {
    let s = `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
    if (withTime && hasTime(d)) s += ` ${d.getHours()}:${p2(d.getMinutes())}`;
    return s;
  }
  function fmtShort(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }
  function fmtFull(d) { return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`; }
  function dueBadge(d) {
    const n = dayDiff(d);
    if (n < 0) return `<span class="due past">期限切れ</span>`;
    if (n === 0) return `<span class="due today">今日</span>`;
    if (n === 1) return `<span class="due soon">明日</span>`;
    if (n <= 3) return `<span class="due soon">あと<span class="num">${n}</span>日</span>`;
    return `<span class="due">あと<span class="num">${n}</span>日</span>`;
  }

  /* ================= stages ================= */
  function newId(prefix) {
    const a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else a.forEach((_, i) => (a[i] = Math.random() * 256));
    return prefix + Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
  }
  const stageId = () => newId("s").slice(0, 9);
  /* Validate a stage list; returns null when nothing usable remains. */
  function cleanStages(arr) {
    if (!Array.isArray(arr)) return null;
    const seen = new Set(); const out = [];
    for (const s of arr) {
      if (!s || typeof s !== "object") continue;
      const label = typeof s.label === "string" ? s.label.trim().slice(0, MAX_LABEL) : "";
      if (!label) continue;
      let id = typeof s.id === "string" && STAGE_ID_RE.test(s.id) && !isTerm(s.id) ? s.id : stageId();
      while (seen.has(id)) id = stageId();
      seen.add(id); out.push({ id, label });
      if (out.length >= MAX_STAGES) break;
    }
    return out.length ? out : null;
  }
  function labelIn(stages, id) {
    const s = stages.find((x) => x.id === id);
    if (s) return s.label;
    return TERM_LABEL[id] || DEFAULT_LABEL[id] || String(id || "");
  }
  /* Position colours from the stage palette; the last stage keeps the offer green. */
  function colorAt(i, n) {
    if (i < 0) return "var(--st-interest)";
    if (i === n - 1) return "var(--st-offer)";
    return `var(--st-${PALETTE[i % PALETTE.length]})`;
  }
  const termColor = (k) => (k === "rejected" ? "var(--st-rejected)" : "var(--st-declined)");
  /* Index reached in `stages`: the current stage, or for an ended company the
     most recent non-terminal history entry that still exists in the list. */
  function reachedFrom(stages, stage, history) {
    if (!isTerm(stage)) return stages.findIndex((s) => s.id === stage);
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (isTerm(h.stage)) continue;
      const k = stages.findIndex((s) => s.id === h.stage);
      if (k >= 0) return k;
    }
    return -1;
  }
  const reached = (c) => reachedFrom(c.stages, c.stage, c.history);
  const stageIndex = (c) => (isTerm(c.stage) ? -1 : c.stages.findIndex((s) => s.id === c.stage));
  const atLast = (c) => !isTerm(c.stage) && stageIndex(c) === c.stages.length - 1;
  const stageLabel = (c) => labelIn(c.stages, c.stage);
  const stageColor = (c) => (isTerm(c.stage) ? termColor(c.stage) : colorAt(stageIndex(c), c.stages.length));
  function progressRatio(c) {
    if (c.stage === "rejected") return -1;
    if (c.stage === "declined") return -2;
    const n = c.stages.length;
    return n > 1 ? stageIndex(c) / (n - 1) : 1;
  }

  /* ================= data ================= */
  function normalize(d, idOverride) {
    d = d && typeof d === "object" ? d : {};
    const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
    const id = idOverride || (typeof d.id === "string" && ID_RE.test(d.id) ? d.id : newId("c"));
    // migration: records without their own stage list get the default 8 (old keys)
    const stages = cleanStages(d.stages) || cloneStages(DEFAULT_STAGES);
    let stage = typeof d.stage === "string" ? d.stage : "";
    if (!isTerm(stage) && !stages.some((s) => s.id === stage)) stage = stages[0].id;
    const pr = Number(d.priority);
    const history = Array.isArray(d.history)
      ? d.history.filter((h) => h && typeof h === "object" && typeof h.stage === "string" && h.stage)
          .map((h) => ({
            stage: h.stage.slice(0, 32),
            at: typeof h.at === "string" ? h.at : "",
            label: typeof h.label === "string" && h.label.trim() ? h.label.trim().slice(0, MAX_LABEL) : labelIn(stages, h.stage),
          })).slice(-200)
      : [];
    return {
      id,
      name: str(d.name, 80),
      position: str(d.position, 80),
      industry: str(d.industry, 40),
      stages, stage,
      priority: pr === 1 || pr === 2 || pr === 3 ? pr : 2,
      nextDate: typeof d.nextDate === "string" && parseDate(d.nextDate) ? d.nextDate : "",
      nextLabel: str(d.nextLabel, 40),
      url: typeof d.url === "string" && /^https?:\/\//i.test(d.url) ? d.url.slice(0, 2000) : "",
      memo: str(d.memo, 4000),
      history,
      updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
      example: d.example === true,
      iconId: typeof d.iconId === "string" && ID_RE.test(d.iconId) ? d.iconId : "",
    };
  }
  const byId = (id) => S.docs.find((c) => c.id === id);
  function filtered() {
    const q = S.q.trim().toLowerCase();
    return S.docs.filter((c) => {
      if (S.pri !== "all" && String(c.priority) !== S.pri) return false;
      if (S.scope === "active" && (isTerm(c.stage) || atLast(c))) return false;
      if (q && !(`${c.name} ${c.position} ${c.industry}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }
  function nextTime(c) { const d = parseDate(c.nextDate); return d ? d.getTime() : Infinity; }
  function cmpCard(a, b) { return nextTime(a) - nextTime(b) || a.priority - b.priority || a.name.localeCompare(b.name, "ja"); }

  async function reload() {
    try {
      const t = await Store.getSetting("template").catch(() => undefined);
      S.template = cleanStages(t && t.stages) || cloneStages(DEFAULT_STAGES);
      const rows = await Store.all();
      S.docs = rows.map((r) => normalize(r, r.id));
      S.loaded = true;
      await syncIconUrls();
      render();
    } catch (e) {
      showErr("データを読み込めませんでした。ページを開き直してください。");
    }
  }

  /* writes: simple async/await, one at a time */
  let chain = Promise.resolve();
  function serial(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }
  function errText(e) {
    const n = e && (e.name || "");
    if (n === "QuotaExceededError") return "端末の保存容量が足りません。不要な企業やアイコンを削除してください。";
    return "保存できませんでした。もう一度お試しください。";
  }
  function showErr(msg) { $("notice-err-text").textContent = msg; $("notice-err").hidden = false; }

  async function saveRecord(rec) { await serial(() => Store.put(rec)); notifyOthers(); }
  async function deleteRecord(c) {
    await serial(async () => { await Store.del(c.id); if (c.iconId) await Store.delIcon(c.iconId).catch(() => {}); });
    notifyOthers();
  }
  async function changeStage(c, stage) {
    if (!c || c.stage === stage) return;
    const now = new Date().toISOString();
    const rec = { ...c, stage, history: [...c.history, { stage, at: now, label: labelIn(c.stages, stage) }], updatedAt: now };
    try { await saveRecord(rec); await reload(); } catch (e) { showErr(errText(e)); }
  }

  /* ================= icons ================= */
  function monoChar(name) {
    const n = String(name || "").trim().replace(/^(株式会社|有限会社|合同会社|（株）|\(株\)|㈱)\s*/, "");
    const ch = Array.from(n)[0] || "？";
    return /[a-z]/.test(ch) ? ch.toUpperCase() : ch;
  }
  function hue(name) {
    let h = 2166136261;
    for (const ch of String(name || "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0) % 6;
  }
  function iconHTML(name, iconId, size, overrideUrl) {
    const k = hue(name);
    const src = overrideUrl || (iconId ? S.iconUrls.get(iconId) || "" : "");
    return `<span class="ico" aria-hidden="true" style="--s:${size}px;--mgb:var(--mg${k}-b);--mgi:var(--mg${k}-i)">${esc(monoChar(name))}${src ? `<img src="${esc(src)}" alt="">` : ""}</span>`;
  }
  document.addEventListener("error", (e) => {
    const t = e.target;
    if (t && t.tagName === "IMG" && t.parentElement && t.parentElement.classList.contains("ico")) t.remove();
  }, true);
  async function syncIconUrls() {
    const want = new Set(S.docs.map((c) => c.iconId).filter(Boolean));
    for (const [id, url] of S.iconUrls) if (!want.has(id)) { URL.revokeObjectURL(url); S.iconUrls.delete(id); }
    for (const id of want) {
      if (S.iconUrls.has(id)) continue;
      try { const b = await Store.getIcon(id); if (b) S.iconUrls.set(id, URL.createObjectURL(b)); } catch (e) {}
    }
  }

  /* ================= stepper ================= */
  function stepsHTML(stages, stage, r, large) {
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
    const col = term ? termColor(stage) : colorAt(r, n);
    return `<ol class="steps${large ? " lg" : ""} ${kcls}" style="--sc:${col};min-width:${n * (large ? 72 : 64)}px" aria-label="選考の進み具合：${esc(label)}">${items}</ol>`;
  }

  /* ================= render ================= */
  function priHTML(p) {
    const on = 4 - p;
    return `<span class="pri" title="${PRI[p]}" aria-label="志望度：${PRI[p]}">${"★".repeat(on)}<span class="off" aria-hidden="true">${"★".repeat(3 - on)}</span></span>`;
  }
  function nextHTML(c, cls) {
    const d = parseDate(c.nextDate);
    if (!d) return "";
    return `<div class="${cls}"><span class="when">${esc(fmtDate(d))}</span>${c.nextLabel ? `<span class="lbl">${esc(c.nextLabel)}</span>` : ""}${isTerm(c.stage) ? "" : dueBadge(d)}</div>`;
  }
  const sampleChip = (c) => (c.example ? `<span class="chip">サンプル</span>` : "");
  function progHTML(c) {
    const term = isTerm(c.stage);
    const r = reached(c);
    const reach = term && r >= 0 ? `<span class="reach">${esc(c.stages[r].label)}で終了</span>` : "";
    return `<div class="prog" style="--sc:${stageColor(c)}"><span class="tag">${esc(stageLabel(c))}${reach}</span><div class="steps-scroll">${stepsHTML(c.stages, c.stage, r, false)}</div></div>`;
  }
  function sortList(list) {
    const a = list.slice();
    if (S.sort === "next") a.sort((x, y) => (isTerm(x.stage) - isTerm(y.stage)) || cmpCard(x, y));
    else if (S.sort === "priority") a.sort((x, y) => x.priority - y.priority || (isTerm(x.stage) - isTerm(y.stage)) || cmpCard(x, y));
    else if (S.sort === "stage") a.sort((x, y) => progressRatio(y) - progressRatio(x) || cmpCard(x, y));
    else a.sort((x, y) => (y.updatedAt || "").localeCompare(x.updatedAt || ""));
    return a;
  }
  function actsHTML(c) {
    const id = esc(c.id);
    if (isTerm(c.stage)) {
      const r = reached(c);
      const to = c.stages[r >= 0 ? r : 0];
      return `<button type="button" class="qa adv" data-act="restore" data-id="${id}" title="${esc(to.label)}に戻します">選考中に戻す</button>
        <button type="button" class="qa" data-act="edit" data-id="${id}">編集</button>`;
    }
    const i = stageIndex(c);
    const prev = c.stages[i - 1], next = c.stages[i + 1];
    return `${prev ? `<button type="button" class="qa" data-act="back" data-id="${id}" title="${esc(prev.label)}に戻します">← 戻る</button>` : ""}
      ${next ? `<button type="button" class="qa adv" data-act="advance" data-id="${id}" title="${esc(next.label)}へ">次へ →</button>` : ""}
      <button type="button" class="qa" data-act="rejected" data-id="${id}">不合格</button>
      <button type="button" class="qa" data-act="declined" data-id="${id}">辞退</button>`;
  }
  function listHTML(list) {
    const rows = sortList(list).map((c) => {
      const u = parseDate(c.updatedAt);
      const id = esc(c.id);
      return `<div class="lrow" role="row">
        <div class="who" role="cell"><div class="who-in">${iconHTML(c.name, c.iconId, 28)}<div><button type="button" data-act="edit" data-id="${id}">${esc(c.name || "（社名未入力）")}</button>${sampleChip(c)}
          <span class="pos">${esc(c.position)}${c.industry ? ` <span class="ind">／${esc(c.industry)}</span>` : ""}</span></div></div></div>
        <div role="cell" class="prog-cell" style="min-width:0">${progHTML(c)}</div>
        <div role="cell" class="pricell">${priHTML(c.priority)}</div>
        <div role="cell">${nextHTML(c, "next") || `<span class="hint">—</span>`}</div>
        <div role="cell" class="upd">${u ? fmtShort(u) : "—"}</div>
        <div role="cell" class="acts">${actsHTML(c)}</div>
      </div>`;
    }).join("");
    return `<div class="list" role="table" aria-label="企業一覧">
      <div class="lrow lhead" role="row"><span role="columnheader">社名・職種</span><span role="columnheader">選考段階</span><span role="columnheader">志望度</span><span role="columnheader">次の予定</span><span role="columnheader">更新</span><span role="columnheader" style="text-align:right">操作</span></div>
      ${rows}</div>`;
  }
  function emptyHTML() {
    const n = S.template.length;
    const demo = S.template.map((s, i) => `<span style="--sc:${colorAt(i, n)}">${esc(s.label)}</span>`).join("");
    if (!S.loaded) return `<div class="empty"><h2>読み込み中…</h2><p>この端末に保存された企業を読み込んでいます。</p></div>`;
    return `<div class="empty">
      <h2>応募した企業を、ひとつの一覧で</h2>
      <p>企業ごとに職種・コース、いまの選考段階、次の予定（締切・面接日）を記録すると、進み具合が矢印で並び、近い予定から順に確認できます。選考段階は企業ごとに変えられます。データはこの端末の中だけに保存されます。</p>
      <div class="pipe-demo" aria-label="選考段階の流れ">${demo}</div>
      <div class="row">
        <button type="button" class="btn primary" data-act="add">＋ 企業を追加</button>
        <button type="button" class="btn" data-act="samples">サンプルを入れて試す</button>
      </div>
      <p class="hint" style="margin-top:10px">社名と職種だけで登録でき、あとから段階や予定を足せます。サンプルはいつでも「サンプルを削除」で消せます。</p>
    </div>`;
  }
  function renderStats() {
    const all = S.docs;
    const activeList = all.filter((c) => !isTerm(c.stage) && !atLast(c));
    const active = activeList.length;
    const withNext = activeList.filter((c) => parseDate(c.nextDate)).length;
    const offer = all.filter(atLast).length;
    const rej = all.filter((c) => c.stage === "rejected").length;
    const dec = all.filter((c) => c.stage === "declined").length;
    const segs = [["選考中", active, "var(--accent)"], ["内定", offer, "var(--st-offer)"], ["不合格", rej, "var(--st-rejected)"], ["辞退", dec, "var(--muted)"]];
    const bar = all.length ? segs.map(([l, n, col]) => (n ? `<span style="width:${(n / all.length) * 100}%;background:${col}" title="${l} ${n}"></span>` : "")).join("") : "";
    $("stats").innerHTML = `
      <div class="stat"><div class="k">選考中</div><div class="v">${active}</div><div class="d">うち予定あり <span class="num">${withNext}</span></div></div>
      <div class="stat offer"><div class="k">内定</div><div class="v">${offer}</div><div class="d">全<span class="num">${all.length}</span>社中</div></div>
      <div class="stat"><div class="k">終了</div><div class="v">${rej + dec}</div><div class="d">不合格 <span class="num">${rej}</span>・辞退 <span class="num">${dec}</span></div></div>
      <div class="stagebar" role="img" aria-label="選考中 ${active}・内定 ${offer}・不合格 ${rej}・辞退 ${dec}">${bar}</div>`;
  }
  function renderUpcoming() {
    const items = S.docs
      .filter((c) => !isTerm(c.stage) && parseDate(c.nextDate) && dayDiff(parseDate(c.nextDate)) >= -14)
      .sort((a, b) => nextTime(a) - nextTime(b)).slice(0, 5);
    const el = $("upcoming");
    if (!items.length) {
      el.innerHTML = `<li class="up-empty">${S.docs.length ? "登録された予定はありません。編集画面で「次の予定」を入れるとここに出ます。" : "企業を登録すると、締切や面接日が日付順に並びます。"}</li>`;
      return;
    }
    el.innerHTML = items.map((c) => {
      const d = parseDate(c.nextDate);
      return `<li><button type="button" class="up-item" data-act="edit" data-id="${esc(c.id)}">
        <span class="up-date">${esc(fmtDate(d))}</span>
        <span class="up-what" style="display:flex;align-items:center;gap:7px">${iconHTML(c.name, c.iconId, 20)}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis"><b>${esc(c.name)}</b><span>${esc(c.nextLabel || stageLabel(c))}</span></span></span>
        ${dueBadge(d)}</button></li>`;
    }).join("");
  }
  function renderChrome() {
    $("notice-db").hidden = S.mode !== "memory";
    $("local-note").classList.toggle("mem", S.mode === "memory");
    const samples = S.docs.filter((c) => c.example).length;
    $("btn-del-samples").hidden = !samples;
    if (!samples) $("notice-samples").hidden = true;
    $("f-sort").value = S.sort;
  }
  function render() {
    renderChrome(); renderStats(); renderUpcoming();
    const main = $("main");
    if (!S.docs.length) { main.innerHTML = emptyHTML(); $("count-line").textContent = ""; return; }
    const list = filtered();
    $("count-line").textContent = `${list.length} / ${S.docs.length} 社`;
    main.innerHTML = list.length ? listHTML(list)
      : `<div class="empty"><h2>条件に一致する企業はありません</h2><p>検索語や志望度・対象の絞り込みを変えてみてください。</p></div>`;
  }

  /* ================= stage list editor (template + per company) ================= */
  /* kind "tpl" edits S.tplDraft, kind "cs" edits S.draftStages. */
  const ED = {
    tpl: { list: () => S.tplDraft, set: (a) => { S.tplDraft = a; }, box: "tpl-editor", err: "tpl-err", changed: () => {} },
    cs: { list: () => S.draftStages, set: (a) => { S.draftStages = a; }, box: "cs-editor", err: "cs-err", changed: () => updateDialogVisuals(true) },
  };
  function renderEditor(kind) {
    const list = ED[kind].list();
    const n = list.length;
    $(ED[kind].box).innerHTML = `<ol class="sed" aria-label="選考段階の並び">${list.map((s, i) => `
      <li class="sed-row">
        <span class="sed-n num">${i + 1}</span>
        <input class="input sed-in" id="${kind}-label-${esc(s.id)}" value="${esc(s.label)}" maxlength="${MAX_LABEL}" autocomplete="off" aria-label="${i + 1}番目の段階名" data-ed="${kind}" data-op="rename" data-i="${i}">
        <button type="button" class="sed-b" id="${kind}-up-${esc(s.id)}" data-ed="${kind}" data-op="up" data-i="${i}" aria-label="${esc(s.label)}を上へ"${i === 0 ? " disabled" : ""}>↑</button>
        <button type="button" class="sed-b" id="${kind}-down-${esc(s.id)}" data-ed="${kind}" data-op="down" data-i="${i}" aria-label="${esc(s.label)}を下へ"${i === n - 1 ? " disabled" : ""}>↓</button>
        <button type="button" class="sed-b" id="${kind}-ins-${esc(s.id)}" data-ed="${kind}" data-op="ins" data-i="${i}" aria-label="${esc(s.label)}の下に段階を追加" title="この下に追加"${n >= MAX_STAGES ? " disabled" : ""}>＋</button>
        <button type="button" class="sed-b del" id="${kind}-del-${esc(s.id)}" data-ed="${kind}" data-op="del" data-i="${i}" aria-label="${esc(s.label)}を削除" title="削除"${n <= 1 ? " disabled" : ""}>✕</button>
      </li>`).join("")}</ol>`;
  }
  function editorOp(kind, op, i, value) {
    const ed = ED[kind];
    const list = ed.list().slice();
    const err = $(ed.err);
    err.textContent = "";
    if (op === "rename") { list[i] = { ...list[i], label: value }; ed.set(list); ed.changed(); return; }
    let focusId = null;
    if (op === "up" && i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; focusId = `${kind}-up-${list[i - 1].id}`; if (i - 1 === 0) focusId = `${kind}-down-${list[0].id}`; }
    else if (op === "down" && i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; focusId = `${kind}-down-${list[i + 1].id}`; if (i + 1 === list.length - 1) focusId = `${kind}-up-${list[i + 1].id}`; }
    else if (op === "ins" || op === "add") {
      if (list.length >= MAX_STAGES) { err.textContent = `段階は${MAX_STAGES}個までです。`; return; }
      const s = { id: stageId(), label: "新しい段階" };
      list.splice(op === "add" ? list.length : i + 1, 0, s);
      focusId = `${kind}-label-${s.id}`;
    } else if (op === "del") {
      if (list.length <= 1) { err.textContent = "段階は少なくとも1つ必要です。"; return; }
      if (kind === "cs" && list[i].id === $("c-stage").value) {
        err.textContent = `「${list[i].label}」はいまの段階なので削除できません。先に上の「選考段階」で別の段階を選んでから削除してください。`;
        return;
      }
      list.splice(i, 1);
      const near = list[Math.min(i, list.length - 1)];
      focusId = `${kind}-del-${near.id}`;
    } else return;
    ed.set(list);
    renderEditor(kind);
    ed.changed();
    if (focusId) { const el = $(focusId); if (el) { el.focus(); if (el.select && op !== "del") el.select(); } }
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ed]");
    if (!b || b.disabled) return;
    editorOp(b.dataset.ed, b.dataset.op, Number(b.dataset.i));
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t && t.matches && t.matches("input[data-ed]")) editorOp(t.dataset.ed, "rename", Number(t.dataset.i), t.value);
  });
  /* Returns cleaned list or an error message. */
  function checkStages(list) {
    if (!list.length) return { error: "段階は少なくとも1つ必要です。" };
    const out = [];
    for (const s of list) {
      const label = String(s.label || "").trim();
      if (!label) return { error: "段階名が空欄のところがあります。入力するか、その段階を削除してください。" };
      if (label.length > MAX_LABEL) return { error: `段階名は${MAX_LABEL}文字までです。` };
      out.push({ id: s.id, label });
    }
    return { stages: out };
  }

  /* template panel */
  function openTemplatePanel(open) {
    const p = $("tpl-panel");
    p.hidden = !open;
    $("btn-tpl").setAttribute("aria-expanded", String(open));
    $("tpl-err").textContent = ""; $("tpl-msg").textContent = "";
    if (open) { S.tplDraft = cloneStages(S.template); renderEditor("tpl"); p.scrollIntoView({ block: "nearest" }); }
  }
  $("btn-tpl").addEventListener("click", () => openTemplatePanel($("tpl-panel").hidden));
  $("btn-tpl-close").addEventListener("click", () => { openTemplatePanel(false); $("btn-tpl").focus(); });
  $("btn-tpl-add").addEventListener("click", () => editorOp("tpl", "add", 0));
  $("btn-tpl-reset").addEventListener("click", () => {
    S.tplDraft = cloneStages(DEFAULT_STAGES); renderEditor("tpl");
    $("tpl-err").textContent = ""; $("tpl-msg").textContent = "初期状態の8段階に戻しました。「保存」で確定します。";
  });
  $("btn-tpl-save").addEventListener("click", async () => {
    const r = checkStages(S.tplDraft);
    if (r.error) { $("tpl-err").textContent = r.error; return; }
    try {
      await serial(() => Store.putSetting("template", { stages: r.stages }));
      S.template = r.stages; S.tplDraft = cloneStages(r.stages);
      renderEditor("tpl"); notifyOthers(); render();
      $("tpl-msg").textContent = "保存しました。これから追加する企業に使われます。";
    } catch (e) { $("tpl-err").textContent = errText(e); }
  });

  /* ================= dialog ================= */
  const dlg = $("dlg");
  const ICON_HINT = "未設定のときは社名の頭文字を表示します。画像の貼り付けもできます。";
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

  function openDialog(id) {
    const c = id ? byId(id) : null;
    S.editingId = c ? c.id : null;
    S.draftStages = cloneStages(c ? c.stages : S.template);
    $("dlg-title").textContent = c ? "企業を編集" : "企業を追加";
    $("c-name").value = c ? c.name : "";
    $("c-position").value = c ? c.position : "";
    $("c-industry").value = c ? c.industry : "";
    $("c-priority").value = String(c ? c.priority : 2);
    const def = S.draftStages.find((s) => s.id === "entry") || S.draftStages[0];
    rebuildStageSelect(c ? c.stage : def.id);
    const d = c ? parseDate(c.nextDate) : null;
    $("c-next-date").value = d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : "";
    $("c-next-time").value = d && hasTime(d) ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : "";
    $("c-next-label").value = c ? c.nextLabel : "";
    $("c-url").value = c ? c.url : "";
    $("c-memo").value = c ? c.memo : "";
    $("form-err").textContent = ""; $("cs-err").textContent = "";
    $("del-confirm").hidden = true;
    $("btn-delete").hidden = !c;
    setStageEditorOpen(false);
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
    updateDialogVisuals();
    updateUrlLink();
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    if (!matchMedia("(pointer: coarse)").matches) setTimeout(() => $("c-name").focus(), 0);
  }
  function closeDialog() { if (dlg.open) dlg.close(); S.editingId = null; resetIcon(); }
  function updateUrlLink() {
    const v = $("c-url").value.trim(); const a = $("c-url-open");
    if (/^https?:\/\/[^\s]+$/i.test(v)) { a.href = v; a.hidden = false; } else { a.removeAttribute("href"); a.hidden = true; }
  }
  $("c-url").addEventListener("input", updateUrlLink);

  function currentIconSrc() {
    if (S.icon.url) return { id: "", url: S.icon.url };
    const c = S.editingId ? byId(S.editingId) : null;
    if (!S.icon.removed && c && c.iconId) return { id: c.iconId, url: "" };
    return { id: "", url: "" };
  }
  function updateDialogVisuals(stagesChanged) {
    if (stagesChanged) rebuildStageSelect($("c-stage").value);
    const stage = $("c-stage").value;
    const c = S.editingId ? byId(S.editingId) : null;
    const r = reachedFrom(S.draftStages, stage, c ? c.history : []);
    $("dlg-steps").innerHTML = stepsHTML(S.draftStages.map((s) => ({ id: s.id, label: String(s.label).trim() || "…" })), stage, r, true);
    const name = $("c-name").value || "";
    const src = currentIconSrc();
    $("dlg-icon").innerHTML = iconHTML(name, src.id, 48, src.url);
    $("icon-preview").innerHTML = iconHTML(name, src.id, 40, src.url);
    $("btn-icon-remove").hidden = !(src.url || src.id);
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
    updateDialogVisuals(false);
    $("cs-err").textContent = note;
  });
  function resetIcon() {
    if (S.icon.url) { try { URL.revokeObjectURL(S.icon.url); } catch (e) {} }
    S.icon = { blob: null, url: "", removed: false };
    const f = $("c-icon-file"); if (f) f.value = "";
  }
  function canvasToBlob(cv, type, q) { return new Promise((r) => { try { cv.toBlob(r, type, q); } catch (e) { r(null); } }); }
  async function squareImage(src) {
    const url = URL.createObjectURL(src);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const w = img.naturalWidth || 128, h = img.naturalHeight || 128, side = Math.min(w, h);
      const cv = document.createElement("canvas"); cv.width = cv.height = 128;
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 128, 128);
      let blob = await canvasToBlob(cv, "image/webp", 0.88);
      if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(cv, "image/png");
      if (!blob) throw new Error("encode");
      return blob;
    } finally { URL.revokeObjectURL(url); }
  }
  async function pickIcon(file) {
    if (!file || !/^image\//.test(file.type)) return;
    if (file.size > 20 * 1024 * 1024) { $("icon-hint").textContent = "画像が大きすぎます（20MBまで）。"; return; }
    try {
      const blob = await squareImage(file);
      resetIcon();
      S.icon.blob = blob; S.icon.url = URL.createObjectURL(blob);
      $("icon-hint").textContent = "保存すると反映されます。";
      updateDialogVisuals();
    } catch (e) { $("icon-hint").textContent = "この画像は読み込めませんでした。別の画像を選んでください。"; }
  }
  $("c-icon-file").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) pickIcon(f); });
  $("btn-icon-remove").addEventListener("click", () => {
    resetIcon(); S.icon.removed = true;
    $("icon-hint").textContent = "保存すると画像が外れ、頭文字の表示に戻ります。";
    updateDialogVisuals();
  });
  dlg.addEventListener("paste", (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.kind === "file" && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) { e.preventDefault(); pickIcon(f); } return; }
    }
  });
  $("c-name").addEventListener("input", () => updateDialogVisuals());
  $("c-stage").addEventListener("change", () => { $("cs-err").textContent = ""; updateDialogVisuals(); });

  $("form-company").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (S.busy) return;
    const name = $("c-name").value.trim();
    if (!name) { $("form-err").textContent = "社名を入力してください。"; $("c-name").focus(); return; }
    const url = $("c-url").value.trim();
    if (url && !/^https?:\/\//i.test(url)) { $("form-err").textContent = "マイページURLは http:// または https:// から始めてください。"; $("c-url").focus(); return; }
    const chk = checkStages(S.draftStages);
    if (chk.error) { setStageEditorOpen(true); $("cs-err").textContent = chk.error; $("form-err").textContent = "選考段階の編集欄を確認してください。"; return; }
    const stages = chk.stages;
    const stage = $("c-stage").value;
    if (!isTerm(stage) && !stages.some((s) => s.id === stage)) { $("form-err").textContent = "選考段階を選び直してください。"; return; }
    let nextDate = "";
    const dv = $("c-next-date").value, tv = $("c-next-time").value;
    if (dv) { const dt = new Date(`${dv}T${tv || "00:00"}`); if (!isNaN(dt)) nextDate = dt.toISOString(); }
    const now = new Date().toISOString();
    const old = S.editingId ? byId(S.editingId) : null;
    const history = old ? old.history.slice() : [];
    if (!old || old.stage !== stage) history.push({ stage, at: now, label: labelIn(stages, stage) });
    const rec = {
      id: old ? old.id : newId("c"),
      name, position: $("c-position").value.trim(), industry: $("c-industry").value.trim(),
      stages, stage, priority: Number($("c-priority").value) || 2,
      nextDate, nextLabel: $("c-next-label").value.trim(),
      url, memo: $("c-memo").value, history, updatedAt: now, example: old ? old.example : false,
      iconId: old && !S.icon.removed ? old.iconId : "",
    };
    S.busy = true; $("btn-save").disabled = true; $("form-err").textContent = "";
    let newIcon = "";
    try {
      if (S.icon.blob) { newIcon = newId("i"); await serial(() => Store.putIcon(newIcon, S.icon.blob)); rec.iconId = newIcon; }
      await saveRecord(rec);
      if (old && old.iconId && old.iconId !== rec.iconId) await serial(() => Store.delIcon(old.iconId)).catch(() => {});
      closeDialog();
      await reload();
    } catch (err) {
      if (newIcon) serial(() => Store.delIcon(newIcon)).catch(() => {});
      $("form-err").textContent = errText(err);
    } finally { S.busy = false; $("btn-save").disabled = false; }
  });
  $("btn-cancel").addEventListener("click", closeDialog);
  $("btn-dlg-close").addEventListener("click", closeDialog);
  dlg.addEventListener("close", () => { S.editingId = null; resetIcon(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDialog(); });
  $("btn-delete").addEventListener("click", () => { $("del-confirm").hidden = false; $("btn-delete-cancel").focus(); });
  $("btn-delete-cancel").addEventListener("click", () => { $("del-confirm").hidden = true; $("btn-delete").focus(); });
  $("btn-delete-confirm").addEventListener("click", async () => {
    const c = S.editingId ? byId(S.editingId) : null; if (!c) return;
    $("btn-delete-confirm").disabled = true;
    try { await deleteRecord(c); closeDialog(); await reload(); }
    catch (err) { $("form-err").textContent = errText(err); }
    finally { $("btn-delete-confirm").disabled = false; }
  });

  /* ================= samples ================= */
  async function insertSamples() {
    const day = (n, h = 0, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); d.setDate(d.getDate() + n); return d.toISOString(); };
    const ago = (n) => day(-n, 12);
    const tpl = S.template;
    const at = (i) => tpl[Math.min(i, tpl.length - 1)].id;
    // one sample shows a company-specific list (三次面接 added, Webテスト removed)
    const custom = [
      { id: stageId(), label: "気になる" }, { id: stageId(), label: "エントリー" }, { id: stageId(), label: "ES・書類選考" },
      { id: stageId(), label: "一次面接" }, { id: stageId(), label: "二次面接" }, { id: stageId(), label: "三次面接" },
      { id: stageId(), label: "最終面接" }, { id: stageId(), label: "内定" },
    ];
    const rows = [
      { name: "サンプル商事", position: "総合職（事務系）", industry: "商社", stage: at(4), priority: 1, nextDate: day(2, 14), nextLabel: "一次面接", hist: [1, 2, 3, 4].map(at) },
      { name: "架空テック", position: "エンジニア職", industry: "IT・通信", stage: at(2), priority: 1, nextDate: day(0, 23, 59), nextLabel: "ES締切", hist: [1, 2].map(at) },
      { name: "みどり食品（例）", position: "研究開発コース", industry: "食品", stage: at(3), priority: 2, nextDate: day(5), nextLabel: "Webテスト締切", hist: [1, 2, 3].map(at) },
      { name: "ほしぞら銀行（例）", position: "オープンコース", industry: "金融", stages: custom, stage: custom[5].id, priority: 2, nextDate: day(9, 10), nextLabel: "三次面接", hist: [1, 2, 3, 4, 5].map((i) => custom[i].id) },
      { name: "あおば出版（例）", position: "編集職", industry: "出版", stage: "rejected", priority: 3, nextDate: "", nextLabel: "", hist: [...[1, 2, 4].map(at), "rejected"] },
      { name: "サンプル物流", position: "総合職", industry: "物流", stage: at(0), priority: 3, nextDate: day(12, 13), nextLabel: "説明会", hist: [at(0)] },
    ];
    try {
      for (const r of rows) {
        const stages = cloneStages(r.stages || tpl);
        const n = r.hist.length;
        const rec = normalize({
          name: r.name, position: r.position, industry: r.industry, stages, stage: r.stage, priority: r.priority,
          nextDate: r.nextDate, nextLabel: r.nextLabel, url: "", memo: "これはサンプルです。自由に編集・削除できます。",
          history: r.hist.map((s, i) => ({ stage: s, at: ago((n - i) * 6), label: labelIn(stages, s) })),
          updatedAt: new Date().toISOString(), example: true,
        });
        await saveRecord(rec);
      }
      await reload();
    } catch (e) { showErr(errText(e)); }
  }

  /* ================= backup ================= */
  function blobToDataURL(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); }); }
  function dataURLToBlob(u) {
    const m = /^data:(image\/(?:png|webp|jpeg|gif));base64,([A-Za-z0-9+/=]+)$/.exec(u || "");
    if (!m) return null;
    const bin = atob(m[2]); const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: m[1] });
  }
  function ymd(d) { return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`; }
  async function exportBackup() {
    const msg = $("backup-msg");
    try {
      const companies = (await Store.all()).map((r) => normalize(r, r.id));
      const icons = {};
      for (const c of companies) {
        if (!c.iconId) continue;
        const b = await Store.getIcon(c.iconId).catch(() => null);
        if (b) icons[c.iconId] = await blobToDataURL(b);
      }
      const payload = { app: "shukatsu-board", version: BACKUP_VERSION, exportedAt: new Date().toISOString(), template: { stages: S.template }, companies, icons };
      const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `shukatsu-backup-${ymd(new Date())}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      msg.textContent = `${companies.length} 社分を書き出しました。`;
    } catch (e) { msg.textContent = "書き出しに失敗しました。"; }
  }
  async function readBackup(file) {
    const msg = $("backup-msg");
    $("import-confirm").hidden = true; S.pendingImport = null;
    if (file.size > 60 * 1024 * 1024) { msg.textContent = "ファイルが大きすぎます。"; return; }
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { msg.textContent = "読み込めませんでした（JSON 形式ではありません）。"; return; }
    if (!data || typeof data !== "object" || data.app !== "shukatsu-board" || !Array.isArray(data.companies)) {
      msg.textContent = "就活ボードのバックアップファイルではないようです。"; return;
    }
    // old (version 1) backups have no stages: normalize() applies the same migration
    const companies = data.companies.filter((c) => c && typeof c === "object" && typeof c.name === "string" && c.name.trim()).map((c) => normalize(c));
    const icons = data.icons && typeof data.icons === "object" ? data.icons : {};
    const template = cleanStages(data.template && data.template.stages);
    const iconCount = companies.filter((c) => c.iconId && typeof icons[c.iconId] === "string").length;
    if (!companies.length) { msg.textContent = "読み込める企業がありませんでした。"; return; }
    S.pendingImport = { companies, icons, template };
    const when = parseDate(data.exportedAt);
    $("import-summary").textContent = `${companies.length} 社（アイコン ${iconCount} 件）${when ? `・${fmtFull(when)} 書き出し` : ""} のデータを読み込みます。今のデータ：${S.docs.length} 社。${template ? "「置き換え」では段階テンプレートもファイルの内容になります。" : ""}`;
    $("import-confirm").hidden = false; msg.textContent = "";
    $("btn-import-merge").focus();
  }
  async function applyImport(replace) {
    const p = S.pendingImport; if (!p) return;
    const msg = $("backup-msg");
    $("btn-import-merge").disabled = $("btn-import-replace").disabled = true;
    try {
      if (replace) {
        await serial(() => Store.clearAll());
        if (p.template) await serial(() => Store.putSetting("template", { stages: p.template }));
      }
      const existing = new Set(replace ? [] : S.docs.map((c) => c.id));
      for (const c of p.companies) {
        const rec = { ...c };
        if (existing.has(rec.id)) rec.id = newId("c");
        let iconId = "";
        if (c.iconId && typeof p.icons[c.iconId] === "string") {
          const b = dataURLToBlob(p.icons[c.iconId]);
          if (b) { iconId = newId("i"); await serial(() => Store.putIcon(iconId, b)); }
        }
        rec.iconId = iconId;
        await saveRecord(rec);
      }
      msg.textContent = `${p.companies.length} 社を${replace ? "置き換えて" : "追加して"}読み込みました。`;
      S.pendingImport = null; $("import-confirm").hidden = true; $("backup-file").value = "";
      notifyOthers();
      await reload();
    } catch (e) { msg.textContent = "読み込み中にエラーが起きました。" + errText(e); }
    finally { $("btn-import-merge").disabled = $("btn-import-replace").disabled = false; }
  }
  $("btn-backup").addEventListener("click", () => {
    const p = $("backup-panel"); p.hidden = !p.hidden;
    $("btn-backup").setAttribute("aria-expanded", String(!p.hidden));
    if (!p.hidden) $("btn-export").focus();
  });
  $("btn-export").addEventListener("click", exportBackup);
  $("backup-file").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) readBackup(f); });
  $("btn-import-merge").addEventListener("click", () => applyImport(false));
  $("btn-import-replace").addEventListener("click", () => applyImport(true));
  $("btn-import-cancel").addEventListener("click", () => { S.pendingImport = null; $("import-confirm").hidden = true; $("backup-file").value = ""; });

  /* ================= events ================= */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const id = b.dataset.id, act = b.dataset.act;
    const c = id ? byId(id) : null;
    if (act === "edit") openDialog(id);
    else if (act === "add") openDialog(null);
    else if (act === "samples") { b.disabled = true; insertSamples(); }
    else if (act === "advance" && c && !isTerm(c.stage)) { const n = c.stages[stageIndex(c) + 1]; if (n) changeStage(c, n.id); }
    else if (act === "back" && c && !isTerm(c.stage)) { const p = c.stages[stageIndex(c) - 1]; if (p) changeStage(c, p.id); }
    else if (act === "restore" && c && isTerm(c.stage)) { const r = reached(c); changeStage(c, c.stages[r >= 0 ? r : 0].id); }
    else if ((act === "rejected" || act === "declined") && c) changeStage(c, act);
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

  /* ================= iOS install hint ================= */
  (() => {
    const ua = navigator.userAgent || "";
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
    if (ios && !standalone && lsGet(LS.iosHint) !== "1") $("ios-hint").hidden = false;
    $("btn-ios-hint-close").addEventListener("click", () => { $("ios-hint").hidden = true; lsSet(LS.iosHint, "1"); });
  })();

  /* ================= start ================= */
  const today = new Date();
  $("today-line").innerHTML = `<span class="num">${today.getFullYear()}/${p2(today.getMonth() + 1)}/${p2(today.getDate())}</span>（${WD[today.getDay()]}）時点`;
  render();
  (async () => {
    S.mode = await Store.init();
    if (S.mode === "idb" && navigator.storage && navigator.storage.persist) {
      try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) {}
    }
    await reload();
  })();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.loaded) render(); });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
  }
})();
