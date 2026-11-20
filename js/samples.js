/* Fictional example companies for 「サンプルを入れて試す」. Pure. */
import { normalize, cloneStages, stageId, labelIn } from "./model.js";

export function buildSamples(template, now = new Date()) {
  const day = (n, h = 0, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); d.setDate(d.getDate() + n); return d.toISOString(); };
  const ago = (n) => day(-n, 12);
  const at = (i) => template[Math.min(i, template.length - 1)].id;
  // one sample shows a company-specific list (三次面接 added, Webテスト removed)
  const custom = ["気になる", "エントリー", "ES・書類選考", "一次面接", "二次面接", "三次面接", "最終面接", "内定"].map((label) => ({ id: stageId(), label }));
  const ev = (n, label, h, m) => ({ at: day(n, h, m), label });
  const rows = [
    { name: "サンプル商事", position: "総合職（事務系）", industry: "商社", stage: at(4), priority: 1, events: [ev(2, "一次面接", 14), ev(6, "適性検査", 10), ev(11, "二次面接", 15, 30)], hist: [1, 2, 3, 4].map(at) },
    { name: "架空テック", position: "エンジニア職", industry: "IT・通信", stage: at(2), priority: 1, events: [ev(0, "ES締切", 23, 59)], hist: [1, 2].map(at) },
    { name: "みどり食品（例）", position: "研究開発コース", industry: "食品", stage: at(3), priority: 2, events: [ev(5, "Webテスト締切")], hist: [1, 2, 3].map(at) },
    { name: "ほしぞら銀行（例）", position: "オープンコース", industry: "金融", stages: custom, stage: custom[5].id, priority: 2, events: [ev(9, "三次面接", 10)], hist: [1, 2, 3, 4, 5].map((i) => custom[i].id) },
    { name: "あおば出版（例）", position: "編集職", industry: "出版", stage: "rejected", priority: 3, events: [], hist: [...[1, 2, 4].map(at), "rejected"] },
    { name: "サンプル物流", position: "総合職", industry: "物流", stage: at(0), priority: 3, events: [ev(12, "説明会", 13)], hist: [at(0)] },
  ];
  return rows.map((r) => {
    const stages = cloneStages(r.stages || template);
    const n = r.hist.length;
    return normalize({
      name: r.name, position: r.position, industry: r.industry, stages, stage: r.stage, priority: r.priority,
      events: r.events, url: "", memo: "これはサンプルです。自由に編集・削除できます。",
      history: r.hist.map((s, i) => ({ stage: s, at: ago((n - i) * 6), label: labelIn(stages, s) })),
      updatedAt: now.toISOString(), example: true,
    });
  });
}
