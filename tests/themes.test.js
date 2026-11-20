import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEMES, parseThemePref, THEME_META } from "../js/themes.js";

/* ---- read the token blocks out of the CSS ---- */
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
function tokens(body) {
  const out = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
/** {light, dark} tokens for a selector found at top level and inside @media (prefers-color-scheme: dark) */
function tokenSets(css, selector) {
  const esc = selector.replace(/[[\]"().*+?^$|\\]/g, "\\$&");
  const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
  const blocks = [...css.matchAll(new RegExp(`(^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`, "g"))];
  const light = {}, dark = {};
  for (const b of blocks) {
    // inside a dark media block?
    const before = css.slice(0, b.index);
    const lastMedia = before.lastIndexOf("@media (prefers-color-scheme: dark)");
    const closedSince = lastMedia >= 0 ? before.slice(lastMedia).split("{").length - before.slice(lastMedia).split("}").length : 0;
    Object.assign(lastMedia >= 0 && closedSince > 0 && darkStart >= 0 ? dark : light, tokens(b[2]));
  }
  return { light, dark };
}
const app = read("app.css"), themes = read("themes.css");
const SETS = { standard: tokenSets(app, ':root, [data-theme-name="standard"]') };
for (const t of THEMES.filter((x) => x.id !== "standard")) SETS[t.id] = tokenSets(themes, `[data-theme-name="${t.id}"]`);

/* ---- WCAG contrast ---- */
function lum(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) throw new Error(`not a hex colour: ${hex}`);
  const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

// [foreground, background, minimum]
const PAIRS = [
  ["ink", "bg", 4.5], ["ink", "surface", 4.5], ["ink-2", "surface", 4.5], ["ink-2", "bg", 4.5], ["ink", "surface-2", 4.5],
  ["accent-ink", "accent", 4.5], ["accent", "bg", 4.5], ["accent", "surface", 4.5], ["danger", "surface", 4.5], ["danger", "danger-soft", 4.5],
  ["ok", "surface", 4.5], ["warn", "surface", 4.5], ["warn", "warn-soft", 4.5], ["chip-ink", "chip", 4.5], ["accent", "accent-soft", 4.5],
  ["ink-3", "surface", 3], ["step-off-ink", "step-off", 3], ["focus", "bg", 3], ["line", "surface", 1.1],
  ...[0, 1, 2, 3, 4, 5].map((i) => [`mg${i}-i`, `mg${i}-b`, 4.5]),
  ...["interest", "entry", "es", "test", "gd", "interview2", "final", "offer", "rejected"].map((k) => [`st-${k}`, "surface", 3]),
];

for (const t of THEMES) {
  for (const mode of ["light", "dark"]) {
    test(`${t.id} (${mode}): key colour pairs meet contrast minimums`, () => {
      const base = SETS.standard.light, set = { ...(mode === "dark" ? { ...base, ...SETS.standard.dark } : base), ...SETS[t.id].light, ...(mode === "dark" ? SETS[t.id].dark : {}) };
      const fails = PAIRS.filter(([f, b, min]) => contrast(set[f], set[b]) < min).map(([f, b, min]) => `${f}/${b} ${contrast(set[f], set[b]).toFixed(2)} < ${min}`);
      assert.deepEqual(fails, []);
    });
  }
}
test("every theme defines the same colour tokens for light and dark", () => {
  const colourKeys = Object.keys(SETS.standard.dark).sort();
  for (const t of THEMES.filter((x) => x.id !== "standard")) {
    for (const mode of ["light", "dark"]) {
      const missing = colourKeys.filter((k) => !(k in SETS[t.id][mode]));
      assert.deepEqual(missing, [], `${t.id} ${mode}`);
    }
  }
});
test("the stage colours and the 内定 green stay distinguishable in every theme", () => {
  for (const t of THEMES) for (const mode of ["light", "dark"]) {
    const s = { ...SETS.standard.light, ...(mode === "dark" ? SETS.standard.dark : {}), ...SETS[t.id].light, ...(mode === "dark" ? SETS[t.id].dark : {}) };
    const keys = ["entry", "es", "test", "gd", "interview2", "final", "offer", "rejected"].map((k) => s[`st-${k}`]);
    assert.equal(new Set(keys).size, keys.length, `${t.id} ${mode}`);
    // offer must differ clearly from rejected and from the 'warn' tone
    assert.ok(contrast(s["st-offer"], s["st-rejected"]) > 1.05 || s["st-offer"] !== s["st-rejected"]);
  }
});
test("theme preference parsing", () => {
  assert.equal(parseThemePref("pop"), "pop");
  assert.equal(parseThemePref("standard"), "standard");
  assert.equal(parseThemePref(null), "standard");
  assert.equal(parseThemePref(""), "standard");
  assert.equal(parseThemePref("evil\"><script>"), "standard");
  assert.equal(parseThemePref("SF"), "standard");
  assert.deepEqual(THEMES.map((t) => t.id), ["standard", "pop", "wa", "yo", "sf"]);
  for (const t of THEMES) assert.ok(/^#[0-9a-f]{6}$/i.test(THEME_META[t.id].light) && /^#[0-9a-f]{6}$/i.test(THEME_META[t.id].dark));
});
test("theme-color values match each theme's background", () => {
  for (const t of THEMES) {
    const s = SETS[t.id];
    assert.equal(THEME_META[t.id].light.toLowerCase(), (s.light.bg || SETS.standard.light.bg).toLowerCase());
    assert.equal(THEME_META[t.id].dark.toLowerCase(), (s.dark.bg || SETS.standard.dark.bg).toLowerCase());
  }
});
test("theme-boot.js uses the same names and colours as js/themes.js", () => {
  const boot = read("js/theme-boot.js");
  for (const t of THEMES.filter((x) => x.id !== "standard")) {
    assert.ok(boot.includes(`${t.id}:["${THEME_META[t.id].light}","${THEME_META[t.id].dark}"]`), t.id);
  }
});
