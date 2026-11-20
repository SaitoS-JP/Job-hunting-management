/* 「はじめかた」checklist card. */
import { $ } from "./html.js";
import { onboardingSteps, onboardingProgress, checklistVisible } from "../onboarding.js";

const TEXT = {
  add: { title: "企業を1社登録する", body: "社名だけでOKです。職種や段階はあとからでも入れられます。", btn: "＋ 企業を追加" },
  event: { title: "締切や面接の予定を1件入れる", body: "ES締切や面接日を入れると、「直近の予定」に近い順で並びます。", btn: "予定を入れる" },
  advance: { title: "選考が進んだら「次へ →」で段階を進める", body: "一覧の各行の「次へ →」を押すと、矢印が1つ進み、履歴にも残ります。", btn: "「次へ →」の場所を見る" },
  protect: { title: "データが消えないように守る", body: "データはこの端末の中だけにあります。バックアップを書き出しておくと、機種変更やデータ削除のときも戻せます。", btn: "バックアップを書き出す" },
};

/**
 * state: {companies, lastBackupAt, ios, standalone, dismissed, doneSeen, forced}
 * Returns whether the card is visible (other first-run banners stay hidden then).
 */
export function renderOnboarding(state, { hasSamples }) {
  const box = $("onboard");
  const steps = onboardingSteps(state);
  const p = onboardingProgress(steps);
  const show = checklistVisible({ all: p.all, dismissed: state.dismissed, doneSeen: state.doneSeen, forced: state.forced });
  box.hidden = !show;
  if (!show) return { visible: false, all: p.all };
  const firstOpen = steps.findIndex((s) => !s.done);
  const items = steps.map((s, k) => {
    const t = TEXT[s.id];
    if (s.done) return `<li class="ob-step done"><span class="ob-mark" aria-hidden="true">✓</span><span class="ob-t">${t.title}</span><span class="sr">（完了）</span></li>`;
    const extra = s.id === "protect" && s.installHint
      ? `<p class="ob-b">iPhone なら Safari の共有ボタン → 「ホーム画面に追加」で、アプリとして使えて消えにくくなります。</p>` : "";
    return `<li class="ob-step${k === firstOpen ? " next" : ""}"><span class="ob-mark num" aria-hidden="true">${k + 1}</span>
      <div class="ob-c"><span class="ob-t">${t.title}</span><p class="ob-b">${t.body}</p>${extra}
      <button type="button" class="btn small${k === firstOpen ? " primary" : ""}" data-ob="${s.id}" id="ob-btn-${s.id}">${t.btn}</button>
      <p class="hint ob-msg" id="ob-msg-${s.id}" role="status"></p></div></li>`;
  }).join("");
  box.innerHTML = `
    <div class="ob-h">
      <h2 id="ob-title">はじめかた</h2>
      <span class="ob-prog num">${p.done} / ${p.total} 完了</span>
      <button type="button" class="btn small ghost" id="btn-ob-close">閉じる</button>
    </div>
    <div class="ob-bar" role="progressbar" aria-label="はじめかたの進み具合" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}"><span style="width:${p.ratio * 100}%"></span></div>
    ${p.all ? `<p class="ob-done" role="status">準備ができました。あとは選考が進むたびに「次へ →」と予定を更新するだけです。</p>` : ""}
    <ol class="ob-steps">${items}</ol>
    <p class="ob-links">
      ${hasSamples ? "" : `<button type="button" class="linkbtn" data-ob="samples" id="ob-samples">サンプルで試してみる</button>`}
      <button type="button" class="linkbtn" data-ob="tour" id="ob-tour">使い方ツアーを見る</button>
    </p>`;
  return { visible: true, all: p.all };
}
