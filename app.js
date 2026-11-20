/* 就活ボード — standalone app. All data stays on this device (IndexedDB). */
(() => {
  "use strict";
  const STAGES = [
    { k: "interest", l: "気になる" },
    { k: "entry", l: "エントリー" },
    { k: "es", l: "ES・書類選考" },
    { k: "test", l: "適性検査・Webテスト" },
    { k: "gd", l: "GD・一次面接" },
    { k: "interview2", l: "二次面接" },
    { k: "final", l: "最終面接" },
    { k: "offer", l: "内定" },
  ];
  const TERMS = [{ k: "rejected", l: "不合格" }, { k: "declined", l: "辞退" }];
  const LABEL = {}; const IDX = {};
  STAGES.forEach((s, i) => { LABEL[s.k] = s.l; IDX[s.k] = i; });
  TERMS.forEach((s) => { LABEL[s.k] = s.l; });
  const SHORT = ["気になる", "エントリー", "ES", "Webテスト", "一次", "二次", "最終", "内定"];
  const isTerm = (k) => k === "rejected" || k === "declined";
  const PRI = { 1: "第一志望群", 2: "第二志望群", 3: "第三志望群" };
  const WD = "日月火水木金土";
  const LS = { sort: "shukatsu.sort", iosHint: "shukatsu.iosHintDismissed" };
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sc = (k) => `--sc:var(--st-${k in LABEL ? k : "interest"})`;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  const S = {
    mode: "loading", // loading | idb | memory
    docs: [], loaded: false,
    q: "", pri: "all", scope: "all", sort: "next",
    editingId: null, busy: false,
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
        try { req = indexedDB.open("shukatsu-board", 1); } catch (e) { return reject(e); }
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains("companies")) d.createObjectStore("companies", { keyPath: "id" });
          if (!d.objectStoreNames.contains("icons")) d.createObjectStore("icons");
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
          await run(["icons"], "readwrite", (t) => t.objectStore("icons").put({ type: "x", data: new ArrayBuffer(0) }, "__probe"));
          await run(["icons"], "readwrite", (t) => t.objectStore("icons").delete("__probe"));
          db.onversionchange = () => { try { db.close(); } catch (e) {} };
          return "idb";
        } catch (e) {
          db = null; mem = { companies: new Map(), icons: new Map() };
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

  /* ================= data ================= */
  function normalize(d, idOverride) {
    d = d && typeof d === "object" ? d : {};
    const stage = typeof d.stage === "string" && d.stage in LABEL ? d.stage : "interest";
    const pr = Number(d.priority);
    const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
    const id = idOverride || (typeof d.id === "string" && ID_RE.test(d.id) ? d.id : newId("c"));
    return {
      id,
      name: str(d.name, 80),
      position: str(d.position, 80),
      industry: str(d.industry, 40),
      stage,
      priority: pr === 1 || pr === 2 || pr === 3 ? pr : 2,
      nextDate: typeof d.nextDate === "string" && parseDate(d.nextDate) ? d.nextDate : "",
      nextLabel: str(d.nextLabel, 40),
      url: typeof d.url === "string" && /^https?:\/\//i.test(d.url) ? d.url.slice(0, 2000) : "",
      memo: str(d.memo, 4000),
      history: Array.isArray(d.history)
        ? d.history.filter((h) => h && typeof h === "object" && typeof h.stage === "string" && h.stage in LABEL)
            .map((h) => ({ stage: h.stage, at: typeof h.at === "string" ? h.at : "" })).slice(-200)
        : [],
      updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
      example: d.example === true,
      iconId: typeof d.iconId === "string" && ID_RE.test(d.iconId) ? d.iconId : "",
    };
  }
  function newId(prefix) {
    const a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else a.forEach((_, i) => (a[i] = Math.random() * 256));
    return prefix + Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
  }
  function reached(c) {
    if (!isTerm(c.stage)) return IDX[c.stage];
    let best = -1;
    for (const h of c.history) if (h.stage in IDX && IDX[h.stage] > best) best = IDX[h.stage];
    return best;
  }
  const byId = (id) => S.docs.find((c) => c.id === id);
  function filtered() {
    const q = S.q.trim().toLowerCase();
    return S.docs.filter((c) => {
      if (S.pri !== "all" && String(c.priority) !== S.pri) return false;
      if (S.scope === "active" && (isTerm(c.stage) || c.stage === "offer")) return false;
      if (q && !(`${c.name} ${c.position} ${c.industry}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }
  function nextTime(c) { const d = parseDate(c.nextDate); return d ? d.getTime() : Infinity; }
  function cmpCard(a, b) { return nextTime(a) - nextTime(b) || a.priority - b.priority || a.name.localeCompare(b.name, "ja"); }

  async function reload() {
    try {
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
    const rec = { ...c, stage, history: [...c.history, { stage, at: now }], updatedAt: now };
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
  function stepsHTML(stage, r, large) {
    const term = isTerm(stage);
    const kcls = stage === "rejected" ? "rej" : stage === "declined" ? "dec" : "";
    const items = STAGES.map((s, i) => {
      const cls = i < r ? "on" : i === r ? "cur" : "";
      let txt = SHORT[i];
      if (i === r && stage === "rejected") txt = "✕ " + txt;
      if (i === r && stage === "declined") txt = "辞退";
      return `<li class="${cls}"${i === r ? ' aria-current="step"' : ""} title="${esc(s.l)}">${esc(txt)}</li>`;
    }).join("");
    const label = term ? `${LABEL[stage]}${r >= 0 ? `（${STAGES[r].l}で終了）` : ""}` : `${LABEL[stage]}（${r + 1}/${STAGES.length}）`;
    return `<ol class="steps${large ? " lg" : ""} ${kcls}" style="${sc(stage)}" aria-label="選考の進み具合：${esc(label)}">${items}</ol>`;
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
    const reach = term && r >= 0 ? `<span class="reach">${esc(STAGES[r].l)}で終了</span>` : "";
    return `<div class="prog" style="${sc(c.stage)}"><span class="tag">${LABEL[c.stage]}${reach}</span><div class="steps-scroll">${stepsHTML(c.stage, r, false)}</div></div>`;
  }
  function sortList(list) {
    const a = list.slice();
    const stageRank = (c) => (isTerm(c.stage) ? -1 - (c.stage === "declined" ? 1 : 0) : IDX[c.stage]);
    if (S.sort === "next") a.sort((x, y) => (isTerm(x.stage) - isTerm(y.stage)) || cmpCard(x, y));
    else if (S.sort === "priority") a.sort((x, y) => x.priority - y.priority || (isTerm(x.stage) - isTerm(y.stage)) || cmpCard(x, y));
    else if (S.sort === "stage") a.sort((x, y) => stageRank(y) - stageRank(x) || cmpCard(x, y));
    else a.sort((x, y) => (y.updatedAt || "").localeCompare(x.updatedAt || ""));
    return a;
  }
  function listHTML(list) {
    const rows = sortList(list).map((c) => {
      const term = isTerm(c.stage);
      const nxt = term ? null : STAGES[IDX[c.stage] + 1];
      const u = parseDate(c.updatedAt);
      const id = esc(c.id);
      return `<div class="lrow" role="row">
        <div class="who" role="cell"><div class="who-in">${iconHTML(c.name, c.iconId, 28)}<div><button type="button" data-act="edit" data-id="${id}">${esc(c.name || "（社名未入力）")}</button>${sampleChip(c)}
          <span class="pos">${esc(c.position)}${c.industry ? ` <span class="ind">／${esc(c.industry)}</span>` : ""}</span></div></div></div>
        <div role="cell" class="prog-cell" style="min-width:0">${progHTML(c)}</div>
        <div role="cell" class="pricell">${priHTML(c.priority)}</div>
        <div role="cell">${nextHTML(c, "next") || `<span class="hint">—</span>`}</div>
        <div role="cell" class="upd">${u ? fmtShort(u) : "—"}</div>
        <div role="cell" class="acts">${term ? `<button type="button" class="qa" data-act="edit" data-id="${id}">編集</button>` :
          `${nxt ? `<button type="button" class="qa adv" data-act="advance" data-id="${id}" title="${esc(nxt.l)}へ">次へ →</button>` : ""}
           <button type="button" class="qa" data-act="rejected" data-id="${id}">不合格</button>
           <button type="button" class="qa" data-act="declined" data-id="${id}">辞退</button>`}</div>
      </div>`;
    }).join("");
    return `<div class="list" role="table" aria-label="企業一覧">
      <div class="lrow lhead" role="row"><span role="columnheader">社名・職種</span><span role="columnheader">選考段階</span><span role="columnheader">志望度</span><span role="columnheader">次の予定</span><span role="columnheader">更新</span><span role="columnheader" style="text-align:right">操作</span></div>
      ${rows}</div>`;
  }
  function emptyHTML() {
    const demo = STAGES.map((s) => `<span style="${sc(s.k)}">${s.l}</span>`).join("");
    if (!S.loaded) return `<div class="empty"><h2>読み込み中…</h2><p>この端末に保存された企業を読み込んでいます。</p></div>`;
    return `<div class="empty">
      <h2>応募した企業を、ひとつの一覧で</h2>
      <p>企業ごとに職種・コース、いまの選考段階、次の予定（締切・面接日）を記録すると、進み具合が矢印で並び、近い予定から順に確認できます。データはこの端末の中だけに保存されます。</p>
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
    const count = (k) => all.filter((c) => c.stage === k).length;
    const active = all.filter((c) => !isTerm(c.stage) && c.stage !== "offer").length;
    const rej = count("rejected"), dec = count("declined");
    const bar = all.length ? [...STAGES, ...TERMS].map((s) => {
      const n = count(s.k);
      return n ? `<span style="width:${(n / all.length) * 100}%;background:var(--st-${s.k})" title="${s.l} ${n}"></span>` : "";
    }).join("") : "";
    $("stats").innerHTML = `
      <div class="stat"><div class="k">選考中</div><div class="v">${active}</div><div class="d">うち気になる <span class="num">${count("interest")}</span></div></div>
      <div class="stat offer"><div class="k">内定</div><div class="v">${count("offer")}</div><div class="d">全<span class="num">${all.length}</span>社中</div></div>
      <div class="stat"><div class="k">終了</div><div class="v">${rej + dec}</div><div class="d">不合格 <span class="num">${rej}</span>・辞退 <span class="num">${dec}</span></div></div>
      <div class="stagebar" role="img" aria-label="段階ごとの内訳">${bar}</div>`;
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
        <span class="up-what" style="display:flex;align-items:center;gap:7px">${iconHTML(c.name, c.iconId, 20)}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis"><b>${esc(c.name)}</b><span>${esc(c.nextLabel || LABEL[c.stage])}</span></span></span>
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

  /* ================= dialog ================= */
  const dlg = $("dlg");
  $("c-stage").innerHTML =
    `<optgroup label="選考段階">${STAGES.map((s) => `<option value="${s.k}">${s.l}</option>`).join("")}</optgroup>` +
    `<optgroup label="終了">${TERMS.map((s) => `<option value="${s.k}">${s.l}</option>`).join("")}</optgroup>`;
  const ICON_HINT = "未設定のときは社名の頭文字を表示します。画像の貼り付けもできます。";

  function openDialog(id) {
    const c = id ? byId(id) : null;
    S.editingId = c ? c.id : null;
    $("dlg-title").textContent = c ? "企業を編集" : "企業を追加";
    $("c-name").value = c ? c.name : "";
    $("c-position").value = c ? c.position : "";
    $("c-industry").value = c ? c.industry : "";
    $("c-priority").value = String(c ? c.priority : 2);
    $("c-stage").value = c ? c.stage : "entry";
    const d = c ? parseDate(c.nextDate) : null;
    $("c-next-date").value = d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : "";
    $("c-next-time").value = d && hasTime(d) ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : "";
    $("c-next-label").value = c ? c.nextLabel : "";
    $("c-url").value = c ? c.url : "";
    $("c-memo").value = c ? c.memo : "";
    $("form-err").textContent = "";
    $("del-confirm").hidden = true;
    $("btn-delete").hidden = !c;
    const hist = c ? c.history.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))) : [];
    $("hist-wrap").hidden = !hist.length;
    $("hist").innerHTML = hist.map((h) => {
      const t = parseDate(h.at);
      return `<li style="${sc(h.stage)}"><span class="num">${t ? esc(fmtFull(t)) : "—"}</span><span>${esc(LABEL[h.stage] || h.stage)}</span></li>`;
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

  function dialogReached(stage) {
    if (!isTerm(stage)) return IDX[stage];
    const c = S.editingId ? byId(S.editingId) : null;
    if (c) { const r = isTerm(c.stage) ? reached(c) : IDX[c.stage]; if (r >= 0) return r; }
    return -1;
  }
  function currentIconSrc() {
    if (S.icon.url) return { id: "", url: S.icon.url };
    const c = S.editingId ? byId(S.editingId) : null;
    if (!S.icon.removed && c && c.iconId) return { id: c.iconId, url: "" };
    return { id: "", url: "" };
  }
  function updateDialogVisuals() {
    const stage = $("c-stage").value;
    $("dlg-steps").innerHTML = stepsHTML(stage, dialogReached(stage), true);
    const name = $("c-name").value || "";
    const src = currentIconSrc();
    $("dlg-icon").innerHTML = iconHTML(name, src.id, 48, src.url);
    $("icon-preview").innerHTML = iconHTML(name, src.id, 40, src.url);
    $("btn-icon-remove").hidden = !(src.url || src.id);
  }
  function resetIcon() {
    if (S.icon.url) { try { URL.revokeObjectURL(S.icon.url); } catch (e) {} }
    S.icon = { blob: null, url: "", removed: false };
    const f = $("c-icon-file"); if (f) f.value = "";
  }
  function canvasToBlob(cv, type, q) { return new Promise((r) => { try { cv.toBlob(r, type, q); } catch (e) { r(null); } }); }
  async function squareImage(src) {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
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
    } finally { if (typeof src !== "string") URL.revokeObjectURL(url); }
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
  $("c-name").addEventListener("input", updateDialogVisuals);
  $("c-stage").addEventListener("change", updateDialogVisuals);

  $("form-company").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (S.busy) return;
    const name = $("c-name").value.trim();
    if (!name) { $("form-err").textContent = "社名を入力してください。"; $("c-name").focus(); return; }
    const url = $("c-url").value.trim();
    if (url && !/^https?:\/\//i.test(url)) { $("form-err").textContent = "マイページURLは http:// または https:// から始めてください。"; $("c-url").focus(); return; }
    let nextDate = "";
    const dv = $("c-next-date").value, tv = $("c-next-time").value;
    if (dv) { const dt = new Date(`${dv}T${tv || "00:00"}`); if (!isNaN(dt)) nextDate = dt.toISOString(); }
    const now = new Date().toISOString();
    const old = S.editingId ? byId(S.editingId) : null;
    const stage = $("c-stage").value;
    const history = old ? old.history.slice() : [];
    if (!old || old.stage !== stage) history.push({ stage, at: now });
    const rec = {
      id: old ? old.id : newId("c"),
      name, position: $("c-position").value.trim(), industry: $("c-industry").value.trim(),
      stage, priority: Number($("c-priority").value) || 2,
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
    const rows = [
      { name: "サンプル商事", position: "総合職（事務系）", industry: "商社", stage: "gd", priority: 1, nextDate: day(2, 14), nextLabel: "一次面接", hist: ["entry", "es", "test", "gd"] },
      { name: "架空テック", position: "エンジニア職", industry: "IT・通信", stage: "es", priority: 1, nextDate: day(0, 23, 59), nextLabel: "ES締切", hist: ["entry", "es"] },
      { name: "みどり食品（例）", position: "研究開発コース", industry: "食品", stage: "test", priority: 2, nextDate: day(5), nextLabel: "Webテスト締切", hist: ["entry", "es", "test"] },
      { name: "ほしぞら銀行（例）", position: "オープンコース", industry: "金融", stage: "final", priority: 2, nextDate: day(9, 10), nextLabel: "最終面接", hist: ["entry", "es", "gd", "interview2", "final"] },
      { name: "あおば出版（例）", position: "編集職", industry: "出版", stage: "rejected", priority: 3, nextDate: "", nextLabel: "", hist: ["entry", "es", "gd", "rejected"] },
      { name: "サンプル物流", position: "総合職", industry: "物流", stage: "interest", priority: 3, nextDate: day(12, 13), nextLabel: "説明会", hist: ["interest"] },
    ];
    try {
      for (const r of rows) {
        const n = r.hist.length;
        const rec = normalize({
          name: r.name, position: r.position, industry: r.industry, stage: r.stage, priority: r.priority,
          nextDate: r.nextDate, nextLabel: r.nextLabel, url: "", memo: "これはサンプルです。自由に編集・削除できます。",
          history: r.hist.map((s, i) => ({ stage: s, at: ago((n - i) * 6) })), updatedAt: new Date().toISOString(), example: true,
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
      const companies = await Store.all();
      const icons = {};
      for (const c of companies) {
        if (!c.iconId) continue;
        const b = await Store.getIcon(c.iconId).catch(() => null);
        if (b) icons[c.iconId] = await blobToDataURL(b);
      }
      const payload = { app: "shukatsu-board", version: 1, exportedAt: new Date().toISOString(), companies, icons };
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
    const companies = data.companies.filter((c) => c && typeof c === "object" && typeof c.name === "string" && c.name.trim()).map((c) => normalize(c));
    const icons = data.icons && typeof data.icons === "object" ? data.icons : {};
    const iconCount = companies.filter((c) => c.iconId && typeof icons[c.iconId] === "string").length;
    if (!companies.length) { msg.textContent = "読み込める企業がありませんでした。"; return; }
    S.pendingImport = { companies, icons };
    const when = parseDate(data.exportedAt);
    $("import-summary").textContent = `${companies.length} 社（アイコン ${iconCount} 件）${when ? `・${fmtFull(when)} 書き出し` : ""} のデータを読み込みます。今のデータ：${S.docs.length} 社。`;
    $("import-confirm").hidden = false; msg.textContent = "";
    $("btn-import-merge").focus();
  }
  async function applyImport(replace) {
    const p = S.pendingImport; if (!p) return;
    const msg = $("backup-msg");
    $("btn-import-merge").disabled = $("btn-import-replace").disabled = true;
    try {
      if (replace) await serial(() => Store.clearAll());
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
    if (act === "edit") openDialog(id);
    else if (act === "add") openDialog(null);
    else if (act === "samples") { b.disabled = true; insertSamples(); }
    else if (act === "advance") { const c = byId(id); if (c && !isTerm(c.stage) && STAGES[IDX[c.stage] + 1]) changeStage(c, STAGES[IDX[c.stage] + 1].k); }
    else if (act === "rejected" || act === "declined") changeStage(byId(id), act);
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
