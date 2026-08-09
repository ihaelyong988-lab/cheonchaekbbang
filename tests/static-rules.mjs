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
/* 원장 67 — 설치 품질. maskable 용도가 없으면 안드로이드 홈 화면이 아이콘 모서리를 잘라낸다.
   id 는 manifest URL 이 아니라 origin 을 기준으로 해석되므로, 하위 경로 배포에서는 그 경로를
   그대로 담아야 start_url 과 같은 곳을 가리킨다. 배포 주소는 production-smoke 기본값이 단일 출처다. */
const productionSmoke = await read("tests/production-smoke.mjs");
const productionBase = new URL(productionSmoke.match(/PRODUCTION_URL \|\| "([^"]+)"/u)[1]);
assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && `${icon.purpose ?? ""}`.split(" ").includes("maskable")),
  "maskable 용도 512 아이콘 누락 — 홈 화면 아이콘 모서리가 잘립니다.");
assert.ok(manifest.id, "설치 동일성 id 누락 — 설치된 앱 식별이 start_url 추정에 의존합니다.");
assert.equal(new URL(manifest.id, productionBase.origin).href, new URL(manifest.start_url, productionBase).href,
  "manifest id 가 start_url 과 다른 곳을 가리킵니다 — 설치 동일성이 갈립니다.");

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
/* §0-3 3항 — 캐시 버전을 하드코딩한 지점 전수 일치. 지점을 열거하면 원본이 늘 때 조용히 낡는다(§9 E-015).
   정규식 이스케이프로 적힌 값도 같은 값으로 세도록 역슬래시를 걷어내고 센다. */
const cacheVersionSources = `${sw}\n${productionSmoke}\n${await read("tests/static-rules.mjs")}`;
const cacheVersions = [...new Set([...cacheVersionSources.replace(/\\/gu, "").matchAll(/ccb-v\d+\.\d+\.\d+/gu)].map((hit) => hit[0]))];
assert.equal(cacheVersions.length, 1, `캐시 버전이 여러 값으로 갈렸습니다: ${cacheVersions.join(" · ")}`);
assert.match(sw, /const CACHE = "ccb-v\d+\.\d+\.\d+"/u, "서비스워커 캐시 버전 상수 누락");
assert.match(app, /register\("sw\.js", \{ updateViaCache: "none" \}\)/u, "SW 갱신 확인은 HTTP 캐시를 우회해야 합니다.");

/* G-14 배포 갱신 통지 — 열린 탭의 히스토리를 건드리지 않고 통지만 한다 (§10-2 원장 12) */
assert.doesNotMatch(sw, /\.navigate\s*\(/u, "서비스워커는 열린 탭을 강제 이동시켜서는 안 됩니다.");
assert.match(sw, /isUpdate[\s\S]*clients\.matchAll[\s\S]*postMessage\(\{ type: "ccb-updated"/u,
  "기존 캐시 갱신 시 postMessage 로 갱신 사실만 통지해야 합니다.");

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
/* DI-3 — 답변 상한 단일 출처. 저장·입력·마크업이 각자 리터럴을 들면 한 곳만 고쳐도
   화면은 더 받고 저장은 잘라내는 무경고 소실이 되살아난다(원장 49). */
assert.match(app, /const ANSWER_MAX = \d+/u, "답변 상한 상수 ANSWER_MAX 누락");
assert.match(app, /myAnswer:\s*typeof item\.myAnswer.*slice\(0, ANSWER_MAX\)/u, "저장 답변 길이 방어 누락");
assert.doesNotMatch(app, /slice\(0, 10000\)|maxlength="10000"/u,
  "답변 상한 리터럴이 남아 있습니다 — 값은 ANSWER_MAX 한 곳에서만 정해야 합니다(DI-3).");
assert.equal((app.match(/maxlength="\$\{ANSWER_MAX\}"/gu) || []).length, 3,
  "답변 입력 3종(문답집·여정 완료답·진행 중 초안) 전부에 상한 속성이 있어야 합니다(원장 49).");
assert.equal((app.match(/aria-labelledby="(qa|jqa)-q-\$\{index\}"/gu) || []).length, 2,
  "문답집 답칸의 접근 이름이 질문 문단에 연결되지 않았습니다 — placeholder 는 입력이 시작되면 사라집니다(원장 52).");

/* 원장 29 — 건너뛰기 버튼. 서재 첫 페이지 80장 뒤에 하단 탭이 있어 키보드로는 98번을 눌러야 닿는다.
   해시를 바꾸는 앵커 대신 버튼을 쓰고, 상단바 안에 두어 오버레이·종료 팝업 배경 잠금을 함께 받는다. */
assert.equal((html.match(/class="skip-link" data-skip-to="(view|tabbar)"/gu) || []).length, 2,
  "본문·탭 건너뛰기 버튼 2개가 필요합니다(원장 29).");
assert.match(html, /<header class="topbar">\s*(<!--[\s\S]*?-->\s*)?<button class="skip-link"/u,
  "건너뛰기 버튼은 상단바 안 최상단에 있어야 배경 잠금을 함께 받습니다.");
assert.match(css, /\.skip-link\s*\{[^}]*min-height:\s*44px/u, "건너뛰기 버튼 44px 게이트 누락");
assert.match(css, /\.skip-link:focus\s*\{[^}]*top:/u, "건너뛰기 버튼이 포커스 시 화면에 나타나지 않습니다.");

/* 주인님 지시(2026-08-09) — 질문은 최소 주 1회 갱신된다. 전에는 방문마다 무작위라 주기 개념이 없었다. */
assert.match(app, /function isoWeekKey\(/u, "주차 산출 헬퍼 누락 — 질문 주간 갱신의 기준입니다.");
assert.match(app, /if \(state\.questionWeek !== week\)/u, "주가 바뀔 때 질문 묶음을 갈아타는 분기가 없습니다.");
assert.match(app, /questionWeek: \/\^\\d\{4\}-W\\d\{2\}\$\/u\.test/u, "questionWeek 가 정화 화이트리스트에 없습니다.");
assert.doesNotMatch(app, /function shuffledQuestionIds/u,
  "전체 무작위 추첨 경로가 남아 있습니다 — 주간 묶음과 두 갈래가 되면 주기가 깨집니다.");
assert.doesNotMatch(app, /aria-label="오늘의 질문"/u,
  "접근 이름이 실제 갱신 주기와 어긋납니다 — 화면은 주 단위로 갱신됩니다.");

/* v1.8.0 §11-3 — 상단 브랜드 = 첫 화면 복귀 버튼 (템플릿 고정) */
assert.match(html, /<h1 class="brand"><button class="brand-btn" data-home="1" aria-label="첫 화면으로">천책빵<\/button><\/h1>/u,
  "상단 브랜드는 data-home 첫 화면 복귀 버튼이어야 합니다.");
assert.match(css, /\.brand-btn\s*\{[^}]*min-height:\s*44px/u, "브랜드 홈 버튼 44px 세로 게이트 누락");
assert.match(css, /\.brand-btn\s*\{[^}]*min-width:\s*44px/u, "브랜드 홈 버튼 44px 가로 게이트 누락");
assert.match(app, /function goHome\(\)\s*\{/u, "첫 화면 복귀 단일 진입점 goHome 누락");
assert.match(app, /history\.go\(-d\)/u, "goHome은 히스토리 위치를 index 0으로 되돌려야 합니다.");
assert.match(app, /if \(t\.dataset\.home\)[\s\S]{0,60}goHome\(\)/u, "브랜드 버튼 클릭이 goHome으로 연결되지 않았습니다.");
assert.match(app, /t\.dataset\.tab === "question"[\s\S]{0,60}goHome\(\)/u, "홈 탭 클릭이 goHome으로 통일되지 않았습니다.");

/* v1.8.0 §11-1 — 홈 스트립 문맥 전환 마커 */
assert.match(app, /function stepsToRoot\(book\)\s*\{/u, "뿌리 거리 단일 헬퍼 stepsToRoot 누락");
assert.equal((app.match(/function stepsToRoot\(/gu) || []).length, 1, "stepsToRoot는 단일 헬퍼여야 합니다.");
assert.match(app, /const bookSteps = stepsToRoot\(b\)/u, "홈 스트립은 stepsToRoot로만 뿌리 거리를 계산해야 합니다.");
assert.match(app, /class="qstat is-ctx\$\{flip\}" data-tab="record"[\s\S]{0,120}<span>수집한 질문<\/span>/u,
  "스트립 2번 칸은 문맥 전환·기록 탭 링크·라벨 `수집한 질문`을 유지해야 합니다.");
assert.match(app, /class="qstat is-ctx\$\{flip\}" data-tab="lineage"[\s\S]{0,140}<span>뿌리까지<\/span>/u,
  "스트립 3번 칸은 문맥 전환·계보 탭 링크·라벨 `뿌리까지`를 유지해야 합니다.");
assert.match(app, /bookSteps === 0 \? "도달"/u, "뿌리 책은 `도달`로 표시해야 합니다.");
assert.equal((app.match(/is-ctx/gu) || []).length, 2, "문맥 전환은 스트립 2·3번 칸에만 적용해야 합니다.");
assert.match(css, /@media \(prefers-reduced-motion: no-preference\)[\s\S]{0,240}qstat-swap/u,
  "스트립 전환 효과는 prefers-reduced-motion을 존중해야 합니다.");
assert.match(css, /animation: qstat-swap 1[0-2]\dms/u, "스트립 전환은 120ms 이내여야 합니다.");

/* v1.10.0 §11-4 — 기록 탭 계보 진행률: 분야마다 탭 1개, 누르면 그 분야 목록이 펼쳐진다 */
assert.match(app, /<button class="progress-row" data-progress-domain="\$\{esc\(d\)\}"/u,
  "계보 진행률의 분야 행은 누를 수 있는 탭 버튼이어야 합니다.");
assert.match(app, /aria-expanded="\$\{open\}" aria-controls="\$\{panelId\}"/u,
  "계보 진행률 탭은 펼침 상태와 대상 목록을 함께 알려야 합니다.");
assert.match(app, /class="progress-panel" id="\$\{panelId\}"/u, "계보 진행률 목록 패널 누락");
assert.match(app, /function progressBookRow\(b\)\s*\{/u, "계보 진행률 목록 행 헬퍼 누락");
assert.match(app, /openProgressDomain = openProgressDomain === domain \? null : domain/u,
  "계보 진행률은 한 번에 한 분야만 펼쳐야 합니다.");
/* R6 — 펼친 목록은 아직 손대지 않은 책만 담는다. 읽음·읽는 중은 아래 개인 기록 섹션이 원천이다 */
assert.match(app, /function progressPanelHtml\(domain\)[\s\S]{0,200}readStatus\(b\.id\) === "none"/u,
  "펼친 목록이 읽음·읽는 중 책을 걸러내지 않습니다 — 한 화면에 같은 책이 두 번 나옵니다(R6).");
/* 개폐는 패널만 갱신한다 — 전면 재렌더는 §7 승격선을 넘고 포커스를 날린다 */
assert.match(app, /function renderProgressPanels\(\)\s*\{/u, "진행률 패널 부분 갱신 함수 누락");
assert.match(app, /openProgressDomain === domain \? null : domain;\s*\n\s*renderProgressPanels\(\)/u,
  "분야 탭 개폐가 부분 갱신이 아니라 전면 재렌더를 호출합니다.");
assert.match(css, /\.progress-row\s*\{[^}]*min-height:\s*44px/u, "계보 진행률 탭 44px 세로 게이트 누락");
assert.match(css, /\.progress-book\s*\{[^}]*min-height:\s*44px/u, "계보 진행률 목록 행 44px 세로 게이트 누락");

/* v1.10.0 §6-6 N-9 — 하단 탭은 그 화면의 첫 페이지 최상단에서 시작한다 */
assert.match(app, /function resetTabToFirstPage\(tab\)\s*\{/u, "하단 탭 첫 페이지 복귀 단일 헬퍼 누락");
assert.match(app, /if \(!view\.overlay && view\.tab !== previous\.tab\) \{ scrollPageTop\(\); clearAnnounce\(\); \}/u,
  "탭이 바뀌는 pushView 경로에서만 최상단 복귀와 낭독 문구 해제를 해야 합니다(N-9 · 원장 21).");
/* 화면이 바뀌면 직전 화면의 문구를 걷는다 — 채우기만 하면 옛 문구가 남아 지금 화면과 무관한 문장이 읽힌다 */
assert.match(app, /function clearAnnounce\(\)\s*\{/u, "라이브 리전 해제 헬퍼 누락(원장 21).");
assert.match(app, /if \(previousTab !== currentView\.tab\) clearAnnounce\(\)/u,
  "뒤로·앞으로 이동으로 탭이 바뀔 때 옛 낭독 문구가 남습니다.");
assert.match(app, /resetTabToFirstPage\(t\.dataset\.tab\)/u, "탭 클릭이 첫 페이지 복귀를 거치지 않았습니다.");
assert.match(app, /if \(cur\.overlay\) pushView\(\{ tab: cur\.tab, overlay: null \}\);\s*\n\s*else render\(\);\s*\n\s*scrollPageTop\(\)/u,
  "이미 보고 있는 탭을 다시 눌러도 최상단으로 되돌아와야 합니다.");
assert.equal((app.match(/function scrollPageTop\(/gu) || []).length, 1, "최상단 복귀는 단일 헬퍼여야 합니다.");

/* W1 (2026-08-02) — 검색: 두 화면이 같은 정규화를 쓰고, 빈 결과가 막다른 길이 아니다 */
assert.match(app, /import \{ createQuestionSearch, compactSearchText, TOPIC_CHIPS \} from "\.\/lib\/search\.js"/u,
  "서재 검색이 홈과 같은 정규화 함수를 가져오지 않았습니다(원장 16).");
assert.match(app, /compactSearchText\(b\.title\)\.includes\(compact\)/u,
  "서재 검색이 여전히 원문 부분문자열로 거릅니다(원장 16).");
assert.doesNotMatch(app, /b\.title\.includes\(q\) \|\| b\.author\.includes\(q\)/u, "서재 검색의 구 정규화 경로가 남아 있습니다.");
assert.match(app, /id="question-search"[\s\S]{0,80}minlength="1"/u, "한 글자 주제어 검색이 UI 에서 막혀 있습니다(원장 17).");
assert.match(app, /function runQuestionSearch\(value\)\s*\{/u, "질문 검색 단일 진입점 누락");
assert.equal((app.match(/findBooksForQuestion\(/gu) || []).length, 1,
  "질문 검색 실행부는 runQuestionSearch 1곳이어야 합니다(경로가 갈리면 진입 방식마다 결과가 달라집니다).");
assert.match(app, /data-ask-term="\$\{esc\(term\)\}"/u, "빈 결과에서 되짚을 낱말 칩이 없습니다(원장 18).");
assert.match(app, /찾을 낱말을 한 글자 이상 적어 주세요/u, "공백 제출 안내 문구 누락(원장 17).");
assert.match(search, /export const TOPIC_TERMS/u, "등록 주제어 목록이 노출되지 않습니다.");
assert.match(search, /TOPIC_GROUPS\.map\(\(group\) => group\.terms\[0\]\)/u,
  "빈 결과 낱말 칩이 그룹마다 하나씩이 아닙니다 — 앞에서 자르면 한 분야 낱말만 나옵니다.");
assert.match(search, /export function compactSearchText/u, "compactSearchText 미노출");
const josaList = search.match(/const JOSA = \/\(([^)]*)\)/u)?.[1].split("|") || [];
for (const josa of ["이나", "라도", "마다", "조차", "에", "도", "만"]) {
  assert.ok(josaList.includes(josa), `조사 "${josa}" 가 JOSA 목록에 없습니다(원장 18).`);
}
assert.ok(josaList.indexOf("이나") < josaList.indexOf("이"),
  "긴 조사가 짧은 조사보다 뒤에 있으면 '이나'가 '이'로 먼저 잘립니다.");

/* W0 — 테스트 체인이 패키지 매니저에 묶이지 않는다 (원장 62) */
const pkg = JSON.parse(await read("package.json"));
assert.doesNotMatch(pkg.scripts.test, /npm run|pnpm run|yarn/u,
  "테스트 체인이 특정 패키지 매니저 호출에 묶여 있습니다 — 락파일은 pnpm, 내부 호출은 npm 이었습니다(원장 62).");
assert.ok(pkg.scripts["test:production"], "배포 검사 스크립트가 사라졌습니다.");

console.log(JSON.stringify({ result: "pass", siteName: "천책빵", cachedAssets: cachedAssets.length, tabs: 4, templateOrder: true, brandHomeButton: true, contextStripMarkers: true, lineageProgressTabs: true, tabFirstPageReset: true, searchReachability: true, managerAgnosticTests: true, installQuality: true, answerLimitSingleSource: true, skipLinks: true, weeklyQuestions: true }, null, 2));
