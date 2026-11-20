/* Month grid for the calendar view. Pure. Weeks start on Sunday (日〜土). */
import { parseDate, p2 } from "./dates.js";

export const localYmd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}
/** Shift a {y, m} month (m is 0-11) by `delta` months. */
export function addMonths({ y, m }, delta) {
  const t = y * 12 + m + delta;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}

/**
 * Weeks covering the month, including leading/trailing days of the
 * neighbouring months so every week has 7 cells (4–6 weeks).
 * Each cell: {date, ymd, day, dow, inMonth, isToday}.
 */
export function monthGrid(y, m, today = new Date()) {
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());
  const last = new Date(y, m + 1, 0);
  const end = new Date(y, m + 1, 0 + (6 - last.getDay()));
  const todayYmd = localYmd(today);
  const weeks = []; let week = [];
  for (let d = start; d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const ymd = localYmd(d);
    week.push({ date: d, ymd, day: d.getDate(), dow: d.getDay(), inMonth: d.getMonth() === m, isToday: ymd === todayYmd });
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  return weeks;
}

/** Group events by local day: Map ymd -> [{company, event, date}] sorted by time. */
export function eventsByDay(companies, { from, to, include = () => true } = {}) {
  const map = new Map();
  for (const c of companies) {
    if (!include(c)) continue;
    for (const e of c.events || []) {
      const d = parseDate(e.at);
      if (!d || (from && d < from) || (to && d >= to)) continue;
      const k = localYmd(d);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push({ company: c, event: e, date: d });
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.date - b.date || a.company.name.localeCompare(b.company.name, "ja"));
  return map;
}
