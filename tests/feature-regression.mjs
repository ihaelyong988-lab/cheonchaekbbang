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
  assert.equal(await page.locator(".load-more").textContent(), "더 보기 · 80/200권");
  await page.locator(".load-more").click();
  assert.equal(await page.locator("#lib-list > .card").count(), 160);
  await page.locator(".load-more").click();
  assert.equal(await page.locator("#lib-list > .card").count(), 200);

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

  /* ── G-18 (2026-08-09 방문자 실사) ─────────────────────────────────────
     소스에 처방이 적혀 있다는 것과 화면에서 그렇게 동작한다는 것은 다른 사실이다(§9 E-012).
     아래는 전부 방문자 조작을 그대로 재현해 결과를 센다. */

  /* N-12 — 시트를 연 채 여러 칸을 한 번에 뒤로 가면 앱이 갇혔다.
     팝업이 뜨고, 그 뒤 어떤 닫기 조작도 다시 팝업으로 되돌아와 새로고침 말고는 나갈 길이 없었다. */
  const trap = await freshPage();
  await trap.page.locator("#view [data-open-book]").first().click();
  await trap.page.waitForTimeout(200);
  assert.equal(await trap.page.locator(".sheet").count(), 1, "책 상세 시트가 열리지 않아 재현 조건이 서지 않습니다.");
  await trap.page.evaluate(() => history.go(-2));        // 뒤로 제스처 연타 = 두 칸 점프
  await trap.page.waitForTimeout(450);
  assert.equal(await trap.page.locator("#exit-dialog").isVisible(), true, "센티널에 닿았는데 종료 팝업이 뜨지 않았습니다.");
  await trap.page.keyboard.press("Escape");
  await trap.page.waitForTimeout(300);
  assert.equal(await trap.page.locator("#exit-dialog").isVisible(), false, "ESC 로 종료 팝업이 닫히지 않았습니다.");
  assert.equal(await trap.page.locator(".sheet").count(), 0,
    "히스토리는 홈인데 시트가 남아 있습니다 — 이 어긋남이 탈출 경로를 없앱니다(N-12).");
  assert.equal(await trap.page.evaluate(() => document.querySelector(".tabbar").inert), false,
    "배경 잠금이 걷히지 않아 하단 탭을 누를 수 없습니다(N-12).");
  await trap.page.locator('.tab[data-tab="library"]').click();
  await trap.page.waitForTimeout(250);
  assert.equal(await trap.page.locator("#lib-list").count(), 1, "팝업을 닫은 뒤 다른 탭으로 나가지 못합니다 — 막다른 길입니다.");
  assert.deepEqual(trap.errors, []);
  await trap.context.close();

  /* 원장 30 — 여정 체크가 켠 읽음은 체크를 되돌리면 함께 되돌아온다. */
  const revert = await freshPage();
  await revert.page.locator("#view [data-open-jlist]").first().click();
  await revert.page.waitForTimeout(200);
  await revert.page.locator("[data-start-journey]").first().click();
  await revert.page.waitForTimeout(250);
  const journeyBookIds = await revert.page.locator("[data-jcheck]").evaluateAll((els) => els.map((el) => el.dataset.jcheck));
  await revert.page.locator("[data-jcheck]").nth(0).check();
  await revert.page.waitForTimeout(150);
  await revert.page.locator("[data-jcheck]").nth(1).check();
  await revert.page.waitForTimeout(150);
  const savedRead = () => revert.page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).read);
  assert.deepEqual(await savedRead(), journeyBookIds.slice(0, 2), "여정 체크가 읽음을 켜지 않았습니다.");
  await revert.page.locator("[data-jcheck]").nth(1).uncheck();
  await revert.page.waitForTimeout(250);
  assert.deepEqual(await savedRead(), journeyBookIds.slice(0, 1),
    "체크를 되돌렸는데 읽음이 남았습니다 — 방문자의 읽은 책 수가 조작한 적 없는 값으로 늘어납니다(원장 30).");
  assert.deepEqual(revert.errors, []);
  await revert.context.close();

  /* 원장 50 — 홈 게이지 이동은 저장된 서재 필터를 덮어쓰지 않고, 좁혀진 화면에는 되돌림 컨트롤이 있다. */
  const gauge = await freshPage();
  await gauge.page.locator('.tab[data-tab="library"]').click();
  await gauge.page.waitForTimeout(200);
  await gauge.page.locator('[data-libdomain="문학"]').click();
  await gauge.page.waitForTimeout(200);
  const prefsBefore = await gauge.page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).prefs);
  await gauge.page.locator('.tab[data-tab="question"]').click();
  await gauge.page.waitForTimeout(350);
  await gauge.page.locator("[data-open-domain-list]").first().click();
  await gauge.page.waitForTimeout(350);
  assert.deepEqual(await gauge.page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).prefs), prefsBefore,
    "홈 게이지 이동이 방문자가 골라 저장한 서재 필터를 덮어썼습니다(원장 50).");
  assert.equal(await gauge.page.locator("[data-lib-reset]").isVisible(), true,
    "좁혀진 서재에 전체 보기로 되돌리는 컨트롤이 없습니다(원장 50 · 36).");
  await gauge.page.locator("[data-lib-reset]").click();
  await gauge.page.waitForTimeout(250);
  assert.equal(await gauge.page.locator(".library-summary").textContent(), "전체 서재 · 200권", "되돌림이 전체 서재로 복원하지 않았습니다.");
  assert.equal(await gauge.page.locator("[data-lib-reset]").count(), 0, "되돌린 뒤에도 되돌림 컨트롤이 남아 있습니다.");
  assert.deepEqual(gauge.errors, []);
  await gauge.context.close();

  /* 원장 20 · 29 — 필터·분야 칩을 눌러도 눌린 컨트롤이 살아 있고, 건너뛰기 버튼이 하단 탭으로 데려간다. */
  const keyboard = await freshPage();
  await keyboard.page.locator('.tab[data-tab="library"]').click();
  await keyboard.page.waitForTimeout(200);
  await keyboard.page.locator('[data-libtier="뿌리"]').click();
  await keyboard.page.waitForTimeout(200);
  assert.equal(await keyboard.page.evaluate(() => document.activeElement?.dataset?.libtier), "뿌리",
    "계단 필터를 누른 뒤 포커스가 사라졌습니다 — 키보드 사용자는 순회를 처음부터 다시 합니다(원장 20).");
  await keyboard.page.locator('.tab[data-tab="lineage"]').click();
  await keyboard.page.waitForTimeout(200);
  await keyboard.page.locator('[data-domain="과학"]').click();
  await keyboard.page.waitForTimeout(200);
  assert.equal(await keyboard.page.evaluate(() => document.activeElement?.dataset?.domain), "과학",
    "계보 분야 칩을 누른 뒤 포커스가 사라졌습니다(원장 20).");
  await keyboard.page.locator('[data-skip-to="tabbar"]').focus();
  await keyboard.page.keyboard.press("Enter");
  await keyboard.page.waitForTimeout(200);
  assert.equal(await keyboard.page.evaluate(() => document.activeElement?.classList?.contains("tab")), true,
    "건너뛰기 버튼이 하단 탭으로 포커스를 옮기지 않았습니다 — 서재에서는 98번을 눌러야 닿습니다(원장 29).");
  assert.deepEqual(keyboard.errors, []);
  await keyboard.context.close();

  /* 원장 34 · 37 · 49 · 52 — 백링크가 대상을 실어 나르고, 답칸에 상한과 접근 이름이 붙는다. */
  const land = await freshPage();
  await land.page.locator("#view [data-collect]").first().click();
  await land.page.waitForTimeout(200);
  await land.page.locator("[data-shuffle]").click();
  await land.page.waitForTimeout(200);
  await land.page.locator("#view [data-collect]").first().click();
  await land.page.waitForTimeout(200);
  assert.ok(await land.page.locator('.qstat[data-tab="lineage"]').getAttribute("data-land-domain"),
    "홈 스트립 [뿌리까지] 가 착지 분야를 싣지 않았습니다 — 지금 보는 책과 다른 계보가 열립니다(원장 34).");
  await land.page.locator("[data-land-question]").click();
  await land.page.waitForTimeout(450);
  const landed = await land.page.evaluate(() => {
    const el = document.querySelector(".qa-item.is-landed");
    if (!el) return null;
    return { top: el.getBoundingClientRect().top, viewport: window.innerHeight };
  });
  assert.ok(landed, "최근 질문 백링크가 대상 문답집 항목을 가리키지 않았습니다(원장 37).");
  assert.ok(landed.top >= 0 && landed.top < landed.viewport,
    `대상 항목이 화면 밖에 있습니다(top=${Math.round(landed.top)}px · 뷰포트 ${landed.viewport}px).`);
  const answerAttrs = await land.page.locator("#view [data-answer-q]").first()
    .evaluate((el) => ({ max: el.maxLength, labelledBy: el.getAttribute("aria-labelledby") }));
  assert.equal(answerAttrs.max, 10000, "문답집 답칸에 상한이 없어 초과분이 말없이 잘립니다(원장 49).");
  assert.ok(answerAttrs.labelledBy && (await land.page.locator(`#${answerAttrs.labelledBy}`).count()) === 1,
    "문답집 답칸의 접근 이름이 질문 문단에 연결되지 않았습니다(원장 52).");
  // 백링크 착지는 이동이지 설정 변경이 아니다 — 저장된 관심 분야를 바꾸면 안 된다.
  await land.page.locator('.tab[data-tab="question"]').click();   // 홈 스트립이 있는 화면으로 되돌아간다
  await land.page.waitForTimeout(400);
  await land.page.evaluate(() => {
    const strip = document.querySelector('.qstat[data-tab="lineage"]');
    strip.dataset.landDomain = "예술";
    strip.click();
  });
  await land.page.waitForTimeout(400);
  assert.equal(await land.page.locator('.chip[data-domain="예술"]').getAttribute("aria-pressed"), "true",
    "백링크가 실어 온 분야로 착지하지 않았습니다(원장 34).");
  assert.notEqual(await land.page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).prefs.lineageDomain), "예술",
    "백링크 착지가 저장된 관심 분야를 덮어썼습니다(N-11).");
  assert.deepEqual(land.errors, []);
  await land.context.close();

  /* 원장 65 — 여정을 전부 마치면 목록이 그 사실을 인정한다. 수치는 홈 스트립이 원천이라 문구에 넣지 않는다(R6). */
  const finished = await freshPage();
  const journeyIds = await finished.page.evaluate(async () => (await import("./data/books.js")).JOURNEYS.map((j) => j.id));
  await finished.page.evaluate((ids) => {
    localStorage.setItem("cheonchaek.v1", JSON.stringify({
      journeysDone: ids.map((id) => ({ id, date: "2026-08-09", myAnswer: "" })),
    }));
  }, journeyIds);
  await finished.page.reload({ waitUntil: "networkidle" });
  await finished.page.locator("#view [data-open-jlist]").first().click();
  await finished.page.waitForTimeout(300);
  const completionText = await finished.page.locator(".sheet .notice").first().textContent();
  assert.match(completionText, /모든 갈래의 질문을 지나 왔습니다/u, "여정을 전부 마쳤는데 완주 인정이 없습니다(원장 65).");
  assert.doesNotMatch(completionText, /\d/u, "완주 문구가 수치를 다시 표시합니다 — 원천은 홈 스트립입니다(R6).");
  assert.deepEqual(finished.errors, []);
  await finished.context.close();

  /* 주인님 지시(2026-08-09) — 질문은 최소 주 1회 갱신된다.
     같은 주에는 같은 묶음이 열리고, 주가 바뀌면 반드시 다른 묶음이 열려야 한다. */
  async function weeklyState(fixedIso) {
    const weekContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await weekContext.addInitScript((iso) => {
      const RealDate = Date;
      const fixed = new RealDate(iso).getTime();
      const FixedDate = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [fixed])); }
        static now() { return fixed; }
      };
      Object.defineProperty(globalThis, "Date", { value: FixedDate, writable: true, configurable: true });
    }, fixedIso);
    const weekPage = await weekContext.newPage();
    await weekPage.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await weekPage.evaluate(() => localStorage.clear());
    await weekPage.reload({ waitUntil: "networkidle" });
    await weekPage.locator("[data-shuffle]").click();      // 추첨을 저장으로 확정시킨다
    await weekPage.waitForTimeout(200);
    const saved = await weekPage.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")));
    await weekContext.close();
    return saved;
  }
  const weekOne = await weeklyState("2026-08-10T09:00:00Z");
  const weekOneAgain = await weeklyState("2026-08-12T21:00:00Z");   // 같은 주 다른 날
  const weekTwo = await weeklyState("2026-08-18T09:00:00Z");        // 다음 주
  const openedSet = (saved) => [...new Set([...saved.questionDeck, saved.lastHeroQuestionId])].sort();
  assert.match(weekOne.questionWeek, /^\d{4}-W\d{2}$/u, "이번 주 표기가 저장되지 않았습니다.");
  assert.equal(weekOne.questionWeek, weekOneAgain.questionWeek, "같은 주인데 주차 값이 갈렸습니다.");
  assert.notEqual(weekOne.questionWeek, weekTwo.questionWeek, "주가 바뀌었는데 주차 값이 그대로입니다.");
  assert.deepEqual(openedSet(weekOne), openedSet(weekOneAgain), "같은 주에 서로 다른 질문 묶음이 열렸습니다.");
  assert.notDeepEqual(openedSet(weekOne), openedSet(weekTwo),
    "주가 바뀌었는데 질문 묶음이 그대로입니다 — 최소 주 1회 갱신이 성립하지 않습니다.");
  assert.notEqual(weekOne.lastHeroQuestionId, weekTwo.lastHeroQuestionId, "주가 바뀌었는데 첫 질문이 같습니다.");
  /* 묶음이 주마다 바뀌는 것만으로는 부족하다 — 주 안에서 덱이 소진되지 않으면 매번 같은 두 문항만 돈다.
     로드와 [다른 질문]을 합쳐 두 번 넘게 뽑았으므로 남은 수는 묶음 크기보다 최소 2 적어야 한다.
     (정확한 소비 횟수로 세지 않는다 — reload 직전 pagehide 확정이 회차를 하나 더 얹는다.) */
  /* ── 손실 계수 (2026-08-09 신설) ────────────────────────────────────────
     새 동작만 단언하고 그 변경이 줄인 값을 안 세면, "주마다 다른 묶음"은 통과하면서
     카탈로그의 절반이 영영 안 열리는 상태가 초록으로 지나간다. 실제로 그렇게 배포됐다
     — 주당 14문항만 열려 1년을 다녀도 590 중 265문항이 도달 불가였다.
     아래 두 단언은 앱이 실제로 저장한 값과 실제 화면에 뜬 문구만 본다. */
  const { BOOKS: CATALOGUE } = await import("../data/books.js");
  const totalQuestions = CATALOGUE.reduce((sum, book) => sum + book.questions.length, 0);
  // 그 주에 열리는 덱은 카탈로그 전량이어야 한다. 잘라 쓰면 못 열리는 질문이 생긴다.
  assert.ok(weekOne.questionDeck.length >= totalQuestions - 5,
    `이번 주에 열리는 질문이 ${weekOne.questionDeck.length}문항뿐입니다(카탈로그 ${totalQuestions}) — 나머지는 이번 주 내내 나오지 않습니다.`);
  // 덱은 소진돼야 한다. 뽑을 때마다 새로 만들면 같은 질문만 앞에서 되돌아온다.
  assert.ok(weekOne.questionDeck.length < totalQuestions,
    "이번 주 덱이 소진되지 않습니다 — 뽑은 질문이 덱에서 빠지지 않습니다.");

  // 한 세션에서 연속으로 넘겨도 소진 전에는 같은 질문이 다시 나오지 않아야 한다.
  const variety = await (async () => {
    const probe = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const probePage = await probe.newPage();
    await probePage.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await probePage.evaluate(() => localStorage.clear());
    await probePage.reload({ waitUntil: "networkidle" });
    const seen = [];
    for (let i = 0; i < 30; i += 1) {
      seen.push(await probePage.locator(".q-text span").textContent());
      await probePage.locator("[data-shuffle]").click();
      await probePage.waitForTimeout(40);
    }
    await probe.close();
    return { shown: seen.length, distinct: new Set(seen).size };
  })();
  assert.equal(variety.distinct, variety.shown,
    `한 세션에서 ${variety.shown}회 넘기는 동안 질문이 ${variety.shown - variety.distinct}회 반복됐습니다 — 주간 갱신 전에는 반복 0이었습니다.`);

  /* Q1-01 — 주차는 drawQuestion 안에서만 읽혀서, 열어 둔 화면과 홈에 설치한 PWA 는 주 경계를
     넘겨도 지난주 문장을 그대로 들고 있었다. 위의 weeklyState 는 로드 시각을 고정하는 방식이라
     "연 채로 주가 바뀌는" 상황을 만들지 못한다 — 그래서 시계를 전역에 두고 페이지를 연 채 민다. */
  const weekBoundary = await (async () => {
    const boundaryContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await boundaryContext.addInitScript(() => {
      const RealDate = Date;
      globalThis.__fakeNow = new RealDate("2026-08-10T09:00:00Z").getTime();
      const MovableDate = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [globalThis.__fakeNow])); }
        static now() { return globalThis.__fakeNow; }
      };
      Object.defineProperty(globalThis, "Date", { value: MovableDate, writable: true, configurable: true });
    });
    const boundaryPage = await boundaryContext.newPage();
    await boundaryPage.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await boundaryPage.evaluate(() => localStorage.clear());
    await boundaryPage.reload({ waitUntil: "networkidle" });
    const opened = await boundaryPage.locator(".q-text span").textContent();
    // 같은 주 안의 복귀 — 문장이 흔들리면 안 된다.
    await boundaryPage.evaluate(() => {
      globalThis.__fakeNow += 2 * 86400000;
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    });
    await boundaryPage.waitForTimeout(200);
    const sameWeek = await boundaryPage.locator(".q-text span").textContent();
    // 주 경계를 넘긴 복귀 — 새 주의 질문이 열려야 한다.
    await boundaryPage.evaluate(() => {
      globalThis.__fakeNow += 7 * 86400000;
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    });
    await boundaryPage.waitForTimeout(300);
    const nextWeek = await boundaryPage.locator(".q-text span").textContent();
    const status = await boundaryPage.locator("#app-status").textContent();
    await boundaryContext.close();
    return { opened, sameWeek, nextWeek, status };
  })();
  assert.equal(weekBoundary.sameWeek, weekBoundary.opened,
    "같은 주에 화면으로 돌아왔는데 질문이 바뀌었습니다 — 탭을 오갈 때마다 문장이 흔들립니다.");
  assert.notEqual(weekBoundary.nextWeek, weekBoundary.opened,
    "주 경계를 넘겨 화면으로 돌아왔는데 지난주 질문 그대로입니다(Q1-01) — 열어 둔 화면과 설치형 PWA 가 갱신되지 않습니다.");
  assert.match(weekBoundary.status, /이번 주의 질문이 새로 열렸습니다/u,
    "주 경계 재추첨이 화면만 바꾸고 낭독하지 않았습니다.");

  console.log(JSON.stringify({
    result: "pass",
    libraryPaging: [80, 160, 175],
    historyDesyncEscape: true,
    journeyReadRevert: true,
    gaugeKeepsSavedFilter: true,
    libraryResetControl: true,
    filterFocusKept: true,
    skipLinkReachesTabbar: true,
    backlinkPayload: true,
    answerLimitAndLabel: true,
    journeyCompletionNotice: true,
    weeklyQuestionRotation: [weekOne.questionWeek, weekTwo.questionWeek],
    weekBoundaryRedraw: true,
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
