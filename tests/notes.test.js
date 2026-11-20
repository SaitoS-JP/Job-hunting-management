process.env.TZ = "Asia/Tokyo";
import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../js/model.js";
import { normalizeKind, normalizeNotes, notesErrors, matchesQuery, charCount, NOTE_LIMITS } from "../js/notes.js";

test("kind: missing or blank becomes 本選考; free text kept", () => {
  assert.equal(normalize({ name: "a" }).kind, "本選考");
  assert.equal(normalizeKind("  "), "本選考");
  assert.equal(normalizeKind("サマーインターン"), "サマーインターン");
  assert.equal(normalizeKind("1day仕事体験"), "1day仕事体験");
  assert.equal(normalizeKind("あ".repeat(30)).length, 20);
});
test("notes: old records get empty notes; entries normalized and capped", () => {
  assert.deepEqual(normalize({ name: "a" }).notes, { es: [], interviews: [] });
  const n = normalizeNotes({
    es: [{ question: "志望動機", answer: "x".repeat(NOTE_LIMITS.answer + 5) }, null, "bad"],
    interviews: [{ date: "2026/11/01", title: "一次面接", questions: "q" }, { date: "2026-11-02" }],
  });
  assert.equal(n.es.length, 1);
  assert.equal(n.es[0].answer.length, NOTE_LIMITS.answer);
  assert.ok(n.es[0].id);
  assert.equal(n.interviews[0].date, "");
  assert.equal(n.interviews[1].date, "2026-11-02");
  assert.equal(normalizeNotes({ es: Array.from({ length: 80 }, () => ({})) }).es.length, NOTE_LIMITS.entries);
});
test("strict note checks for backups", () => {
  assert.deepEqual(notesErrors(undefined), []);
  assert.deepEqual(notesErrors({ es: [{ question: "q", answer: "a" }] }), []);
  assert.match(notesErrors({ es: [{ answer: "x".repeat(NOTE_LIMITS.answer + 1) }] })[0], /10000/);
  assert.match(notesErrors({ es: Array.from({ length: 51 }, () => ({})) })[0], /50件/);
  assert.match(notesErrors({ interviews: [{ date: "11/1" }] })[0], /日付/);
  assert.equal(notesErrors("x").length, 1);
});
test("search matches name, kind and ES/面接 text; all words must match", () => {
  const c = normalize({ name: "サンプル商事", kind: "サマーインターン", notes: { es: [{ question: "ガクチカ", answer: "ゼミで地域企業にヒアリング" }], interviews: [{ title: "一次面接", reflection: "結論から話す" }] } });
  assert.ok(matchesQuery(c, ""));
  assert.ok(matchesQuery(c, "ヒアリング"));
  assert.ok(matchesQuery(c, "結論"));
  assert.ok(matchesQuery(c, "インターン 商事"));
  assert.ok(!matchesQuery(c, "商事 銀行"));
  assert.ok(matchesQuery(normalize({ name: "ABC Tech" }), "abc tech"));
});
test("character count treats emoji/surrogate pairs as one", () => {
  assert.equal(charCount("志望動機"), 4);
  assert.equal(charCount("𠮷野家"), 3);
  assert.equal(charCount(""), 0);
});
