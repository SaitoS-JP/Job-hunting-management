process.env.TZ = "Asia/Tokyo";
import test from "node:test";
import assert from "node:assert/strict";
import { onboardingSteps, onboardingProgress, checklistVisible, latestOwnCompany, tourStepsFor } from "../js/onboarding.js";
import { normalize, withStage } from "../js/model.js";
import { buildSamples } from "../js/samples.js";
import { DEFAULT_STAGES } from "../js/model.js";

const done = (steps) => Object.fromEntries(steps.map((s) => [s.id, s.done]));

test("empty first run: nothing is done", () => {
  const s = onboardingSteps({ companies: [] });
  assert.deepEqual(done(s), { add: false, event: false, advance: false, protect: false });
  assert.deepEqual(onboardingProgress(s), { done: 0, total: 4, all: false, ratio: 0 });
});
test("sample data never ticks a step", () => {
  const samples = buildSamples(DEFAULT_STAGES);
  assert.ok(samples.some((c) => c.events.length) && samples.some((c) => c.history.length >= 2));
  assert.deepEqual(done(onboardingSteps({ companies: samples })), { add: false, event: false, advance: false, protect: false });
});
test("steps tick from real data", () => {
  const a = normalize({ id: "a", name: "A社", stage: "entry", history: [{ stage: "entry", at: "2026-11-01T00:00:00Z" }] });
  assert.deepEqual(done(onboardingSteps({ companies: [a] })), { add: true, event: false, advance: false, protect: false });
  const b = normalize({ ...a, events: [{ id: "e", at: "2026-11-30T00:00:00Z", label: "ES締切" }] });
  assert.equal(done(onboardingSteps({ companies: [b] })).event, true);
  const c = withStage(b, "es", new Date("2026-11-20T00:00:00Z"));
  assert.equal(done(onboardingSteps({ companies: [c] })).advance, true);
  const all = onboardingSteps({ companies: [c], lastBackupAt: "2026-11-20T01:00:00Z" });
  assert.equal(onboardingProgress(all).all, true);
  assert.equal(onboardingProgress(all).ratio, 1);
});
test("install hint only for iOS outside the home-screen app", () => {
  const p = (o) => onboardingSteps({ companies: [], ...o }).find((s) => s.id === "protect").installHint;
  assert.equal(p({ ios: true, standalone: false }), true);
  assert.equal(p({ ios: true, standalone: true }), false);
  assert.equal(p({ ios: false }), false);
});
test("checklist visibility: closed, finished, reopened", () => {
  assert.equal(checklistVisible({ all: false }), true);
  assert.equal(checklistVisible({ all: false, dismissed: true }), false);
  assert.equal(checklistVisible({ all: true, doneSeen: false }), true); // celebrate once
  assert.equal(checklistVisible({ all: true, doneSeen: true }), false);
  assert.equal(checklistVisible({ all: true, dismissed: true, forced: true }), true);
});
test("latest own company ignores samples", () => {
  const s = normalize({ id: "s", name: "サンプル", example: true, updatedAt: "2026-11-20T09:00:00Z" });
  const x = normalize({ id: "x", name: "X", updatedAt: "2026-11-19T00:00:00Z" });
  const y = normalize({ id: "y", name: "Y", updatedAt: "2026-11-20T00:00:00Z" });
  assert.equal(latestOwnCompany([s, x, y]).id, "y");
  assert.equal(latestOwnCompany([s]), null);
});
test("tour skips steps whose target is missing", () => {
  const steps = [{ title: "intro" }, { target: "#a" }, { target: "#row" }, { target: "#b" }];
  const have = new Set(["#a", "#b"]);
  assert.deepEqual(tourStepsFor(steps, (t) => have.has(t)).map((s) => s.target || "intro"), ["intro", "#a", "#b"]);
});
