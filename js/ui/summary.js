/* Summary strip: counts and 直近の予定. */
import { $, esc } from "./html.js";
import { iconHTML } from "../icons.js";
import { fmtDate } from "../dates.js";
import { upcomingEvents, pendingEvents } from "../events.js";
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

export function renderUpcoming(all, iconUrl, now = new Date()) {
  const items = upcomingEvents(all, { now, include: (c) => !isTerm(c.stage) });
  const el = $("upcoming");
  if (!items.length) {
    el.innerHTML = `<li class="up-empty">${all.length ? "未完了の予定はありません。編集画面の「予定」で追加するとここに出ます。" : "企業を登録すると、締切や面接日が日付順に並びます。"}</li>`;
    return;
  }
  el.innerHTML = items.map(({ company: c, event: e, date: d }) => `<li><button type="button" class="up-item" data-act="edit" data-id="${esc(c.id)}">
      <span class="up-date">${esc(fmtDate(d))}</span>
      <span class="up-what" style="display:flex;align-items:center;gap:7px">${iconHTML(c.name, iconUrl(c.iconId), 20)}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis"><b>${esc(c.name)}</b><span>${esc(e.label || stageLabel(c))}</span></span></span>
      ${dueBadgeHTML(d, now)}</button></li>`).join("");
}
