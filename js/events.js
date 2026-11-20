/* Scheduled events per company (deadlines, interviews). Pure. */
import { parseDate, dayDiff } from "./dates.js";

export const EVENT_LABELS = Object.freeze(["ES提出", "ES締切", "適性検査", "Webテスト締切", "説明会", "GD", "一次面接", "二次面接", "最終面接", "内定承諾期限"]);
export const MAX_EVENTS = 50;
export const MAX_EVENT_LABEL = 40;
const EV_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function evId() {
  const a = new Uint8Array(6);
  const c = globalThis.crypto;
  if (c && c.getRandomValues) c.getRandomValues(a); else a.forEach((_, i) => (a[i] = Math.random() * 256));
  return "e" + Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}
export const newEventId = evId;

/** Tolerant: keeps valid events; migrates legacy nextDate/nextLabel. */
export function normalizeEvents(raw, legacyDate, legacyLabel) {
  const out = []; const seen = new Set();
  if (Array.isArray(raw)) {
    for (const e of raw) {
      if (!e || typeof e !== "object" || !parseDate(e.at)) continue;
      let id = typeof e.id === "string" && EV_ID_RE.test(e.id) ? e.id : evId();
      while (seen.has(id)) id = evId();
      seen.add(id);
      out.push({ id, at: e.at, label: typeof e.label === "string" ? e.label.slice(0, MAX_EVENT_LABEL) : "", done: e.done === true });
      if (out.length >= MAX_EVENTS) break;
    }
  } else if (parseDate(legacyDate)) {
    out.push({ id: "legacy", at: legacyDate, label: typeof legacyLabel === "string" ? legacyLabel.slice(0, MAX_EVENT_LABEL) : "", done: false });
  }
  return out.sort((a, b) => parseDate(a.at) - parseDate(b.at));
}

export const pendingEvents = (c) => (c.events || []).filter((e) => !e.done && parseDate(e.at));

/** Nearest not-done event: the first upcoming one (today counts), otherwise
    the most recent overdue one. {event, overdue, more} or null. */
export function nearestEvent(c, now = new Date()) {
  const pend = pendingEvents(c).map((e) => ({ e, d: parseDate(e.at) })).sort((a, b) => a.d - b.d);
  if (!pend.length) return null;
  const up = pend.find((x) => dayDiff(x.d, now) >= 0);
  const pick = up || pend[pend.length - 1];
  return { event: pick.e, overdue: !up, more: pend.length - 1 };
}
export function nearestTime(c, now = new Date()) {
  const n = nearestEvent(c, now);
  return n ? parseDate(n.event.at).getTime() : Infinity;
}

/** Next `limit` not-done events across companies, overdue up to `overdueDays`. */
/** Summary agenda, split so overdue items never push out what is coming up.
    upcoming: today or later, soonest first (up to `limit`).
    overdue: before today and not done, most recent first (up to `overdueLimit`);
    overdueTotal counts all of them. */
export function agenda(companies, { now = new Date(), limit = 5, overdueLimit = 3, include = () => true } = {}) {
  const up = [], over = [];
  for (const c of companies) {
    if (!include(c)) continue;
    for (const e of pendingEvents(c)) {
      const d = parseDate(e.at);
      (dayDiff(d, now) >= 0 ? up : over).push({ company: c, event: e, date: d });
    }
  }
  up.sort((a, b) => a.date - b.date);
  over.sort((a, b) => b.date - a.date);
  return { upcoming: up.slice(0, limit), overdue: over.slice(0, overdueLimit), overdueTotal: over.length };
}

/** Mark one event done (pure). Returns the same object if nothing changes. */
export function withEventDone(c, eventId, now = new Date()) {
  if (!(c.events || []).some((e) => e.id === eventId && !e.done)) return c;
  return { ...c, events: c.events.map((e) => (e.id === eventId ? { ...e, done: true } : e)), updatedAt: now.toISOString() };
}

/** Dialog rows {id,date,time,label,done} -> events, or {error}. Empty rows are dropped. */
export function eventsFromRows(rows, toIso) {
  const events = [];
  for (const r of rows) {
    const label = String(r.label || "").trim();
    if (!r.date && !r.time && !label) continue;
    if (!r.date) return { error: "日付が入っていない予定があります。日付を入れるか、その予定を削除してください。", id: r.id };
    const at = toIso(r.date, r.time);
    if (!at) return { error: "日付または時刻が正しくない予定があります。", id: r.id };
    events.push({ id: r.id, at, label: label.slice(0, MAX_EVENT_LABEL), done: r.done === true });
  }
  if (events.length > MAX_EVENTS) return { error: `予定は${MAX_EVENTS}件までです。` };
  return { events: events.sort((a, b) => parseDate(a.at) - parseDate(b.at)) };
}
