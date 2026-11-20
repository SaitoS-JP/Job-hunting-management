/* 使い方ツアー: spotlight real elements with a tooltip. No library. */
import { $, esc } from "./html.js";
import { tourStepsFor } from "../onboarding.js";

const STEPS = [
  { target: "#btn-add", title: "企業を追加", text: "応募した企業はここから登録します。社名だけでも登録でき、予定や段階はあとから足せます。" },
  { target: ".upcoming", title: "直近の予定", text: "締切や面接が近い順に並びます。「今日」「あと3日」のように残りの日数も表示します。" },
  { target: "#main .lrow:not(.lhead)", title: "企業ごとの進み具合", text: "矢印で今の選考段階が分かります。選考が進んだら「次へ →」を押すだけで更新できます。" },
  { target: ".viewbar .tabs", title: "一覧とカレンダー", text: "「カレンダー」に切り替えると、予定を月のカレンダーで確認できます。" },
  { target: ".toolbar", title: "検索と絞り込み", text: "社名やESの内容で検索したり、志望度・選考の種類で絞り込んだりできます。" },
  { target: "#btn-menu", title: "メニュー", text: "バックアップ、カレンダーへの書き出し、段階テンプレート、はじめかた、使い方はここから開けます。" },
];
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

/** cfg: {hasCompanies(), insertSamples(): Promise, beforeStart()} */
export function createTour(cfg) {
  const root = $("tour"), hole = $("tour-hole"), tip = $("tour-tip");
  let steps = [], i = 0, returnFocus = null, raf = 0, intro = false;

  const exists = (sel) => visible(document.querySelector(sel));
  const target = () => (steps[i] && steps[i].target ? document.querySelector(steps[i].target) : null);

  function place() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const el = target();
      const vw = innerWidth, vh = innerHeight, m = 12;
      const phone = vw <= 560;
      if (!el) { hole.hidden = true; tip.className = "tour-tip center"; tip.style.cssText = ""; return; }
      const r = el.getBoundingClientRect(), pad = 6;
      hole.hidden = false;
      Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      if (phone) {
        const low = r.top + r.height / 2 > vh / 2;
        tip.className = `tour-tip sheet ${low ? "at-top" : "at-bottom"}`;
        tip.style.cssText = "";
        return;
      }
      tip.className = "tour-tip float";
      const tw = Math.min(360, vw - m * 2);
      tip.style.width = `${tw}px`;
      const th = tip.offsetHeight;
      let top = r.bottom + pad + 10;
      if (top + th > vh - m) top = Math.max(m, r.top - pad - 10 - th);
      let left = Math.min(Math.max(m, r.left), vw - tw - m);
      tip.style.left = `${left}px`; tip.style.top = `${top}px`;
    });
  }
  function render() {
    const s = steps[i];
    const btn = (id, label, cls = "") => `<button type="button" class="btn ${cls}" id="${id}">${esc(label)}</button>`;
    if (intro) {
      $("tour-count").textContent = "";
      $("tour-title").textContent = "使い方ツアー";
      $("tour-text").textContent = "まだ企業が登録されていません。サンプル（架空の企業）を入れると、一覧の見方まで確認できます。サンプルはあとで「サンプルを削除」で消せます。";
      $("tour-btns").innerHTML = btn("tour-samples", "サンプルを入れて見る", "primary") + btn("tour-plain", "このまま見る") + btn("tour-end", "終了", "ghost");
    } else {
      $("tour-count").textContent = `${i + 1} / ${steps.length}`;
      $("tour-title").textContent = s.title;
      $("tour-text").textContent = s.text;
      $("tour-btns").innerHTML = (i > 0 ? btn("tour-prev", "戻る") : "") + btn("tour-next", i === steps.length - 1 ? "おわり" : "次へ", "primary") + btn("tour-end", "終了", "ghost");
      const el = target();
      if (el) el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced() ? "auto" : "smooth" });
    }
    place();
    $("tour-title").focus();
  }
  function begin() {
    intro = false;
    steps = tourStepsFor(STEPS, exists);
    i = 0; render();
  }
  function start() {
    if (!root.hidden) return;
    cfg.beforeStart && cfg.beforeStart();
    returnFocus = document.activeElement;
    root.hidden = false; document.body.classList.add("touring");
    addEventListener("scroll", place, true); addEventListener("resize", place);
    if (!cfg.hasCompanies()) { intro = true; steps = []; render(); } else begin();
  }
  function end() {
    root.hidden = true; document.body.classList.remove("touring");
    removeEventListener("scroll", place, true); removeEventListener("resize", place);
    const f = returnFocus; returnFocus = null;
    if (f && f.isConnected && visible(f) && typeof f.focus === "function") f.focus();
    else if (cfg.fallbackFocus) cfg.fallbackFocus();
  }
  const go = (d) => { const n = i + d; if (n < 0) return; if (n >= steps.length) return end(); i = n; render(); };

  $("tour-btns").addEventListener("click", async (e) => {
    const id = e.target.closest("button") && e.target.closest("button").id;
    if (id === "tour-next") go(1);
    else if (id === "tour-prev") go(-1);
    else if (id === "tour-end") end();
    else if (id === "tour-plain") begin();
    else if (id === "tour-samples") { e.target.disabled = true; await cfg.insertSamples(); begin(); }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); end(); }
    else if (!intro && e.key === "ArrowRight") { e.preventDefault(); go(1); }
    else if (!intro && e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    else if (e.key === "Tab") { // keep focus inside the tooltip
      const f = [...tip.querySelectorAll("button:not([disabled]), [tabindex='-1']")];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  $("tour-block").addEventListener("click", () => $("tour-title").focus());
  return { start, end, isOpen: () => !root.hidden };
}
