/* 「比較」view: companies as columns, conditions as rows. */
import { esc } from "./html.js";
import { iconHTML } from "../icons.js";
import { COMPARE_FIELDS, RATINGS, bestIds, formatCell, overallRating, hasCompareData } from "../compare.js";
import { isOffer, isTerm, stageLabel, stageColor } from "../model.js";
import { kindChip } from "./list.js";

function pickerHTML(all, selected) {
  const order = all.slice().sort((a, b) => (isOffer(b) - isOffer(a)) || (hasCompareData(b) - hasCompareData(a)) || (isTerm(a.stage) - isTerm(b.stage)) || a.name.localeCompare(b.name, "ja"));
  return order.map((c) => `<button type="button" class="cmp-pick" data-act="cmp-toggle" data-id="${esc(c.id)}" aria-pressed="${selected.has(c.id)}">
      <span class="cmp-pick-n">${esc(c.name)}</span>${kindChip(c)}<span class="cmp-pick-s">${esc(stageLabel(c))}${hasCompareData(c) ? "・条件あり" : ""}</span>
    </button>`).join("");
}

/** state: {selectedIds, pickerOpen}. */
export function compareHTML(all, state, { iconUrl }) {
  const selected = new Set(state.selectedIds);
  const cols = state.selectedIds.map((id) => all.find((c) => c.id === id)).filter(Boolean);
  const head = `<div class="cmp-h">
      <h2 class="cmp-title">企業比較</h2>
      <button type="button" class="btn small" id="btn-cmp-pick" data-act="cmp-picker" aria-expanded="${state.pickerOpen}" aria-controls="cmp-picker">比べる企業を選ぶ<span class="num">（${cols.length}）</span></button>
    </div>
    <div class="cmp-picker" id="cmp-picker" role="group" aria-label="比べる企業"${state.pickerOpen ? "" : " hidden"}>
      ${all.length ? `<p class="hint">押すと比較に入れたり外したりできます。最初は「内定」の企業と、条件を入れた企業が並びます。</p><div class="cmp-picks">${pickerHTML(all, selected)}</div>` : `<p class="hint">まだ企業が登録されていません。</p>`}
    </div>`;
  if (!cols.length) {
    return `<section class="cmp" aria-label="企業比較">${head}
      <div class="empty cmp-empty">
        <h2>内定した企業や迷っている企業を、横に並べて比べられます</h2>
        <p>企業の編集画面の「条件」タブに、勤務地・初任給・年間休日・自分の評価などを入れて、比べたい企業を選びます。</p>
        <button type="button" class="btn primary" data-act="cmp-picker-open">条件を入力する企業を選ぶ</button>
      </div></section>`;
  }
  const th = cols.map((c) => `<th scope="col"><button type="button" class="cmp-col" data-act="cmp-open" data-id="${esc(c.id)}" title="${esc(c.name)}の条件を編集">
      ${iconHTML(c.name, iconUrl(c.iconId), 24)}<span class="cmp-col-n">${esc(c.name)}</span>
      <span class="cmp-col-m">${kindChip(c)}<span class="tag" style="--sc:${stageColor(c)}">${esc(stageLabel(c))}</span></span>
    </button></th>`).join("");
  const mark = `<span class="best-mark" aria-hidden="true">◎</span><span class="sr">（いちばん高い）</span>`;
  const cell = (txt, best) => `<td class="${best ? "best" : ""}">${txt ? esc(txt) + (best ? mark : "") : `<span class="cmp-none">—</span>`}</td>`;
  const rows = COMPARE_FIELDS.map((f) => {
    const best = f.better ? bestIds(cols, f.key) : new Set();
    return `<tr><th scope="row">${esc(f.label)}</th>${cols.map((c) => cell(formatCell(c, f), best.has(c.id))).join("")}</tr>`;
  });
  const rateRows = RATINGS.map(({ key, label }) => {
    const best = bestIds(cols, `r:${key}`);
    return `<tr class="cmp-rate"><th scope="row">評価：${esc(label)}</th>${cols.map((c) => { const v = c.compare.ratings[key]; return cell(v ? `${"★".repeat(v)}${"☆".repeat(5 - v)}` : "", best.has(c.id)); }).join("")}</tr>`;
  });
  const bestO = bestIds(cols, "overall");
  const overall = `<tr class="cmp-overall"><th scope="row">評価：総合</th>${cols.map((c) => { const o = overallRating(c.compare); return cell(o === null ? "" : o.toFixed(1), bestO.has(c.id)); }).join("")}</tr>`;
  return `<section class="cmp" aria-label="企業比較">${head}
    <p class="hint cmp-note">◎ は数字の項目でいちばん高い企業です。企業名を押すと「条件」を編集できます。</p>
    <div class="cmp-scroll" tabindex="0" role="region" aria-label="比較表（横にスクロールできます）">
      <table class="cmp-table">
        <thead><tr><th scope="col" class="cmp-corner">項目</th>${th}</tr></thead>
        <tbody>${rows.join("")}${rateRows.join("")}${overall}</tbody>
      </table>
    </div></section>`;
}
