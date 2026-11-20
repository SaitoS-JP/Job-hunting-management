process.env.TZ = "Asia/Tokyo";
import test from "node:test";
import assert from "node:assert/strict";
import { monthGrid, eventsByDay, addMonths, localYmd, parseYmd } from "../js/calendar.js";

test("November 2026 grid: starts on Sunday with leading/trailing days", () => {
  const w = monthGrid(2026, 10, new Date(2026, 10, 20, 15));
  assert.equal(w.length, 5); // 11/1 is a Sunday, 11/30 a Monday
  assert.equal(w[0][0].ymd, "2026-11-01");
  assert.equal(w[4][6].ymd, "2026-12-05");
  assert.equal(w[4][1].ymd, "2026-11-30");
  assert.equal(w[4][2].inMonth, false);
  assert.ok(w.every((wk) => wk.length === 7 && wk.every((d, i) => d.dow === i)));
  const today = w.flat().filter((d) => d.isToday);
  assert.deepEqual(today.map((d) => d.ymd), ["2026-11-20"]);
});
test("months needing 6 weeks and leap February", () => {
  assert.equal(monthGrid(2026, 7).length, 6); // Aug 2026: starts Saturday
  const feb = monthGrid(2028, 1).flat().filter((d) => d.inMonth);
  assert.equal(feb.length, 29);
  assert.equal(monthGrid(2027, 1).flat()[0].ymd, "2027-01-31"); // Feb 2027 starts Monday
});
test("month arithmetic across years", () => {
  assert.deepEqual(addMonths({ y: 2026, m: 11 }, 1), { y: 2027, m: 0 });
  assert.deepEqual(addMonths({ y: 2026, m: 0 }, -1), { y: 2025, m: 11 });
  assert.deepEqual(addMonths({ y: 2026, m: 5 }, -18), { y: 2024, m: 11 });
});
test("ymd helpers are local-time and reject impossible dates", () => {
  assert.equal(localYmd(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(parseYmd("2026-02-30"), null);
  assert.equal(parseYmd("2026-02-28").getDate(), 28);
});
test("events grouped by local day, sorted by time, filtered by range", () => {
  const iso = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();
  const a = { id: "a", name: "A社", events: [{ id: "1", at: iso(20, 15) }, { id: "2", at: iso(20, 9) }, { id: "3", at: iso(1, 0) }] };
  const b = { id: "b", name: "B社", events: [{ id: "4", at: iso(20, 9) }, { id: "5", at: new Date(2026, 11, 10).toISOString() }] };
  const map = eventsByDay([a, b], { from: new Date(2026, 10, 1), to: new Date(2026, 11, 1) });
  assert.deepEqual(map.get("2026-11-20").map((x) => x.event.id), ["2", "4", "1"]);
  assert.equal(map.get("2026-11-01").length, 1);
  assert.equal(map.has("2026-12-10"), false);
  const only = eventsByDay([a, b], { include: (c) => c.id === "b" });
  assert.deepEqual([...only.keys()].sort(), ["2026-11-20", "2026-12-10"]);
});
