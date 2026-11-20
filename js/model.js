/* Company records: defaults, normalization/migration and stage logic. Pure. */
import { normalizeEvents } from "./events.js";
import { normalizeKind, normalizeNotes } from "./notes.js";

export const DEFAULT_STAGES = Object.freeze([
  { id: "interest", label: "気になる" },
  { id: "entry", label: "エントリー" },
  { id: "es", label: "ES・書類選考" },
  { id: "test", label: "適性検査・Webテスト" },
  { id: "gd", label: "GD・一次面接" },
  { id: "interview2", label: "二次面接" },
  { id: "final", label: "最終面接" },
  { id: "offer", label: "内定" },
].map(Object.freeze));
const DEFAULT_LABEL = Object.fromEntries(DEFAULT_STAGES.map((s) => [s.id, s.label]));
export const TERM_LABEL = Object.freeze({ rejected: "不合格", declined: "辞退" });
export const isTerm = (k) => k === "rejected" || k === "declined";
export const PRI = Object.freeze({ 1: "第一志望群", 2: "第二志望群", 3: "第三志望群" });
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const STAGE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const MAX_LABEL = 16;
export const MAX_STAGES = 30;
const PALETTE = ["interest", "entry", "es", "test", "gd", "interview2", "final"];

export const cloneStages = (a) => a.map((s) => ({ id: s.id, label: s.label }));

export function newId(prefix) {
  const a = new Uint8Array(12);
  const c = globalThis.crypto;
  if (c && c.getRandomValues) c.getRandomValues(a); else a.forEach((_, i) => (a[i] = Math.random() * 256));
  return prefix + Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}
export const stageId = () => newId("s").slice(0, 9);

/** Validate a stage list; null when nothing usable remains. */
export function cleanStages(arr) {
  if (!Array.isArray(arr)) return null;
  const seen = new Set(); const out = [];
  for (const s of arr) {
    if (!s || typeof s !== "object") continue;
    const label = typeof s.label === "string" ? s.label.trim().slice(0, MAX_LABEL) : "";
    if (!label) continue;
    let id = typeof s.id === "string" && STAGE_ID_RE.test(s.id) && !isTerm(s.id) ? s.id : stageId();
    while (seen.has(id)) id = stageId();
    seen.add(id); out.push({ id, label });
    if (out.length >= MAX_STAGES) break;
  }
  return out.length ? out : null;
}
export function labelIn(stages, id) {
  const s = stages.find((x) => x.id === id);
  if (s) return s.label;
  return TERM_LABEL[id] || DEFAULT_LABEL[id] || String(id || "");
}
/** Position colour token; the last stage keeps the offer green. */
export function colorAt(i, n) {
  if (i < 0) return "var(--st-interest)";
  if (i === n - 1) return "var(--st-offer)";
  return `var(--st-${PALETTE[i % PALETTE.length]})`;
}
export const termColor = (k) => (k === "rejected" ? "var(--st-rejected)" : "var(--st-declined)");

/** Index reached: the current stage, or for an ended company the most recent
    non-terminal history entry that still exists in the list (-1 if none). */
export function reachedFrom(stages, stage, history) {
  if (!isTerm(stage)) return stages.findIndex((s) => s.id === stage);
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (isTerm(h.stage)) continue;
    const k = stages.findIndex((s) => s.id === h.stage);
    if (k >= 0) return k;
  }
  return -1;
}
export const reached = (c) => reachedFrom(c.stages, c.stage, c.history);
export const stageIndex = (c) => (isTerm(c.stage) ? -1 : c.stages.findIndex((s) => s.id === c.stage));
export const atLast = (c) => !isTerm(c.stage) && stageIndex(c) === c.stages.length - 1;
export const isActive = (c) => !isTerm(c.stage) && !atLast(c);
export const stageLabel = (c) => labelIn(c.stages, c.stage);
export const stageColor = (c) => (isTerm(c.stage) ? termColor(c.stage) : colorAt(stageIndex(c), c.stages.length));
export function progressRatio(c) {
  if (c.stage === "rejected") return -1;
  if (c.stage === "declined") return -2;
  const n = c.stages.length;
  return n > 1 ? stageIndex(c) / (n - 1) : 1;
}

/* ---- stage transitions (return the target id, or null when not allowed) ---- */
export function nextStageId(c) { if (isTerm(c.stage)) return null; const s = c.stages[stageIndex(c) + 1]; return s ? s.id : null; }
export function prevStageId(c) { if (isTerm(c.stage)) return null; const i = stageIndex(c); return i > 0 ? c.stages[i - 1].id : null; }
export function restoreStageId(c) { if (!isTerm(c.stage)) return null; const r = reached(c); return c.stages[r >= 0 ? r : 0].id; }
/** New record with `stage` set and the change appended to history. */
export function withStage(c, stage, now = new Date()) {
  if (!isTerm(stage) && !c.stages.some((s) => s.id === stage)) throw new Error("unknown stage");
  if (c.stage === stage) return c;
  const at = now.toISOString();
  return { ...c, stage, history: [...c.history, { stage, at, label: labelIn(c.stages, stage) }], updatedAt: at };
}

/* ---- stage list editing (pure; return {list} or {error}) ---- */
export function moveStage(list, i, dir) {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return { list };
  const out = list.slice(); [out[i], out[j]] = [out[j], out[i]];
  return { list: out };
}
export function insertStage(list, at, label = "新しい段階") {
  if (list.length >= MAX_STAGES) return { error: `段階は${MAX_STAGES}個までです。` };
  const s = { id: stageId(), label };
  const out = list.slice(); out.splice(Math.max(0, Math.min(at, list.length)), 0, s);
  return { list: out, added: s };
}
export function deleteStage(list, i, currentId) {
  if (list.length <= 1) return { error: "段階は少なくとも1つ必要です。" };
  if (list[i] && list[i].id === currentId) {
    return { error: `「${list[i].label}」はいまの段階なので削除できません。先に上の「選考段階」で別の段階を選んでから削除してください。` };
  }
  const out = list.slice(); out.splice(i, 1);
  return { list: out };
}
/** Final check before saving a stage list. */
export function checkStages(list) {
  if (!list.length) return { error: "段階は少なくとも1つ必要です。" };
  const out = [];
  for (const s of list) {
    const label = String(s.label || "").trim();
    if (!label) return { error: "段階名が空欄のところがあります。入力するか、その段階を削除してください。" };
    if (label.length > MAX_LABEL) return { error: `段階名は${MAX_LABEL}文字までです。` };
    out.push({ id: s.id, label });
  }
  return { stages: out };
}

/* ---- normalization / migration ---- */
export function normalize(d, idOverride) {
  d = d && typeof d === "object" ? d : {};
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const id = idOverride || (typeof d.id === "string" && ID_RE.test(d.id) ? d.id : newId("c"));
  // records without their own stage list get the default 8 (old keys)
  const stages = cleanStages(d.stages) || cloneStages(DEFAULT_STAGES);
  let stage = typeof d.stage === "string" ? d.stage : "";
  if (!isTerm(stage) && !stages.some((s) => s.id === stage)) stage = stages[0].id;
  const pr = Number(d.priority);
  const history = Array.isArray(d.history)
    ? d.history.filter((h) => h && typeof h === "object" && typeof h.stage === "string" && h.stage)
        .map((h) => ({
          stage: h.stage.slice(0, 32),
          at: typeof h.at === "string" ? h.at : "",
          label: typeof h.label === "string" && h.label.trim() ? h.label.trim().slice(0, MAX_LABEL) : labelIn(stages, h.stage),
        })).slice(-200)
    : [];
  return {
    id,
    name: str(d.name, 80),
    position: str(d.position, 80),
    industry: str(d.industry, 40),
    kind: normalizeKind(d.kind),
    stages, stage,
    priority: pr === 1 || pr === 2 || pr === 3 ? pr : 2,
    // older records kept a single nextDate/nextLabel; they become one event
    events: normalizeEvents(d.events, d.nextDate, d.nextLabel),
    url: typeof d.url === "string" && /^https?:\/\//i.test(d.url) ? d.url.slice(0, 2000) : "",
    memo: str(d.memo, 4000),
    notes: normalizeNotes(d.notes),
    history,
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
    example: d.example === true,
    iconId: typeof d.iconId === "string" && ID_RE.test(d.iconId) ? d.iconId : "",
  };
}
