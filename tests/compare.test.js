process.env.TZ = "Asia/Tokyo";
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompare, compareErrors, overallRating, bestIds, compareSelection, hasCompareData, formatCell, COMPARE_FIELDS } from "../js/compare.js";
import { normalize, isOffer } from "../js/model.js";
import { matchesQuery } from "../js/notes.js";

test("old records get an empty compare object", () => {
  const c = normalize({ name: "旧" });
  assert.equal(c.compare.salary, null);
  assert.equal(c.compare.location, "");
  assert.deepEqual(c.compare.ratings, { work: null, growth: null, comfort: null, stable: null });
  assert.equal(hasCompareData(c), false);
});
test("normalize keeps valid values and drops bad ones", () => {
  const n = normalizeCompare({ salary: "255,000", annual: 450, holidays: 400, housing: "あり", housingNote: "家賃の8割", transfer: "たまに", ratings: { work: 5, growth: "4", comfort: 9, stable: 2.5 }, location: "  東京 " });
  assert.equal(n.salary, 255000);
  assert.equal(n.annual, 450);
  assert.equal(n.holidays, null);
  assert.equal(n.housing, "あり");
  assert.equal(n.transfer, "");
  assert.equal(n.location, "東京");
  assert.deepEqual(n.ratings, { work: 5, growth: 4, comfort: null, stable: null });
});
test("strict validation for backups", () => {
  assert.deepEqual(compareErrors(undefined), []);
  assert.deepEqual(compareErrors({ salary: 250000, ratings: { work: 3 } }), []);
  assert.match(compareErrors({ salary: -1 })[0], /初任給/);
  assert.match(compareErrors({ holidays: 500 })[0], /年間休日/);
  assert.match(compareErrors({ housing: "たくさん" })[0], /住宅補助/);
  assert.match(compareErrors({ ratings: { stable: 6 } })[0], /安定/);
  assert.match(compareErrors({ benefits: "x".repeat(501) })[0], /500文字/);
  assert.equal(compareErrors([]).length, 1);
});
test("overall rating and best values", () => {
  assert.equal(overallRating({ ratings: { work: 5, growth: 4, comfort: null, stable: 4 } }), 4.3);
  assert.equal(overallRating({ ratings: {} }), null);
  const a = normalize({ id: "a", name: "A", compare: { salary: 250000, holidays: 125, ratings: { work: 4 } } });
  const b = normalize({ id: "b", name: "B", compare: { salary: 270000, holidays: 125, ratings: { work: 5 } } });
  const c = normalize({ id: "c", name: "C", compare: { salary: 270000, ratings: { work: 3 } } });
  assert.deepEqual([...bestIds([a, b, c], "salary")].sort(), ["b", "c"]); // ties share the mark
  assert.deepEqual([...bestIds([a, b, c], "holidays")], []); // all equal: no mark
  assert.deepEqual([...bestIds([a, c], "annual")], []); // nobody filled in
  assert.deepEqual([...bestIds([a, b, c], "r:work")], ["b"]);
  assert.deepEqual([...bestIds([a, b], "overall")], ["b"]);
  assert.deepEqual([...bestIds([a], "salary")], []); // a single value is not "best"
});
test("default selection: 内定 companies plus those with conditions; saved wins", () => {
  const offer = normalize({ id: "o", name: "O", stage: "offer" });
  const filled = normalize({ id: "f", name: "F", compare: { location: "大阪" } });
  const other = normalize({ id: "x", name: "X" });
  assert.deepEqual(compareSelection([offer, filled, other], null, isOffer), ["o", "f"]);
  assert.deepEqual(compareSelection([offer, filled, other], ["x", "gone"], isOffer), ["x"]);
  assert.deepEqual(compareSelection([offer], [], isOffer), []);
});
test("cell formatting and search", () => {
  const c = normalize({ name: "A", compare: { salary: 255000, housing: "一部", housingNote: "寮あり", workstyle: "リモート週2", benefits: "資格手当" } });
  const f = (k) => COMPARE_FIELDS.find((x) => x.key === k);
  assert.equal(formatCell(c, f("salary")), "255,000円");
  assert.equal(formatCell(c, f("housing")), "一部（寮あり）");
  assert.equal(formatCell(c, f("annual")), "");
  assert.ok(matchesQuery(c, "リモート"));
  assert.ok(matchesQuery(c, "資格手当"));
});
