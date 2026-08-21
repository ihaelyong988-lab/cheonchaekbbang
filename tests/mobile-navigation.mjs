import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

function findBrowser() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROME_PATH,
    chromium.executablePath(),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  const executablePath = candidates.find(existsSync);
  assert.ok(executablePath, "Chrome 또는 Edge 실행 파일을 찾지 못했습니다.");
  return executablePath;
}

// G-14 는 캐시 버전이 다른 워커를 올려야 한다. 저장소 sw.js 를 고치지 않고 응답 바이트만 바꾼다.
let swCacheSuffix = "";

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname) === "/"
      ? "index.html"
      : decodeURIComponent(url.pathname).slice(1);
    const filePath = path.resolve(ROOT, relative);
    assert.ok(filePath.startsWith(`${ROOT}${path.sep}`), "허용되지 않은 경로입니다.");
    let body = await readFile(filePath);
    if (swCacheSuffix && path.basename(filePath) === "sw.js") {
      body = String(body).replace(/(const CACHE = "ccb-[^"]*)"/u, `$1${swCacheSuffix}"`);
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolve, reject) => {
  server.listen(0, "127.0.0.1", resolve).once("error", reject);
});

const address = server.address();
const baseURL = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: findBrowser() });
const context = await browser.newContext({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 }
});
const page = await context.newPage();
const runtimeErrors = [];
page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) runtimeErrors.push(`${message.type()}: ${message.text()}`);
});
page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));

async function back() {
  await page.evaluate(() => history.back());
  await page.waitForTimeout(220);
}

// [v1.8.0 §11-1] 홈 스트립 2·3번 칸 실측값
async function contextStrip() {
  return page.locator(".qstat.is-ctx").evaluateAll((nodes) => nodes.map((node) => ({
    value: node.querySelector("b").textContent,
    label: node.querySelector("span").textContent,
    tab: node.dataset.tab,
  })));
}

// 같은 값의 기대치를 현재 질문의 책과 저장 기록에서 독립 계산(앱 렌더 결과를 그대로 베끼지 않는다)
async function expectedContextStrip() {
  return page.evaluate(async () => {
    const { BOOKS } = await import("./data/books.js");
    const byId = new Map(BOOKS.map((book) => [book.id, book]));
    const bookId = document.querySelector(".q-actions [data-open-book]").dataset.openBook;
    const book = byId.get(bookId);
    const stored = JSON.parse(localStorage.getItem("cheonchaek.v1") || "{}");
    const questions = Array.isArray(stored.questions) ? stored.questions : [];
    const collected = questions.filter((item) => item.bookId === bookId).length;
    const steps = (() => {
      if (!book || book.tier === "root") return 0;
      let current = book, hops = 0;
      const seen = new Set([book.id]);
      while (hops < 50) {
        const parent = byId.get(current.roots?.[0]);
        if (!parent || seen.has(parent.id)) return hops;
        hops += 1;
        if (parent.tier === "root") return hops;
        seen.add(parent.id);
        current = parent;
      }
      return hops;
    })();
    return [
      { value: `${collected}/${book.questions.length}`, label: "수집한 질문", tab: "record" },
      { value: steps === 0 ? "도달" : `${steps}단계`, label: "뿌리까지", tab: "lineage" },
    ];
  });
}

try {
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload({ waitUntil: "networkidle" });

  assert.equal(page.url(), `${baseURL}/#question`);
  assert.equal(await page.title(), "천책빵 — 뿌리를 찾는 서재");
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "홈");
  assert.equal(await page.locator("#exit-dialog").isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
  assert.equal(await page.locator(".q-card").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(214, 214, 207)");
  assert.equal(await page.locator(".topbar").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(228, 228, 223)");
  assert.deepEqual(await page.locator("button").evaluateAll((buttons) => buttons
    .filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
    })
    .map((button) => ({ text: button.textContent.trim(), width: button.offsetWidth, height: button.offsetHeight }))), []);

  const firstOpeningQuestion = await page.locator(".q-text").innerText();
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "홈");
  const secondOpeningQuestion = await page.locator(".q-text").innerText();
  assert.notEqual(secondOpeningQuestion, firstOpeningQuestion, "앱을 다시 열었을 때 직전 질문이 반복됐습니다.");
  await context.setOffline(false);

  const catalog = await page.evaluate(async () => {
    const { BOOKS } = await import("./data/books.js");
    return {
      books: BOOKS.length,
      questions: BOOKS.reduce((sum, book) => sum + book.questions.length, 0),
      literature: BOOKS.filter((book) => book.domain === "문학").length,
    };
  });
  assert.deepEqual(catalog, { books: 200, questions: 665, literature: 64 });   // 2026-08-21 역사 25권 확장

  /* [§4-4 임계 단일 출처] 글자수 버킷은 app.js 의 매핑을 읽어 그대로 쓴다.
     테스트가 값을 따로 적으면 앱이 압축 단계를 바꿀 때 옛 버킷으로 재어 거짓 통과한다. */
  const heroBucketSource = (await readFile(path.resolve(ROOT, "app.js"), "utf8")).match(/const qSize\s*=\s*([^;]+);/u);
  assert.ok(heroBucketSource, "app.js 에서 히어로 질문 글꼴 버킷 매핑(const qSize)을 찾지 못했습니다.");
  const heroBuckets = [...heroBucketSource[1].matchAll(/<=\s*(\d+)\s*\?\s*"([^"]*)"/gu)]
    .map(([, limit, className]) => ({ limit: Number(limit), className }));
  const heroFallbackClass = heroBucketSource[1].match(/:\s*"([^"]*)"\s*$/u)?.[1] ?? "";
  assert.ok(heroBuckets.length >= 1, "히어로 질문 글꼴 버킷 임계를 추출하지 못했습니다.");
  assert.deepEqual(
    heroBuckets.map((bucket) => bucket.limit),
    [...heroBuckets.map((bucket) => bucket.limit)].sort((a, z) => a - z),
    "히어로 글꼴 버킷 임계가 오름차순이 아닙니다."
  );

  const questionLineProbe = await page.evaluate(async ({ buckets, fallbackClass }) => {
    const { BOOKS } = await import("./data/books.js");
    const original = document.querySelector(".q-text");
    const probe = original.cloneNode(true);
    const span = probe.querySelector("span");
    probe.style.position = "fixed";
    probe.style.visibility = "hidden";
    probe.style.width = `${original.getBoundingClientRect().width}px`;
    probe.style.height = "auto";
    probe.style.display = "block";
    span.style.display = "block";
    span.style.webkitLineClamp = "unset";
    span.style.overflow = "visible";
    document.body.append(probe);
    const failures = [];
    const stats = new Map();
    for (const book of BOOKS) {
      for (const question of book.questions) {
        const length = question.text.length;
        const bucket = buckets.find((item) => length <= item.limit);
        const className = bucket ? bucket.className : fallbackClass;
        probe.className = `q-text${className}`;
        span.textContent = question.text;
        const style = getComputedStyle(probe);
        const lineHeight = Number.parseFloat(style.lineHeight);
        const height = span.getBoundingClientRect().height;
        const lines = Math.ceil((height - 0.5) / lineHeight);
        if (lines > 2) failures.push({ bookId: book.id, text: question.text, lines });
        const key = className.trim() || "q-text";
        const row = stats.get(key)
          || { bucket: key, fontSize: style.fontSize, count: 0, twoLines: 0, maxLines: 0, maxLength: 0 };
        row.count += 1;
        if (lines === 2) row.twoLines += 1;      // 2줄 상한에 붙은 건수 = 글꼴 확대 시 먼저 넘치는 모집단
        row.maxLines = Math.max(row.maxLines, lines);
        row.maxLength = Math.max(row.maxLength, length);
        stats.set(key, row);
      }
    }
    probe.remove();
    return { failures, buckets: [...stats.values()] };
  }, { buckets: heroBuckets, fallbackClass: heroFallbackClass });
  assert.deepEqual(questionLineProbe.failures, [], "히어로 질문 박스에서 2줄을 넘긴 질문이 있습니다(INV-9).");

  await page.locator("#theme-btn").click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "navy");
  assert.equal(await page.locator("#theme-btn").getAttribute("aria-pressed"), null);
  assert.equal(await page.locator("#theme-btn").getAttribute("aria-label"), "은회 테마로 바꾸기");
  assert.equal(await page.locator(".q-card").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(23, 58, 85)");
  assert.equal(await page.locator(".topbar").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(15, 42, 67)");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "navy");
  assert.equal(await page.locator("#theme-btn").textContent(), "은회");
  await page.locator("#theme-btn").click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "silver");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  assert.ok(await page.evaluate(() => window.scrollY > 0));
  await page.locator('.tab[data-tab="question"]').click();
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => window.scrollY), 0);

  await page.locator('[data-open-domain-list="문학"]').click();
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "서재");
  assert.equal(await page.locator(".library-summary").textContent(), "문학 · 64권");
  assert.equal(await page.locator("#lib-list > .card").count(), 64);
  await back();
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "홈");

  await page.locator("#question-search").fill("돈과 투자는 어떻게 판단해야 하는가");
  await page.locator("#question-search-form").evaluate((form) => form.requestSubmit());
  assert.ok(await page.locator(".question-hit").count() > 0);
  assert.equal(await page.getByText("현명한 투자자", { exact: true }).count() > 0, true);

  await page.locator('.tab[data-tab="lineage"]').click();
  await page.locator('.tab[data-tab="library"]').click();
  await back();
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "계보");
  assert.equal(await page.locator("#exit-dialog").isVisible(), false);

  await back();
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "홈");
  assert.equal(await page.locator("#exit-dialog").isVisible(), false);

  await back();
  assert.equal(await page.locator("#exit-dialog").isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "exit-stay");
  assert.equal(page.url(), `${baseURL}/#question`);
  assert.equal(await page.locator(".topbar").getAttribute("aria-hidden"), "true");

  await page.locator("#exit-leave").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "exit-stay");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "exit-leave");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#exit-dialog").isVisible(), false);
  assert.equal(await page.locator(".topbar").getAttribute("aria-hidden"), null);

  await page.locator("#profile-btn").click();
  assert.equal(await page.locator("#profile-title").textContent(), "내 서재");
  assert.equal(await page.locator('input[type="tel"], input[autocomplete="tel"]').count(), 0);
  assert.equal(await page.getByText(/휴대폰|문자|SMS|인증번호|본인인증/i).count(), 0);
  await page.locator("[data-save-profile]").click();
  assert.equal(await page.locator("#profile-alert").isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "profile-name");
  await page.locator("#profile-name").fill("검토자");
  await page.locator("[data-save-profile]").click();
  await page.waitForTimeout(220);
  assert.equal(await page.locator("#profile-btn").textContent(), "검토자님");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).profile), { name: "검토자" });

  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("#profile-btn").textContent(), "검토자님");
  await page.locator("#profile-btn").click();
  assert.equal(await page.locator("#profile-title").textContent(), "검토자님의 서재");
  await page.locator("#profile-name").fill("변경자");
  await page.locator("[data-save-profile]").click();
  await page.waitForTimeout(220);
  assert.equal(await page.locator("#profile-btn").textContent(), "변경자님");
  await page.locator("#profile-btn").click();
  await page.locator("[data-clear-profile]").click();
  await page.waitForTimeout(220);
  assert.equal(await page.locator("#profile-btn").textContent(), "내 서재");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).profile), null);
  await page.locator("#profile-btn").click();
  await back();
  assert.equal(await page.locator("#profile-title").count(), 0);
  assert.equal(await page.locator("#exit-dialog").isVisible(), false);

  /* v1.8.0 §11-1 — 홈 스트립 문맥 전환 (2·3번 칸만 현재 질문의 책 기준) */
  assert.deepEqual(
    await page.locator(".q-stats .qstat").evaluateAll((nodes) => nodes.map((node) => node.classList.contains("is-ctx"))),
    [false, true, true, false],
    "문맥 전환은 스트립 2·3번 칸에만 적용되어야 합니다."
  );
  const stripBefore = await contextStrip();
  assert.equal(stripBefore.length, 2, "문맥 스트립 칸이 2개가 아닙니다.");
  assert.deepEqual(stripBefore, await expectedContextStrip(), "전환 전 스트립이 현재 질문의 책 기준값과 다릅니다.");
  let shuffleClicks = 0;
  let stripAfter = stripBefore;
  while (shuffleClicks < 40 && JSON.stringify(stripAfter) === JSON.stringify(stripBefore)) {
    await page.locator("[data-shuffle]").click();
    await page.waitForTimeout(80);
    shuffleClicks += 1;
    stripAfter = await contextStrip();
  }
  assert.notDeepEqual(stripAfter, stripBefore, "다른 질문을 눌러도 문맥 스트립이 전환되지 않았습니다.");
  assert.deepEqual(stripAfter, await expectedContextStrip(), "전환 후 스트립이 현재 질문의 책 기준값과 다릅니다.");
  assert.deepEqual(stripAfter.map((cell) => cell.label), ["수집한 질문", "뿌리까지"], "문맥 스트립 라벨이 바뀌었습니다.");
  assert.deepEqual(stripAfter.map((cell) => cell.tab), ["record", "lineage"], "문맥 스트립 링크 대상이 바뀌었습니다.");
  assert.match(stripAfter[1].value, /^(도달|\d+단계)$/u, "뿌리까지 값 형식이 잘못됐습니다.");
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "홈");

  /* v1.8.0 §11-3 — 브랜드 버튼 = 첫 화면 복귀, 이후 뒤로 = 닫기 팝업 */
  await page.locator('.tab[data-tab="lineage"]').click();
  await page.locator('.tab[data-tab="library"]').click();
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "서재");
  await page.locator(".brand-btn").click();
  await page.waitForTimeout(320);
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "홈", "브랜드 버튼이 첫 화면으로 복귀하지 않았습니다.");
  assert.equal(page.url(), `${baseURL}/#question`);
  assert.equal(await page.evaluate(() => history.state?.i), 0, "브랜드 복귀 후 히스토리 위치가 index 0이 아닙니다.");
  await back();
  assert.equal(await page.locator("#exit-dialog").isVisible(), true, "브랜드 복귀 후 뒤로가기가 닫기 팝업을 열지 않았습니다.");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  assert.equal(await page.locator("#exit-dialog").isVisible(), false);

  /* v1.8.0 §11-3 — 홈 탭도 같은 첫 화면 복귀 경로 */
  await page.locator('.tab[data-tab="lineage"]').click();
  await page.locator('.tab[data-tab="library"]').click();
  await page.locator('.tab[data-tab="question"]').click();
  await page.waitForTimeout(320);
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "홈", "홈 탭이 첫 화면으로 복귀하지 않았습니다.");
  assert.equal(await page.evaluate(() => history.state?.i), 0, "홈 탭 복귀 후 히스토리 위치가 index 0이 아닙니다.");
  await back();
  assert.equal(await page.locator("#exit-dialog").isVisible(), true, "홈 탭 복귀 후 뒤로가기가 닫기 팝업을 열지 않았습니다.");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  assert.equal(await page.locator("#exit-dialog").isVisible(), false);

  /* v1.8.0 §11-3 — 오버레이(책 시트)를 거친 뒤에도 첫 화면 복귀
     시트는 모달(§2-15 배경 inert)이므로 열린 동안 브랜드는 비활성이어야 하고,
     시트를 닫은 뒤 브랜드가 첫 화면으로 되돌리는지 확인한다. */
  await page.locator('.tab[data-tab="library"]').click();
  await page.locator("#lib-list > .card").first().click();
  await page.waitForTimeout(120);
  assert.equal(await page.locator("#overlay-root .sheet").count(), 1, "책 시트가 열리지 않았습니다.");
  assert.equal(await page.evaluate(() => document.querySelector(".topbar").inert), true, "시트가 열린 동안 상단바가 비활성(inert)이 아닙니다.");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(220);
  assert.equal(await page.locator("#overlay-root .sheet").count(), 0, "Escape로 시트가 닫히지 않았습니다.");
  assert.equal(await page.evaluate(() => document.querySelector(".topbar").inert), false, "시트를 닫은 뒤 상단바 비활성이 해제되지 않았습니다.");
  await page.locator(".brand-btn").click();
  await page.waitForTimeout(320);
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "홈", "시트를 거친 뒤 브랜드 버튼이 첫 화면으로 복귀하지 않았습니다.");
  assert.equal(await page.evaluate(() => history.state?.i), 0, "시트 복귀 후 히스토리 위치가 index 0이 아닙니다.");
  await back();
  assert.equal(await page.locator("#exit-dialog").isVisible(), true, "시트에서 복귀한 뒤 뒤로가기가 닫기 팝업을 열지 않았습니다.");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  assert.equal(await page.locator("#exit-dialog").isVisible(), false);

  await back();
  assert.equal(await page.locator("#exit-dialog").isVisible(), true);
  await back();
  assert.equal(await page.locator("#exit-dialog").isVisible(), true);
  assert.equal(page.url(), `${baseURL}/#question`);

  // 앱이 window.close() 를 호출하지 않으므로 경고 은폐용 스텁을 제거했다(원장 60 · §6-7)
  await page.locator("#exit-leave").click();
  await page.waitForTimeout(180);
  assert.equal(await page.locator(".goodbye").isVisible(), true);
  assert.match(await page.locator(".goodbye").innerText(), /천책빵 사용을 마쳤습니다/);
  assert.deepEqual(runtimeErrors, []);

  const responsive = [];
  for (const width of [360, 390, 430]) {
    const auditContext = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width, height: 844 },
    });
    const auditPage = await auditContext.newPage();
    const auditErrors = [];
    auditPage.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) auditErrors.push(`${message.type()}: ${message.text()}`);
    });
    auditPage.on("pageerror", (error) => auditErrors.push(`pageerror: ${error.message}`));
    await auditPage.goto(`${baseURL}/`, { waitUntil: "networkidle" });
    await auditPage.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    });
    await auditPage.reload({ waitUntil: "networkidle" });
    assert.equal(await auditPage.locator(".tab").count(), 4, `${width}px: 4탭 누락`);
    assert.equal(await auditPage.locator('.tab[aria-current="page"] span').textContent(), "홈", `${width}px: 홈 첫 화면 아님`);
    assert.equal(await auditPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `${width}px: 가로 넘침`);
    assert.deepEqual(await auditPage.locator("button").evaluateAll((buttons) => buttons
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
      })
      .map((button) => button.textContent.trim())), [], `${width}px: 44px 미달 버튼`);
    assert.deepEqual(auditErrors, [], `${width}px: 런타임 오류`);
    responsive.push(`${width}x844`);
    await auditContext.close();
  }

  /* ── 라운드 2 신설 게이트 (§11-2 G-1 · G-7 · G-14 · G-2) ──────────
     본 시나리오는 닫힘 화면에서 문서를 교체하므로 신설 게이트는 각자 새 컨텍스트에서 돈다.
     컨텍스트마다 §3-0 P-2 전처리(SW 전량 unregister + 캐시 전삭제 후 재로드)를 적용한다.
     실행 순서는 G-2 를 마지막에 둔다 — 미해결 조항 하나가 나머지 세 조항의 판정을 가리지 않게 한다. */
  const TAB_BY_HASH = { "#question": "홈", "#lineage": "계보", "#library": "서재", "#record": "기록" };

  async function openProbe(hash = "") {
    const probeContext = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    const probePage = await probeContext.newPage();
    const probeErrors = [];
    probePage.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) probeErrors.push(`${message.type()}: ${message.text()}`);
    });
    probePage.on("pageerror", (error) => probeErrors.push(`pageerror: ${error.message}`));
    await probePage.goto(`${baseURL}/${hash}`, { waitUntil: "networkidle" });
    await probePage.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    });
    await probePage.reload({ waitUntil: "networkidle" });
    await probePage.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await probePage.reload({ waitUntil: "networkidle" });
    return { probeContext, probePage, probeErrors };
  }

  async function currentTab(target) {
    return target.locator(".tab[aria-current=page] span").textContent();
  }

  async function countComposition(target) {
    return target.evaluate(() => ({ ...window.__composition }));
  }

  async function composeKorean(session, target, steps, commit) {
    await target.evaluate(() => { window.__composition = { start: 0, end: 0 }; });
    for (const step of steps) {
      await session.send("Input.imeSetComposition", {
        text: step,
        selectionStart: step.length,
        selectionEnd: step.length,
      });
    }
    await session.send("Input.insertText", { text: commit });   // 조합 확정
    await target.waitForTimeout(260);
  }

  /* [G-1] 서재 검색 한글 IME 조합 — 조합 결과가 그대로 남고 결과가 나온다 (원장 1) */
  const ime = await openProbe();
  const imeSession = await ime.probeContext.newCDPSession(ime.probePage);
  await ime.probePage.evaluate(() => {
    window.__composition = { start: 0, end: 0 };
    document.addEventListener("compositionstart", () => { window.__composition.start += 1; }, true);
    document.addEventListener("compositionend", () => { window.__composition.end += 1; }, true);
  });
  await ime.probePage.locator('.tab[data-tab="library"]').click();
  await ime.probePage.locator("#lib-search").click();
  await ime.probePage.evaluate(() => { window.__libInput = document.getElementById("lib-search"); });
  await composeKorean(imeSession, ime.probePage, ["ㄴ", "노", "노인"], "노인");
  assert.equal(await ime.probePage.locator("#lib-search").inputValue(), "노인", "서재 검색 입력값이 IME 조합 결과와 다릅니다.");
  // 갱신 경계가 #lib-list 하나이므로 입력 노드는 타이핑 전후 같은 노드로 남는다.
  // 화면 전체 재렌더로 되돌아가면 노드가 교체되어 여기서 잡힌다(원장 1 2단계).
  assert.equal(
    await ime.probePage.evaluate(() => {
      const input = document.getElementById("lib-search");
      return Boolean(window.__libInput) && window.__libInput === input && input.isConnected;
    }),
    true,
    "서재 검색 입력 노드가 조합 뒤 새 노드로 교체됐습니다 — 목록 갱신이 화면 전체를 다시 그립니다(원장 1)."
  );
  assert.ok(await ime.probePage.locator("#lib-list > .card").count() >= 1, "IME 조합으로 입력한 제목의 결과 카드가 0장입니다.");
  assert.equal(await ime.probePage.locator(".library-summary").isVisible(), true, "서재 요약줄이 사라졌습니다.");
  assert.deepEqual(await countComposition(ime.probePage), { start: 1, end: 1 }, "서재 검색의 조합 이벤트가 1회·1회가 아닙니다.");

  /* 대조군 — 재렌더가 없는 홈 질문 검색은 처음부터 1회·1회다 */
  await ime.probePage.locator('.tab[data-tab="question"]').click();
  await ime.probePage.waitForTimeout(360);
  await ime.probePage.locator("#question-search").click();
  await composeKorean(imeSession, ime.probePage, ["ㄴ", "노", "논어"], "논어");
  assert.equal(await ime.probePage.locator("#question-search").inputValue(), "논어", "홈 질문 검색 입력값이 IME 조합 결과와 다릅니다.");
  assert.deepEqual(await countComposition(ime.probePage), { start: 1, end: 1 }, "홈 질문 검색의 조합 이벤트가 1회·1회가 아닙니다.");
  assert.deepEqual(ime.probeErrors, [], "IME 게이트에서 런타임 오류가 발생했습니다.");
  await ime.probeContext.close();

  /* [G-7] 히스토리 페이로드 왕복 — URL 변경과 렌더 탭 변경이 1:1 (원장 6 · 13 · 14) */
  const history7 = await openProbe();
  await history7.probePage.evaluate(() => {
    window.__popstates = [];
    window.addEventListener("popstate", (event) => { window.__popstates.push(event.state); });
  });

  async function step(target, action) {
    await target.evaluate(action);
    await target.waitForTimeout(260);
  }
  const marks = [];
  async function mark(target) {
    marks.push({ url: target.url(), tab: await currentTab(target) });
  }

  for (const tab of ["lineage", "library", "record"]) {
    await history7.probePage.locator(`.tab[data-tab="${tab}"]`).click();
    await history7.probePage.waitForTimeout(160);
  }
  assert.equal(await currentTab(history7.probePage), "기록", "기록 탭까지 진행하지 못했습니다.");
  await mark(history7.probePage);
  for (let index = 0; index < 2; index += 1) {
    await step(history7.probePage, () => history.back());
    await mark(history7.probePage);
  }
  for (let index = 0; index < 3; index += 1) {
    await step(history7.probePage, () => history.forward());
    await mark(history7.probePage);
  }
  const urlChanges = marks.filter((item, index) => index > 0 && item.url !== marks[index - 1].url).length;
  const tabChanges = marks.filter((item, index) => index > 0 && item.tab !== marks[index - 1].tab).length;
  assert.equal(urlChanges, tabChanges, `URL 변경 ${urlChanges}회와 렌더 탭 변경 ${tabChanges}회가 다릅니다(N-2).`);
  assert.equal(urlChanges, 4, `뒤로 2회·앞으로 3회의 URL 변경이 4회가 아닙니다(실측 ${urlChanges}회).`);
  const forwardMark = marks[marks.length - 1];
  assert.equal(
    forwardMark.tab,
    TAB_BY_HASH[new URL(forwardMark.url).hash],
    `앞으로가기 후 렌더 탭이 URL 해시와 다릅니다(URL ${forwardMark.url} · 렌더 ${forwardMark.tab}).`
  );
  const payload = await history7.probePage.evaluate(() => history.state);
  assert.equal(typeof payload?.i, "number", "history.state 에 인덱스가 없습니다.");
  assert.equal(typeof payload?.view?.tab, "string", "history.state 에 뷰가 직렬화되지 않았습니다(N-2).");
  assert.equal(payload.view.tab, new URL(forwardMark.url).hash.slice(1), "직렬화된 뷰의 탭이 URL 해시와 다릅니다.");
  assert.ok("overlay" in payload.view, "직렬화된 뷰에 오버레이 슬롯이 없습니다.");

  /* 센티널은 고유 값으로 식별된다 — 미지 state(null)와 같은 값으로 접히면 안 된다(N-1) */
  for (let index = 0; index < 3; index += 1) await step(history7.probePage, () => history.back());
  assert.equal(await currentTab(history7.probePage), "홈", "인덱스 0 으로 돌아오지 못했습니다.");
  await step(history7.probePage, () => history.back());
  assert.equal(await history7.probePage.locator("#exit-dialog").isVisible(), true, "센티널 진입에서 종료 팝업이 뜨지 않았습니다.");
  // 센티널 도착 직후 앱이 history.forward() 로 되돌리므로 popstate 기록 전량에서 센티널 항목을 찾는다.
  const popstateLog = await history7.probePage.evaluate(() => window.__popstates);
  const sentinelHits = popstateLog.filter((entry) => entry?.sentinel === true);
  assert.equal(sentinelHits.length, 1, `센티널 도착이 1회가 아닙니다(실측 ${sentinelHits.length}회).`);
  assert.deepEqual(sentinelHits[0], { sentinel: true }, "센티널이 고유 값으로 식별되지 않습니다(N-1).");
  assert.equal(
    popstateLog.filter((entry) => entry === null).length,
    0,
    "일반 항목이 state 없이 기록됐습니다 — 미지 항목과 구분되지 않습니다(N-1)."
  );
  await history7.probePage.keyboard.press("Escape");
  await history7.probePage.waitForTimeout(200);

  /* 미지 state 는 센티널로 취급하지 않고 인덱스를 재기입한다(N-3) */
  await history7.probePage.locator('.tab[data-tab="lineage"]').click();
  await history7.probePage.waitForTimeout(200);
  await step(history7.probePage, () => { location.hash = "#library"; });
  await step(history7.probePage, () => history.back());
  await step(history7.probePage, () => history.forward());
  assert.equal(await history7.probePage.locator("#exit-dialog").isVisible(), false, "미지 state 진입에서 종료 팝업이 떴습니다(N-3).");
  assert.equal(await history7.probePage.evaluate(() => document.querySelector(".topbar").inert), false, "미지 state 진입 후 상단바가 잠겼습니다.");
  const rebuilt = await history7.probePage.evaluate(() => history.state);
  assert.equal(typeof rebuilt?.i, "number", "미지 state 가 replaceState 로 재기입되지 않았습니다(N-3).");
  assert.notEqual(rebuilt?.sentinel, true, "미지 state 가 센티널로 재기입됐습니다(N-1).");
  assert.deepEqual(history7.probeErrors, [], "히스토리 게이트에서 런타임 오류가 발생했습니다.");
  await history7.probeContext.close();

  /* 해시 딥링크 — 요청 해시로 부팅하고 재기입하지 않는다(§6-5) */
  const deepLink = await openProbe("#library");
  assert.equal(await currentTab(deepLink.probePage), "서재", "해시 딥링크가 요청한 탭으로 부팅하지 않았습니다.");
  assert.equal(deepLink.probePage.url(), `${baseURL}/#library`, "해시 딥링크의 최종 URL 이 요청 해시와 다릅니다.");
  assert.deepEqual(deepLink.probeErrors, [], "해시 딥링크 게이트에서 런타임 오류가 발생했습니다.");
  await deepLink.probeContext.close();

  /* [G-14] 캐시 버전을 올린 워커 활성화 후 history.state 보존 (원장 12) */
  const update = await openProbe();
  assert.equal(await update.probePage.evaluate(() => Boolean(navigator.serviceWorker.controller)), true, "갱신 시험 전 워커가 제어 중이 아닙니다.");
  await update.probePage.locator('.tab[data-tab="library"]').click();
  await update.probePage.waitForTimeout(200);
  const beforeUpdate = {
    state: await update.probePage.evaluate(() => history.state),
    url: update.probePage.url(),
    tab: await currentTab(update.probePage),
  };
  // 통지 도달은 앱이 렌더한 확인 컨트롤로 판정한다. 프로브가 startMessages() 로 큐를 열면
  // 앱의 수신 경로가 막혀 있어도 통과해 버린다.
  await update.probePage.evaluate(() => { window.__aliveMark = 1; });   // 재로드되면 사라진다
  swCacheSuffix = "-probe";
  let updateActivated = false;    // 구 캐시가 지워지면 신 워커 activate 가 끝난 것이다
  let updateNotified = false;
  let updateReloaded = false;
  try {
    await update.probePage.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
    });
    for (let attempt = 0; attempt < 80 && !(updateActivated && updateNotified) && !updateReloaded; attempt += 1) {
      const snapshot = await update.probePage.evaluate(async () => ({
        keys: await caches.keys(),
        alive: window.__aliveMark ?? null,
        notices: document.querySelectorAll("[data-apply-update]").length,
      }));
      updateReloaded = snapshot.alive === null;
      updateActivated = snapshot.keys.length > 0 && snapshot.keys.every((key) => key.endsWith("-probe"));
      updateNotified = snapshot.notices > 0;
      if (!(updateActivated && updateNotified) && !updateReloaded) await update.probePage.waitForTimeout(250);
    }
  } finally {
    swCacheSuffix = "";
  }
  await update.probePage.waitForTimeout(600);   // 통지 수신 후 뒤늦은 강제 재로드까지 관측한다
  assert.equal(updateReloaded, false, "갱신 통지 직후 사용자 확인 없이 재로드했습니다(§6-3).");
  assert.equal(await update.probePage.evaluate(() => window.__aliveMark), 1, "갱신 통지 직후 사용자 확인 없이 재로드했습니다(§6-3).");
  assert.ok(updateActivated, "캐시 버전을 올린 워커가 활성화되지 않았습니다(구 캐시가 남아 있습니다).");
  assert.ok(updateNotified, "워커 갱신 통지가 앱에 도달하지 않았습니다(적용 확인 컨트롤 0건).");
  assert.equal(await update.probePage.locator("[data-apply-update]").count(), 1, "적용 확인 컨트롤이 1개가 아닙니다.");
  assert.deepEqual(await update.probePage.evaluate(() => history.state), beforeUpdate.state, "워커 갱신 후 history.state 가 보존되지 않았습니다.");
  assert.equal(await update.probePage.locator("#exit-dialog").isVisible(), false, "워커 갱신 후 종료 팝업이 떴습니다.");
  assert.equal(update.probePage.url(), beforeUpdate.url, "워커 갱신 후 URL 이 어긋났습니다.");
  assert.equal(await currentTab(update.probePage), beforeUpdate.tab, "워커 갱신 후 렌더 탭이 바뀌었습니다.");
  assert.deepEqual(update.probeErrors, [], "워커 갱신 게이트에서 런타임 오류가 발생했습니다.");
  await update.probeContext.close();

  /* [G-2] 여정 완료 이중 실행 — 기록 1건, 팝업 비표시, 탭 유지, 다른 여정 미시작 (원장 4) */
  const journey = await openProbe();
  const journeyMatrix = [];
  const journeyModes = ["task", 0, 80, 150, 250];

  async function closeAllOverlays(target) {
    for (let attempt = 0; attempt < 5 && await target.locator("#overlay-root .sheet").count() > 0; attempt += 1) {
      await target.keyboard.press("Escape");
      await target.waitForTimeout(240);
    }
  }

  async function storedState(target) {
    return target.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1") || "{}"));
  }

  for (const mode of journeyModes) {
    await closeAllOverlays(journey.probePage);
    await journey.probePage.locator("[data-open-jlist]").first().click();
    await journey.probePage.waitForTimeout(160);
    await journey.probePage.locator("[data-start-journey]:not([disabled])").first().click();
    await journey.probePage.waitForTimeout(200);
    const boxes = journey.probePage.locator("[data-jcheck]");
    const boxCount = await boxes.count();
    assert.ok(boxCount >= 4, `여정 상세의 체크 항목이 ${boxCount}개입니다.`);
    for (let index = 0; index < boxCount; index += 1) {
      await boxes.nth(index).check();
      await journey.probePage.waitForTimeout(70);
    }
    const finish = journey.probePage.locator("[data-finish-journey]");
    await finish.waitFor();
    await journey.probePage.locator("#j-answer").fill(`이중 실행 시험 ${mode}`);
    const before = await storedState(journey.probePage);
    if (mode === "task") {
      await finish.evaluate((element) => { element.click(); element.click(); });   // 동일 태스크 2회 호출
    } else {
      const box = await finish.boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await journey.probePage.mouse.click(x, y);
      if (mode > 0) await journey.probePage.waitForTimeout(mode);
      await journey.probePage.mouse.click(x, y);                                   // 실포인터 더블탭
    }
    await journey.probePage.waitForTimeout(520);
    const after = await storedState(journey.probePage);
    journeyMatrix.push({
      mode: mode === "task" ? "동일 태스크" : `${mode}ms`,
      doneDelta: after.journeysDone.length - before.journeysDone.length,
      exitDialog: await journey.probePage.locator("#exit-dialog").isVisible(),
      tab: await currentTab(journey.probePage),
      startedOther: after.journey ? after.journey.id : null,
    });
    if (after.journey) {
      // 오염된 진행 상태를 걷어내 남은 간격도 측정한다. 위반 사실은 matrix 에 남는다.
      await journey.probePage.evaluate(() => {
        const stored = JSON.parse(localStorage.getItem("cheonchaek.v1"));
        stored.journey = null;
        localStorage.setItem("cheonchaek.v1", JSON.stringify(stored));
      });
      await journey.probePage.reload({ waitUntil: "networkidle" });
    }
  }
  assert.deepEqual(
    journeyMatrix,
    journeyModes.map((mode) => ({
      mode: mode === "task" ? "동일 태스크" : `${mode}ms`,
      doneDelta: 1,
      exitDialog: false,
      tab: "홈",
      startedOther: null,
    })),
    "여정 완료 이중 실행에서 기록 1건·팝업 비표시·탭 유지·다른 여정 미시작이 깨졌습니다(N-7 · N-8)."
  );

  /* 관통 차단은 닫힘을 일으킨 좌표만 무효로 한다 — 다른 자리 탭은 닫힘 직후에도 먹혀야 한다(N-7).
     화면 전체를 시간 창으로 잠그면 이 세 번째 탭이 사라져 정상 조작이 죽는다. */
  async function tapCenter(target, locator) {
    const box = await locator.boundingBox();
    await target.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await closeAllOverlays(journey.probePage);
  await journey.probePage.locator('.tab[data-tab="library"]').click();
  await journey.probePage.waitForTimeout(200);
  const libCards = journey.probePage.locator("#lib-list > .card");
  await tapCenter(journey.probePage, libCards.nth(0));
  await journey.probePage.waitForTimeout(200);
  assert.equal(await journey.probePage.locator("#overlay-root .sheet").count(), 1, "서재 카드 탭으로 책 시트가 열리지 않았습니다.");
  await tapCenter(journey.probePage, journey.probePage.locator(".sheet-close"));
  await journey.probePage.waitForTimeout(60);
  assert.equal(await journey.probePage.locator("#overlay-root .sheet").count(), 0, "닫기 버튼 탭으로 시트가 닫히지 않았습니다.");
  await tapCenter(journey.probePage, libCards.nth(1));
  await journey.probePage.waitForTimeout(240);
  assert.equal(
    await journey.probePage.locator("#overlay-root .sheet").count(),
    1,
    "닫힘 직후 다른 자리 탭이 무시됐습니다 — 관통 차단이 복원 화면 전체를 잠갔습니다(N-7)."
  );
  await closeAllOverlays(journey.probePage);
  assert.deepEqual(journey.probeErrors, [], "여정 이중 실행 게이트에서 런타임 오류가 발생했습니다.");
  await journey.probeContext.close();

  /* [G-15] 기록 탭 계보 진행률 = 분야 탭 + 목록 펼침 · 하단 탭 = 그 화면의 첫 페이지 최상단 (§6-6 N-9 · §11-4) */
  const shell = await openProbe();
  const shellPage = shell.probePage;

  /* (a) 탭이 바뀌는 이동은 최상단에서 시작한다 */
  await shellPage.locator('.tab[data-tab="library"]').click();
  await shellPage.waitForTimeout(220);
  await shellPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  assert.ok(await shellPage.evaluate(() => window.scrollY > 0), "서재를 아래로 내리지 못해 스크롤 게이트를 판정할 수 없습니다.");
  await shellPage.locator('.tab[data-tab="lineage"]').click();
  await shellPage.waitForTimeout(220);
  assert.equal(await shellPage.evaluate(() => window.scrollY), 0, "탭을 바꿨는데 이전 화면의 스크롤 위치가 남았습니다(N-9).");

  /* (b) 이미 보고 있는 탭을 다시 눌러도 그 화면 최상단으로 되돌아온다 */
  await shellPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  assert.ok(await shellPage.evaluate(() => window.scrollY > 0));
  await shellPage.locator('.tab[data-tab="lineage"]').click();
  await shellPage.waitForTimeout(220);
  assert.equal(await shellPage.evaluate(() => window.scrollY), 0, "같은 탭을 다시 눌렀는데 최상단으로 되돌아오지 않았습니다.");

  /* (c) 이어 보던 목록 페이지도 하단 탭으로 다시 열면 첫 페이지에서 시작한다 */
  await shellPage.locator('.tab[data-tab="library"]').click();
  await shellPage.waitForTimeout(220);
  const libFirstPage = await shellPage.locator("#lib-list > .card").count();
  await shellPage.locator("[data-load-more]").click();
  await shellPage.waitForTimeout(220);
  assert.ok(await shellPage.locator("#lib-list > .card").count() > libFirstPage, "더 보기가 목록을 잇지 않아 첫 페이지 복귀를 판정할 수 없습니다.");
  await shellPage.locator('.tab[data-tab="record"]').click();
  await shellPage.waitForTimeout(220);
  await shellPage.locator('.tab[data-tab="library"]').click();
  await shellPage.waitForTimeout(220);
  assert.equal(await shellPage.locator("#lib-list > .card").count(), libFirstPage, "하단 탭으로 다시 연 서재가 첫 페이지가 아닙니다.");

  /* (d) 계보 진행률 — 분야마다 탭 1개, 누르면 그 분야 목록이 펼쳐진다 */
  await shellPage.locator('.tab[data-tab="record"]').click();
  await shellPage.waitForTimeout(220);
  const domainTabs = shellPage.locator("[data-progress-domain]");
  assert.equal(await domainTabs.count(), 6, "계보 진행률의 분야 탭이 6개가 아닙니다.");
  assert.equal(await shellPage.locator('[data-progress-domain][aria-expanded="true"]').count(), 0,
    "기록 화면 첫 페이지에서 진행률 목록이 이미 펼쳐져 있습니다.");
  assert.equal(await shellPage.locator(".progress-book").count(), 0);

  const firstTab = domainTabs.nth(0);
  const firstDomain = await firstTab.getAttribute("data-progress-domain");
  const firstTotal = Number((await firstTab.locator("b").textContent()).match(/\/\s*(\d+)권/u)[1]);
  await firstTab.click();
  await shellPage.waitForTimeout(180);
  assert.equal(await firstTab.getAttribute("aria-expanded"), "true", `${firstDomain} 탭을 눌러도 펼쳐지지 않았습니다.`);
  const firstPanelId = await firstTab.getAttribute("aria-controls");
  assert.equal(await shellPage.locator(`#${firstPanelId} .progress-book`).count(), firstTotal,
    `${firstDomain} 목록 행 수가 진행률 분모와 다릅니다.`);
  assert.notEqual(await shellPage.evaluate(() => document.activeElement?.tagName), "BODY",
    "분야 탭을 누른 뒤 포커스가 본문 밖으로 떨어졌습니다(§8-1).");

  await domainTabs.nth(1).click();
  await shellPage.waitForTimeout(180);
  assert.equal(await shellPage.locator('[data-progress-domain][aria-expanded="true"]').count(), 1,
    "계보 진행률이 두 분야를 동시에 펼쳤습니다.");
  assert.equal(await domainTabs.nth(1).getAttribute("aria-expanded"), "true");
  await domainTabs.nth(1).click();
  await shellPage.waitForTimeout(180);
  assert.equal(await shellPage.locator(".progress-book").count(), 0, "같은 분야 탭을 다시 눌러도 목록이 접히지 않았습니다.");

  await firstTab.click();
  await shellPage.waitForTimeout(180);
  assert.deepEqual(await shellPage.locator(".progress-row, .progress-book").evaluateAll((nodes) => nodes
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.height < 44;
    })
    .map((node) => node.textContent.trim())), [], "계보 진행률에 44px 미달 터치 타깃이 있습니다.");
  await shellPage.locator(".progress-book").nth(0).click();
  await shellPage.waitForTimeout(240);
  assert.equal(await shellPage.locator("#overlay-root .sheet").count(), 1, "진행률 목록에서 책 상세가 열리지 않았습니다.");
  await shellPage.locator(".sheet-close").click();
  await shellPage.waitForTimeout(300);
  assert.ok(await shellPage.locator(".progress-book").count() > 0, "책 상세를 닫자 펼쳐 두었던 목록이 사라졌습니다.");

  /* (e) 기록 화면도 하단 탭으로 다시 열면 첫 페이지(전부 접힘)에서 시작한다 */
  await shellPage.locator('.tab[data-tab="record"]').click();
  await shellPage.waitForTimeout(220);
  assert.equal(await shellPage.locator(".progress-book").count(), 0, "하단 탭으로 다시 연 기록 화면이 첫 페이지가 아닙니다.");
  assert.equal(await shellPage.evaluate(() => window.scrollY), 0);

  /* (f) 기록이 있는 실사용 상태 — 한 화면에 같은 책이 두 번 나오지 않는다(R6 · §9 E-016).
         기록 0건 상태에서만 돌리면 중복은 발현하지 않는다. 반드시 읽음·읽는 중을 심고 판정한다. */
  const seeded = await shellPage.evaluate(async () => {
    const { BOOKS } = await import("./data/books.js");
    const philosophy = BOOKS.filter((book) => book.domain === "철학").slice(0, 5).map((book) => book.id);
    const stored = JSON.parse(localStorage.getItem("cheonchaek.v1") || "{}");
    stored.read = philosophy.slice(0, 3);
    stored.reading = philosophy.slice(3, 5);
    localStorage.setItem("cheonchaek.v1", JSON.stringify(stored));
    return { read: 3, reading: 2 };
  });
  await shellPage.reload({ waitUntil: "networkidle" });
  await shellPage.locator('.tab[data-tab="record"]').click();
  await shellPage.waitForTimeout(220);
  const philTab = shellPage.locator("[data-progress-domain]").nth(0);
  const philCount = await philTab.locator("b").textContent();
  assert.equal(Number(philCount.match(/^\s*(\d+)\s*\//u)[1]), seeded.read, "심어 둔 읽음 수가 진행률에 반영되지 않았습니다.");
  await philTab.click();
  await shellPage.waitForTimeout(180);
  assert.equal(
    await shellPage.locator(`#${await philTab.getAttribute("aria-controls")} .progress-book`).count(),
    Number(philCount.match(/\/\s*(\d+)권/u)[1]) - seeded.read - seeded.reading,
    "펼친 목록이 아직 읽지 않은 책만 담고 있지 않습니다."
  );
  assert.deepEqual(await shellPage.evaluate(() => {
    const counts = new Map();
    for (const node of document.querySelectorAll("#view [data-open-book]")) {
      const id = node.dataset.openBook;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [...counts].filter(([, times]) => times > 1).map(([id, times]) => `${id}×${times}`);
  }), [], "기록 화면 한 화면에 같은 책이 두 번 렌더됐습니다(R6 1정보 1표시).");

  /* 개폐는 진행률 패널만 갱신한다 — 기록 화면 전체 재렌더는 §7 승격선을 넘고 포커스를 날린다 */
  const toggleCost = await shellPage.evaluate(() => {
    const row = document.querySelector("[data-progress-domain]");
    const card = document.querySelector("#view .card-title");   // 전면 재렌더면 이 노드가 교체된다
    const start = performance.now();
    row.click();
    return {
      sync: performance.now() - start,
      rowKept: row.isConnected,
      cardKept: card.isConnected,
    };
  });
  assert.equal(toggleCost.cardKept, true, "분야 탭 개폐가 기록 화면의 책 카드까지 다시 그렸습니다.");
  assert.equal(toggleCost.rowKept, true, "분야 탭 개폐가 눌린 버튼 자신을 교체했습니다 — 포커스가 날아갑니다(§8-1).");
  assert.ok(toggleCost.sync < 100, `분야 탭 개폐 동기 렌더가 ${toggleCost.sync.toFixed(1)}ms 로 §7 승격선을 넘었습니다.`);

  assert.deepEqual(shell.probeErrors, [], "계보 진행률·첫 페이지 복귀 게이트에서 런타임 오류가 발생했습니다.");
  await shell.probeContext.close();

  /* [G-16] 검색이 화면에서 실제로 도달하는가 (W1 · 원장 15·16·17·18)
     엔진 단위 테스트만으로 UI 도달성을 보증하지 않는다(§3-5). 반드시 DOM 으로 확인한다. */
  const search16 = await openProbe();
  const searchPage = search16.probePage;

  /* 서재 검색 — 띄어쓰기·구두점이 달라도 같은 결과 (원장 16) */
  await searchPage.locator('.tab[data-tab="library"]').click();
  await searchPage.waitForTimeout(220);
  const libHits = {};
  for (const query of ["총, 균, 쇠", "총균쇠", "사피엔스 "]) {
    await searchPage.locator("#lib-search").fill(query);
    await searchPage.waitForTimeout(220);
    libHits[query] = await searchPage.locator("#lib-list > .card").count();
  }
  assert.equal(libHits["총균쇠"], libHits["총, 균, 쇠"],
    `서재 검색이 띄어쓰기로 갈립니다 — "총, 균, 쇠" ${libHits["총, 균, 쇠"]}권 vs "총균쇠" ${libHits["총균쇠"]}권(원장 16).`);
  assert.ok(libHits["총균쇠"] >= 1, "서재에서 '총균쇠' 가 0권입니다.");
  assert.ok(libHits["사피엔스 "] >= 1, "끝 공백이 붙으면 서재 결과가 사라집니다.");

  /* 홈 질문 검색 — 2글자 제목·한 글자 주제어가 화면에 뜬다 (원장 15·17) */
  await searchPage.locator('.tab[data-tab="question"]').click();
  await searchPage.waitForTimeout(350);
  for (const [query, label] of [["맹자", "2글자 제목"], ["돈", "한 글자 주제어"]]) {
    await searchPage.locator("#question-search").fill(query);
    await searchPage.locator("#question-search-form").evaluate((form) => form.requestSubmit());
    await searchPage.waitForTimeout(260);
    assert.ok(await searchPage.locator(".question-hit").count() > 0, `${label} "${query}" 가 화면에서 0건입니다.`);
  }

  /* 공백만 제출해도 반응이 있다 (원장 17) */
  await searchPage.locator("#question-search").fill("   ");
  await searchPage.locator("#question-search-form").evaluate((form) => form.requestSubmit());
  await searchPage.waitForTimeout(260);
  assert.ok((await searchPage.locator(".empty").innerText()).includes("한 글자 이상"),
    "공백만 제출했을 때 안내가 뜨지 않습니다(원장 17).");
  assert.equal(await searchPage.evaluate(() => document.activeElement?.id), "question-search",
    "공백 제출 후 포커스가 입력창에 남지 않았습니다.");

  /* 빈 결과가 막다른 길이 아니다 — 낱말 칩으로 되짚어 간다 (원장 18) */
  await searchPage.locator("#question-search").fill("zzzzz");
  await searchPage.locator("#question-search-form").evaluate((form) => form.requestSubmit());
  await searchPage.waitForTimeout(260);
  const chips = searchPage.locator("[data-ask-term]");
  assert.ok(await chips.count() > 0, "빈 결과 화면에 되짚을 낱말 칩이 없습니다 — 막다른 길입니다(원장 18).");
  await chips.first().click();
  await searchPage.waitForTimeout(300);
  assert.ok(await searchPage.locator(".question-hit").count() > 0, "낱말 칩을 눌러도 결과가 나오지 않습니다.");
  assert.deepEqual(await searchPage.locator("[data-ask-term], .question-hit").evaluateAll((nodes) => nodes
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.height < 44;
    })
    .map((node) => node.textContent.trim())), [], "검색 결과·낱말 칩에 44px 미달 터치 타깃이 있습니다.");
  assert.deepEqual(search16.probeErrors, [], "검색 도달성 게이트에서 런타임 오류가 발생했습니다.");
  await search16.probeContext.close();

  /* [G-17] 되돌릴 수 있는가 · 보이는가 · 눌리는가 (W2·W3·W5 · 원장 25·26·27·28·38·40·42·51·60·63·64·66) */
  const contrastRatio = (fg, bg) => {
    const luminance = (color) => {
      const [r, g, b] = color.match(/[\d.]+/gu).slice(0, 3).map((value) => Number(value) / 255)
        .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
      return r * 0.2126 + g * 0.7152 + b * 0.0722;
    };
    const [high, low] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
  };

  /* 수집한 질문을 되돌릴 수 있다 — 확인 1회를 거치고, 저장소에서도 사라진다 (원장 63) */
  const undo = await openProbe();
  await undo.probePage.locator("[data-collect]").first().click();
  await undo.probePage.waitForTimeout(240);
  await undo.probePage.locator('.tab[data-tab="record"]').click();
  await undo.probePage.waitForTimeout(260);
  assert.equal(await undo.probePage.locator("[data-drop-question]").count(), 1, "수집한 질문에 철회 수단이 없습니다(원장 63).");
  await undo.probePage.locator("[data-drop-question]").first().click();
  await undo.probePage.waitForTimeout(200);
  assert.equal(await undo.probePage.locator("[data-drop-confirm]").count(), 1, "수집 취소가 확인 없이 즉시 실행됩니다(C6-4).");
  await undo.probePage.locator("[data-drop-confirm]").click();
  await undo.probePage.waitForTimeout(300);
  assert.equal(await undo.probePage.locator(".qa-item").count(), 0, "수집 취소 후에도 문답집에 항목이 남았습니다.");
  assert.equal(
    await undo.probePage.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).questions.length), 0,
    "화면에서만 사라지고 저장소에는 남았습니다."
  );

  /* 이름: Enter 저장 · 경고 해제 · 상단바 불변 (원장 26·27·28) */
  await undo.probePage.locator("#profile-btn").click();
  await undo.probePage.waitForTimeout(260);
  await undo.probePage.locator("[data-save-profile]").click();
  await undo.probePage.waitForTimeout(200);
  assert.equal(await undo.probePage.locator("#profile-alert").isVisible(), true, "빈 이름 경고가 뜨지 않습니다.");
  await undo.probePage.locator("#profile-name").fill("가");
  await undo.probePage.waitForTimeout(160);
  assert.equal(await undo.probePage.locator("#profile-alert").isVisible(), false, "다시 입력해도 경고가 남습니다(원장 28).");
  const barBefore = await undo.probePage.evaluate(() => Math.round(document.querySelector(".topbar").getBoundingClientRect().height));
  await undo.probePage.locator("#profile-name").fill("아주아주긴이름을가진방문자");
  await undo.probePage.locator("#profile-name").press("Enter");
  await undo.probePage.waitForTimeout(360);
  assert.equal(await undo.probePage.locator("#overlay-root .sheet").count(), 0, "이름 입력 후 Enter 가 저장하지 않습니다(원장 27).");
  assert.equal(
    await undo.probePage.evaluate(() => Math.round(document.querySelector(".topbar").getBoundingClientRect().height)), barBefore,
    "긴 이름을 저장하자 상단바 높이가 변했습니다(원장 26)."
  );

  /* 진행바가 보인다 (원장 40) */
  await undo.probePage.locator('.tab[data-tab="question"]').click();
  await undo.probePage.waitForTimeout(320);
  const gauge = await undo.probePage.evaluate(() => {
    const bar = document.querySelector(".gauge-row .bar");
    return {
      fill: getComputedStyle(bar.querySelector("i")).backgroundColor,
      track: getComputedStyle(bar).backgroundColor,
      edge: getComputedStyle(bar).borderTopColor,
      card: getComputedStyle(document.querySelector(".gauge")).backgroundColor,
      numbers: document.querySelectorAll(".gauge-row .num").length,
    };
  });
  assert.ok(contrastRatio(gauge.fill, gauge.track) >= 3, `진행바 채움/트랙 대비 ${contrastRatio(gauge.fill, gauge.track).toFixed(2)}:1 (임계 3:1).`);
  assert.ok(contrastRatio(gauge.edge, gauge.card) >= 3, `진행바 트랙 경계/카드 대비 ${contrastRatio(gauge.edge, gauge.card).toFixed(2)}:1 (임계 3:1).`);
  assert.equal(gauge.numbers, 0, "홈 게이지에 수치가 남아 있습니다 — 기록 탭과 중복입니다(R6 · 원장 44).");
  assert.equal(
    (await undo.probePage.locator("#view").innerText()).match(/\d+\s*\/\s*6/gu)?.length ?? 0, 1,
    "홈 한 화면에 여정 완료 수치가 두 번 이상 나옵니다(R6 · 원장 45)."
  );

  /* 여정: 잠금은 감쇠가 아니라 설명으로 · 체크박스는 눌린다 (원장 42·51·64) */
  await undo.probePage.locator("[data-open-jlist]").first().click();
  await undo.probePage.waitForTimeout(300);
  await undo.probePage.locator("[data-start-journey]").first().click();
  await undo.probePage.waitForTimeout(400);
  const lockedCard = await undo.probePage.evaluate(() => {
    const boxes = [...document.querySelectorAll('#overlay-root input[type="checkbox"]')];
    const locked = document.querySelector("#overlay-root .is-locked");
    return {
      small: boxes.filter((box) => { const rect = box.getBoundingClientRect(); return rect.width < 44 || rect.height < 44; }).length,
      opacity: locked ? getComputedStyle(locked).opacity : "1",
      why: document.querySelectorAll("#overlay-root .lock-why").length,
      title: locked ? getComputedStyle(locked.querySelector(".card-title")).color : null,
      background: locked ? getComputedStyle(locked).backgroundColor : null,
    };
  });
  assert.equal(lockedCard.small, 0, `여정 체크박스 ${lockedCard.small}개가 44px 미만입니다(원장 51).`)      ;
  assert.equal(lockedCard.opacity, "1", "잠금 카드를 opacity 로 감쇠하고 있습니다 — 텍스트 대비가 임계 아래로 떨어집니다(원장 42).");
  assert.ok(lockedCard.why > 0, "잠긴 이유를 알려주는 문장이 없습니다(원장 64).");
  assert.ok(contrastRatio(lockedCard.title, lockedCard.background) >= 4.5,
    `잠금 카드 제목 대비 ${contrastRatio(lockedCard.title, lockedCard.background).toFixed(2)}:1 (임계 4.5:1).`);
  await undo.probePage.keyboard.press("Escape");
  await undo.probePage.waitForTimeout(320);
  assert.deepEqual(undo.probeErrors, [], "되돌리기·대비 게이트에서 런타임 오류가 발생했습니다.");
  await undo.probeContext.close();

  /* 200% 확대에서 가로 스크롤도 잘림도 없다 (원장 25) */
  const zoomContext = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 188, height: 406 } });
  const zoomPage = await zoomContext.newPage();
  await zoomPage.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  const zoom = await zoomPage.evaluate(() => {
    const hero = document.querySelector(".q-text");
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clipped: hero.querySelector("span").scrollHeight - hero.clientHeight,
    };
  });
  assert.equal(zoom.overflow, false, `200% 확대에서 가로 스크롤이 생깁니다(문서 ${zoom.scrollWidth}px > 188px, 원장 25).`);
  assert.ok(zoom.clipped <= 0, `200% 확대에서 히어로 질문이 ${zoom.clipped}px 잘립니다(원장 25).`);
  await zoomContext.close();

  /* 종료: 배경 탭으로 닫히고, 닫힘 화면은 막다른 길이 아니며, 콘솔 경고가 없다 (원장 38·60·66) */
  const exit = await openProbe();
  await exit.probePage.goBack().catch(() => {});
  await exit.probePage.waitForTimeout(400);
  assert.equal(await exit.probePage.locator("#exit-dialog").isVisible(), true, "첫 화면 뒤로가기에서 종료 팝업이 뜨지 않습니다.");
  await exit.probePage.mouse.click(195, 60);
  await exit.probePage.waitForTimeout(300);
  assert.equal(await exit.probePage.locator("#exit-dialog").isVisible(), false, "종료 팝업 배경을 눌러도 닫히지 않습니다(원장 66).");
  await exit.probePage.goBack().catch(() => {});
  await exit.probePage.waitForTimeout(400);
  await exit.probePage.locator("#exit-leave").click();
  await exit.probePage.waitForTimeout(400);
  assert.equal(await exit.probePage.locator(".goodbye button").count(), 1, "닫힘 화면에 복귀 수단이 없습니다(원장 38).");
  assert.deepEqual(exit.probeErrors.filter((message) => /close/iu.test(message)), [],
    "닫기 실행이 콘솔 경고를 남깁니다 — window.close 는 항상 차단됩니다(원장 60).");
  await exit.probePage.locator("#reopen-app").click();
  await exit.probePage.waitForTimeout(800);
  assert.equal(await currentTab(exit.probePage), "홈", "다시 열기가 앱을 복구하지 못했습니다.");
  await exit.probeContext.close();

  console.log(JSON.stringify({
    result: "pass",
    viewport: "390x844",
    lineageProgressTabs: { domains: 6, singleOpen: true, opensBookSheet: true },
    tabFirstPageReset: { scrollTop: true, libraryFirstPage: true, recordCollapsed: true },
    homeFirst: true,
    openingQuestionRotates: true,
    questionPool: catalog.questions,
    questionTwoLineGate: true,
    heroFontBuckets: questionLineProbe.buckets,
    imeCompositionGate: true,
    journeyDoubleTapGate: journeyMatrix.map((row) => row.mode),
    tapThroughReleaseGate: true,
    historyPayloadGate: { urlChanges, tabChanges },
    serviceWorkerUpdateGate: true,
    responsive,
    themePersistence: true,
    homeRetapScrollTop: true,
    domainGraphToLibrary: true,
    questionSearch: true,
    backSequence: ["서재", "계보", "홈", "종료 확인"],
    contextStrip: true,
    contextStripShuffles: shuffleClicks,
    brandHome: true,
    overlayBrandHome: true,
    homeTabReset: true,
    exitFocusTrap: true,
    repeatedBackGuard: true,
    localProfile: true,
    smsAuthentication: false,
    serviceWorkerControlled: true,
    offlineReload: true,
    runtimeErrors
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
