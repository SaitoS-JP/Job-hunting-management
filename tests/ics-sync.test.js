process.env.TZ = "Asia/Tokyo";
import test from "node:test";
import assert from "node:assert/strict";
import { fingerprint, diffExport, planExport, cleanSnapshot, exportable } from "../js/ics-sync.js";
import { buildICS, uidFor } from "../js/ics.js";
import { normalize, withStage } from "../js/model.js";

const NOW = new Date(2026, 10, 20, 12);
const iso = (d, h = 0) => new Date(2026, 10, d, h).toISOString();
const co = (events, over = {}) => normalize({ id: "c1", name: "A商事", stage: "es", events, ...over });

test("fingerprint is stable and changes with what goes into the file", () => {
  const c = co([{ id: "e1", at: iso(25, 14), label: "一次面接" }]);
  const a = fingerprint(c, c.events[0]), b = fingerprint(normalize(JSON.parse(JSON.stringify(c))), c.events[0]);
  assert.equal(a.h, b.h);
  assert.equal(a.k, b.k);
  const later = co([{ id: "e1", at: iso(25, 15), label: "一次面接" }]);
  assert.notEqual(fingerprint(later, later.events[0]).h, a.h);
  assert.notEqual(fingerprint(later, later.events[0]).k, a.k);
  const advanced = withStage(c, "gd", NOW); // only the description changes
  const f = fingerprint(advanced, advanced.events[0]);
  assert.notEqual(f.h, a.h);
  assert.equal(f.k, a.k);
});
test("diff: added, changed (major/minor), removed; nothing before the first export", () => {
  const c = co([{ id: "e1", at: iso(25, 14), label: "一次面接" }, { id: "e2", at: iso(27), label: "ES締切" }, { id: "e3", at: iso(28), label: "説明会" }]);
  const empty = diffExport([c], null, NOW);
  assert.equal(empty.exported, false);
  assert.equal(empty.added.length, 3);
  const { snapshot } = planExport(exportable([c]), null, { now: NOW, mode: "full" });
  assert.deepEqual([diffExport([c], snapshot, NOW)].map((d) => [d.added.length, d.changed.length, d.removed.length]), [[0, 0, 0]]);
  const after = co([
    { id: "e1", at: iso(25, 16), label: "一次面接" },        // time changed
    { id: "e2", at: iso(27), label: "ES締切", done: true },   // done -> removed
    { id: "e3", at: iso(28), label: "説明会" },
    { id: "e4", at: iso(30), label: "二次面接" },             // new
    { id: "e5", at: iso(10), label: "過去の予定" },            // new but past: not offered
  ]);
  const d = diffExport([after], snapshot, NOW);
  assert.deepEqual(d.added.map((x) => x.event.id), ["e4"]);
  assert.deepEqual(d.changed.map((x) => [x.event.id, x.major]), [["e1", true]]);
  assert.equal(d.changed[0].before.at, iso(25, 14));
  assert.deepEqual(d.removed.map((x) => x.uid), [uidFor(c, c.events[1])]);
  assert.equal(d.notable, 2);
  const ended = diffExport([withStage(after, "rejected", NOW)], snapshot, NOW);
  assert.equal(ended.removed.length, 3); // company ended: everything exported is gone
  const minor = diffExport([withStage(c, "gd", NOW)], snapshot, NOW);
  assert.equal(minor.changed.length, 3);
  assert.equal(minor.notable, 0);
});
test("sequence goes up only when the content changed; merge vs full snapshots", () => {
  const c = co([{ id: "e1", at: iso(25, 14), label: "一次面接" }, { id: "e2", at: iso(27), label: "ES締切" }]);
  const p1 = planExport(exportable([c]), null, { now: NOW, mode: "full" });
  assert.deepEqual(Object.values(p1.seq), [0, 0]);
  const c2 = co([{ id: "e1", at: iso(25, 15), label: "一次面接" }, { id: "e2", at: iso(27), label: "ES締切" }, { id: "e3", at: iso(29), label: "GD" }]);
  const p2 = planExport(exportable([c2]), p1.snapshot, { now: NOW, mode: "full" });
  assert.equal(p2.seq[uidFor(c2, c2.events[0])], 1);
  assert.equal(p2.seq[uidFor(c2, c2.events[1])], 0);
  assert.equal(p2.seq[uidFor(c2, c2.events[2])], 0);
  const p3 = planExport(exportable([c2]), p2.snapshot, { now: NOW, mode: "full" });
  assert.equal(p3.seq[uidFor(c2, c2.events[0])], 1); // unchanged: stays
  // merge keeps other UIDs; full drops ones not in the file
  const only = planExport([{ company: c2, event: c2.events[2] }], p1.snapshot, { now: NOW, mode: "merge" });
  assert.equal(Object.keys(only.snapshot.items).length, 3);
  const full = planExport([{ company: c2, event: c2.events[2] }], p1.snapshot, { now: NOW, mode: "full" });
  assert.equal(Object.keys(full.snapshot.items).length, 1);
  assert.ok(buildICS(exportable([c2]).map(({ company, event }) => ({ company, event })), { now: NOW, seq: p2.seq }).includes("SEQUENCE:1"));
  assert.ok(buildICS(exportable([c2]), { now: NOW }).includes("LAST-MODIFIED:"));
});
test("broken snapshots are cleaned", () => {
  assert.deepEqual(cleanSnapshot("x"), { at: "", items: {} });
  assert.deepEqual(Object.keys(cleanSnapshot({ at: "t", items: { a: { h: "1", seq: -3 }, b: 5 } }).items), ["a"]);
  assert.equal(cleanSnapshot({ at: "t", items: { a: { h: "1", seq: -3 } } }).items.a.seq, 0);
});

import { exportedChanges } from "../js/ics-sync.js";
test("changes to exported events caused by one edit", () => {
  const c = co([{ id: "e1", at: iso(25, 14), label: "一次面接" }, { id: "e2", at: iso(27), label: "ES締切" }, { id: "e3", at: iso(28), label: "説明会" }]);
  const { snapshot } = planExport(exportable([c]).filter((x) => x.event.id !== "e3"), null, { now: NOW, mode: "full" }); // e3 never exported
  assert.deepEqual(exportedChanges(c, c, snapshot), []);
  assert.deepEqual(exportedChanges(c, c, null), []); // never exported: nothing to say
  const moved = co([{ id: "e1", at: iso(25, 16), label: "一次面接" }, { id: "e2", at: iso(27), label: "ES締切", done: true }, { id: "e3", at: iso(29), label: "説明会" }]);
  const r = exportedChanges(c, moved, snapshot);
  assert.deepEqual(r.map((x) => [x.type, x.reason || ""]), [["changed", ""], ["removed", "完了"]]);
  assert.equal(r[0].before.at, iso(25, 14));
  assert.equal(r[0].after.at, iso(25, 16));
  assert.deepEqual(exportedChanges(c, withStage(c, "declined", NOW), snapshot).map((x) => x.reason), ["辞退", "辞退"]);
  assert.deepEqual(exportedChanges(c, null, snapshot).map((x) => x.reason), ["企業を削除", "企業を削除"]);
  assert.deepEqual(exportedChanges(c, co([{ id: "e2", at: iso(27), label: "ES締切" }]), snapshot).map((x) => x.reason), ["予定を削除"]);
  assert.deepEqual(exportedChanges(c, withStage(c, "gd", NOW), snapshot), []); // stage only: description changes, nothing visible
});

test("acknowledging clears changed/removed differences but keeps new events pending", async () => {
  const { acknowledgeDiff } = await import("../js/ics-sync.js");
  const c = co([{ id: "e1", at: iso(25, 14), label: "一次面接" }, { id: "e2", at: iso(27), label: "ES締切" }]);
  const { snapshot } = planExport(exportable([c]), null, { now: NOW, mode: "full" });
  const after = co([
    { id: "e1", at: iso(25, 16), label: "一次面接" },        // fixed by hand in the calendar app
    { id: "e2", at: iso(27), label: "ES締切", done: true },   // deleted by hand in the calendar app
    { id: "e3", at: iso(29), label: "説明会" },               // not in the calendar yet
  ]);
  assert.equal(diffExport([after], snapshot, NOW).notable, 2);
  const ack = acknowledgeDiff([after], snapshot, NOW);
  const d = diffExport([after], ack, NOW);
  assert.equal(d.notable, 0);
  assert.equal(d.changed.length, 0);
  assert.equal(d.removed.length, 0);
  assert.deepEqual(d.added.map((x) => x.event.id), ["e3"]);
  assert.equal(ack.at, snapshot.at);
  const uid1 = uidFor(after, after.events[0]);
  assert.equal(ack.items[uid1].seq, snapshot.items[uid1].seq + 1);
  assert.deepEqual(acknowledgeDiff([after], null, NOW).items, {});
});
