/* Reusing ES answers across companies. Pure. */
import { esCount } from "./notes.js";

export const ES_CATEGORIES = Object.freeze(["志望動機", "自己PR", "ガクチカ", "長所・短所", "入社後にやりたいこと", "その他"]);
const RULES = [
  ["長所・短所", /長所|短所|弱み|欠点/],
  ["志望動機", /志望|応募(の)?(理由|動機)|なぜ(当社|弊社|この会社)|選んだ理由/],
  ["ガクチカ", /ガクチカ|学生時代|力を入れ|打ち込|頑張った|がんばった|挑戦した経験/],
  ["自己PR", /自己\s*(PR|ＰＲ|ピーアール)|自己アピール|強み|アピール/i],
  ["入社後にやりたいこと", /入社後|やりたいこと|実現したい|キャリア|将来|成し遂げ/],
];
/** Rough category of an ES question from its wording. */
export function classifyQuestion(q) {
  const s = String(q || "");
  for (const [cat, re] of RULES) if (re.test(s)) return cat;
  return "その他";
}

/**
 * ES answers from other records, newest first.
 * Each item: {company, entry, category, count}. Empty answers are skipped.
 * query: every word must appear in question, answer, company name or kind.
 */
export function esLibrary(companies, { excludeId = null, query = "", category = "all" } = {}) {
  const words = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const c of companies) {
    if (c.id === excludeId) continue;
    for (const e of (c.notes && c.notes.es) || []) {
      if (!String(e.answer || "").trim()) continue;
      const cat = classifyQuestion(e.question);
      if (category !== "all" && cat !== category) continue;
      if (words.length) {
        const hay = `${e.question}\n${e.answer}\n${c.name}\n${c.kind}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
      }
      out.push({ company: c, entry: e, category: cat, count: esCount(e.answer), at: e.updatedAt || c.updatedAt || "" });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.company.name.localeCompare(b.company.name, "ja"));
}
