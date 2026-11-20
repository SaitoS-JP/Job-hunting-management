/* 就活ボード service worker — offline app shell. Bump VERSION on every release. */
const VERSION = "v14";
const SHELL_CACHE = "shukatsu-shell-" + VERSION;
const FONT_CACHE = "shukatsu-fonts-v2";
const SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./js/main.js",
  "./js/store.js",
  "./js/model.js",
  "./js/events.js",
  "./js/dates.js",
  "./js/backup.js",
  "./js/samples.js",
  "./js/notes.js",
  "./js/calendar.js",
  "./js/ics.js",
  "./js/icons.js",
  "./js/ui/html.js",
  "./js/ui/stepper.js",
  "./js/ui/list.js",
  "./js/ui/summary.js",
  "./js/ui/stage-editor.js",
  "./js/ui/dialog.js",
  "./js/ui/panels.js",
  "./js/ui/notes-editor.js",
  "./js/ui/calendar.js",
  "./js/ui/download.js",
  "./js/ui/es-picker.js",
  "./js/es.js",
  "./js/onboarding.js",
  "./js/compare.js",
  "./js/ics-sync.js",
  "./js/crypto-backup.js",
  "./js/ui/compare.js",
  "./js/ui/onboarding-card.js",
  "./js/ui/tour.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/favicon-32.png",
  "./fonts/fonts.css",
];

self.addEventListener("install", (event) => {
  // cache: "reload" so the new version is stored, never a copy from the browser's HTTP cache
  event.waitUntil(caches.open(SHELL_CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith("shukatsu-shell-") && k !== SHELL_CACHE) || k === "shukatsu-fonts").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* App files (page, scripts, styles, manifest): always ask the server first,
   revalidating past the HTTP cache, so the page and its scripts are the same
   release. The cached copy is used only when offline. */
function networkFirst(request, cacheKey) {
  return fetch(request.url, { cache: "no-cache", credentials: "same-origin" })
    .then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(cacheKey || request, copy)); }
      return res;
    })
    .catch(() => caches.match(cacheKey || request, { ignoreSearch: true })
      .then((r) => r || (request.mode === "navigate" ? caches.match("./") : undefined))
      .then((r) => r || Response.error()));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  // Font files: bundled with the app; keep each piece once it has been used
  if (/\/fonts\/.+\.woff2$/.test(url.pathname)) {
    event.respondWith(caches.open(FONT_CACHE).then((c) => c.match(req).then((r) => r || fetch(req).then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; }))));
    return;
  }

  // Pages, scripts, styles, manifest: network first (see networkFirst)
  if (req.mode === "navigate") { event.respondWith(networkFirst(req, "./index.html")); return; }
  if (/\.(?:js|css|webmanifest)$/.test(url.pathname)) { event.respondWith(networkFirst(req)); return; }

  // Everything else (icons): cache first
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
