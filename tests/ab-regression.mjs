/* A/B 퇴행 대조 — "전에 되던 것이 지금도 되는가"를 기계로 잰다.
 *
 * 왜 필요한가: 신설 게이트는 내가 추가한 동작만 채점한다. 그래서 2026-08-09 라운드는
 * 게이트 15종과 뮤테이션 4/4를 통과하면서 퇴행 10건을 함께 배포했다 — 종료 팝업의 복귀 포커스,
 * 여정 읽음 원복, 검색 입력 위치, 질문 덱 깊이가 전부 "전에는 되던 것"이었다(§9 E-023).
 *
 * 이 검사는 기준 커밋(기본 origin/main)의 소스를 그대로 꺼내 같은 서버·같은 브라우저에 올리고,
 * 같은 프로브를 양쪽에 돌려 값을 비교한다. 새 코드가 기준보다 나빠진 항목이 하나라도 있으면 실패한다.
 *
 * 사용: node tests/ab-regression.mjs [기준-ref]
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_REF = process.argv[2] || process.env.AB_BASE_REF || "origin/main";
/* 기준에서 꺼내야 하는 것은 "화면 동작을 만드는 파일"뿐이다. 아이콘·테스트는 대조에 영향이 없다.
   목록을 손으로 적으면 새 모듈이 늘 때 조용히 빠진다 — 실제로 `data/authored-questions.js` 가
   빠져 기준 쪽이 부팅하지 못한 채 이 게이트가 죽어 있었다(§9 E-028). 그래서 ref 에서 직접 센다. */
const EXCLUDED_DIR = /^(tests|docs|scripts|\.github|graphify-out|node_modules)\//u;
const EXCLUDED_FILE = /^(package(-lock)?\.json|pnpm-lock\.yaml|\.gitignore|[^/]*\.md)$/u;
function sourcesAt(ref) {
  // -z 로 받는다. 기본 출력은 한글 경로를 따옴표+8진 이스케이프로 감싸서 제외 패턴이 통째로 빗나간다.
  const files = execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", ref], { cwd: ROOT, encoding: "utf8" })
    .split("\0").map((line) => line.trim()).filter(Boolean)
    .filter((file) => !EXCLUDED_DIR.test(file) && !EXCLUDED_FILE.test(file));
  if (!files.includes("app.js") || !files.includes("index.html")) {
    throw new Error(`기준 ${ref} 에서 앱 소스를 세지 못했다 — 측정 실패`);
  }
  return files;
}
const MIME = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
};

function gitShow(ref, file) {
  return execFileSync("git", ["show", `${ref}:${file}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
}

/* 기준 커밋을 임시 폴더에 그대로 펼친다. 작업 트리를 읽으면 측정 중 편집에 오염된다 —
   실제로 그 오염 때문에 1차 측정이 정반대 결과를 냈다(§9 E-024). */
function materializeBase(ref) {
  const dir = mkdtempSync(path.join(tmpdir(), "ccb-base-"));
  for (const file of sourcesAt(ref)) {
    const target = path.join(dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, gitShow(ref, file));
  }
  mkdirSync(path.join(dir, "icons"), { recursive: true });
  for (const icon of ["icon.svg", "icon-192.png", "icon-512.png"]) {
    const from = path.join(ROOT, "icons", icon);
    if (existsSync(from)) writeFileSync(path.join(dir, "icons", icon), readFileSync(from));
  }
  return dir;
}

function startServer(root) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname) === "/" ? "index.html" : decodeURIComponent(url.pathname).slice(1);
    const file = path.resolve(root, relative);
    if (!file.startsWith(root) || !existsSync(file)) { response.writeHead(404); response.end("404"); return; }
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

const { chromium } = await import("playwright");

async function coldPage(browser, port) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
    localStorage.clear();
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#view .q-card", { timeout: 15000 });
  return { context, page };
}

const describe = (element) => element
  ? `${element.tagName}${element.className ? "." + String(element.className).split(" ")[0] : ""}`
  : "NONE";

/* ── 프로브 ────────────────────────────────────────────────────────────────
   각 프로브는 "좋을수록 커지는 값" 또는 불리언을 돌려준다. 비교는 아래 COMPARE 가 한다.
   프로브를 추가할 때는 반드시 기준 쪽에서도 의미가 성립하는 값으로 만든다. */
const PROBES = {
  // A2 — 종료 팝업을 닫으면 누르던 자리로 돌아와야 한다(§2-1 C7-3)
  async exitFocusReturn(page) {
    await page.locator("#view [data-collect]").first().focus();
    const before = await page.evaluate(() => document.activeElement?.getAttribute("data-collect") || "");
    await page.evaluate(() => history.back());
    await page.waitForTimeout(350);
    const popup = await page.locator("#exit-dialog").isVisible();
    await page.locator("#exit-stay").click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.activeElement?.getAttribute("data-collect") || "");
    return { ok: popup && before !== "" && before === after, detail: `${before || "-"} → ${after || "-"}` };
  },

  // 원장 20 — 본문 액션 뒤에 포커스가 사라지지 않아야 한다
  async focusKeptAfterActions(page) {
    let kept = 0;
    const actions = ["[data-shuffle]", '.tab[data-tab="library"]', "[data-libtier]", "[data-libdomain]"];
    for (const selector of actions) {
      const target = page.locator(selector).first();
      if (!(await target.count())) continue;
      await target.click();
      await page.waitForTimeout(180);
      if (await page.evaluate(() => document.activeElement && document.activeElement !== document.body)) kept += 1;
    }
    return { ok: kept, detail: `${kept}/${actions.length} 유지` };
  },

  // A3 — 검색을 시작해도 입력창이 제자리에 있어야 한다
  async searchBoxStaysPut(page) {
    await page.locator('.tab[data-tab="library"]').click();
    await page.waitForTimeout(250);
    const y = () => page.locator("#lib-search").evaluate((element) => Math.round(element.getBoundingClientRect().top));
    const before = await y();
    await page.locator("#lib-search").type("햄", { delay: 40 });
    await page.waitForTimeout(250);
    const shift = Math.abs((await y()) - before);
    return { ok: shift === 0, detail: `${shift}px 이동` };
  },

  // A1 — 방문자가 손으로 바꾼 읽음 상태를 여정 조작이 덮어쓰면 안 된다
  async manualReadSurvives(page) {
    await page.locator("#view [data-open-jlist]").first().click();
    await page.waitForTimeout(250);
    await page.locator("[data-start-journey]").first().click();
    await page.waitForTimeout(300);
    const first = await page.locator("[data-jcheck]").first().getAttribute("data-jcheck");
    await page.locator("[data-jcheck]").first().check();
    await page.waitForTimeout(250);
    /* 방문자가 그 책의 읽음 상태를 손으로 '읽는 중'으로 바꾼 상태를 만든다.
       UI 로 하면 오버레이 해제 타이밍에 걸리므로 저장 상태를 직접 옮긴다 — 결과 상태는 동일하다. */
    await page.evaluate((id) => {
      const stored = JSON.parse(localStorage.getItem("cheonchaek.v1"));
      stored.read = stored.read.filter((x) => x !== id);
      stored.reading = [...new Set([...(stored.reading || []), id])];
      localStorage.setItem("cheonchaek.v1", JSON.stringify(stored));
      // 재로드는 pagehide 저장이 이 편집을 덮어쓴다. 앱이 저장소를 다시 읽게 storage 이벤트로 알린다.
      window.dispatchEvent(new StorageEvent("storage", { key: "cheonchaek.v1" }));
    }, first);
    await page.waitForTimeout(400);
    const manual = await page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).reading.length);
    // 여정 시트는 계속 열려 있다. 그 자리에서 체크만 되돌린다.
    await page.locator("[data-jcheck]").first().uncheck();
    await page.waitForTimeout(350);
    const survived = await page.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).reading.length);
    return { ok: manual > 0 && survived === manual, detail: `수동 ${manual}권 → 해제 후 ${survived}권` };
  },

  // 주간 갱신이 덱 깊이를 깎지 않았는가
  async questionVariety(page) {
    const seen = [];
    for (let i = 0; i < 30; i += 1) {
      seen.push(await page.locator(".q-text span").textContent());
      await page.locator("[data-shuffle]").click();
      await page.waitForTimeout(35);
    }
    return { ok: new Set(seen).size, detail: `30회 중 distinct ${new Set(seen).size}` };
  },

  /* 원장 47 — 탭을 오갈수록 종료까지의 뒤로가기가 길어지면 안 된다.
     적을수록 좋은 값이라 음수로 돌려 "클수록 좋다"는 비교 규약에 맞춘다. */
  async backPressesToExit(page) {
    for (const tab of ["lineage", "library", "record", "lineage", "library", "record"]) {
      await page.locator(`.tab[data-tab="${tab}"]`).click();
      await page.waitForTimeout(160);
    }
    let presses = 0;
    while (presses < 20) {
      await page.evaluate(() => history.back());
      await page.waitForTimeout(180);
      presses += 1;
      if (await page.locator("#exit-dialog").isVisible()) break;
    }
    return { ok: -presses, detail: `교차 6회 뒤 종료까지 뒤로 ${presses}회` };
  },

  /* 저장이 거부되는 기기(비공개 모드·용량 초과)에서도 앱이 열리고 첫 질문이 고정되지 않는가.
     저장 실패는 게이트가 한 번도 재지 않던 실사용 상태다(§9 E-016). */
  async survivesStorageDenial(page, { browser, port }) {
    const denied = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await denied.addInitScript(() => {
      const blocked = {
        getItem: () => null,
        setItem() { throw new DOMException("QuotaExceededError", "QuotaExceededError"); },
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        get length() { return 0; },
      };
      Object.defineProperty(window, "localStorage", { configurable: true, get: () => blocked });
    });
    const shown = [];
    for (let visit = 0; visit < 3; visit += 1) {
      const probePage = await denied.newPage();
      await probePage.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
      shown.push(await probePage.locator(".q-text span").count()
        ? await probePage.locator(".q-text span").textContent() : null);
      await probePage.close();
    }
    await denied.close();
    const rendered = shown.filter(Boolean).length;
    const distinct = new Set(shown.filter(Boolean)).size;
    // 열리는 것과 첫 질문이 갈리는 것을 한 값으로 합친다 — 둘 다 클수록 좋다.
    return { ok: rendered + distinct, detail: `열림 ${rendered}/3 · 첫 질문 distinct ${distinct}` };
  },

  // 오프라인에서 재로드해도 열리는가(INV-5). 서비스워커 캐시가 실제로 자산을 덮는지 본다.
  async worksOffline(page) {
    await page.waitForTimeout(1500);                      // 서비스워커 설치·프리캐시 대기
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    await page.context().setOffline(true);
    let rendered = false;
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      rendered = (await page.locator("#view .q-card").count()) > 0;
    } catch { rendered = false; }
    await page.context().setOffline(false);
    return { ok: (controlled ? 1 : 0) + (rendered ? 1 : 0), detail: `SW 제어 ${controlled} · 오프라인 렌더 ${rendered}` };
  },

  /* 같은 기기 두 탭이 동시에 열려 있어도 먼저 탭의 기록이 사라지지 않는가(C5-4).
     같은 컨텍스트의 두 페이지는 저장소를 공유하므로 실제 두 탭과 같은 조건이다. */
  async keepsRecordsAcrossTabs(page, { browser, port }) {
    const shared = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const open = async () => {
      const tab = await shared.newPage();
      await tab.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
      await tab.waitForSelector("#view [data-collect]", { timeout: 10000 });
      return tab;
    };
    const tabA = await open();
    await tabA.evaluate(() => localStorage.clear());
    await tabA.reload({ waitUntil: "load" });
    await tabA.waitForSelector("#view [data-collect]", { timeout: 10000 });
    await tabA.locator("#view [data-collect]").first().click();
    await tabA.waitForTimeout(250);
    const tabB = await open();
    await tabB.locator("[data-shuffle]").click();          // 다른 질문으로 바꿔 서로 다른 것을 수집한다
    await tabB.waitForTimeout(200);
    await tabB.locator("#view [data-collect]").first().click();
    await tabB.waitForTimeout(300);
    const stored = await tabB.evaluate(() => JSON.parse(localStorage.getItem("cheonchaek.v1")).questions.length);
    await shared.close();
    return { ok: stored, detail: `두 탭이 각각 수집한 뒤 남은 질문 ${stored}건` };
  },

  /* 글자를 200% 로 키운 폭(188px)에서 가로 넘침과 잘림이 없는가(WCAG 1.4.10).
     기존 게이트는 한 번 재고 끝났고 A/B 로는 재지 않았다. */
  async zoom200NoOverflow(page, { browser, port }) {
    const zoomed = await browser.newContext({ viewport: { width: 188, height: 406 } });
    const zoomPage = await zoomed.newPage();
    await zoomPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await zoomPage.waitForSelector("#view .q-card", { timeout: 10000 });
    const measured = await zoomPage.evaluate(() => {
      const doc = document.documentElement;
      const hero = document.querySelector(".q-text");
      return {
        overflow: Math.max(0, doc.scrollWidth - doc.clientWidth),
        clipped: hero ? Math.max(0, hero.scrollHeight - hero.clientHeight) : 0,
      };
    });
    await zoomed.close();
    // 넘침·잘림은 적을수록 좋으므로 음수로 돌려 비교 규약에 맞춘다.
    return {
      ok: -(measured.overflow + measured.clipped),
      detail: `가로 넘침 ${measured.overflow}px · 히어로 잘림 ${measured.clipped}px`,
    };
  },

  // 탭 전환 3값(히스토리·주소·렌더)이 어긋나지 않는가
  async tabTripleMatch(page) {
    let matched = 0;
    for (const tab of ["lineage", "library", "record"]) {
      await page.locator(`.tab[data-tab="${tab}"]`).click();
      await page.waitForTimeout(220);
      const state = await page.evaluate(() => ({
        hash: location.hash,
        stateTab: history.state?.view?.tab || "",
        rendered: document.querySelector(".tab[aria-current=page]")?.dataset.tab || "",
      }));
      if (state.hash === `#${tab}` && state.stateTab === tab && state.rendered === tab) matched += 1;
    }
    return { ok: matched, detail: `${matched}/3 일치` };
  },
};

// 값이 불리언이면 "기준이 참인데 새 코드가 거짓"일 때 퇴행. 숫자면 "줄어들면" 퇴행이다.
function isRegression(base, next) {
  if (typeof base.ok === "boolean") return base.ok === true && next.ok !== true;
  return next.ok < base.ok;
}

const baseDir = materializeBase(BASE_REF);
const baseServer = await startServer(baseDir);
const headServer = await startServer(ROOT);
const browser = await chromium.launch({ headless: true });
const results = {};

try {
  for (const [name, probe] of Object.entries(PROBES)) {
    const runs = {};
    for (const [side, port] of [["base", baseServer.port], ["head", headServer.port]]) {
      /* coldPage 를 try 밖에 두면 기준 쪽이 부팅하지 못할 때 게이트가 통째로 크래시하고,
         그 실패가 "퇴행 없음"과 구분되지 않는다. 부팅 실패도 측정 실패로 남긴다(§9 E-028). */
      let session = null;
      try {
        session = await coldPage(browser, port);
        runs[side] = await probe(session.page, { browser, port, coldPage });
      } catch (error) {
        runs[side] = { ok: false, detail: `측정 실패: ${String(error.message).slice(0, 120)}` };
      } finally {
        if (session) await session.context.close();
      }
    }
    results[name] = runs;
  }
} finally {
  await browser.close();
  await new Promise((resolve) => baseServer.server.close(resolve));
  await new Promise((resolve) => headServer.server.close(resolve));
  rmSync(baseDir, { recursive: true, force: true });
}

const regressions = Object.entries(results).filter(([, runs]) => isRegression(runs.base, runs.head));
const measurementFailures = Object.entries(results)
  .filter(([, runs]) => ["base", "head"].some((side) => String(runs[side]?.detail).startsWith("측정 실패")));

console.log(JSON.stringify({
  result: regressions.length === 0 && measurementFailures.length === 0 ? "pass" : "fail",
  baseRef: BASE_REF,
  probes: Object.fromEntries(Object.entries(results)
    .map(([name, runs]) => [name, `기준 ${runs.base.detail} · 현행 ${runs.head.detail}`])),
}, null, 2));

// 기준 쪽 측정이 실패하면 비교가 성립하지 않는다. 통과가 아니라 측정 실패로 보고한다(§9 E-022).
assert.equal(measurementFailures.length, 0,
  `기준 커밋에서 프로브가 실패했습니다 — 비교가 성립하지 않습니다: ${measurementFailures.map(([name]) => name).join(", ")}`);
assert.equal(regressions.length, 0,
  `전에 되던 것이 지금 안 됩니다(${regressions.length}건):\n${regressions
    .map(([name, runs]) => `  ${name}: 기준 ${runs.base.detail} → 현행 ${runs.head.detail}`).join("\n")}`);
