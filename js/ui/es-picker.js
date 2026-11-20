/* 「他社のESから使う」: pick an answer from other records inside the dialog. */
import { $, esc } from "./html.js";
import { esLibrary, ES_CATEGORIES } from "../es.js";
import { newNoteId } from "../notes.js";
import { kindChip } from "./list.js";

/**
 * cfg: {companies(), excludeId(), getDraft(), setDraft(rows), afterChange(focusId)}
 * open(targetId?) — with a target, the chosen answer replaces that entry's answer.
 */
export function createEsPicker(cfg) {
  const st = { q: "", cat: "all", items: [], pick: null, target: null };
  const box = $("es-picker"), main = $("es-main");

  $("es-picker-cats").innerHTML = ["all", ...ES_CATEGORIES].map((c) =>
    `<button type="button" class="chip-btn" data-cat="${esc(c)}" aria-pressed="${c === "all"}">${c === "all" ? "すべて" : esc(c)}</button>`).join("");

  function renderList() {
    st.items = esLibrary(cfg.companies(), { excludeId: cfg.excludeId(), query: st.q, category: st.cat });
    for (const b of $("es-picker-cats").querySelectorAll("[data-cat]")) b.setAttribute("aria-pressed", String(b.dataset.cat === st.cat));
    $("es-picker-list").innerHTML = st.items.length ? st.items.map((x, i) => `<li><button type="button" class="pick-item" data-pick="${i}">
        <span class="pick-co"><b>${esc(x.company.name)}</b>${kindChip(x.company)}</span>
        <span class="pick-q">${esc(x.entry.question || "（設問なし）")}<span class="num pick-n">${x.count}字</span></span>
        <span class="pick-a">${esc(x.entry.answer)}</span>
      </button></li>`).join("")
      : `<li class="hint pick-none">${cfg.companies().some((c) => c.id !== cfg.excludeId() && c.notes.es.length) ? "条件に合うESがありません。" : "ほかの企業にESの記録がまだありません。"}</li>`;
  }
  function showPreview(i) {
    const x = st.items[i]; if (!x) return;
    st.pick = x;
    $("es-picker-prev-body").innerHTML = `<p class="pick-co"><b>${esc(x.company.name)}</b>${kindChip(x.company)}</p>
      <p class="pick-q">${esc(x.entry.question || "（設問なし）")}<span class="num pick-n">${x.count}字</span></p>
      <div class="pick-full" tabindex="0">${esc(x.entry.answer)}</div>`;
    $("btn-es-use").textContent = st.target ? "この回答に置き換え" : "この内容で追加";
    $("es-replace-confirm").hidden = true;
    $("es-picker-browse").hidden = true; $("es-picker-prev").hidden = false;
    $("btn-es-use").focus();
  }
  function backToList() { $("es-picker-prev").hidden = true; $("es-picker-browse").hidden = false; st.pick = null; }
  function open(targetId = null) {
    st.target = targetId; st.pick = null; st.q = ""; st.cat = "all";
    $("es-picker-title").textContent = targetId ? "他社のESを読み込む" : "他社のESから使う";
    $("es-picker-q").value = st.q;
    backToList(); renderList();
    main.hidden = true; box.hidden = false;
    $("es-picker-q").focus();
  }
  function close(focusId) {
    box.hidden = true; main.hidden = false;
    const el = focusId && $(focusId); (el || $("btn-es-pick")).focus();
  }
  function apply() {
    const x = st.pick; if (!x) return;
    const rows = cfg.getDraft();
    if (st.target) {
      const r = rows.find((e) => e.id === st.target); if (!r) return close();
      r.answer = x.entry.answer;
      if (!r.question.trim()) r.question = x.entry.question;
      cfg.setDraft(rows); cfg.afterChange(`es-a-${r.id}`, `${x.company.name}のESから置き換えました（元のESとは別に保存されます）`, r.id);
    } else {
      const r = { id: newNoteId("q"), question: x.entry.question, answer: x.entry.answer, limit: "", updatedAt: "" };
      rows.push(r); cfg.setDraft(rows);
      cfg.afterChange(`es-a-${r.id}`, `${x.company.name}のESをコピーして追加しました（元のESとは別に保存されます）`, r.id);
    }
    close(null);
  }

  let qt;
  $("es-picker-q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { st.q = e.target.value; renderList(); }, 120); });
  $("es-picker-cats").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) { st.cat = b.dataset.cat; renderList(); } });
  $("es-picker-list").addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) showPreview(Number(b.dataset.pick)); });
  $("btn-es-back").addEventListener("click", () => { backToList(); $("es-picker-q").focus(); });
  $("btn-es-picker-close").addEventListener("click", () => close(st.target ? `es-pick-${st.target}` : null));
  $("btn-es-use").addEventListener("click", () => {
    if (st.target) {
      const r = cfg.getDraft().find((e) => e.id === st.target);
      if (r && r.answer.trim() && $("es-replace-confirm").hidden) { $("es-replace-confirm").hidden = false; $("btn-es-replace-no").focus(); return; }
    }
    apply();
  });
  $("btn-es-replace-yes").addEventListener("click", apply);
  $("btn-es-replace-no").addEventListener("click", () => { $("es-replace-confirm").hidden = true; $("btn-es-use").focus(); });

  return { open, close: () => { box.hidden = true; main.hidden = false; }, isOpen: () => !box.hidden };
}
