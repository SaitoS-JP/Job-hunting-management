process.env.TZ = "Asia/Tokyo";
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STAGES, normalize, nextStageId, prevStageId, restoreStageId, withStage, reached, atLast, isActive,
  progressRatio, moveStage, insertStage, deleteStage, checkStages, colorAt,
} from "../js/model.js";

const base = (over = {}) => normalize({ id: "c1", name: "テスト社", stage: "entry", history: [{ stage: "entry", at: "2026-11-01T00:00:00.000Z" }], ...over });
const NOW = new Date("2026-11-20T03:00:00.000Z");

test("advance and back respect the ends of the list", () => {
  let c = base({ stage: "interest" });
  assert.equal(prevStageId(c), null);
  assert.equal(nextStageId(c), "entry");
  c = base({ stage: "offer" });
  assert.equal(nextStageId(c), null);
  assert.equal(prevStageId(c), "final");
  assert.equal(atLast(c), true);
  assert.equal(isActive(c), false);
});
test("withStage appends history with a readable label", () => {
  const c = withStage(base(), "es", NOW);
  assert.equal(c.stage, "es");
  assert.deepEqual(c.history.at(-1), { stage: "es", at: NOW.toISOString(), label: "ES・書類選考" });
  assert.equal(c.updatedAt, NOW.toISOString());
  assert.throws(() => withStage(base(), "nope", NOW));
});
test("reject / decline, then restore to the last active stage", () => {
  let c = withStage(withStage(base(), "es", NOW), "gd", NOW);
  c = withStage(c, "rejected", NOW);
  assert.equal(reached(c), 4);
  assert.equal(restoreStageId(c), "gd");
  assert.equal(nextStageId(c), null);
  c = withStage(c, restoreStageId(c), NOW);
  assert.equal(c.stage, "gd");
  const d = withStage(base(), "declined", NOW);
  assert.equal(restoreStageId(d), "entry");
  const noHist = normalize({ name: "x", stage: "declined" });
  assert.equal(restoreStageId(noHist), "interest");
});
test("progress ratio orders by how far along each company's own list", () => {
  const short = normalize({ name: "a", stages: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }], stage: "b" });
  assert.equal(progressRatio(short), 0.5);
  assert.equal(progressRatio(base({ stage: "offer" })), 1);
  assert.ok(progressRatio(base({ stage: "rejected" })) < 0);
});
test("editing stages: add, reorder, delete; the current stage cannot be deleted", () => {
  let list = DEFAULT_STAGES.map((s) => ({ ...s }));
  const ins = insertStage(list, 6, "三次面接");
  assert.equal(ins.list[6].label, "三次面接");
  assert.equal(ins.list.length, 9);
  list = moveStage(ins.list, 6, -1).list;
  assert.equal(list[5].label, "三次面接");
  assert.equal(moveStage(list, 0, -1).list, list);
  const del = deleteStage(list, 3, "entry");
  assert.ok(!del.error);
  assert.ok(!del.list.some((s) => s.id === "test"));
  assert.match(deleteStage(list, 1, "entry").error, /いまの段階/);
  assert.match(deleteStage([{ id: "x", label: "X" }], 0, null).error, /少なくとも1つ/);
  assert.match(checkStages([{ id: "x", label: "  " }]).error, /空欄/);
  assert.match(checkStages([{ id: "x", label: "あ".repeat(17) }]).error, /16文字/);
});
test("last stage colour is the offer green", () => {
  assert.equal(colorAt(7, 8), "var(--st-offer)");
  assert.equal(colorAt(8, 10), "var(--st-entry)");
});
test("migration: old records get the default stages and keep working", () => {
  const c = normalize({ id: "old", name: "旧社", stage: "gd", nextDate: "2026-11-25T05:00:00.000Z", nextLabel: "一次面接", history: [{ stage: "entry", at: "2026-10-01T00:00:00Z" }] });
  assert.deepEqual(c.stages.map((s) => s.id), DEFAULT_STAGES.map((s) => s.id));
  assert.equal(c.stage, "gd");
  assert.equal(c.history[0].label, "エントリー");
  assert.deepEqual(c.events, [{ id: "legacy", at: "2026-11-25T05:00:00.000Z", label: "一次面接", done: false }]);
  assert.equal("nextDate" in c, false);
  const bad = normalize({ name: "x", stage: "unknown", stages: "nope", url: "javascript:alert(1)" });
  assert.equal(bad.stage, "interest");
  assert.equal(bad.url, "");
});
