/* 就活ボード service worker — offline app shell. Bump VERSION on every release. */
const VERSION = "v2";
const SHELL_CACHE = "shukatsu-shell-" + VERSION;
const FONT_CACHE = "shukatsu-fonts";
const SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shukatsu-shell-") && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      const fresh = fetch(request).then((res) => {
        if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Google Fonts: optional; keep a copy for offline use
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Pages: network first so updates arrive, cached shell when offline
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put("./index.html", copy)); }
        return res;
      }).catch(() => caches.match("./index.html", { ignoreSearch: true }).then((r) => r || caches.match("./")))
    );
    return;
  }

  // Script / style: serve cached, refresh in background
  if (/\.(?:js|css)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  // Everything else (icons, manifest): cache first
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
