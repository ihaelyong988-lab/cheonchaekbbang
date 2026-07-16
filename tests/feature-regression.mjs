import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
};

function findBrowser() {
  const executablePath = [
    process.env.PLAYWRIGHT_CHROME_PATH,
    chromium.executablePath(),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean).find(existsSync);
  assert.ok(executablePath, "Chrome, Edge 또는 Playwright Chromium을 찾지 못했습니다.");
  return executablePath;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname) === "/" ? "index.html" : decodeURIComponent(url.pathname).slice(1);
    const filePath = path.resolve(ROOT, relative);
    assert.ok(filePath.startsWith(`${ROOT}${path.sep}`), "허용되지 않은 경로입니다.");
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    response.end(await readFile(filePath));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
const baseURL = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: findBrowser() });

async function freshPage() {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
    localStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  return { context, page, errors };
}

async function back(page) {
  await page.evaluate(() => history.back());
  await page.waitForTimeout(180);
}

try {
  const { context, page, errors } = await freshPage();

  // 서재 1,000권 확장 대비: 80권 단위 지연 렌더링.
  await page.locator('.tab[data-tab="library"]').click();
  assert.equal(await page.locator(".view > .card").count(), 80);
  assert.equal(await page.locator(".load-more").textContent(), "더 보기 · 80/175권");
  await page.locator(".load-more").click();
  assert.equal(await page.locator(".view > .card").count(), 160);
  await page.locator(".load-more").click();
  assert.equal(await page.locator(".view > .card").count(), 175);

  // 일반 시트의 모달 의미, 배경 inert, 포커스 트랩, Escape, 호출 위치 복귀.
  const firstCard = page.locator(".view > .card").first();
  const firstBookId = await firstCard.getAttribute("data-open-book");
  await firstCard.focus();
  await firstCard.click();
  assert.equal(await page.locator('.sheet[role="dialog"][aria-modal="true"]').count(), 1);
  assert.equal(await page.locator("#view").getAttribute("aria-hidden"), "true");
  assert.equal(await page.evaluate(() => document.body.classList.contains("has-overlay")), true);
  await page.locator(".sheet-close").focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest(".sheet"))), true);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(180);
  assert.equal(await page.locator(".sheet").count(), 0);
  assert.equal(await page.locator("#view").getAttribute("aria-hidden"), null);
  assert.equal(await page.evaluate((id) => document.activeElement?.dataset.openBook === id, firstBookId), true);

  // 뿌리 도달은 실제 따라가기 동작당 한 번만 증가하며 중첩 렌더에서 중복되지 않는다.
  await page.locator('[data-libtier="가지"]').click();
  await page.locator(".view > .card").first().click();
  const branchId = await page.locator("[data-open-trail]").getAttribute("data-open-trail");
  await page.locator("[data-open-trail]").click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).rootArrivals), 1);
  await page.locator(".trail-step [data-open-book]").first().click();
  await back(page);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).rootArrivals), 1);
  await back(page);
  assert.equal(await page.locator(`[data-open-trail="${branchId}"]`).count(), 1);

  // 읽음 상태는 안 읽음→읽는 중→읽음→안 읽음 순환 및 저장.
  await page.locator(`[data-cycle-read="${branchId}"]`).click();
  assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).reading)).includes(branchId));
  await page.locator(`[data-cycle-read="${branchId}"]`).click();
  assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).read)).includes(branchId));
  await page.locator(`[data-cycle-read="${branchId}"]`).click();
  assert.equal(await page.evaluate((id) => {
    const saved = JSON.parse(localStorage.getItem("cheonchaek.v1"));
    return saved.read.includes(id) || saved.reading.includes(id);
  }, branchId), false);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(180);

  // 질문 수집·답변의 지연 저장과 새로고침 유지.
  await page.locator('.tab[data-tab="question"]').click();
  const collectedId = await page.locator("[data-collect]").first().getAttribute("data-collect");
  await page.locator("[data-collect]").first().click();
  await page.locator('.tab[data-tab="record"]').click();
  const answer = "내가 검증한 질문의 답";
  await page.locator(`[data-answer-q="${collectedId}"]`).fill(answer);
  await page.waitForTimeout(320);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('.tab[data-tab="record"]').click();
  assert.equal(await page.locator(`[data-answer-q="${collectedId}"]`).inputValue(), answer);

  // 질문 여정은 앞 책 완료 전 다음 책 잠금, 해제 시 이후 진척 제거, 완료 답변 저장.
  await page.locator('.tab[data-tab="question"]').click();
  await page.locator("[data-open-jlist]").first().click();
  await page.locator("[data-start-journey]").first().click();
  assert.equal(await page.locator("[data-jcheck]").count(), 4);
  assert.deepEqual(await page.locator("[data-jcheck]").evaluateAll((items) => items.map((item) => item.disabled)), [false, true, true, true]);
  await page.locator("[data-jcheck]").nth(0).check();
  await page.locator("[data-jcheck]").nth(1).check();
  await page.locator("[data-jcheck]").nth(2).check();
  await page.locator("[data-jcheck]").nth(1).uncheck();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).journey.doneBookIds.length), 1);
  assert.deepEqual(await page.locator("[data-jcheck]").evaluateAll((items) => items.map((item) => item.disabled)), [false, false, true, true]);
  for (let index = 1; index < 4; index += 1) await page.locator("[data-jcheck]").nth(index).check();
  await page.locator("#j-answer").fill("뿌리부터 순서대로 읽은 답");
  const journeyId = await page.locator("[data-finish-journey]").getAttribute("data-finish-journey");
  await page.locator("[data-finish-journey]").click();
  await page.waitForTimeout(180);
  assert.deepEqual(await page.evaluate((id) => {
    const saved = JSON.parse(localStorage.getItem("cheonchaek.v1"));
    return [saved.journey, saved.journeysDone.find((item) => item.id === id)?.myAnswer];
  }, journeyId), [null, "뿌리부터 순서대로 읽은 답"]);
  assert.deepEqual(errors, []);
  await context.close();

  // 손상·중복·삭제된 ID를 정리하고 사용자 문자열은 HTML로 실행하지 않는다.
  const corrupt = await freshPage();
  await corrupt.page.evaluate(() => localStorage.setItem("cheonchaek.v1", JSON.stringify({
    version: 1,
    read: ["plato-republic", "plato-republic", "missing"],
    reading: ["plato-republic", "mencius", "missing"],
    questions: [
      { id: "plato-republic#0", bookId: "bad", date: "2026-07-17-extra", myAnswer: "x".repeat(12000) },
      { id: "plato-republic#0", bookId: "plato-republic", date: "", myAnswer: "duplicate" },
      { id: "missing#0", bookId: "missing" },
    ],
    journey: { id: "j-philosophy", doneBookIds: ["plato-republic", "sandel-justice"] },
    journeysDone: [{ id: "j-philosophy" }, { id: "j-philosophy" }, { id: "missing" }],
    profile: { name: '<img src=x onerror="document.body.dataset.hacked=1">' },
    theme: "invalid",
  })));
  await corrupt.page.reload({ waitUntil: "networkidle" });
  const cleaned = await corrupt.page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")));
  assert.equal(cleaned.version, 2);
  assert.deepEqual(cleaned.read, ["plato-republic"]);
  assert.deepEqual(cleaned.reading, ["mencius"]);
  assert.equal(cleaned.questions.length, 1);
  assert.equal(cleaned.questions[0].bookId, "plato-republic");
  assert.equal(cleaned.questions[0].myAnswer.length, 10000);
  assert.deepEqual(cleaned.journey.doneBookIds, ["plato-republic"]);
  assert.equal(cleaned.journeysDone.length, 1);
  assert.equal(cleaned.theme, "silver");
  assert.equal(await corrupt.page.locator("#profile-btn img").count(), 0);
  assert.equal(await corrupt.page.evaluate(() => document.body.dataset.hacked), undefined);
  assert.deepEqual(corrupt.errors, []);
  await corrupt.context.close();

  // 저장 공간 오류가 나도 앱은 작동하며 사용자에게 상태를 알린다.
  const quota = await freshPage();
  await quota.page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      value() { throw new DOMException("quota", "QuotaExceededError"); },
    });
  });
  await quota.page.reload({ waitUntil: "networkidle" });
  await quota.page.waitForTimeout(80);
  assert.equal(await quota.page.locator('.tab[aria-current="page"] span').textContent(), "홈");
  assert.match(await quota.page.locator("#app-status").textContent(), /저장 공간이 부족/u);
  assert.deepEqual(quota.errors, []);
  await quota.context.close();

  console.log(JSON.stringify({
    result: "pass",
    libraryPaging: [80, 160, 175],
    modalAccessibility: true,
    rootArrivalSingleIncrement: true,
    readStateCycle: true,
    questionAnswerPersistence: true,
    journeyStrictOrder: true,
    corruptedStorageRecovery: true,
    xssEscaping: true,
    quotaFailureNotice: true,
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
