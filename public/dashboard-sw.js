/* GhostChat dashboard PWA shell. Network-first for app pages; never caches API or marketing. */
const CACHE = "ghostchat-dashboard-v1";
const APP = /^\/(login|signup|account|dashboard)(\/|\?|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([
    "/dashboard",
    "/dashboard/styles.css",
    "/dashboard/app.js",
    "/icon-192.png",
    "/icon-512.png",
    "/apple-touch-icon.png",
    "/dashboard.webmanifest",
  ]).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  const isApp = APP.test(url.pathname) || url.pathname.startsWith("/dashboard/") || url.pathname === "/dashboard.webmanifest" || url.pathname === "/dashboard-sw.js";
  if (!isApp) return;
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || caches.match("/dashboard")))
  );
});
