// 천책빵 Service Worker — 전 자산 캐시, 완전 오프라인 동작 (PRD §6)
const CACHE = "ccb-v1.19.0";
// 카탈로그는 생성물(부팅 색인 + 분야 샤드 12개)만 캐시한다. 원천 모듈(data/books.js 등)은 Node 전용이라
// 함께 캐시하면 같은 책을 두 번 받는다(§7-2 V3b). 샤드 목록 완전성은 tests/static-rules.mjs 가 디스크와 대조한다.
const ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./data/boot-index.js",
  "./data/shards/philosophy.questions.js",
  "./data/shards/philosophy.meta.js",
  "./data/shards/history.questions.js",
  "./data/shards/history.meta.js",
  "./data/shards/science.questions.js",
  "./data/shards/science.meta.js",
  "./data/shards/literature.questions.js",
  "./data/shards/literature.meta.js",
  "./data/shards/economy-society.questions.js",
  "./data/shards/economy-society.meta.js",
  "./data/shards/arts.questions.js",
  "./data/shards/arts.meta.js",
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
