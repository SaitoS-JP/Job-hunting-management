/* Summary strip: counts and 直近の予定. */
import { $, esc } from "./html.js";
import { iconHTML } from "../icons.js";
import { fmtDate } from "../dates.js";
import { agenda, pendingEvents } from "../events.js";
import { isTerm, atLast, isActive, stageLabel } from "../model.js";
import { dueBadgeHTML } from "./list.js";

export function renderStats(all) {
  const activeList = all.filter(isActive);
  const withNext = activeList.filter((c) => pendingEvents(c).length).length;
  const offer = all.filter(atLast).length;
  const rej = all.filter((c) => c.stage === "rejected").length;
  const dec = all.filter((c) => c.stage === "declined").length;
  const active = activeList.length;
  const segs = [["選考中", active, "var(--accent)"], ["内定", offer, "var(--st-offer)"], ["不合格", rej, "var(--st-rejected)"], ["辞退", dec, "var(--muted)"]];
  const bar = all.length ? segs.map(([l, n, col]) => (n ? `<span style="width:${(n / all.length) * 100}%;background:${col}" title="${l} ${n}"></span>` : "")).join("") : "";
  $("stats").innerHTML = `
    <div class="stat"><div class="k">選考中</div><div class="v">${active}</div><div class="d">うち予定あり <span class="num">${withNext}</span></div></div>
    <div class="stat offer"><div class="k">内定</div><div class="v">${offer}</div><div class="d">全<span class="num">${all.length}</span>社中</div></div>
    <div class="stat"><div class="k">終了</div><div class="v">${rej + dec}</div><div class="d">不合格 <span class="num">${rej}</span>・辞退 <span class="num">${dec}</span></div></div>
    <div class="stagebar" role="img" aria-label="選考中 ${active}・内定 ${offer}・不合格 ${rej}・辞退 ${dec}">${bar}</div>`;
}

function itemHTML({ company: c, event: e, date: d }, iconUrl, now, doneBtn) {
  return `<li class="up-row"><button type="button" class="up-item" data-act="edit" data-id="${esc(c.id)}">
      <span class="up-date">${esc(fmtDate(d))}</span>
      <span class="up-what" style="display:flex;align-items:center;gap:7px">${iconHTML(c.name, iconUrl(c.iconId), 20)}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis"><b>${esc(c.name)}</b>${c.kind !== "本選考" ? `<span class="kind-t">${esc(c.kind)}</span>` : ""}<span>${esc(e.label || stageLabel(c))}</span></span></span>
      ${dueBadgeHTML(d, now)}</button>${doneBtn ? `<button type="button" class="qa up-done" data-act="ev-done" data-id="${esc(c.id)}" data-ev="${esc(e.id)}" aria-label="${esc(c.name)}の${esc(e.label || "予定")}を完了にする">完了</button>` : ""}</li>`;
}

export function renderUpcoming(all, iconUrl, now = new Date()) {
  const { upcoming, overdue, overdueTotal } = agenda(all, { now, include: (c) => !isTerm(c.stage) });
  const el = $("upcoming");
  let html = upcoming.length
    ? upcoming.map((x) => itemHTML(x, iconUrl, now, false)).join("")
    : `<li class="up-empty">${all.length ? "今日以降の未完了の予定はありません。編集画面の「予定」で追加するとここに出ます。" : "企業を登録すると、締切や面接日が日付順に並びます。"}</li>`;
  if (overdueTotal) {
    const rest = overdueTotal - overdue.length;
    html += `<li class="up-sub" role="presentation">期限切れ・未完了 <span class="num">${overdueTotal}</span>件<span class="hint">　済んだものは「完了」にすると消えます</span></li>`
      + overdue.map((x) => itemHTML(x, iconUrl, now, true)).join("")
      + (rest > 0 ? `<li class="up-more">ほか <span class="num">${rest}</span>件（各企業の編集画面で確認できます）</li>` : "");
  }
  el.innerHTML = html;
}
