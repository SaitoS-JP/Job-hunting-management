process.env.TZ = "Asia/Tokyo";
import test from "node:test";
import assert from "node:assert/strict";
import { escapeText, foldLine, buildICS, triggerFor, selectForExport, uidFor } from "../js/ics.js";
import { normalize } from "../js/model.js";

const NOW = new Date(Date.UTC(2026, 10, 20, 3, 0, 0));
const unfold = (ics) => ics.replace(/\r\n /g, "").split("\r\n");
const co = (over = {}) => normalize({ id: "c1", name: "テスト商事", kind: "サマーインターン", position: "総合職", stage: "es", url: "https://example.com/my?a=1,b=2", ...over });

test("TEXT escaping of backslash, semicolon, comma and newlines", () => {
  assert.equal(escapeText("a\\b;c,d\ne\r\nf"), "a\\\\b\\;c\\,d\\ne\\nf");
});
test("folding at 75 octets keeps UTF-8 characters whole", () => {
  const line = "SUMMARY:" + "あ".repeat(60);
  const folded = foldLine(line);
  const parts = folded.split("\r\n");
  assert.ok(parts.length > 1);
  const enc = new TextEncoder();
  assert.ok(parts.every((p) => enc.encode(p).length <= 75));
  assert.ok(parts.slice(1).every((p) => p.startsWith(" ")));
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(""), line);
  assert.equal(foldLine("SHORT:x"), "SHORT:x");
});
test("all-day vs timed events", () => {
  const c = co({ events: [{ id: "e1", at: new Date(2026, 10, 24).toISOString(), label: "ES締切" }, { id: "e2", at: new Date(2026, 10, 25, 14, 30).toISOString(), label: "一次面接" }] });
  const lines = unfold(buildICS(selectForExport([c], { now: NOW }), { now: NOW, reminders: [] }));
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.ok(lines.includes("VERSION:2.0") && lines.includes("CALSCALE:GREGORIAN") && lines.some((l) => l.startsWith("PRODID:")));
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20261124"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20261125"));
  assert.ok(lines.includes("DTSTART:20261125T053000Z")); // 14:30 JST
  assert.ok(lines.includes("DTEND:20261125T063000Z"));
  assert.ok(lines.includes("DTSTAMP:20261120T030000Z"));
  assert.ok(lines.includes("SUMMARY:テスト商事｜ES締切（サマーインターン）"));
  assert.ok(lines.some((l) => l.startsWith("DESCRIPTION:職種：総合職\\n選考段階：ES・書類選考\\nマイページ：https://example.com/my?a=1\\,b=2")));
  assert.ok(lines.includes("URL:https://example.com/my?a=1,b=2"));
  assert.equal(lines.at(-1), "");
  assert.equal(lines.at(-2), "END:VCALENDAR");
  assert.ok(buildICS([], { now: NOW }).includes("\r\n") && !/[^\r]\n/.test(buildICS(selectForExport([c], { now: NOW }), { now: NOW })));
});
test("alarms: one VALARM per chosen reminder, 9:00-based for all-day", () => {
  const c = co({ events: [{ id: "e1", at: new Date(2026, 10, 24).toISOString(), label: "x" }, { id: "e2", at: new Date(2026, 10, 25, 14, 30).toISOString(), label: "y" }] });
  const ics = buildICS(selectForExport([c], { now: NOW }), { now: NOW, reminders: ["week", "d3", "d1", "morning"] });
  assert.equal(ics.match(/BEGIN:VALARM/g).length, 8);
  assert.equal(ics.match(/ACTION:DISPLAY/g).length, 8);
  assert.equal(triggerFor("d1", new Date(2026, 10, 24), true), "-PT15H");
  assert.equal(triggerFor("morning", new Date(2026, 10, 24), true), "PT9H");
  assert.equal(triggerFor("week", new Date(2026, 10, 24), true), "-P6DT15H");
  assert.equal(triggerFor("d3", new Date(2026, 10, 25, 14, 30), false), "-P3D");
  assert.equal(triggerFor("morning", new Date(2026, 10, 25, 14, 30), false), "-PT5H30M");
  assert.equal(triggerFor("morning", new Date(2026, 10, 25, 8, 0), false), "PT0M");
  assert.equal(buildICS(selectForExport([c], { now: NOW }), { now: NOW }).match(/BEGIN:VALARM/g).length, 4); // default 3日前+前日
});
test("stable UID and selection of not-done events of active companies", () => {
  const c = co({ events: [
    { id: "past", at: new Date(2026, 10, 1).toISOString(), label: "p" },
    { id: "done", at: new Date(2026, 10, 30).toISOString(), label: "d", done: true },
    { id: "next", at: new Date(2026, 10, 30).toISOString(), label: "n" },
  ] });
  const ended = co({ id: "c2", stage: "rejected", events: [{ id: "z", at: new Date(2026, 10, 30).toISOString() }] });
  assert.deepEqual(selectForExport([c, ended], { now: NOW }).map((x) => x.event.id), ["next"]);
  assert.deepEqual(selectForExport([c], { now: NOW, range: "all" }).map((x) => x.event.id), ["past", "next"]);
  assert.equal(uidFor(c, c.events[0]), "past-c1@shukatsu-board");
  const a = buildICS(selectForExport([c], { now: NOW }), { now: NOW });
  const b = buildICS(selectForExport([c], { now: NOW }), { now: new Date() });
  assert.equal(a.match(/UID:.*/)[0], b.match(/UID:.*/)[0]);
});

test("semicolons, commas and backslashes are escaped in the written file", () => {
  assert.equal(escapeText("A;B"), "A\\;B");
  assert.equal(escapeText("A;B").length, 4);
  const c = { id: "c1", name: "株式会社A;B,C", position: "総合職", kind: "本選考", stage: "entry", stages: [{ id: "entry", label: "エントリー" }], url: "", events: [{ id: "e1", at: new Date(2026, 11, 1, 10).toISOString(), label: "一次;面接", done: false }] };
  const ics = buildICS([{ company: c, event: c.events[0] }], { reminders: [], now: new Date(2026, 10, 20) });
  const summary = ics.split("\r\n").find((l) => l.startsWith("SUMMARY:"));
  assert.ok(summary.includes("株式会社A\\;B\\,C"), summary);
  assert.ok(summary.includes("一次\\;面接"), summary);
});
test("export of upcoming events drops a deadline that passed earlier today", () => {
  const c = { id: "c1", name: "A", stage: "entry", events: [
    { id: "am", at: new Date(2026, 10, 20, 10).toISOString(), label: "", done: false },
    { id: "pm", at: new Date(2026, 10, 20, 18).toISOString(), label: "", done: false },
  ] };
  const out = selectForExport([c], { range: "future", now: new Date(2026, 10, 20, 15) });
  assert.deepEqual(out.map((x) => x.event.id), ["pm"]);
});
