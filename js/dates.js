/* Date helpers. Pure: no DOM, safe to run in Node. Dates are local time. */
export const WD = "日月火水木金土";
export const p2 = (n) => String(n).padStart(2, "0");

export function parseDate(iso) {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}
export function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
/** Whole calendar days from `now` to `d` (negative = past). */
export function dayDiff(d, now = new Date()) {
  return Math.round((dayStart(d) - dayStart(now)) / 86400000);
}
export function hasTime(d) { return d.getHours() !== 0 || d.getMinutes() !== 0; }
export function fmtDate(d, withTime = true) {
  let s = `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
  if (withTime && hasTime(d)) s += ` ${d.getHours()}:${p2(d.getMinutes())}`;
  return s;
}
export const fmtShort = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
export const fmtFull = (d) => `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`;
export const ymd = (d) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;

/** Has this moment passed? An event with a time is past once that minute has
    passed (10:00 deadline at 15:00 the same day = past). A date-only event
    (local midnight) stays current until the end of its day. */
export function isPast(d, now = new Date()) {
  return hasTime(d) ? d.getTime() < now.getTime() : dayDiff(d, now) < 0;
}

/** Due badge classification: {cls, text} where cls is past|today|soon|later. */
export function dueInfo(d, now = new Date()) {
  const n = dayDiff(d, now);
  if (isPast(d, now)) return { cls: "past", text: "期限切れ", days: Math.min(n, 0) };
  if (n === 0) return { cls: "today", text: "今日", days: 0 };
  if (n === 1) return { cls: "soon", text: "明日", days: 1 };
  if (n <= 3) return { cls: "soon", text: `あと${n}日`, days: n };
  return { cls: "later", text: `あと${n}日`, days: n };
}

/** ISO string -> values for <input type=date> / <input type=time>. */
export function toInputs(iso) {
  const d = parseDate(iso);
  if (!d) return { date: "", time: "" };
  return {
    date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    time: hasTime(d) ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : "",
  };
}
/** Input values -> ISO string (date only = local midnight), or "" if invalid. */
export function fromInputs(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return "";
  if (time && !/^\d{2}:\d{2}$/.test(time)) return "";
  const d = new Date(`${date}T${time || "00:00"}`);
  return isNaN(d) ? "" : d.toISOString();
}
