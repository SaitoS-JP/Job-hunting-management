/* Fictional example companies for 「サンプルを入れて試す」. Pure. */
import { normalize, cloneStages, stageId, labelIn } from "./model.js";

export function buildSamples(template, now = new Date()) {
  const day = (n, h = 0, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); d.setDate(d.getDate() + n); return d.toISOString(); };
  const ymd = (n) => day(n, 12).slice(0, 10);
  const ago = (n) => day(-n, 12);
  const at = (i) => template[Math.min(i, template.length - 1)].id;
  // one sample shows a company-specific list (三次面接 added, Webテスト removed)
  const custom = ["気になる", "エントリー", "ES・書類選考", "一次面接", "二次面接", "三次面接", "最終面接", "内定"].map((label) => ({ id: stageId(), label }));
  const ev = (n, label, h, m, done) => ({ at: day(n, h, m), label, done: !!done });
  const rows = [
    {
      name: "サンプル商事", kind: "本選考", position: "総合職（事務系）", industry: "商社", stage: at(4), priority: 1,
      events: [ev(-3, "ES提出", 0, 0, true), ev(2, "一次面接", 14), ev(6, "適性検査", 10), ev(16, "二次面接", 15, 30)],
      hist: [1, 2, 3, 4].map(at),
      compare: { location: "東京（本社）", salary: 255000, annual: 450, bonus: "年2回・5か月", holidays: 122, housing: "あり", housingNote: "家賃の8割（入社5年まで）", transfer: "あり", transferNote: "3〜5年ごと", workstyle: "出社中心", benefits: "社員食堂、資格取得支援", ratings: { work: 4, growth: 5, comfort: 3, stable: 4 } },
      notes: {
        es: [
          { question: "志望動機", limit: 400, answer: "物流と商流の両方から地域の産業を支える仕事に関心があります。学生時代に地元の商店街で販路づくりを手伝った経験から、人と人をつなぐ役割を担いたいと考えています。" },
          { question: "学生時代に力を入れたこと", limit: 300, answer: "ゼミで地域企業10社へのヒアリングを企画し、報告書をまとめました。日程調整と質問設計を担当し、全社から回答を得ました。" },
        ],
        interviews: [{ date: ymd(-10), title: "GD", questions: "テーマ：新規事業の立案（4人・30分）", reflection: "時間配分の提案ができた。結論を先に言う練習が必要。" }],
      },
    },
    { name: "サンプル商事", kind: "サマーインターン", position: "5日間ワークショップ", industry: "商社", stage: "declined", priority: 1, events: [], hist: [1, 2].map(at).concat("declined") },
    { name: "架空テック", kind: "サマーインターン", position: "エンジニア職", industry: "IT・通信", stage: at(2), priority: 1, events: [ev(0, "ES締切", 23, 59), ev(24, "インターン初日", 10)], hist: [1, 2].map(at),
      compare: { location: "東京・大阪", salary: 270000, annual: 430, bonus: "年2回", holidays: 128, housing: "一部", housingNote: "住宅手当 月2万円", transfer: "なし", workstyle: "リモート週3・フレックス", benefits: "書籍購入補助", ratings: { work: 5, growth: 4, comfort: 5, stable: 3 } },
      notes: { es: [{ question: "あなたの強みを教えてください", limit: 200, answer: "粘り強く仕組みを改善できることです。アルバイト先の在庫管理表を作り直し、棚卸しの時間を半分にしました。" }], interviews: [] } },
    { name: "みどり食品（例）", kind: "本選考", position: "研究開発コース", industry: "食品", stage: at(3), priority: 2, events: [ev(5, "Webテスト締切")], hist: [1, 2, 3].map(at) },
    { name: "ほしぞら銀行（例）", kind: "早期選考", position: "オープンコース", industry: "金融", stages: custom, stage: custom[5].id, priority: 2, compare: { location: "全国（地域限定コースあり）", salary: 240000, annual: 410, bonus: "年2回・4.5か月", holidays: 121, housing: "あり", transfer: "地域限定あり", workstyle: "出社", ratings: { work: 3, growth: 3, comfort: 4, stable: 5 } }, events: [ev(9, "三次面接", 10), ev(30, "最終面接", 13)], hist: [1, 2, 3, 4, 5].map((i) => custom[i].id) },
    { name: "あおば出版（例）", kind: "本選考", position: "編集職", industry: "出版", stage: "rejected", priority: 3, events: [], hist: [...[1, 2, 4].map(at), "rejected"] },
    { name: "サンプル物流", kind: "ウィンターインターン", position: "総合職", industry: "物流", stage: at(0), priority: 3, events: [ev(12, "説明会", 13), ev(35, "ES締切")], hist: [at(0)] },
  ];
  return rows.map((r) => {
    const stages = cloneStages(r.stages || template);
    const n = r.hist.length;
    return normalize({
      name: r.name, kind: r.kind, position: r.position, industry: r.industry, stages, stage: r.stage, priority: r.priority,
      events: r.events, url: "", memo: "これはサンプルです。自由に編集・削除できます。", compare: r.compare,
      notes: r.notes ? { es: r.notes.es.map((e, i) => ({ ...e, updatedAt: ago(4 + i) })), interviews: r.notes.interviews } : undefined,
      history: r.hist.map((s, i) => ({ stage: s, at: ago((n - i) * 6), label: labelIn(stages, s) })),
      updatedAt: now.toISOString(), example: true,
    });
  });
}
