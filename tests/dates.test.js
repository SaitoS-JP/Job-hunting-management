process.env.TZ = "Asia/Tokyo";
import test from "node:test";
import assert from "node:assert/strict";
import { dayDiff, dueInfo, fromInputs, toInputs, fmtDate, hasTime, isPast } from "../js/dates.js";

const L = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi);

test("dayDiff counts calendar days, ignoring the time of day", () => {
  assert.equal(dayDiff(L(2026, 11, 20, 23, 59), L(2026, 11, 20, 0, 1)), 0);
  assert.equal(dayDiff(L(2026, 11, 21, 0, 0), L(2026, 11, 20, 23, 59)), 1);
  assert.equal(dayDiff(L(2026, 11, 19), L(2026, 11, 20, 12)), -1);
});
test("dayDiff across month and year boundaries", () => {
  assert.equal(dayDiff(L(2026, 12, 1), L(2026, 11, 30)), 1);
  assert.equal(dayDiff(L(2027, 1, 1), L(2026, 12, 31, 18)), 1);
  assert.equal(dayDiff(L(2026, 12, 25), L(2027, 1, 5)), -11);
  assert.equal(dayDiff(L(2028, 3, 1), L(2028, 2, 28)), 2); // leap year
});
test("due badge classification", () => {
  const now = L(2026, 11, 20, 10);
  assert.equal(dueInfo(L(2026, 11, 19, 23), now).cls, "past");
  assert.equal(dueInfo(L(2026, 11, 19, 23), now).text, "期限切れ");
  // a time earlier today has already passed; a later time / date-only today is 今日
  assert.deepEqual([dueInfo(L(2026, 11, 20, 8), now).cls, dueInfo(L(2026, 11, 20, 8), now).text], ["past", "期限切れ"]);
  assert.deepEqual([dueInfo(L(2026, 11, 20, 18), now).cls, dueInfo(L(2026, 11, 20, 18), now).text], ["today", "今日"]);
  assert.equal(dueInfo(L(2026, 11, 20), now).text, "今日");
  assert.equal(dueInfo(L(2026, 11, 21), now).text, "明日");
  assert.equal(dueInfo(L(2026, 11, 23), now).cls, "soon");
  assert.equal(dueInfo(L(2026, 11, 23), now).days, 3);
  assert.equal(dueInfo(L(2026, 11, 24), now).cls, "later");
  assert.equal(dueInfo(L(2026, 11, 24), now).text, "あと4日");
});
test("input conversion: date only is local midnight; time is optional", () => {
  const iso = fromInputs("2026-11-24", "");
  assert.equal(new Date(iso).getTime(), L(2026, 11, 24).getTime());
  assert.equal(hasTime(new Date(iso)), false);
  assert.deepEqual(toInputs(fromInputs("2026-11-24", "14:30")), { date: "2026-11-24", time: "14:30" });
  assert.deepEqual(toInputs(iso), { date: "2026-11-24", time: "" });
  assert.equal(fromInputs("", "10:00"), "");
  assert.equal(fromInputs("2026-13-40", ""), "");
  assert.equal(fmtDate(L(2026, 11, 24, 9, 5)), "11/24(火) 9:05");
});

test("a timed deadline is past once its time has passed, even on the same day", () => {
  const es = L(2026, 11, 20, 10, 0);
  assert.equal(isPast(es, L(2026, 11, 20, 9, 59)), false);
  assert.equal(isPast(es, L(2026, 11, 20, 10, 1)), true);
  assert.equal(dueInfo(es, L(2026, 11, 20, 15, 0)).cls, "past");
  assert.equal(dueInfo(es, L(2026, 11, 20, 15, 0)).text, "期限切れ");
  assert.equal(dueInfo(es, L(2026, 11, 20, 8, 0)).text, "今日");
});
test("a date-only event stays 今日 until the end of its day", () => {
  const d = L(2026, 11, 20);
  assert.equal(isPast(d, L(2026, 11, 20, 23, 59)), false);
  assert.equal(dueInfo(d, L(2026, 11, 20, 23, 59)).text, "今日");
  assert.equal(isPast(d, L(2026, 11, 21, 0, 1)), true);
});
