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
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  const executablePath = candidates.find(existsSync);
  assert.ok(executablePath, "Chrome 또는 Edge 실행 파일을 찾지 못했습니다.");
  return executablePath;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname) === "/"
      ? "index.html"
      : decodeURIComponent(url.pathname).slice(1);
    const filePath = path.resolve(ROOT, relative);
    assert.ok(filePath.startsWith(`${ROOT}${path.sep}`), "허용되지 않은 경로입니다.");
    const body = await readFile(filePath);
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

try {
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload({ waitUntil: "networkidle" });

  assert.equal(page.url(), `${baseURL}/#question`);
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "홈");
  assert.equal(await page.locator("#exit-dialog").isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
  assert.deepEqual(await page.locator("button").evaluateAll((buttons) => buttons
    .filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
    })
    .map((button) => ({ text: button.textContent.trim(), width: button.offsetWidth, height: button.offsetHeight }))), []);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator(".tab[aria-current=page] span").textContent(), "홈");
  await context.setOffline(false);

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

  await back();
  assert.equal(await page.locator("#exit-dialog").isVisible(), true);
  await back();
  assert.equal(await page.locator("#exit-dialog").isVisible(), true);
  assert.equal(page.url(), `${baseURL}/#question`);

  await page.evaluate(() => { window.close = () => {}; });
  await page.locator("#exit-leave").click();
  await page.waitForTimeout(180);
  assert.equal(await page.locator(".goodbye").isVisible(), true);
  assert.match(await page.locator(".goodbye").innerText(), /천책빵을 닫았습니다/);
  assert.deepEqual(runtimeErrors, []);

  console.log(JSON.stringify({
    result: "pass",
    viewport: "390x844",
    homeFirst: true,
    backSequence: ["서재", "계보", "홈", "종료 확인"],
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
