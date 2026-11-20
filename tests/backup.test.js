process.env.TZ = "Asia/Tokyo";
import test from "node:test";
import assert from "node:assert/strict";
import { validateBackup, planImport, serializeBackup, decodeIcon, BACKUP_VERSION } from "../js/backup.js";
import { normalize, DEFAULT_STAGES } from "../js/model.js";
import { createMemoryStore } from "../js/store.js";

// 1x1 transparent PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const file = (over = {}) => ({ app: "shukatsu-board", version: 3, exportedAt: "2026-11-20T00:00:00.000Z", companies: [], icons: {}, ...over });
let n = 0; const seqId = (p) => `${p}${++n}`;

test("v1 backup (single nextDate, no stages) migrates", () => {
  const v = validateBackup(JSON.stringify(file({ version: 1, companies: [{ id: "a", name: "旧社", stage: "final", nextDate: "2026-11-25T00:00:00Z", nextLabel: "最終面接" }] })));
  assert.equal(v.ok, true);
  const c = v.companies[0];
  assert.equal(c.stages.length, DEFAULT_STAGES.length);
  assert.equal(c.stage, "final");
  assert.equal(c.events[0].label, "最終面接");
  assert.equal(v.template, null);
});
test("v2 backup (stages + template, no events) migrates", () => {
  const stages = [{ id: "s1", label: "エントリー" }, { id: "s2", label: "面接" }, { id: "s3", label: "内定" }];
  const v = validateBackup(file({ version: 2, template: { stages }, companies: [{ id: "a", name: "社", stages, stage: "s2" }] }));
  assert.equal(v.ok, true);
  assert.deepEqual(v.template.map((s) => s.label), stages.map((s) => s.label));
  assert.equal(v.template[2].offer, true); // label 内定 migrates to the offer stage
  assert.deepEqual(v.companies[0].events, []);
});
test("v3 roundtrip keeps events, stages and icons", () => {
  const c = normalize({ id: "a", name: "社", iconId: "i1", events: [{ id: "e1", at: "2026-11-25T01:00:00.000Z", label: "一次面接", done: true }] });
  const payload = serializeBackup({ companies: [c], template: DEFAULT_STAGES, icons: { i1: PNG } });
  assert.equal(payload.version, BACKUP_VERSION);
  const v = validateBackup(JSON.stringify(payload));
  assert.equal(v.ok, true);
  assert.deepEqual(v.companies[0].events, c.events);
  assert.equal(v.iconCount, 1);
  assert.equal(v.icons.i1.type, "image/png");
});
test("rejects wrong app, unknown version and broken JSON", () => {
  assert.equal(validateBackup("{").ok, false);
  assert.equal(validateBackup(JSON.stringify({ app: "other", companies: [] })).ok, false);
  const v = validateBackup(file({ version: 99, companies: [{ name: "a" }] }));
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /バージョン/);
  assert.equal(validateBackup(file({ version: "3", companies: [{ name: "a" }] })).ok, false);
});
test("rejects SVG or mislabelled icons, and non-http URLs", () => {
  const svg = "data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64");
  const r1 = validateBackup(file({ companies: [{ name: "a", iconId: "x" }], icons: { x: svg } }));
  assert.equal(r1.ok, false);
  assert.match(r1.errors.join(), /image\/svg\+xml/);
  assert.equal(typeof decodeIcon("data:image/png;base64," + Buffer.from("GIF89a....").toString("base64")), "string");
  const r2 = validateBackup(file({ companies: [{ name: "a", url: "javascript:alert(1)" }] }));
  assert.equal(r2.ok, false);
  assert.match(r2.errors[0], /http/);
});
test("one bad company rejects the whole file", () => {
  const v = validateBackup(file({ companies: [{ name: "ok" }, { name: "" }, { name: "x", events: [{ at: "nope" }] }] }));
  assert.equal(v.ok, false);
  assert.equal(v.errors.length, 2);
  assert.match(v.errors[0], /^2件目/);
});
test("import plan: replace keeps ids and template; add renames collisions", () => {
  const v = validateBackup(file({ template: { stages: DEFAULT_STAGES }, companies: [{ id: "a", name: "A", iconId: "x" }, { id: "b", name: "B" }], icons: { x: PNG } }));
  const rep = planImport(v, "replace", ["a", "zzz"], seqId);
  assert.equal(rep.clear, true);
  assert.deepEqual(rep.companies.map((c) => c.id), ["a", "b"]);
  assert.ok(rep.template);
  assert.equal(rep.icons.length, 1);
  assert.equal(rep.companies[0].iconId, rep.icons[0].id);
  const add = planImport(v, "add", ["a"], seqId);
  assert.equal(add.clear, false);
  assert.equal(add.template, null);
  assert.notEqual(add.companies[0].id, "a");
  assert.equal(add.companies[1].id, "b");
});
test("memory store applies an import all-or-nothing", async () => {
  const s = createMemoryStore();
  await s.put(normalize({ id: "keep", name: "既存" }));
  const v = validateBackup(file({ companies: [{ id: "n", name: "新" }] }));
  const plan = planImport(v, "replace", ["keep"], seqId);
  plan.companies.push({ id: "bad", fn: () => 1 }); // not cloneable -> throws mid-way
  await assert.rejects(s.applyImport(plan));
  assert.deepEqual((await s.all()).map((c) => c.id), ["keep"]);
  plan.companies.pop();
  await s.applyImport(plan);
  assert.deepEqual((await s.all()).map((c) => c.id), ["n"]);
});

test("v4 keeps kind and notes; v3 (no kind/notes) migrates to defaults", () => {
  const c4 = normalize({ id: "a", name: "社", kind: "ウィンターインターン", notes: { es: [{ id: "q1", question: "自己PR", answer: "粘り強さ" }], interviews: [] } });
  const v4 = validateBackup(JSON.stringify(serializeBackup({ companies: [c4], template: DEFAULT_STAGES, icons: {} })));
  assert.equal(v4.ok, true);
  assert.equal(v4.version, BACKUP_VERSION);
  assert.equal(v4.companies[0].kind, "ウィンターインターン");
  assert.equal(v4.companies[0].notes.es[0].answer, "粘り強さ");
  const v3 = validateBackup(file({ version: 3, companies: [{ id: "b", name: "旧", events: [{ id: "e", at: "2026-11-25T00:00:00Z", label: "x" }] }] }));
  assert.equal(v3.ok, true);
  assert.equal(v3.companies[0].kind, "本選考");
  assert.deepEqual(v3.companies[0].notes, { es: [], interviews: [] });
});
test("v4 validation rejects oversized notes and bad kind", () => {
  const long = validateBackup(file({ version: 4, companies: [{ name: "a", notes: { es: [{ question: "q", answer: "x".repeat(10001) }] } }] }));
  assert.equal(long.ok, false);
  assert.match(long.errors[0], /10000/);
  const many = validateBackup(file({ version: 4, companies: [{ name: "a", notes: { interviews: Array.from({ length: 51 }, () => ({ title: "t" })) } }] }));
  assert.equal(many.ok, false);
  const kind = validateBackup(file({ version: 4, companies: [{ name: "a", kind: 5 }] }));
  assert.equal(kind.ok, false);
});

test("backup reminder: only for own data, after 7 days, and only when changed since the last backup", async () => {
  const { backupReminder } = await import("../js/backup.js");
  const now = new Date("2026-11-20T03:00:00Z");
  const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();
  const rec = (updatedAt, extra = {}) => ({ id: "x", updatedAt, history: [{ stage: "entry", at: updatedAt }], ...extra });
  assert.equal(backupReminder({ companies: [], now }), null);
  assert.equal(backupReminder({ companies: [rec(daysAgo(30), { example: true })], now }), null);
  assert.equal(backupReminder({ companies: [rec(daysAgo(2))], now }), null);
  assert.deepEqual(backupReminder({ companies: [rec(daysAgo(8))], now }), { never: true, days: 8 });
  assert.equal(backupReminder({ companies: [rec(daysAgo(20))], lastBackupAt: daysAgo(10), now }), null);
  assert.deepEqual(backupReminder({ companies: [rec(daysAgo(1))], lastBackupAt: daysAgo(10), now }), { never: false, days: 10 });
  assert.equal(backupReminder({ companies: [rec(daysAgo(1))], lastBackupAt: daysAgo(3), now }), null);
  assert.equal(backupReminder({ companies: [rec(daysAgo(8))], snoozeUntil: daysAgo(-1), now }), null);
});

test("v5 keeps the offer flag and ES limit; v4 migrates the flag", () => {
  const stages = [{ id: "s1", label: "書類" }, { id: "s2", label: "最終面接" }, { id: "s3", label: "内定承諾" }];
  const c = normalize({ id: "a", name: "社", stages: stages.map((s, i) => ({ ...s, offer: i === 1 })), stage: "s2", notes: { es: [{ id: "q", question: "志望動機", answer: "x", limit: 400 }] } });
  const v5 = validateBackup(JSON.stringify(serializeBackup({ companies: [c], template: DEFAULT_STAGES, icons: {} })));
  assert.equal(v5.ok, true);
  assert.equal(v5.version, 5);
  assert.deepEqual(v5.companies[0].stages.map((s) => s.offer), [false, true, false]);
  assert.equal(v5.companies[0].notes.es[0].limit, 400);
  assert.equal(v5.template[7].offer, true);
  const v4 = validateBackup(file({ version: 4, template: { stages: [{ id: "x", label: "最終" }] }, companies: [{ id: "b", name: "旧", stages, stage: "s2" }, { id: "c", name: "旧2", stage: "offer" }] }));
  assert.equal(v4.ok, true);
  assert.deepEqual(v4.companies[0].stages.map((s) => s.offer), [false, false, true]); // label 内定承諾
  assert.equal(v4.companies[1].stages.find((s) => s.offer).id, "offer");
  assert.equal(v4.template[0].offer, false); // no 内定 anywhere: none, not the last stage
  const bad = validateBackup(file({ version: 5, companies: [{ name: "a", notes: { es: [{ answer: "x", limit: 99999 }] } }] }));
  assert.equal(bad.ok, false);
});
