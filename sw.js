// 천책빵 Service Worker — 전 자산 캐시, 완전 오프라인 동작 (PRD §6)
const CACHE = "ccb-v1.7.3";
const ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./data/books.js",
  "./data/research-books.js",
  "./data/celeb-books-2025.js",
  "./lib/search.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(async (keys) => {
        const isUpdate = keys.some((key) => key.startsWith("ccb-") && key !== CACHE);
        await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
        await self.clients.claim();
        if (!isUpdate) return;
        const clients = await self.clients.matchAll({ type: "window" });
        await Promise.all(clients.map((client) => client.navigate(client.url)));
      })
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
