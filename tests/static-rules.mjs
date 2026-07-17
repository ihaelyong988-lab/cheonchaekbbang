import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(ROOT, relative), "utf8");
const [html, app, css, sw, manifestRaw, books, celeb, search] = await Promise.all([
  read("index.html"), read("app.js"), read("app.css"), read("sw.js"),
  read("manifest.webmanifest"), read("data/books.js"), read("data/celeb-books-2025.js"), read("lib/search.js"),
]);
const manifest = JSON.parse(manifestRaw);

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/../gu).map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

assert.equal((html.match(/class="tab"/gu) || []).length, 4, "기존 4탭을 유지해야 합니다.");
const tabOrder = ["question", "lineage", "library", "record"].map((tab) => html.indexOf(`data-tab="${tab}"`));
assert.ok(tabOrder.every((position) => position >= 0), "필수 탭 누락");
assert.deepEqual([...tabOrder].sort((a, b) => a - b), tabOrder, "홈→계보→서재→기록 순서를 유지해야 합니다.");

const homeOrder = ["${questionSearchHtml()}", "${lastQObj ? `", "<p class=\"section-label\">질문 여정</p>", "<p class=\"section-label\">분야별 진행</p>"]
  .map((marker) => app.indexOf(marker));
assert.ok(homeOrder.every((position) => position >= 0), "홈 정보 순서 표식 누락");
assert.deepEqual([...homeOrder].sort((a, b) => a - b), homeOrder, "홈 정보 순서를 유지해야 합니다.");

assert.equal(manifest.display, "standalone", "PWA standalone 누락");
assert.equal(manifest.orientation, "portrait", "휴대폰 세로 방향 누락");
assert.equal(manifest.name, "천책빵 — 뿌리를 찾는 서재", "PWA 전체 이름에 천책빵이 포함되어야 합니다.");
assert.equal(manifest.short_name, "천책빵", "PWA 짧은 이름은 천책빵이어야 합니다.");
assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"), "192 아이콘 누락");
assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"), "512 아이콘 누락");

assert.match(html, /<title>천책빵 — 뿌리를 찾는 서재<\/title>/u, "브라우저 제목에 천책빵 누락");
for (const metadata of [
  '<meta name="application-name" content="천책빵">',
  '<meta name="apple-mobile-web-app-title" content="천책빵">',
  '<meta property="og:site_name" content="천책빵">',
  '<meta property="og:title" content="천책빵 — 뿌리를 찾는 서재">',
]) assert.ok(html.includes(metadata), `사이트 이름 메타데이터 누락: ${metadata}`);
assert.match(html, /"@type":"WebSite","name":"천책빵"/u, "WebSite 구조화 데이터 이름 누락");

const cachedAssets = [...sw.matchAll(/"\.\/([^"\n]+)"/gu)].map((match) => match[1]);
for (const asset of cachedAssets) assert.ok(existsSync(path.join(ROOT, asset)), `SW 자산 누락: ${asset}`);
for (const required of ["app.js", "app.css", "lib/search.js", "data/books.js", "data/celeb-books-2025.js"]) {
  assert.ok(cachedAssets.includes(required), `SW 캐시 자산 누락: ${required}`);
}
assert.match(sw, /ccb-v1\.7\.3/u, "서비스워커 캐시 버전이 v1.7.3이어야 합니다.");
assert.match(app, /register\("sw\.js", \{ updateViaCache: "none" \}\)/u, "SW 갱신 확인은 HTTP 캐시를 우회해야 합니다.");
assert.match(sw, /isUpdate[\s\S]*clients\.matchAll[\s\S]*client\.navigate/u, "기존 캐시 갱신 시 열린 앱을 최신 화면으로 다시 불러와야 합니다.");

const uiSource = `${html}\n${app}\n${css}`;
assert.doesNotMatch(uiSource, /천책방/u, "정식 명칭 오기");
assert.doesNotMatch(uiSource, /linear-gradient|radial-gradient|conic-gradient/iu, "그라데이션 사용 금지");
assert.doesNotMatch(uiSource, /\p{Extended_Pictographic}/u, "UI 이모지 사용 금지");
assert.doesNotMatch(`${app}\n${books}\n${search}`, /\bfetch\s*\(|XMLHttpRequest|axios\s*\(/u, "외부 API 의존 금지");
assert.doesNotMatch(`${html}\n${app}`, /로그인|본인인증|인증번호|SMS|휴대폰 인증/iu, "서버 인증으로 오인되는 문구 금지");
assert.ok(contrastRatio("#704600", "#D6D6CF") >= 4.5, "은회 히어로 강조색 대비 미달");
assert.ok(contrastRatio("#E2BF7A", "#173A55") >= 4.5, "남색 히어로 강조색 대비 미달");
assert.doesNotMatch(html.match(/<button id="theme-btn"[\s\S]*?<\/button>/u)?.[0] || "", /aria-pressed/u, "테마 전환 대상 버튼에 aria-pressed를 사용하면 안 됩니다.");
assert.match(celeb, /sourceSheet:\s*"인생책"/u, "인생책 시트 출처 누락");
assert.match(celeb, /장바구니 시트는 읽기 대상과 앱 데이터에서 제외/u, "장바구니 시트 제외 규칙 누락");
assert.match(app, /textContent\s*=\s*state\.profile/u, "프로필은 textContent로 출력해야 합니다.");
assert.match(app, /myAnswer:\s*typeof item\.myAnswer.*slice\(0, 10000\)/u, "저장 답변 길이 방어 누락");

console.log(JSON.stringify({ result: "pass", siteName: "천책빵", cachedAssets: cachedAssets.length, tabs: 4, templateOrder: true }, null, 2));
