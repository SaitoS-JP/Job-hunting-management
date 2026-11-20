/* Selection kind (本選考 / インターン …) and ES・面接 notes. Pure. */
import { compareSearchText } from "./compare.js";

export const KINDS = Object.freeze(["本選考", "サマーインターン", "オータムインターン", "ウィンターインターン", "早期選考", "その他"]);
export const DEFAULT_KIND = "本選考";
export const MAX_KIND = 20;
export const ES_QUESTIONS = Object.freeze(["志望動機", "自己PR", "ガクチカ", "入社後にやりたいこと", "長所・短所"]);
export const NOTE_LIMITS = Object.freeze({ entries: 50, question: 200, answer: 10000, title: 40, text: 10000 });
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nid(prefix) {
  const a = new Uint8Array(6);
  const c = globalThis.crypto;
  if (c && c.getRandomValues) c.getRandomValues(a); else a.forEach((_, i) => (a[i] = Math.random() * 256));
  return prefix + Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}
export const newNoteId = nid;

/** Missing or empty -> 本選考; free text allowed. */
export function normalizeKind(k) {
  const s = typeof k === "string" ? k.trim().slice(0, MAX_KIND) : "";
  return s || DEFAULT_KIND;
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
function uniqId(v, seen, prefix) {
  let id = typeof v === "string" && ID_RE.test(v) ? v : nid(prefix);
  while (seen.has(id)) id = nid(prefix);
  seen.add(id); return id;
}

/** 文字数制限: integer 1–10000, otherwise none (null). */
export function normalizeLimit(v) {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return Number.isInteger(n) && n >= 1 && n <= NOTE_LIMITS.answer ? n : null;
}

/** Tolerant normalization: oversized text is cut, broken entries dropped. */
export function normalizeNotes(n) {
  const L = NOTE_LIMITS;
  const src = n && typeof n === "object" && !Array.isArray(n) ? n : {};
  const seen = new Set();
  const es = (Array.isArray(src.es) ? src.es : []).filter((e) => e && typeof e === "object").slice(0, L.entries).map((e) => ({
    id: uniqId(e.id, seen, "q"),
    question: str(e.question, L.question),
    answer: str(e.answer, L.answer),
    limit: normalizeLimit(e.limit),
    updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : "",
  }));
  const interviews = (Array.isArray(src.interviews) ? src.interviews : []).filter((e) => e && typeof e === "object").slice(0, L.entries).map((e) => ({
    id: uniqId(e.id, seen, "v"),
    date: typeof e.date === "string" && DATE_RE.test(e.date) ? e.date : "",
    title: str(e.title, L.title),
    questions: str(e.questions, L.text),
    reflection: str(e.reflection, L.text),
  }));
  return { es, interviews };
}

/** Strict check used when reading a backup file; returns error strings. */
export function notesErrors(n) {
  if (n == null) return [];
  if (typeof n !== "object" || Array.isArray(n)) return ["ES・面接の記録の形式が正しくありません"];
  const L = NOTE_LIMITS; const errs = [];
  for (const [key, name] of [["es", "ES"], ["interviews", "面接の記録"]]) {
    const a = n[key];
    if (a == null) continue;
    if (!Array.isArray(a)) { errs.push(`${name}の形式が正しくありません`); continue; }
    if (a.length > L.entries) errs.push(`${name}が${L.entries}件を超えています`);
    if (a.some((e) => !e || typeof e !== "object")) errs.push(`${name}に壊れた項目があります`);
  }
  for (const e of Array.isArray(n.es) ? n.es : []) {
    if (!e || typeof e !== "object") continue;
    if (typeof e.answer === "string" && e.answer.length > L.answer) { errs.push(`ESの回答が${L.answer}文字を超えています`); break; }
    if (typeof e.question === "string" && e.question.length > L.question) { errs.push(`ESの設問が${L.question}文字を超えています`); break; }
    if (e.limit != null && normalizeLimit(e.limit) === null) { errs.push("ESの文字数制限は1〜10000の整数にしてください"); break; }
  }
  for (const e of Array.isArray(n.interviews) ? n.interviews : []) {
    if (!e || typeof e !== "object") continue;
    if ((typeof e.questions === "string" && e.questions.length > L.text) || (typeof e.reflection === "string" && e.reflection.length > L.text)) { errs.push(`面接の記録が${L.text}文字を超えています`); break; }
    if (e.date && !(typeof e.date === "string" && DATE_RE.test(e.date))) { errs.push("面接の記録の日付が読めません"); break; }
  }
  return errs;
}

/** Text searched by the toolbar search box. */
export function searchText(c) {
  const n = c.notes || { es: [], interviews: [] };
  return [c.name, c.position, c.industry, c.kind, c.memo,
    ...n.es.flatMap((e) => [e.question, e.answer]),
    ...n.interviews.flatMap((e) => [e.title, e.questions, e.reflection]), compareSearchText(c.compare)].join("\n").toLowerCase();
}
export function matchesQuery(c, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return true;
  const hay = searchText(c);
  return s.split(/\s+/).every((w) => hay.includes(w));
}
/** Count characters as people see them (surrogate pairs = 1). */
export const charCount = (s) => Array.from(String(s || "")).length;
/** ES 文字数: every character except line breaks (most ES forms count this
    way); spaces and symbols count, surrogate pairs count as one. */
export const ES_COUNT_RULE = "改行を除いた文字数（スペース・記号を含む）";
export const esCount = (s) => Array.from(String(s || "").replace(/\r\n|\r|\n/g, "")).length;
/** Counter text for an answer against an optional limit. */
export function limitStatus(count, limit) {
  if (!limit) return { text: `${count}字`, over: false, rest: "" };
  const d = limit - count;
  return { text: `${count} / ${limit}字`, over: d < 0, rest: d >= 0 ? `あと${d}字` : `${-d}字オーバー` };
}
