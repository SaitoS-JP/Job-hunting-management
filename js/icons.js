/* Company icons: monogram fallback, image crop/resize, object URL cache. */
import { esc } from "./ui/html.js";
import { getIconBlob } from "./store.js";

export function monoChar(name) {
  const n = String(name || "").trim().replace(/^(株式会社|有限会社|合同会社|（株）|\(株\)|㈱)\s*/, "");
  const ch = Array.from(n)[0] || "？";
  return /[a-z]/.test(ch) ? ch.toUpperCase() : ch;
}
export function hue(name) {
  let h = 2166136261;
  for (const ch of String(name || "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 6;
}
export function iconHTML(name, src, size) {
  const k = hue(name);
  return `<span class="ico" aria-hidden="true" style="--s:${size}px;--mgb:var(--mg${k}-b);--mgi:var(--mg${k}-i)">${esc(monoChar(name))}${src ? `<img src="${esc(src)}" alt="">` : ""}</span>`;
}
/* a broken image falls back to the monogram underneath */
export function installIconFallback() {
  document.addEventListener("error", (e) => {
    const t = e.target;
    if (t && t.tagName === "IMG" && t.parentElement && t.parentElement.classList.contains("ico")) t.remove();
  }, true);
}

/** Object URLs for stored icons; revoked when no record points at them. */
export class IconCache {
  constructor() { this.urls = new Map(); }
  get(id) { return id ? this.urls.get(id) || "" : ""; }
  async sync(store, ids) {
    const want = new Set(ids.filter(Boolean));
    for (const [id, url] of this.urls) if (!want.has(id)) { URL.revokeObjectURL(url); this.urls.delete(id); }
    for (const id of want) {
      if (this.urls.has(id)) continue;
      try { const b = await getIconBlob(store, id); if (b) this.urls.set(id, URL.createObjectURL(b)); } catch (e) {}
    }
  }
}

function canvasToBlob(cv, type, q) { return new Promise((r) => { try { cv.toBlob(r, type, q); } catch (e) { r(null); } }); }
/** Centre-crop and downscale to a 128×128 WebP (PNG where WebP is unsupported). */
export async function squareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const w = img.naturalWidth || 128, h = img.naturalHeight || 128, side = Math.min(w, h);
    const cv = document.createElement("canvas"); cv.width = cv.height = 128;
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 128, 128);
    let blob = await canvasToBlob(cv, "image/webp", 0.88);
    if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(cv, "image/png");
    if (!blob) throw new Error("encode");
    return blob;
  } finally { URL.revokeObjectURL(url); }
}
