/* 企業比較: conditions per company and helpers for the comparison table. Pure. */

export const COMPARE_FIELDS = Object.freeze([
  { key: "location", label: "勤務地", type: "text", max: 60 },
  { key: "salary", label: "初任給（月給）", type: "int", unit: "円", min: 0, max: 10000000, better: "high" },
  { key: "annual", label: "想定年収", type: "int", unit: "万円", min: 0, max: 100000, better: "high" },
  { key: "bonus", label: "賞与", type: "text", max: 60 },
  { key: "holidays", label: "年間休日", type: "int", unit: "日", min: 0, max: 366, better: "high" },
  { key: "housing", label: "住宅補助", type: "choice", options: ["あり", "一部", "なし"] },
  { key: "transfer", label: "転勤", type: "choice", options: ["なし", "地域限定あり", "あり"] },
  { key: "workstyle", label: "勤務形態", type: "text", max: 60 },
  { key: "benefits", label: "福利厚生・その他", type: "text", max: 500 },
].map(Object.freeze));
export const RATINGS = Object.freeze([
  { key: "work", label: "仕事内容" }, { key: "growth", label: "成長" },
  { key: "comfort", label: "働きやすさ" }, { key: "stable", label: "安定" },
].map(Object.freeze));
const NOTE_MAX = 60; // detail text for choice fields (housingNote, transferNote)

const intIn = (v, min, max) => {
  const n = typeof v === "string" && v.trim() ? Number(v.replace(/[,，\s円]/g, "")) : v;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Tolerant: unknown or out-of-range values become empty. */
export function normalizeCompare(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const f of COMPARE_FIELDS) {
    if (f.type === "int") out[f.key] = intIn(src[f.key], f.min, f.max);
    else if (f.type === "choice") {
      out[f.key] = f.options.includes(src[f.key]) ? src[f.key] : "";
      out[f.key + "Note"] = str(src[f.key + "Note"], NOTE_MAX);
    } else out[f.key] = str(src[f.key], f.max);
  }
  const r = src.ratings && typeof src.ratings === "object" ? src.ratings : {};
  out.ratings = Object.fromEntries(RATINGS.map(({ key }) => [key, intIn(r[key], 1, 5)]));
  return out;
}

/** Strict check for backup files; returns error strings. */
export function compareErrors(raw) {
  if (raw == null) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) return ["比較の条件の形式が正しくありません"];
  const errs = [];
  for (const f of COMPARE_FIELDS) {
    const v = raw[f.key];
    if (v == null || v === "") continue;
    if (f.type === "int" && intIn(v, f.min, f.max) === null) errs.push(`${f.label}は${f.min}〜${f.max}の整数にしてください`);
    if (f.type === "text" && (typeof v !== "string" || v.length > f.max)) errs.push(`${f.label}は${f.max}文字までです`);
    if (f.type === "choice" && !f.options.includes(v)) errs.push(`${f.label}の値が正しくありません`);
  }
  if (raw.ratings != null) {
    if (typeof raw.ratings !== "object") errs.push("自分の評価の形式が正しくありません");
    else for (const { key, label } of RATINGS) {
      const v = raw.ratings[key];
      if (v != null && v !== "" && intIn(v, 1, 5) === null) errs.push(`評価「${label}」は1〜5にしてください`);
    }
  }
  return errs;
}

/** Average of the ratings that are filled in (one decimal), or null. */
export function overallRating(cmp) {
  const v = RATINGS.map(({ key }) => cmp && cmp.ratings && cmp.ratings[key]).filter((x) => Number.isInteger(x));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}
export function hasCompareData(c) {
  const cmp = c.compare; if (!cmp) return false;
  return COMPARE_FIELDS.some((f) => cmp[f.key] !== null && cmp[f.key] !== "") || RATINGS.some(({ key }) => cmp.ratings && cmp.ratings[key] != null);
}

/** Value of a numeric row: a field key, "r:<rating key>" or "overall". */
export function numericValue(c, row) {
  const cmp = c.compare || {};
  if (row === "overall") return overallRating(cmp);
  if (row.startsWith("r:")) return (cmp.ratings || {})[row.slice(2)] ?? null;
  const v = cmp[row];
  return typeof v === "number" ? v : null;
}
/** Ids holding the highest value in a row; empty unless at least 2 companies have a value. */
export function bestIds(companies, row) {
  const vals = companies.map((c) => [c.id, numericValue(c, row)]).filter(([, v]) => v !== null);
  if (vals.length < 2) return new Set();
  const max = Math.max(...vals.map(([, v]) => v));
  if (vals.every(([, v]) => v === max)) return new Set();
  return new Set(vals.filter(([, v]) => v === max).map(([id]) => id));
}

/**
 * Which companies are columns. A saved selection wins (ids that still exist);
 * otherwise 内定 companies plus any with conditions filled in.
 */
export function compareSelection(companies, saved, isOffer) {
  const ids = new Set(companies.map((c) => c.id));
  if (Array.isArray(saved)) return saved.filter((id) => ids.has(id));
  return companies.filter((c) => isOffer(c) || hasCompareData(c))
    .sort((a, b) => (isOffer(b) - isOffer(a)) || a.name.localeCompare(b.name, "ja") || a.kind.localeCompare(b.kind, "ja"))
    .map((c) => c.id);
}

/** Text searched by the toolbar search box. */
export const compareSearchText = (cmp) => (cmp ? [cmp.location, cmp.bonus, cmp.workstyle, cmp.benefits, cmp.housingNote, cmp.transferNote].filter(Boolean).join("\n") : "");

/** Display string for one cell ("" = empty). */
export function formatCell(c, f) {
  const cmp = c.compare || {};
  const v = cmp[f.key];
  if (f.type === "int") return v === null || v === undefined ? "" : `${v.toLocaleString("ja-JP")}${f.unit}`;
  if (f.type === "choice") return [v, cmp[f.key + "Note"]].filter(Boolean).join("（") + (v && cmp[f.key + "Note"] ? "）" : "");
  return v || "";
}
