/* iCalendar (RFC 5545) export so calendar apps can remind about events. Pure. */
import { parseDate, dayDiff, hasTime, p2 } from "./dates.js";
import { isTerm, stageLabel } from "./model.js";

export const REMINDERS = Object.freeze({
  week: "1週間前", d3: "3日前", d1: "前日", morning: "当日朝9時",
});
export const DEFAULT_REMINDERS = Object.freeze(["d3", "d1"]);

/** TEXT value escaping: backslash, semicolon, comma and newlines. */
export function escapeText(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

const enc = new TextEncoder();
/** Fold a content line at 75 octets without splitting a UTF-8 character. */
export function foldLine(line) {
  if (enc.encode(line).length <= 75) return line;
  const parts = []; let cur = ""; let bytes = 0; let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { parts.push(cur); cur = ""; bytes = 0; limit = 74; } // continuation lines start with a space
    cur += ch; bytes += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const utc = (d) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
const dateOnly = (d) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
function dur(min) { // positive minutes -> "P..": days/hours/minutes
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  let s = "P" + (d ? `${d}D` : "");
  if (h || m || !d) s += "T" + (h ? `${h}H` : "") + (m || (!h && !d) ? `${m}M` : "");
  return s;
}

/**
 * TRIGGER value for a reminder. All-day events start at local midnight, so
 * day-before reminders are moved to 9:00 (e.g. 前日 = -PT15H). For timed
 * events, 当日朝9時 is the offset back to 9:00 that day (at the start time
 * if the event begins at or before 9:00).
 */
export function triggerFor(key, start, allDay) {
  if (allDay) return { week: "-P6DT15H", d3: "-P2DT15H", d1: "-PT15H", morning: "PT9H" }[key] || null;
  if (key === "week") return "-P7D";
  if (key === "d3") return "-P3D";
  if (key === "d1") return "-P1D";
  if (key === "morning") {
    const mins = start.getHours() * 60 + start.getMinutes() - 9 * 60;
    return mins > 0 ? "-" + dur(mins) : "PT0M";
  }
  return null;
}

/** Not-done events of companies still in selection. range: "future" | "all". */
export function selectForExport(companies, { range = "future", now = new Date() } = {}) {
  const out = [];
  for (const c of companies) {
    if (isTerm(c.stage)) continue;
    for (const e of c.events || []) {
      const d = parseDate(e.at);
      if (!d || e.done) continue;
      if (range === "future" && dayDiff(d, now) < 0) continue;
      out.push({ company: c, event: e });
    }
  }
  return out.sort((a, b) => parseDate(a.event.at) - parseDate(b.event.at));
}

export const uidFor = (company, event) => `${event.id}-${company.id}@shukatsu-board`;
export const summaryFor = (c, e) => `${c.name}｜${e.label || stageLabel(c)}（${c.kind || "本選考"}）`;

export function buildICS(items, { now = new Date(), reminders = DEFAULT_REMINDERS } = {}) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//shukatsu-board//JA", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:就活ボード"];
  const stamp = utc(now);
  for (const { company: c, event: e } of items) {
    const start = parseDate(e.at);
    if (!start) continue;
    const allDay = !hasTime(start);
    const summary = summaryFor(c, e);
    const desc = [c.position && `職種：${c.position}`, `選考段階：${stageLabel(c)}`, c.url && `マイページ：${c.url}`].filter(Boolean).join("\n");
    L.push("BEGIN:VEVENT", `UID:${uidFor(c, e)}`, `DTSTAMP:${stamp}`);
    if (allDay) {
      const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      L.push(`DTSTART;VALUE=DATE:${dateOnly(start)}`, `DTEND;VALUE=DATE:${dateOnly(next)}`);
    } else {
      L.push(`DTSTART:${utc(start)}`, `DTEND:${utc(new Date(start.getTime() + 3600000))}`);
    }
    L.push(`SUMMARY:${escapeText(summary)}`, `DESCRIPTION:${escapeText(desc)}`);
    if (c.url && /^https?:\/\/\S+$/i.test(c.url)) L.push(`URL:${c.url}`);
    for (const key of reminders) {
      const trig = triggerFor(key, start, allDay);
      if (!trig) continue;
      L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(summary)}`, `TRIGGER:${trig}`, "END:VALARM");
    }
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(foldLine).join("\r\n") + "\r\n";
}
