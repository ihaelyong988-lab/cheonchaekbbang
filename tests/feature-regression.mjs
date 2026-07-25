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
  assert.equal(await page.locator("#lib-list > .card").count(), 80);
  assert.equal(await page.locator(".load-more").textContent(), "더 보기 · 80/175권");
  await page.locator(".load-more").click();
  assert.equal(await page.locator("#lib-list > .card").count(), 160);
  await page.locator(".load-more").click();
  assert.equal(await page.locator("#lib-list > .card").count(), 175);

  // 일반 시트의 모달 의미, 배경 inert, 포커스 트랩, Escape, 호출 위치 복귀.
  const firstCard = page.locator("#lib-list > .card").first();
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
  await page.locator("#lib-list > .card").first().click();
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

  // G-3 초안 보존 — 체크박스 해제·재체크가 완료 답 초안을 지우지 않는다(원장 9).
  const journeyDraft = "체크를 고치는 동안 지워지면 안 되는 초안";
  await page.locator("#j-answer").fill(journeyDraft);
  await page.waitForTimeout(320);
  await page.locator("[data-jcheck]").nth(3).uncheck();
  await page.locator("[data-jcheck]").nth(3).check();
  await page.waitForTimeout(320);
  assert.equal(await page.locator("#j-answer").inputValue(), journeyDraft, "체크박스 조작 후 완료 답 초안이 입력 요소에서 사라졌습니다.");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).journeyDraft), journeyDraft, "저장된 완료 답 초안이 입력 문자열과 다릅니다.");

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
  // 여정 진행은 첫 결번에서 절단하지 않고 결번만 건너뛴다(원장 11 처방).
  assert.deepEqual(cleaned.journey.doneBookIds, ["plato-republic", "sandel-justice"]);
  assert.equal(cleaned.journeysDone.length, 1);
  assert.equal(cleaned.theme, "silver");
  // 카탈로그에 없는 참조는 삭제가 아니라 격리 보존한다(DI-1). 중복·읽음 우선·상한·테마 정화는 그대로 유지된다.
  assert.ok(Array.isArray(cleaned.orphans), "격리 보존 필드 state.orphans 가 없습니다.");
  const corruptOrphanIds = new Set(cleaned.orphans.map((item) => item.id));
  assert.equal(corruptOrphanIds.has("missing"), true, "카탈로그에 없는 읽음·읽는 중 참조가 격리되지 않았습니다.");
  assert.equal(corruptOrphanIds.has("missing#0"), true, "카탈로그에 없는 질문 참조가 격리되지 않았습니다.");
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

  // G-5 낙관적 UI 금지 — 저장이 실패한 수집은 완료 표시로 바뀌지 않고 보이는 오류 1건이 뜬다(원장 10 · DI-4).
  // 라이브 리전 문구는 배너 도입 후에도 유지돼야 하므로 문구 자체가 아니라 클릭 전후 동일성을 단언한다.
  const quotaCollect = quota.page.locator("[data-collect]").first();
  const collectLabelBefore = await quotaCollect.textContent();
  const liveNoticeBefore = await quota.page.locator("#app-status").textContent();
  await quotaCollect.click();
  await quota.page.waitForTimeout(120);
  assert.equal(await quota.page.locator("[data-collect]").first().textContent(), collectLabelBefore, "저장이 실패했는데 수집 버튼이 완료 표시로 바뀌었습니다.");
  assert.equal(await quota.page.locator("[data-collect]").first().isDisabled(), false, "저장이 실패했는데 수집 버튼이 완료 상태로 잠겼습니다.");
  assert.equal(await quota.page.locator('[role="alert"]:visible').count(), 1, "저장 실패를 알리는 가시 오류가 1건이 아닙니다.");
  assert.equal(await quota.page.locator("#app-status").textContent(), liveNoticeBefore, "배너가 기존 라이브 리전 문구를 대체했습니다.");
  assert.deepEqual(quota.errors, []);
  await quota.context.close();

  /* G-4 prefs 복원 — 계보 분야·서재 계단 선택은 복원하고 검색어는 복원하지 않는다(원장 5 · C5-1 · C5-2).
     권수는 리터럴로 적지 않는다. 선택 전후 요약줄을 비교해 필터가 실제로 좁혔는지까지 함께 채점한다. */
  const prefs = await freshPage();
  await prefs.page.locator('.tab[data-tab="lineage"]').click();
  const lineagePick = await prefs.page.locator("[data-domain]").nth(1).getAttribute("data-domain");
  await prefs.page.locator(`[data-domain="${lineagePick}"]`).click();
  await prefs.page.locator('.tab[data-tab="library"]').click();
  const summaryAllTiers = await prefs.page.locator(".library-summary").textContent();
  await prefs.page.locator('[data-libtier="뿌리"]').click();
  const summaryRootTier = await prefs.page.locator(".library-summary").textContent();
  assert.notEqual(summaryRootTier, summaryAllTiers, "계단 칩이 서재 요약 권수를 좁히지 못했습니다.");
  const searchProbe = "복원되어서는 안 되는 검색어";
  await prefs.page.locator("#lib-search").fill(searchProbe);
  await prefs.page.waitForTimeout(120);
  await prefs.page.reload({ waitUntil: "networkidle" });
  await prefs.page.locator('.tab[data-tab="library"]').click();
  assert.equal(await prefs.page.locator('[data-libtier="뿌리"]').getAttribute("aria-pressed"), "true", "서재 계단 칩 선택이 복원되지 않았습니다.");
  assert.equal(await prefs.page.locator(".library-summary").textContent(), summaryRootTier, "복원된 서재 요약 권수가 선택값과 다릅니다.");
  assert.equal(await prefs.page.locator("#lib-search").inputValue(), "", "서재 검색어가 복원됐습니다(C5-2 위반).");
  await prefs.page.locator('.tab[data-tab="lineage"]').click();
  assert.equal(await prefs.page.locator(`[data-domain="${lineagePick}"]`).getAttribute("aria-pressed"), "true", "계보 분야 칩 선택이 복원되지 않았습니다.");
  const prefsSaved = await prefs.page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")));
  assert.deepEqual(prefsSaved.prefs, { lineageDomain: lineagePick, libDomain: "전체", libTier: "뿌리" }, "영속 prefs 필드가 처방이 지정한 형태와 다릅니다.");
  assert.equal(JSON.stringify(prefsSaved).includes(searchProbe), false, "검색어가 저장값에 남았습니다(C5-2 위반).");
  assert.deepEqual(prefs.errors, []);
  await prefs.context.close();

  /* G-6 카탈로그 격리 보존 — 카탈로그에서 사라진 참조는 삭제하지 않고 격리하며 기록 탭에서 1회 고지한다(원장 11 · DI-1).
     카탈로그 교체는 카탈로그에 없는 id 참조로 재현한다. 정화 코드가 타는 경로가 같다. */
  const drift = await freshPage();
  const keptAnswer = "카탈로그에 남은 책의 답";
  const lostAnswer = "카탈로그가 바뀌어도 사라져서는 안 되는 답";
  await drift.page.evaluate(([kept, lost]) => localStorage.setItem("cheonchaek.v1", JSON.stringify({
    version: 2,
    read: ["plato-republic", "retired-read"],
    reading: ["retired-reading"],
    questions: [
      { id: "plato-republic#0", bookId: "plato-republic", date: "2026-07-20", myAnswer: kept },
      { id: "retired-question#0", bookId: "retired-question", date: "2026-07-20", myAnswer: lost },
    ],
    journey: { id: "j-philosophy", doneBookIds: ["plato-republic"] },
    journeysDone: [],
    theme: "silver",
  })), [keptAnswer, lostAnswer]);
  await drift.page.reload({ waitUntil: "networkidle" });
  const drifted = await drift.page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")));
  assert.ok(Array.isArray(drifted.orphans), "격리 보존 필드 state.orphans 가 없습니다.");
  assert.deepEqual(drifted.orphans.map((item) => item.id).sort(), ["retired-question#0", "retired-read", "retired-reading"], "격리 항목 수가 잃어버린 참조 수와 다릅니다.");
  assert.equal(drifted.orphans.find((item) => item.id === "retired-question#0")?.myAnswer, lostAnswer, "격리된 질문의 답 원본이 보존되지 않았습니다.");
  assert.deepEqual(drifted.read, ["plato-republic"], "카탈로그에 있는 읽음 기록이 함께 사라졌습니다.");
  assert.equal(drifted.questions.length, 1, "카탈로그에 있는 질문 기록이 함께 사라졌습니다.");
  assert.equal(drifted.questions[0].myAnswer, keptAnswer, "카탈로그에 있는 질문의 답이 사라졌습니다.");
  await drift.page.locator('.tab[data-tab="record"]').click();
  assert.equal(await drift.page.locator("#view [data-orphan-notice]").count(), 1, "기록 탭 격리 고지가 1회가 아닙니다.");
  assert.equal(await drift.page.locator("#view [data-orphan-notice]").isVisible(), true, "기록 탭 격리 고지가 보이지 않습니다.");
  await drift.page.locator('.tab[data-tab="question"]').click();
  assert.equal(await drift.page.locator("#view [data-orphan-notice]").count(), 0, "격리 고지가 기록 탭 밖에도 노출됩니다.");
  assert.deepEqual(drift.errors, []);
  await drift.context.close();

  console.log(JSON.stringify({
    result: "pass",
    libraryPaging: [80, 160, 175],
    modalAccessibility: true,
    rootArrivalSingleIncrement: true,
    readStateCycle: true,
    questionAnswerPersistence: true,
    journeyStrictOrder: true,
    journeyDraftPreserved: true,
    corruptedStorageRecovery: true,
    xssEscaping: true,
    quotaFailureNotice: true,
    optimisticUiBlocked: true,
    prefsRestored: true,
    orphanQuarantine: true,
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
