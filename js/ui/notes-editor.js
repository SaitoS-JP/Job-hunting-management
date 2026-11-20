/* ES and 面接 record editors inside the company dialog. */
import { $, esc } from "./html.js";
import { NOTE_LIMITS, newNoteId, esCount, limitStatus, normalizeLimit } from "../notes.js";

const L = NOTE_LIMITS;
const EMPTY = { es: "提出したESの設問と回答を残しておくと、面接前の見直しや他社のESに使えます。例：志望動機（400字）", iv: "面接のあとに、聞かれた質問と振り返りを残しておくと次の面接に生かせます。例：一次面接 — 聞かれた質問「学生時代に力を入れたこと」" };

function esRow(r) {
  const id = esc(r.id);
  return `<li class="note" data-n="${id}">
    <div class="note-h">
      <input class="input" id="es-q-${id}" value="${esc(r.question)}" list="es-q-suggest" maxlength="${L.question}" autocomplete="off" placeholder="設問（例：志望動機）" aria-label="ESの設問" data-nf="question">
      <button type="button" class="sed-b del" id="es-del-${id}" data-ndel="${id}" aria-label="このESの記録を削除" title="削除">✕</button>
    </div>
    <div class="es-meta">
      <label for="es-l-${id}">文字数制限</label>
      <input type="number" inputmode="numeric" class="input es-limit" id="es-l-${id}" min="1" max="${L.answer}" step="1" value="${esc(r.limit ?? "")}" placeholder="なし" data-nf="limit">
      <span>字</span>
    </div>
    <textarea class="input note-text" id="es-a-${id}" rows="6" maxlength="${L.answer}" aria-label="回答" placeholder="回答" data-nf="answer">${esc(r.answer)}</textarea>
    <div class="note-f">
      ${countHTML(r)}
      <span class="es-acts">
        <button type="button" class="qa" id="es-copy-${id}" data-ncopy="${id}">コピー</button>
        <button type="button" class="qa" id="es-pick-${id}" data-npick="${id}">他社のESを読み込む</button>
      </span>
    </div>
    <p class="hint es-msg" id="es-m-${id}" role="status"></p>
  </li>`;
}
/** Counter: 「123 / 400字・あと277字」, warning colour when over the limit. */
export function countHTML(r) {
  const st = limitStatus(esCount(r.answer), normalizeLimit(r.limit));
  return `<span class="es-count num${st.over ? " over" : ""}" id="es-c-${esc(r.id)}" aria-live="polite">${esc(st.text)}${st.rest ? `<span class="es-rest">${esc(st.rest)}</span>` : ""}</span>`;
}
function ivRow(r) {
  const id = esc(r.id);
  return `<li class="note" data-n="${id}">
    <div class="note-h iv">
      <input type="date" class="input" id="iv-d-${id}" value="${esc(r.date)}" aria-label="面接の日付" data-nf="date">
      <input class="input" id="iv-t-${id}" value="${esc(r.title)}" list="iv-title-suggest" maxlength="${L.title}" autocomplete="off" placeholder="例：一次面接" aria-label="面接の名前" data-nf="title">
      <button type="button" class="sed-b del" id="iv-del-${id}" data-ndel="${id}" aria-label="この面接の記録を削除" title="削除">✕</button>
    </div>
    <label class="note-l" for="iv-q-${id}">聞かれた質問</label>
    <textarea class="input note-text" id="iv-q-${id}" rows="4" maxlength="${L.text}" data-nf="questions">${esc(r.questions)}</textarea>
    <label class="note-l" for="iv-r-${id}">振り返り</label>
    <textarea class="input note-text" id="iv-r-${id}" rows="3" maxlength="${L.text}" data-nf="reflection">${esc(r.reflection)}</textarea>
  </li>`;
}

/** kind: "es" | "iv". get/set access the draft array; changed() updates counters. */
export function createNotesEditor(kind, { get, set, changed, onPick = null }) {
  async function copyAnswer(id) {
    const r = get().find((x) => x.id === id); if (!r) return;
    const msg = $(`es-m-${id}`);
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(r.answer);
      msg.textContent = "コピーしました";
    } catch (e) {
      // fallback: select the text so the user can copy it themselves
      const ta = $(`es-a-${id}`); ta.focus(); ta.select();
      let ok = false;
      try { ok = document.execCommand && document.execCommand("copy"); } catch (_) { ok = false; }
      msg.textContent = ok ? "コピーしました" : "回答を選択しました。コピーしてください";
    }
    setTimeout(() => { if (msg.isConnected) msg.textContent = ""; }, 2500);
  }
  const listId = `${kind}-list`, errId = `${kind}-err`, addId = `btn-${kind}-add`;
  function render() {
    const rows = get();
    $(listId).innerHTML = rows.length ? rows.map(kind === "es" ? esRow : ivRow).join("") : `<li class="hint note-empty">${EMPTY[kind]}</li>`;
  }
  $(listId).addEventListener("input", (e) => {
    const f = e.target.dataset.nf; const li = e.target.closest("li[data-n]");
    if (!f || !li) return;
    const r = get().find((x) => x.id === li.dataset.n); if (!r) return;
    r[f] = e.target.value;
    if (kind === "es" && (f === "answer" || f === "limit")) $(`es-c-${r.id}`).outerHTML = countHTML(r);
    $(errId).textContent = "";
  });
  $(listId).addEventListener("click", (e) => {
    const cp = e.target.closest("[data-ncopy]");
    if (cp) { copyAnswer(cp.dataset.ncopy); return; }
    const pk = e.target.closest("[data-npick]");
    if (pk && onPick) { onPick(pk.dataset.npick); return; }
    const b = e.target.closest("[data-ndel]"); if (!b) return;
    const rows = get(); const i = rows.findIndex((r) => r.id === b.dataset.ndel); if (i < 0) return;
    rows.splice(i, 1); set(rows); render(); changed();
    const near = rows[Math.min(i, rows.length - 1)];
    ($(near ? `${kind}-del-${near.id}` : addId)).focus();
  });
  $(addId).addEventListener("click", () => {
    const rows = get();
    if (rows.length >= L.entries) { $(errId).textContent = `${L.entries}件までです。`; return; }
    const r = kind === "es"
      ? { id: newNoteId("q"), question: "", answer: "", limit: "", updatedAt: "" }
      : { id: newNoteId("v"), date: "", title: "", questions: "", reflection: "" };
    rows.push(r); set(rows); render(); changed();
    $(kind === "es" ? `es-q-${r.id}` : `iv-d-${r.id}`).focus();
  });
  return { render };
}

/** Draft rows -> notes; empty entries dropped, ES updatedAt refreshed on change. */
export function notesFromDraft(es, iv, original, nowIso) {
  const orig = new Map((original ? original.es : []).map((e) => [e.id, e]));
  const outEs = es.filter((r) => r.question.trim() || r.answer.trim()).map((r) => {
    const o = orig.get(r.id);
    const limit = normalizeLimit(r.limit);
    const same = o && o.question === r.question.trim() && o.answer === r.answer && (o.limit ?? null) === limit;
    return { id: r.id, question: r.question.trim(), answer: r.answer, limit, updatedAt: same ? o.updatedAt : nowIso };
  });
  const outIv = iv.filter((r) => r.date || r.title.trim() || r.questions.trim() || r.reflection.trim())
    .map((r) => ({ id: r.id, date: r.date, title: r.title.trim(), questions: r.questions, reflection: r.reflection }));
  outIv.sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
  return { es: outEs, interviews: outIv };
}
