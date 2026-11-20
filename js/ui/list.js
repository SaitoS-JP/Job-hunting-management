/* Company list rows. */
import { esc } from "./html.js";
import { iconHTML } from "../icons.js";
import { stepsHTML } from "./stepper.js";
import { parseDate, fmtDate, fmtShort, dueInfo } from "../dates.js";
import { nearestEvent, nearestTime } from "../events.js";
import { PRI, isTerm, reached, stageLabel, stageColor, stageIndex, progressRatio } from "../model.js";

export function dueBadgeHTML(d, now) {
  const i = dueInfo(d, now);
  const cls = i.cls === "later" ? "" : ` ${i.cls}`;
  const text = i.cls === "soon" && i.days > 1 || i.cls === "later" ? `あと<span class="num">${i.days}</span>日` : i.text;
  return `<span class="due${cls}">${text}</span>`;
}
export function priHTML(p) {
  const on = 4 - p;
  return `<span class="pri" title="${PRI[p]}" aria-label="志望度：${PRI[p]}">${"★".repeat(on)}<span class="off" aria-hidden="true">${"★".repeat(3 - on)}</span></span>`;
}
function nextHTML(c, now) {
  const n = nearestEvent(c, now);
  if (!n) return `<span class="hint">—</span>`;
  const d = parseDate(n.event.at);
  const more = n.more ? `<span class="more num" title="ほかに未完了の予定が${n.more}件">+${n.more}件</span>` : "";
  return `<div class="next"><span class="when">${esc(fmtDate(d))}${more}</span>${n.event.label ? `<span class="lbl">${esc(n.event.label)}</span>` : ""}${isTerm(c.stage) ? "" : dueBadgeHTML(d, now)}</div>`;
}
const sampleChip = (c) => (c.example ? `<span class="chip">サンプル</span>` : "");
function progHTML(c) {
  const term = isTerm(c.stage);
  const r = reached(c);
  const reach = term && r >= 0 ? `<span class="reach">${esc(c.stages[r].label)}で終了</span>` : "";
  return `<div class="prog" style="--sc:${stageColor(c)}"><span class="tag">${esc(stageLabel(c))}${reach}</span><div class="steps-scroll">${stepsHTML(c.stages, c.stage, r, false)}</div></div>`;
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
function cmpNext(a, b, now) { return nearestTime(a, now) - nearestTime(b, now) || a.priority - b.priority || a.name.localeCompare(b.name, "ja"); }
export function sortList(list, sort, now = new Date()) {
  const a = list.slice();
  const t = (c) => (isTerm(c.stage) ? 1 : 0);
  if (sort === "next") a.sort((x, y) => t(x) - t(y) || cmpNext(x, y, now));
  else if (sort === "priority") a.sort((x, y) => x.priority - y.priority || t(x) - t(y) || cmpNext(x, y, now));
  else if (sort === "stage") a.sort((x, y) => progressRatio(y) - progressRatio(x) || cmpNext(x, y, now));
  else a.sort((x, y) => (y.updatedAt || "").localeCompare(x.updatedAt || ""));
  return a;
}
export function listHTML(list, { sort, iconUrl, now = new Date() }) {
  const rows = sortList(list, sort, now).map((c) => {
    const u = parseDate(c.updatedAt);
    const id = esc(c.id);
    return `<div class="lrow" role="row">
      <div class="who" role="cell"><div class="who-in">${iconHTML(c.name, iconUrl(c.iconId), 28)}<div><button type="button" data-act="edit" data-id="${id}">${esc(c.name || "（社名未入力）")}</button>${sampleChip(c)}
        <span class="pos">${esc(c.position)}${c.industry ? ` <span class="ind">／${esc(c.industry)}</span>` : ""}</span></div></div></div>
      <div role="cell" class="prog-cell" style="min-width:0">${progHTML(c)}</div>
      <div role="cell" class="pricell">${priHTML(c.priority)}</div>
      <div role="cell">${nextHTML(c, now)}</div>
      <div role="cell" class="upd">${u ? fmtShort(u) : "—"}</div>
      <div role="cell" class="acts">${actsHTML(c)}</div>
    </div>`;
  }).join("");
  return `<div class="list" role="table" aria-label="企業一覧">
    <div class="lrow lhead" role="row"><span role="columnheader">社名・職種</span><span role="columnheader">選考段階</span><span role="columnheader">志望度</span><span role="columnheader">次の予定</span><span role="columnheader">更新</span><span role="columnheader" style="text-align:right">操作</span></div>
    ${rows}</div>`;
}
