/* Month calendar view of events. */
import { esc } from "./html.js";
import { iconHTML, hue } from "../icons.js";
import { monthGrid, eventsByDay, parseYmd, localYmd } from "../calendar.js";
import { WD, hasTime, p2 } from "../dates.js";
import { isTerm, stageLabel } from "../model.js";
import { kindChip } from "./list.js";

const MAX_LABELS = 3;
const MAX_DOTS = 4;
const short = (name) => {
  const n = String(name || "").replace(/^(株式会社|有限会社|合同会社|（株）|\(株\)|㈱)\s*/, "").replace(/(株式会社|（株）|\(株\)|㈱)$/, "");
  const a = Array.from(n);
  return a.length > 6 ? a.slice(0, 6).join("") + "…" : n;
};
const tone = (c) => { const k = hue(c.name); return `--mgb:var(--mg${k}-b);--mgi:var(--mg${k}-i)`; };
const timeOf = (d) => (hasTime(d) ? `${d.getHours()}:${p2(d.getMinutes())}` : "終日");

/**
 * state: {y, m, sel}. companies are already filtered by the toolbar;
 * ended companies are left out here.
 */
export function calendarHTML(companies, state, { iconUrl, now = new Date() }) {
  const weeks = monthGrid(state.y, state.m, now);
  const from = weeks[0][0].date;
  const last = weeks[weeks.length - 1][6].date;
  const to = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  const byDay = eventsByDay(companies, { from, to, include: (c) => !isTerm(c.stage) });
  const head = [...WD].map((w, i) => `<div class="cal-wd${i === 0 ? " sun" : i === 6 ? " sat" : ""}" role="columnheader">${w}</div>`).join("");
  const cells = weeks.map((wk) => `<div class="cal-week" role="row">${wk.map((d) => {
    const items = byDay.get(d.ymd) || [];
    const pending = items.filter((x) => !x.event.done).length;
    const cls = ["cal-day", d.inMonth ? "" : "out", d.isToday ? "today" : "", d.ymd === state.sel ? "sel" : "", d.dow === 0 ? "sun" : d.dow === 6 ? "sat" : ""].filter(Boolean).join(" ");
    const labels = items.slice(0, MAX_LABELS).map((x) => `<span class="cal-ev${x.event.done ? " done" : ""}" style="${tone(x.company)}">${esc(short(x.company.name))} ${esc(x.event.label || stageLabel(x.company))}</span>`).join("");
    const more = items.length > MAX_LABELS ? `<span class="cal-more">+${items.length - MAX_LABELS}</span>` : "";
    const dots = items.slice(0, MAX_DOTS).map((x) => `<i class="${x.event.done ? "done" : ""}" style="${tone(x.company)}"></i>`).join("") + (items.length > MAX_DOTS ? `<b>+${items.length - MAX_DOTS}</b>` : "");
    const aria = `${d.date.getMonth() + 1}月${d.day}日（${WD[d.dow]}）${items.length ? `、予定${items.length}件${pending !== items.length ? `（未完了${pending}件）` : ""}` : ""}${d.isToday ? "、今日" : ""}`;
    return `<button type="button" role="gridcell" class="${cls}" data-act="cal-day" data-day="${d.ymd}" id="cal-${d.ymd}" aria-label="${aria}" aria-selected="${d.ymd === state.sel}"${d.ymd === state.sel ? "" : ' tabindex="-1"'}>
      <span class="cal-n num">${d.day}</span>
      ${items.length ? `<span class="cal-evs">${labels}${more}</span><span class="cal-dots" aria-hidden="true">${dots}</span>` : ""}
    </button>`;
  }).join("")}</div>`).join("");

  const sel = parseYmd(state.sel);
  const dayItems = byDay.get(state.sel) || (sel ? eventsByDay(companies, { from: sel, to: new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() + 1), include: (c) => !isTerm(c.stage) }).get(state.sel) : null) || [];
  const dayList = dayItems.length ? dayItems.map(({ company: c, event: e, date: d }) => `<li class="cal-item${e.done ? " done" : ""}">
      <button type="button" class="cal-open" data-act="edit" data-id="${esc(c.id)}">
        <span class="cal-time num">${timeOf(d)}</span>
        ${iconHTML(c.name, iconUrl(c.iconId), 24)}
        <span class="cal-what"><span class="cal-co"><b>${esc(c.name)}</b>${kindChip(c)}</span><span class="cal-lbl">${esc(e.label || stageLabel(c))}</span></span>
      </button>
      <button type="button" class="qa cal-done" data-act="${e.done ? "ev-undone" : "ev-done"}" data-id="${esc(c.id)}" data-ev="${esc(e.id)}" aria-pressed="${e.done}" aria-label="${esc(c.name)}の${esc(e.label || "予定")}を${e.done ? "未完了に戻す" : "完了にする"}">${e.done ? "✓ 完了" : "完了"}</button>
    </li>`).join("") : `<li class="hint cal-none">この日の予定はありません。</li>`;
  const selTitle = sel ? `${sel.getMonth() + 1}月${sel.getDate()}日（${WD[sel.getDay()]}）の予定` : "予定";

  return `<section class="cal" aria-label="カレンダー">
    <div class="cal-h">
      <button type="button" class="btn cal-nav" data-act="cal-prev" id="cal-prev" aria-label="前の月" title="前の月">‹</button>
      <h2 class="cal-title" id="cal-title" aria-live="polite">${state.y}年${state.m + 1}月</h2>
      <button type="button" class="btn cal-nav" data-act="cal-next" id="cal-next" aria-label="次の月" title="次の月">›</button>
      <button type="button" class="btn small" data-act="cal-today" id="cal-today">今日</button>
    </div>
    <div class="cal-grid" role="grid" aria-labelledby="cal-title">
      <div class="cal-week cal-head" role="row">${head}</div>
      ${cells}
    </div>
    <div class="cal-list">
      <h3 id="cal-sel-title">${selTitle}</h3>
      <ul class="cal-items" aria-labelledby="cal-sel-title">${dayList}</ul>
    </div>
  </section>`;
}

export const todayState = (now = new Date()) => ({ y: now.getFullYear(), m: now.getMonth(), sel: localYmd(now) });
