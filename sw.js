/* E-Jet Ops Watch – Service Worker: App-Shell offline, Daten network-first. */
const VERSION = "ejw-v4";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "ejw-fonts").map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function withCacheFlag(res) {
  const headers = new Headers(res.headers);
  headers.set("x-ejw-cache", "1");
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Daten: immer zuerst Netz, sonst letzter Stand aus dem Cache
  if (url.origin === location.origin && url.pathname.endsWith("/data/issues.json")) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(e.request, { cache: "no-store" });
        if (res.ok) await cache.put("data/issues.json", res.clone());
        return res;
      } catch {
        const hit = await cache.match("data/issues.json");
        return hit ? withCacheFlag(hit) : Response.error();
      }
    })());
    return;
  }

  // Google Fonts: stale-while-revalidate
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith((async () => {
      const cache = await caches.open("ejw-fonts");
      const hit = await cache.match(e.request);
      const net = fetch(e.request).then((res) => { if (res.ok || res.type === "opaque") cache.put(e.request, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  // App-Shell: Cache zuerst, im Hintergrund auffrischen
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || (await cache.match("index.html")) || Response.error();
    })());
  }
});
