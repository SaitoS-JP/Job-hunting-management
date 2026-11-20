process.env.TZ = "Asia/Tokyo";
import test from "node:test";
import assert from "node:assert/strict";
import { esLibrary, classifyQuestion } from "../js/es.js";
import { esCount, limitStatus, normalizeLimit, normalizeNotes, notesErrors } from "../js/notes.js";
import { normalize } from "../js/model.js";

test("ES count: all characters except line breaks; surrogate pairs count once", () => {
  assert.equal(esCount("志望動機"), 4);
  assert.equal(esCount("一行目\n二行目\r\n三"), 7);
  assert.equal(esCount("𠮷野家 👍!"), 6);
  assert.equal(esCount(""), 0);
});
test("limit status text", () => {
  assert.deepEqual(limitStatus(123, 400), { text: "123 / 400字", over: false, rest: "あと277字" });
  assert.deepEqual(limitStatus(445, 400), { text: "445 / 400字", over: true, rest: "45字オーバー" });
  assert.equal(limitStatus(400, 400).rest, "あと0字");
  assert.deepEqual(limitStatus(12, null), { text: "12字", over: false, rest: "" });
});
test("limit normalization and validation bounds", () => {
  assert.equal(normalizeLimit("400"), 400);
  assert.equal(normalizeLimit(0), null);
  assert.equal(normalizeLimit(10001), null);
  assert.equal(normalizeLimit(12.5), null);
  assert.equal(normalizeLimit(""), null);
  assert.equal(normalizeNotes({ es: [{ question: "q", answer: "a", limit: 300 }] }).es[0].limit, 300);
  assert.equal(normalizeNotes({ es: [{ question: "q", answer: "a" }] }).es[0].limit, null);
  assert.deepEqual(notesErrors({ es: [{ limit: 400 }] }), []);
  assert.match(notesErrors({ es: [{ limit: 0 }] })[0], /文字数制限/);
});
test("question categories", () => {
  assert.equal(classifyQuestion("当社を志望する理由"), "志望動機");
  assert.equal(classifyQuestion("自己PRをしてください"), "自己PR");
  assert.equal(classifyQuestion("あなたの強みを教えてください"), "自己PR");
  assert.equal(classifyQuestion("学生時代に力を入れたこと"), "ガクチカ");
  assert.equal(classifyQuestion("あなたの長所と短所"), "長所・短所");
  assert.equal(classifyQuestion("入社後に挑戦したいこと"), "入社後にやりたいこと");
  assert.equal(classifyQuestion("最近気になったニュース"), "その他");
});
test("library: other records only, newest first, query and category filters", () => {
  const a = normalize({ id: "a", name: "A商事", kind: "本選考", notes: { es: [
    { id: "1", question: "志望動機", answer: "物流に関心", updatedAt: "2026-11-10T00:00:00Z" },
    { id: "2", question: "ガクチカ", answer: "", updatedAt: "2026-11-12T00:00:00Z" },
  ] } });
  const b = normalize({ id: "b", name: "Bテック", kind: "サマーインターン", stage: "rejected", notes: { es: [
    { id: "3", question: "自己PR", answer: "粘り強さ\n改善", updatedAt: "2026-11-15T00:00:00Z" },
  ] } });
  const me = normalize({ id: "me", name: "自分", notes: { es: [{ id: "4", question: "志望動機", answer: "x" }] } });
  const all = esLibrary([a, b, me], { excludeId: "me" });
  assert.deepEqual(all.map((x) => x.entry.id), ["3", "1"]); // empty answers skipped, ended companies included
  assert.equal(all[0].count, 6);
  assert.deepEqual(esLibrary([a, b, me], { excludeId: "me", category: "志望動機" }).map((x) => x.entry.id), ["1"]);
  assert.deepEqual(esLibrary([a, b], { query: "インターン 粘り" }).map((x) => x.entry.id), ["3"]);
  assert.deepEqual(esLibrary([a, b], { query: "a商事" }).map((x) => x.entry.id), ["1"]);
  assert.equal(esLibrary([a, b], { query: "存在しない" }).length, 0);
});
