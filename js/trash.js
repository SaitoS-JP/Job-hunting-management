/* 削除した企業 (trash): soft delete, restore and the 30-day purge. Pure. */
export const KEEP_DAYS = 30;
const DAY = 86400000;
const t = (s) => { const d = s ? new Date(s) : null; return d && !isNaN(d) ? d.getTime() : NaN; };

export const isDeleted = (c) => !!(c && c.deletedAt);
export const withDeleted = (c, now = new Date()) => ({ ...c, deletedAt: now.toISOString() });
export const withRestored = (c) => ({ ...c, deletedAt: "" });

/** Whole days left before a trashed company is removed for good (0 = today). */
export function daysLeft(c, now = new Date(), keepDays = KEEP_DAYS) {
  const at = t(c.deletedAt);
  if (isNaN(at)) return null;
  return Math.max(0, Math.ceil((at + keepDays * DAY - now.getTime()) / DAY));
}

/**
 * Records to remove permanently: deleted more than `keepDays` ago.
 * iconIds: icons that no remaining record (deleted or not) still uses.
 */
export function purgeSelection(records, now = new Date(), keepDays = KEEP_DAYS) {
  const limit = now.getTime() - keepDays * DAY;
  const purge = records.filter((c) => isDeleted(c) && t(c.deletedAt) < limit);
  const ids = new Set(purge.map((c) => c.id));
  const used = new Set(records.filter((c) => !ids.has(c.id)).map((c) => c.iconId).filter(Boolean));
  return { records: purge, iconIds: [...new Set(purge.map((c) => c.iconId).filter((i) => i && !used.has(i)))] };
}
/** Icon ids that can go when these records are removed now (not used by any other record). */
export function orphanIcons(removed, all) {
  const ids = new Set(removed.map((c) => c.id));
  const used = new Set(all.filter((c) => !ids.has(c.id)).map((c) => c.iconId).filter(Boolean));
  return [...new Set(removed.map((c) => c.iconId).filter((i) => i && !used.has(i)))];
}
/** Split loaded records into the active list and the trash (newest deletion first). */
export function splitTrash(records) {
  const active = [], trash = [];
  for (const c of records) (isDeleted(c) ? trash : active).push(c);
  trash.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  return { active, trash };
}
