process.env.TZ = "Asia/Tokyo";
import test from "node:test";
import assert from "node:assert/strict";
import { purgeSelection, daysLeft, withDeleted, withRestored, splitTrash, orphanIcons, KEEP_DAYS } from "../js/trash.js";
import { normalize } from "../js/model.js";
import { exportable, planExport, diffExport, exportedChanges, acknowledgeDiff } from "../js/ics-sync.js";
import { onboardingSteps } from "../js/onboarding.js";

const NOW = new Date("2026-11-21T03:00:00Z");
const ago = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();

test("deletedAt survives normalize; invalid values are dropped", () => {
  assert.equal(normalize({ name: "a", deletedAt: ago(1) }).deletedAt, ago(1));
  assert.equal(normalize({ name: "a", deletedAt: "nope" }).deletedAt, "");
  assert.equal(normalize({ name: "a" }).deletedAt, "");
  const c = normalize({ id: "x", name: "a" });
  assert.equal(withRestored(withDeleted(c, NOW)).deletedAt, "");
  assert.equal(withDeleted(c, NOW).deletedAt, NOW.toISOString());
});
test("trash split and days left", () => {
  const a = normalize({ id: "a", name: "A" }), b = normalize({ id: "b", name: "B", deletedAt: ago(2) }), c = normalize({ id: "c", name: "C", deletedAt: ago(10) });
  const s = splitTrash([a, c, b]);
  assert.deepEqual(s.active.map((x) => x.id), ["a"]);
  assert.deepEqual(s.trash.map((x) => x.id), ["b", "c"]);
  assert.equal(daysLeft(b, NOW), KEEP_DAYS - 2);
  assert.equal(daysLeft(normalize({ name: "x", deletedAt: ago(40) }), NOW), 0);
  assert.equal(daysLeft(a, NOW), null);
});
test("purge selects items deleted over 30 days ago and their unused icons", () => {
  const old = normalize({ id: "o", name: "old", deletedAt: ago(31), iconId: "i1" });
  const oldShared = normalize({ id: "s", name: "shared", deletedAt: ago(45), iconId: "i2" });
  const keeps = normalize({ id: "k", name: "keep", iconId: "i2" });
  const recent = normalize({ id: "r", name: "recent", deletedAt: ago(29), iconId: "i3" });
  const p = purgeSelection([old, oldShared, keeps, recent], NOW);
  assert.deepEqual(p.records.map((x) => x.id).sort(), ["o", "s"]);
  assert.deepEqual(p.iconIds, ["i1"]); // i2 is still used by "keep"
  assert.deepEqual(purgeSelection([recent], NOW).records, []);
  assert.deepEqual(orphanIcons([old], [old, keeps]), ["i1"]);
  assert.deepEqual(orphanIcons([oldShared], [oldShared, keeps]), []);
});
test("deleted companies are left out of exports and onboarding; restore puts them back cleanly", () => {
  const c = normalize({ id: "c1", name: "A社", stage: "es", events: [{ id: "e1", at: "2026-11-30T05:00:00Z", label: "一次面接" }] });
  const { snapshot } = planExport(exportable([c]), null, { now: NOW, mode: "full" });
  const del = withDeleted(c, NOW);
  assert.deepEqual(exportable([del]), []);
  assert.deepEqual(exportedChanges(c, del, snapshot).map((x) => x.reason), ["削除"]);
  const gone = diffExport([del].filter((x) => !x.deletedAt), snapshot, NOW);
  assert.equal(gone.removed.length, 1);
  const back = withRestored(del);
  const d = diffExport([back], snapshot, NOW);
  assert.deepEqual([d.added.length, d.changed.length, d.removed.length], [0, 0, 0]);
  assert.deepEqual(exportedChanges(del, back, snapshot), []); // restoring is not a change
  if (typeof acknowledgeDiff === "function") {
    const acked = acknowledgeDiff([], snapshot, NOW); // acknowledge while deleted
    const after = diffExport([back], acked, NOW);
    assert.equal(after.removed.length, 0);
  }
  assert.equal(onboardingSteps({ companies: [del].filter((x) => !x.deletedAt) }).find((s) => s.id === "add").done, false);
});
