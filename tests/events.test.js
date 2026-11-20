process.env.TZ = "Asia/Tokyo";
import test from "node:test";
import assert from "node:assert/strict";
import { nearestEvent, nearestTime, agenda, withEventDone, normalizeEvents, eventsFromRows } from "../js/events.js";
import { fromInputs } from "../js/dates.js";

const L = (y, m, d, h = 0) => new Date(y, m - 1, d, h).toISOString();
const NOW = new Date(2026, 10, 20, 12);
const co = (events, over = {}) => ({ id: "c", name: "n", stage: "entry", events, ...over });

test("nearest picks the first upcoming not-done event and counts the rest", () => {
  const c = co([
    { id: "a", at: L(2026, 11, 25), label: "二次面接", done: false },
    { id: "b", at: L(2026, 11, 22), label: "一次面接", done: false },
    { id: "c", at: L(2026, 11, 21), label: "ES提出", done: true },
    { id: "d", at: L(2026, 11, 10), label: "説明会", done: false },
  ]);
  const n = nearestEvent(c, NOW);
  assert.equal(n.event.id, "b");
  assert.equal(n.overdue, false);
  assert.equal(n.more, 2); // a and the overdue d
});
test("an event earlier today still counts as upcoming", () => {
  const n = nearestEvent(co([{ id: "a", at: L(2026, 11, 20, 9), label: "", done: false }]), NOW);
  assert.equal(n.overdue, false);
});
test("with nothing upcoming, the most recent overdue one is shown", () => {
  const c = co([
    { id: "a", at: L(2026, 11, 1), label: "", done: false },
    { id: "b", at: L(2026, 11, 15), label: "", done: false },
    { id: "c", at: L(2026, 11, 30), label: "", done: true },
  ]);
  const n = nearestEvent(c, NOW);
  assert.equal(n.event.id, "b");
  assert.equal(n.overdue, true);
  assert.equal(n.more, 1);
});
test("done events are excluded; none left means no nearest", () => {
  const c = co([{ id: "a", at: L(2026, 11, 22), label: "", done: true }]);
  assert.equal(nearestEvent(c, NOW), null);
  assert.equal(nearestTime(c, NOW), Infinity);
});
test("agenda keeps upcoming and overdue separate; overdue never pushes out upcoming", () => {
  const a = co([{ id: "1", at: L(2026, 11, 21), label: "", done: false }, { id: "2", at: L(2026, 11, 23), label: "", done: false }, { id: "3", at: L(2026, 11, 1), label: "", done: false }], { id: "A" });
  const b = co([{ id: "4", at: L(2026, 11, 7), label: "", done: false }, { id: "5", at: L(2026, 11, 22), label: "", done: false }, { id: "6", at: L(2026, 12, 1), label: "", done: false }, { id: "7", at: L(2026, 12, 2), label: "", done: false }, { id: "t", at: L(2026, 11, 20, 9), label: "today", done: false }], { id: "B" });
  const ended = co([{ id: "x", at: L(2026, 11, 21), label: "", done: false }], { id: "X", stage: "rejected" });
  const out = agenda([a, b, ended], { now: NOW, include: (c) => c.stage !== "rejected" });
  assert.deepEqual(out.upcoming.map((x) => x.event.id), ["t", "1", "5", "2", "6"]);
  assert.deepEqual(out.overdue.map((x) => x.event.id), ["4", "3"]);
  assert.equal(out.overdueTotal, 2);
});
test("many overdue events still leave tomorrow's deadline in upcoming", () => {
  const old = Array.from({ length: 8 }, (_, i) => ({ id: "o" + i, at: L(2026, 11, 10 + i), label: "", done: false }));
  const c = co([...old, { id: "es", at: L(2026, 11, 21, 23), label: "ES締切", done: false }]);
  const out = agenda([c], { now: NOW });
  assert.deepEqual(out.upcoming.map((x) => x.event.id), ["es"]);
  assert.equal(out.overdue.length, 3);
  assert.equal(out.overdue[0].event.id, "o7");
  assert.equal(out.overdueTotal, 8);
});
test("withEventDone marks one event and leaves others", () => {
  const c = co([{ id: "a", at: L(2026, 11, 1), label: "", done: false }, { id: "b", at: L(2026, 11, 2), label: "", done: false }]);
  const n = withEventDone(c, "a", NOW);
  assert.equal(n.events[0].done, true);
  assert.equal(n.events[1].done, false);
  assert.equal(c.events[0].done, false);
  assert.equal(withEventDone(n, "a", NOW), n);
  assert.equal(withEventDone(c, "zz", NOW), c);
});
test("normalizeEvents migrates the legacy single date and drops broken entries", () => {
  assert.equal(normalizeEvents(undefined, "", "x").length, 0);
  assert.equal(normalizeEvents(undefined, "2026-11-25T00:00:00Z", "ES締切")[0].label, "ES締切");
  const ev = normalizeEvents([{ at: "nope" }, { at: L(2026, 11, 25), label: 5, done: "yes" }, { id: "k", at: L(2026, 11, 22) }]);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].id, "k");
  assert.equal(ev[1].label, "");
  assert.equal(ev[1].done, false);
});
test("dialog rows: empty rows dropped, missing date rejected", () => {
  assert.deepEqual(eventsFromRows([{ id: "a", date: "", time: "", label: " " }], fromInputs), { events: [] });
  assert.match(eventsFromRows([{ id: "a", date: "", time: "", label: "面接" }], fromInputs).error, /日付/);
  const r = eventsFromRows([{ id: "b", date: "2026-11-30", time: "", label: "B" }, { id: "a", date: "2026-11-24", time: "10:00", label: "A", done: true }], fromInputs);
  assert.deepEqual(r.events.map((e) => [e.id, e.done]), [["a", true], ["b", false]]);
});
