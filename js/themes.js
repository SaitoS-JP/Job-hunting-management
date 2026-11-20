/* Theme list and preference parsing. Pure (no DOM). Token values live in
   app.css (標準) and themes.css (the others). */
export const THEMES = Object.freeze([
  { id: "standard", label: "標準", note: "落ち着いた手帳風。いつもの見た目です" },
  { id: "pop", label: "ポップ", note: "やわらかいパステルと丸い字体" },
  { id: "wa", label: "和風", note: "和紙の白に墨と朱、見出しは明朝" },
  { id: "yo", label: "洋風", note: "アイボリーにえんじ、セリフ体" },
  { id: "sf", label: "SF", note: "暗い宇宙とネオン、ドットと等幅の数字" },
].map(Object.freeze));
export const THEME_IDS = THEMES.map((t) => t.id);
/** Browser bar colours (theme-color) = each theme's --bg. Keep in sync with themes.css and theme-boot.js. */
export const THEME_META = Object.freeze({
  standard: { light: "#f3f4f1", dark: "#15191d" },
  pop: { light: "#fbf6f1", dark: "#1f1830" },
  wa: { light: "#f5f1e8", dark: "#171513" },
  yo: { light: "#f6f1e4", dark: "#10201a" },
  sf: { light: "#e9eef4", dark: "#070b14" },
});
export const THEME_KEY = "shukatsu.theme";
/** Stored value -> a known theme id ("standard" for anything else). */
export function parseThemePref(v) {
  return typeof v === "string" && THEME_IDS.includes(v) ? v : "standard";
}
export const themeFontCss = (id) => (id && id !== "standard" ? `./fonts/theme-${id}.css` : "");
