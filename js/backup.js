/* Backup file format: serialize, validate, and plan an import. Pure. */
import { normalize, cleanStages, newId } from "./model.js";
import { parseDate } from "./dates.js";
import { notesErrors, MAX_KIND } from "./notes.js";

export const APP_ID = "shukatsu-board";
export const BACKUP_VERSION = 5;
export const MAX_FILE_BYTES = 60 * 1024 * 1024;
export const MAX_COMPANIES = 5000;
export const MAX_ICON_BYTES = 2 * 1024 * 1024;
const ICON_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function serializeBackup({ companies, template, icons, now = new Date() }) {
  return { app: APP_ID, version: BACKUP_VERSION, exportedAt: now.toISOString(), template: { stages: template }, companies, icons };
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
function magicOk(type, b) {
  const at = (i, s) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));
  if (type === "image/png") return b[0] === 0x89 && at(1, "PNG");
  if (type === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === "image/gif") return at(0, "GIF8");
  if (type === "image/webp") return at(0, "RIFF") && at(8, "WEBP");
  return false;
}
/** data URL -> {type, bytes} or an error string. */
export function decodeIcon(url) {
  if (typeof url !== "string") return "画像のデータ形式が正しくありません";
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(url);
  if (!m) return "画像のデータ形式が正しくありません";
  const type = m[1].toLowerCase();
  if (!ICON_TYPES.includes(type)) return `対応していない画像形式です（${type}）`;
  if (m[2].length > MAX_ICON_BYTES * 1.4) return "画像が大きすぎます";
  let bytes;
  try { bytes = b64ToBytes(m[2]); } catch (e) { return "画像のデータが壊れています"; }
  if (!bytes.length || bytes.length > MAX_ICON_BYTES) return "画像の大きさが正しくありません";
  if (!magicOk(type, bytes)) return "画像の中身が形式と一致しません";
  return { type, bytes };
}

function companyErrors(c) {
  const errs = [];
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["データの形式が正しくありません"];
  if (typeof c.name !== "string" || !c.name.trim()) errs.push("社名がありません");
  if (c.url != null && c.url !== "" && (typeof c.url !== "string" || !/^https?:\/\/\S+$/i.test(c.url))) errs.push("マイページURLが http(s) ではありません");
  if (c.events != null) {
    if (!Array.isArray(c.events)) errs.push("予定の形式が正しくありません");
    else if (c.events.some((e) => !e || typeof e !== "object" || !parseDate(e.at))) errs.push("日付が読めない予定があります");
  }
  if (c.nextDate != null && c.nextDate !== "" && !parseDate(c.nextDate)) errs.push("次の予定の日付が読めません");
  if (c.stages != null && !cleanStages(c.stages)) errs.push("選考段階の形式が正しくありません");
  if (c.history != null && !Array.isArray(c.history)) errs.push("履歴の形式が正しくありません");
  if (c.kind != null && (typeof c.kind !== "string" || c.kind.length > MAX_KIND)) errs.push(`選考の種類は${MAX_KIND}文字までの文字列にしてください`);
  errs.push(...notesErrors(c.notes));
  return errs;
}

/**
 * Validate a whole backup (text or parsed object). Nothing is partially
 * accepted: {ok:true, ...} only when every part is usable.
 */
export function validateBackup(input) {
  const errors = [];
  let data = input;
  if (typeof input === "string") {
    if (input.length > MAX_FILE_BYTES) return { ok: false, errors: ["ファイルが大きすぎます。"] };
    try { data = JSON.parse(input); } catch (e) { return { ok: false, errors: ["JSON 形式ではありません。"] }; }
  }
  if (!data || typeof data !== "object" || data.app !== APP_ID || !Array.isArray(data.companies)) {
    return { ok: false, errors: ["就活ボードのバックアップファイルではありません。"] };
  }
  if (!Number.isInteger(data.version) || data.version < 1 || data.version > BACKUP_VERSION) {
    return { ok: false, errors: [`対応していないバージョンのファイルです（version: ${String(data.version)}）。アプリを最新にしてから読み込んでください。`] };
  }
  if (!data.companies.length) errors.push("企業が1件も含まれていません。");
  if (data.companies.length > MAX_COMPANIES) errors.push("企業の数が多すぎます。");
  data.companies.slice(0, MAX_COMPANIES).forEach((c, i) => {
    for (const e of companyErrors(c)) errors.push(`${i + 1}件目${c && typeof c.name === "string" && c.name.trim() ? `（${c.name.trim().slice(0, 20)}）` : ""}：${e}`);
  });
  let template = null;
  if (data.template != null) {
    template = cleanStages(data.template && data.template.stages);
    if (!template) errors.push("段階テンプレートの形式が正しくありません。");
  }
  const icons = {};
  if (data.icons != null && (typeof data.icons !== "object" || Array.isArray(data.icons))) errors.push("アイコンの形式が正しくありません。");
  else for (const [id, url] of Object.entries(data.icons || {})) {
    const r = decodeIcon(url);
    if (typeof r === "string") errors.push(`アイコン（${id.slice(0, 12)}）：${r}`);
    else icons[id] = r;
  }
  if (errors.length) return { ok: false, errors };
  // older versions migrate through the same normalize() used on load
  const companies = data.companies.map((c) => normalize(c));
  const ids = new Set();
  for (const c of companies) { while (ids.has(c.id)) c.id = newId("c"); ids.add(c.id); }
  return { ok: true, version: data.version, exportedAt: parseDate(data.exportedAt), companies, icons, template, iconCount: companies.filter((c) => c.iconId && icons[c.iconId]).length };
}

/**
 * Turn a validated backup into the exact writes to perform.
 * mode "replace": clear everything, keep company ids, use the file's template.
 * mode "add": keep current data, give colliding companies new ids.
 * Icons always get fresh ids so they never overwrite existing ones.
 */
export function planImport(v, mode, existingIds = [], idGen = newId) {
  const taken = new Set(mode === "replace" ? [] : existingIds);
  const companies = []; const icons = [];
  for (const c of v.companies) {
    const rec = { ...c };
    if (taken.has(rec.id)) rec.id = idGen("c");
    taken.add(rec.id);
    const ic = c.iconId && v.icons[c.iconId];
    if (ic) { const id = idGen("i"); icons.push({ id, type: ic.type, bytes: ic.bytes }); rec.iconId = id; }
    else rec.iconId = "";
    companies.push(rec);
  }
  return { clear: mode === "replace", companies, icons, template: mode === "replace" ? v.template : null };
}

/** Should the app remind to back up? Data lives only on this device, so a lost
    phone or cleared browser data loses everything without a recent export.
    Reminds when there are own (non-sample) changes not yet in a backup and the
    last backup (or, if never, the first record) is at least `afterDays` old.
    Returns null or { never, days }. */
export function backupReminder({ companies, lastBackupAt = "", snoozeUntil = "", now = new Date(), afterDays = 7 }) {
  const own = (companies || []).filter((c) => !c.example);
  if (!own.length) return null;
  const t = (s) => { const d = s ? new Date(s) : null; return d && !isNaN(d) ? d.getTime() : NaN; };
  if (t(snoozeUntil) > now.getTime()) return null;
  const changes = own.map((c) => t(c.updatedAt)).filter((x) => !isNaN(x));
  const latest = changes.length ? Math.max(...changes) : NaN;
  const last = t(lastBackupAt);
  if (!isNaN(last) && !isNaN(latest) && latest <= last) return null;
  let ref = last;
  if (isNaN(ref)) {
    const firsts = own.flatMap((c) => [t(c.updatedAt), ...(c.history || []).map((h) => t(h.at))]).filter((x) => !isNaN(x));
    ref = firsts.length ? Math.min(...firsts) : NaN;
  }
  if (isNaN(ref)) return null;
  const days = Math.floor((now.getTime() - ref) / 86400000);
  return days >= afterDays ? { never: isNaN(last), days } : null;
}
