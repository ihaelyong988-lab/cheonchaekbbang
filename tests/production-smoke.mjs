import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const baseURL = new URL(process.env.PRODUCTION_URL || "https://ihaelyong988-lab.github.io/cheonchaekbbang/");
const assets = {
  "index.html": "천책빵",
  "app.js": "PRD-천책빵.md v1.7",
  "app.css": "--hero-accent",
  "data/books.js": "DOMAIN_TARGETS",
  "data/celeb-books-2025.js": "verified-correction",
  "lib/search.js": "createQuestionSearch",
  "manifest.webmanifest": '"standalone"',
  "sw.js": "ccb-v1.7.3",
};

for (const [asset, marker] of Object.entries(assets)) {
  const url = new URL(asset, baseURL);
  url.searchParams.set("verify", Date.now().toString());
  const response = await fetch(url, { redirect: "follow", cache: "no-store" });
  assert.equal(response.status, 200, `${asset}: HTTP ${response.status}`);
  assert.match(await response.text(), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"), `${asset}: 운영 표식 누락`);
}

const executablePath = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  chromium.executablePath(),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find(existsSync);
assert.ok(executablePath, "Chrome, Edge 또는 Playwright Chromium을 찾지 못했습니다.");
const browser = await chromium.launch({ headless: true, executablePath });
const verifiedViewports = [];

try {
  for (const width of [360, 390, 430]) {
    const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    await page.goto(baseURL.href, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator('.tab[aria-current="page"] span').textContent(), "홈", `${width}px: 홈 첫 화면 아님`);
    assert.equal(await page.title(), "천책빵 — 뿌리를 찾는 서재", `${width}px: 브라우저 제목 불일치`);
    assert.deepEqual(await page.evaluate(async () => {
      const meta = (selector) => document.querySelector(selector)?.content;
      const manifest = await fetch(new URL("./manifest.webmanifest", location.href)).then((response) => response.json());
      return {
        applicationName: meta('meta[name="application-name"]'),
        appleTitle: meta('meta[name="apple-mobile-web-app-title"]'),
        ogSiteName: meta('meta[property="og:site_name"]'),
        manifestName: manifest.name,
        manifestShortName: manifest.short_name,
      };
    }), {
      applicationName: "천책빵",
      appleTitle: "천책빵",
      ogSiteName: "천책빵",
      manifestName: "천책빵 — 뿌리를 찾는 서재",
      manifestShortName: "천책빵",
    }, `${width}px: 사이트 이름 메타데이터 불일치`);
    assert.equal(await page.locator(".tab").count(), 4, `${width}px: 4탭 누락`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `${width}px: 가로 넘침`);
    assert.deepEqual(await page.evaluate(async () => {
      const { BOOKS } = await import(new URL("./data/books.js", location.href).href);
      return [BOOKS.length, BOOKS.reduce((sum, book) => sum + book.questions.length, 0)];
    }), [175, 590], `${width}px: 운영 데이터 수 불일치`);
    assert.equal(await page.locator(".q-card").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(214, 214, 207)");
    if (width === 390) {
      await page.locator("#question-search").fill("돈과 투자는 어떻게 판단해야 하는가");
      await page.locator("#question-search-form").evaluate((form) => form.requestSubmit());
      assert.ok(await page.getByText("현명한 투자자", { exact: true }).count() > 0, "운영 질문 검색 실패");
      assert.ok((await page.evaluate(() => caches.keys())).includes("ccb-v1.7.3"), "운영 SW 캐시 버전 불일치");
      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      assert.equal(await page.locator('.tab[aria-current="page"] span').textContent(), "홈", "운영 오프라인 reload 실패");
      await context.setOffline(false);
    }
    assert.deepEqual(errors, [], `${width}px: 운영 런타임 오류`);
    verifiedViewports.push(`${width}x844`);
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({
  result: "pass",
  url: baseURL.href,
  assets: Object.keys(assets),
  viewports: verifiedViewports,
  books: 175,
  questions: 590,
  siteName: "천책빵",
  cache: "ccb-v1.7.3",
  offline: true,
}, null, 2));
