/*
 * Keeping track of what was exported to calendar apps. An .ics file is a
 * snapshot: re-importing it does not update or remove events in most apps.
 * We remember, per UID, a hash of what went into the file so the export
 * panel can say what changed since. Pure.
 */
import { parseDate, isPast } from "./dates.js";
import { isTerm, stageLabel } from "./model.js";
import { uidFor } from "./ics.js";

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
const label = (c, e) => e.label || stageLabel(c);
/**
 * h: every field written to the file (SEQUENCE goes up when it changes).
 * k: what people see in their calendar (date/time, title) — a change there
 *    is worth telling them about; a stage or URL change alone is not.
 */
export function fingerprint(c, e) {
  const t = parseDate(e.at);
  const at = t ? t.toISOString() : "";
  const k = fnv(JSON.stringify([at, label(c, e), c.name, c.kind]));
  const h = fnv(JSON.stringify([at, label(c, e), c.name, c.kind, c.position, stageLabel(c), c.url]));
  return { h, k, at, label: label(c, e), company: c.name };
}

/** Events that may appear in a calendar file: not done, company not ended. */
export function exportable(companies) {
  const out = [];
  for (const c of companies) {
    if (isTerm(c.stage) || c.deletedAt) continue;
    for (const e of c.events || []) if (!e.done && parseDate(e.at)) out.push({ company: c, event: e, uid: uidFor(c, e) });
  }
  return out;
}

export const emptySnapshot = () => ({ at: "", items: {} });
export function cleanSnapshot(s) {
  if (!s || typeof s !== "object" || !s.items || typeof s.items !== "object") return emptySnapshot();
  const items = {};
  for (const [uid, v] of Object.entries(s.items)) {
    if (!v || typeof v !== "object" || typeof v.h !== "string") continue;
    items[uid] = { h: v.h, k: String(v.k || ""), seq: Number.isInteger(v.seq) && v.seq >= 0 ? v.seq : 0, at: String(v.at || ""), label: String(v.label || ""), company: String(v.company || "") };
  }
  return { at: typeof s.at === "string" ? s.at : "", items };
}

/**
 * Compare current events with the last export.
 * added: never exported and not already past (past ones would only be noise)
 * changed: exported, but something in the file would differ (major = date/time/title)
 * removed: exported, but deleted / done / company ended
 */
export function diffExport(companies, snapshot, now = new Date()) {
  const snap = cleanSnapshot(snapshot);
  const cur = exportable(companies);
  const seen = new Set();
  const added = [], changed = [];
  for (const x of cur) {
    seen.add(x.uid);
    const fp = fingerprint(x.company, x.event);
    const prev = snap.items[x.uid];
    if (!prev) { if (!isPast(parseDate(x.event.at), now)) added.push({ ...x, fp }); continue; }
    if (prev.h !== fp.h) changed.push({ ...x, fp, before: prev, major: prev.k !== fp.k });
  }
  const removed = Object.entries(snap.items).filter(([uid]) => !seen.has(uid)).map(([uid, before]) => ({ uid, before }));
  const sort = (a, b) => String(a.fp ? a.fp.at : a.before.at).localeCompare(String(b.fp ? b.fp.at : b.before.at));
  added.sort(sort); changed.sort(sort); removed.sort(sort);
  return { exported: !!snap.at, added, changed, removed, notable: changed.filter((x) => x.major).length + removed.length };
}

/**
 * Sequence numbers for the events about to be written and the snapshot to
 * save afterwards. mode "full": the file replaces what was imported before
 * (removed UIDs are forgotten). mode "merge": only these UIDs are updated.
 */
export function planExport(items, snapshot, { now = new Date(), mode = "merge" } = {}) {
  const snap = cleanSnapshot(snapshot);
  const next = mode === "full" ? {} : { ...snap.items };
  const seq = {};
  for (const { company: c, event: e } of items) {
    const uid = uidFor(c, e);
    const fp = fingerprint(c, e);
    const prev = snap.items[uid];
    const s = prev ? (prev.h === fp.h ? prev.seq : prev.seq + 1) : 0;
    seq[uid] = s;
    next[uid] = { h: fp.h, k: fp.k, seq: s, at: fp.at, label: fp.label, company: fp.company };
  }
  return { seq, snapshot: { at: now.toISOString(), items: next } };
}

/**
 * The user fixed their calendar app by hand: record the current state as what
 * the calendar holds, so the "違いがあります" notice stops. Changed events take
 * their current fingerprint (sequence +1, as a later file would), removed ones
 * are forgotten, new (never exported) ones are left alone. The export date stays.
 */
export function acknowledgeDiff(companies, snapshot, now = new Date()) {
  const snap = cleanSnapshot(snapshot);
  if (!snap.at) return snap;
  const d = diffExport(companies, snap, now);
  const items = { ...snap.items };
  for (const x of d.changed) {
    const prev = items[x.uid];
    items[x.uid] = { h: x.fp.h, k: x.fp.k, seq: prev.seq + 1, at: x.fp.at, label: x.fp.label, company: x.fp.company };
  }
  for (const x of d.removed) delete items[x.uid];
  return { at: snap.at, items };
}

const TERM = { rejected: "不合格", declined: "辞退" };
/**
 * Calendar-visible changes to exported events caused by one edit.
 * before/after: the company record before and after (after = null when the
 * company was deleted). Only UIDs present in the export snapshot count.
 * Returns [{type:"changed"|"removed", uid, before:{at,label,company}, after?:{at,label}, reason?}].
 */
export function exportedChanges(before, after, snapshot) {
  const snap = cleanSnapshot(snapshot);
  if (!before || !snap.at) return [];
  const out = [];
  for (const e of before.events || []) {
    const uid = uidFor(before, e);
    if (!snap.items[uid] || e.done || isTerm(before.stage) || before.deletedAt) continue; // only what was live before this edit
    const was = fingerprint(before, e);
    let reason = "";
    const ae = after ? (after.events || []).find((x) => x.id === e.id) : null;
    if (!after || after.deletedAt) reason = "削除";
    else if (isTerm(after.stage)) reason = TERM[after.stage];
    else if (!ae) reason = "予定を削除";
    else if (ae.done) reason = "完了";
    if (reason) { out.push({ type: "removed", uid, reason, before: { at: was.at, label: was.label, company: was.company } }); continue; }
    const now = fingerprint(after, ae);
    if (now.k !== was.k) out.push({ type: "changed", uid, before: { at: was.at, label: was.label, company: was.company }, after: { at: now.at, label: now.label, company: now.company } });
  }
  return out;
}
