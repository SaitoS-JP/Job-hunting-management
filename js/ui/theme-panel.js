/* テーマ: apply a theme and the panel with live previews. */
import { $, esc } from "./html.js";
import { THEMES, THEME_META, THEME_KEY, parseThemePref, themeFontCss } from "../themes.js";

const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

export const currentTheme = () => parseThemePref(document.documentElement.getAttribute("data-theme-name"));
export const storedTheme = () => lsGet(THEME_KEY);

/** Switch the whole page to a theme (also used at start-up when only the settings store has it). */
export function applyTheme(id) {
  id = parseThemePref(id);
  const root = document.documentElement;
  if (id === "standard") root.removeAttribute("data-theme-name"); else root.setAttribute("data-theme-name", id);
  let link = document.getElementById("theme-font");
  const href = themeFontCss(id);
  if (!href) { if (link) link.remove(); }
  else {
    if (!link) { link = document.createElement("link"); link.rel = "stylesheet"; link.id = "theme-font"; document.head.appendChild(link); }
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  }
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.setAttribute("content", THEME_META[id][/dark/.test(m.getAttribute("media") || "") ? "dark" : "light"]);
  }
  lsSet(THEME_KEY, id);
  return id;
}

function previewFonts() {
  // previews show every theme at once, so their font definitions are needed while the panel is open
  for (const t of THEMES) {
    const href = themeFontCss(t.id);
    if (!href || document.querySelector(`link[data-preview-font="${t.id}"]`)) continue;
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href; l.dataset.previewFont = t.id;
    document.head.appendChild(l);
  }
}

function cardHTML(t, active) {
  const steps = ["entry", "es", "gd", "offer"].map((k, i) => `<i class="${i < 2 ? "on" : i === 2 ? "cur" : ""}" style="--sc:var(--st-${k})"></i>`).join("");
  return `<button type="button" role="radio" class="theme-card" id="theme-pick-${t.id}" data-theme-pick="${t.id}" aria-checked="${active}" tabindex="${active ? 0 : -1}">
    <span class="tp" data-theme-name="${t.id}" aria-hidden="true">
      <span class="tp-h"><b>就活ボード</b><span class="tp-chip">本選考</span></span>
      <span class="tp-steps">${steps}</span>
      <span class="tp-t">株式会社サンプル｜一次面接</span>
      <span class="tp-row"><span class="tp-n">11/22 14:00</span><span class="tp-btn">次へ →</span></span>
    </span>
    <span class="tp-l">${esc(t.label)}${active ? `<span class="tp-cur">使用中</span>` : ""}</span>
    <span class="tp-d">${esc(t.note)}</span>
  </button>`;
}

export function initThemePanel(app) {
  const grid = $("theme-grid");
  function render() {
    const cur = currentTheme();
    grid.innerHTML = THEMES.map((t) => cardHTML(t, t.id === cur)).join("");
  }
  function choose(id, focus = true) {
    const applied = applyTheme(id);
    app.serial(() => app.store().putSetting("theme", applied)).catch(() => {});
    render();
    $("theme-msg").textContent = `「${THEMES.find((t) => t.id === applied).label}」にしました。`;
    if (focus) $(`theme-pick-${applied}`).focus();
  }
  function open(show = $("theme-panel").hidden) {
    $("theme-panel").hidden = !show;
    $("btn-theme").setAttribute("aria-expanded", String(show));
    $("theme-msg").textContent = "";
    if (show) { previewFonts(); render(); $("theme-panel").scrollIntoView({ block: "nearest" }); $(`theme-pick-${currentTheme()}`).focus(); }
  }
  grid.addEventListener("click", (e) => { const b = e.target.closest("[data-theme-pick]"); if (b) choose(b.dataset.themePick); });
  grid.addEventListener("keydown", (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    const ids = THEMES.map((t) => t.id);
    const i = ids.indexOf(currentTheme());
    choose(ids[(i + d + ids.length) % ids.length]); e.preventDefault();
  });
  $("btn-theme").addEventListener("click", () => open());
  $("btn-theme-close").addEventListener("click", () => { open(false); $("btn-menu").focus(); });
  $("btn-theme-reset").addEventListener("click", () => choose("standard", false));
  app.openThemePanel = open;
  /* the settings store is the backup of localStorage: restore from it when the fast path is empty */
  app.syncTheme = async () => {
    if (storedTheme() !== null) return;
    const saved = await app.store().getSetting("theme").catch(() => null);
    if (saved && parseThemePref(saved) !== "standard") applyTheme(saved);
  };
}
