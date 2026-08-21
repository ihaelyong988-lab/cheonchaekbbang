// 천책빵 Service Worker — 전 자산 캐시, 완전 오프라인 동작 (PRD §6)
const CACHE = "ccb-v1.17.0";
const ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./data/books.js",
  "./data/authored-questions.js",
  "./data/history-classics.js",
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
        // 갱신 사실만 통지한다. 열린 탭을 강제 이동시키면 history.state 가 소실된다.
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) client.postMessage({ type: "ccb-updated", cache: CACHE });
      })
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
