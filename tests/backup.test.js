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
  assert.deepEqual(v.template, stages);
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
