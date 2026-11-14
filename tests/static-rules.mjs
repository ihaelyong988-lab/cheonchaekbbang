import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
/* §7-2 V3b — 오프라인 완전 동작(INV-5)은 부팅 색인과 샤드 전부가 프리캐시돼야 성립한다. 샤드 목록은 손으로 적지 않고
   디스크에서 센다(§9 E-028 · E-032). 원천 모듈(data/books.js 등)은 Node 전용이라 프리캐시하면 카탈로그를 두 번 받는다. */
const shardFiles = readdirSync(path.join(ROOT, "data/shards")).filter((file) => file.endsWith(".js")).map((file) => `data/shards/${file}`);
assert.ok(shardFiles.length >= 12, `샤드 파일이 ${shardFiles.length}개뿐입니다 — 생성이 덜 됐습니다(npm run build:shards).`);
for (const required of ["app.js", "app.css", "lib/search.js", "data/boot-index.js", ...shardFiles]) {
  assert.ok(cachedAssets.includes(required), `SW 캐시 자산 누락: ${required}`);
}
for (const sourceModule of ["data/books.js", "data/authored-questions.js", "data/history-classics.js", "data/research-books.js", "data/celeb-books-2025.js"]) {
  assert.ok(!cachedAssets.includes(sourceModule), `원천 모듈 ${sourceModule} 을 프리캐시하면 카탈로그를 두 번 받습니다 — 샤드만 캐시합니다.`);
}
assert.match(app, /import \{ BOOT, SHARDS, JOURNEYS, DOMAINS, IS_SEED \} from "\.\/data\/boot-index\.js"/u,
  "app.js 는 부팅 색인만 정적으로 가져와야 합니다(§7-2 V3b).");
assert.doesNotMatch(app, /from "\.\/data\/books\.js"/u,
  "카탈로그 원천 모듈을 초기 번들에 다시 실었습니다 — 1,000권에서 첫 질문카드가 예산을 깹니다(§7-2).");
assert.match(app, /import\(`\.\/data\/shards\/\$\{SHARDS\[domain\]\}\.\$\{kind\}\.js`\)/u, "샤드 동적 import 경로 누락");
assert.match(app, /function render\(\) \{\s*\n\s*const v = top\(\);\s*\n\s*if \(!viewReady\(v\)\)/u,
  "render 입구의 샤드 준비 가드가 없습니다 — 본문 없는 책으로 화면을 그립니다.");
assert.match(app, /questionSearchIndex \?\?= createQuestionSearch\(ALL\)/u,
  "검색 색인은 첫 검색에서 지연 생성해야 합니다 — 부팅 때 만들면 본문 없는 책으로 굳습니다.");
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
/* 히어로 값은 heroFacts 한 곳에서만 계산한다 — 템플릿과 부분 갱신이 각자 계산하면 한쪽만 낡는다. */
assert.match(app, /function heroFacts\(\)\s*\{/u, "히어로 값 단일 계산부 heroFacts 누락");
assert.match(app, /const bookSteps = stepsToRoot\(book\)/u, "홈 스트립은 stepsToRoot로만 뿌리 거리를 계산해야 합니다.");
assert.equal((app.match(/heroFacts\(\)/gu) || []).length, 3,
  "히어로 값 계산은 정의 1곳 + 템플릿 1곳 + 부분 갱신 1곳이어야 합니다.");
assert.match(app, /function updateHero\(\)\s*\{/u, "히어로 부분 갱신 함수 누락(원장 20).");
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
// 외부 링크 등록 규약 — 방문자를 밖으로 보내는 URL 은 등록부에 확인일과 함께 있어야 한다.
// 왜: 2026-08-20 CanaryLab 에서 근거 원문 52건 중 2건이 404 였고, 게이트 6종 중 **링크를 열어보는 것이
// 없었다**(스키마는 url 존재·형식만 봤다). 이 앱은 지금 외부 링크가 1건이라 안전하지만
// VERIFIED_CORRECTIONS 는 검증 URL 을 늘려가는 설계다 — 늘어난 뒤에 게이트를 만들면 늦다.
// 이 룰은 네트워크를 쓰지 않는다(도달 검사는 test:links 가 main 푸시에서 돈다) — PR 을 남의 사정에 걸지 않는다.
const linkRegistry = JSON.parse(await read("data/external-links.json"));
const registered = new Map(linkRegistry.links.map((link) => [link.url, link]));
const EXTERNAL_URL = /https?:\/\/[A-Za-z0-9._~:\/?#@!$&*+,;=%-]+/gu;
// 스키마·프로토콜 선언은 방문자가 누르는 링크가 아니다(schema.org, w3.org 등 네임스페이스).
const NAMESPACE = /^https?:\/\/(schema\.org|www\.w3\.org|purl\.org|xmlns\.)/u;
// 자기 배포 URL(canonical·og:url)은 제외한다 — 그 URL 의 도달은 tests/production-smoke.mjs 가 실브라우저로
// 이미 소유한다. 두 곳에서 같은 것을 재면 한쪽이 낡아도 초록이 유지된다(정보 1곳 규약).
const SELF_ORIGIN = /^https?:\/\/ihaelyong988-lab\.github\.io\/cheonchaekbbang/u;
const scanned = [
  ["data/books.js", books],
  ["data/celeb-books-2025.js", celeb],
  ["app.js", app],
  ["index.html", html],
  ["lib/search.js", search],
];
const foundLinks = new Map();
for (const [file, source] of scanned) {
  for (const raw of source.match(EXTERNAL_URL) || []) {
    const url = raw.replace(/[.,;:)\]}"'`]+$/u, "");
    if (NAMESPACE.test(url) || SELF_ORIGIN.test(url)) continue;
    if (!foundLinks.has(url)) foundLinks.set(url, file);
  }
}
const unregistered = [...foundLinks].filter(([url]) => !registered.has(url));
assert.deepEqual(unregistered, [],
  `등록되지 않은 외부 링크가 있습니다 — 열어서 확인한 뒤 data/external-links.json 에 checkedAt 과 함께 등록하세요: ${unregistered.map(([url, file]) => `${url}(${file})`).join(", ")}`);
const today = Date.parse(new Date().toISOString().slice(0, 10));
const staleLinks = linkRegistry.links.filter((link) => {
  const checked = Date.parse(link.checkedAt);
  return !Number.isFinite(checked) || (today - checked) / 86400000 > linkRegistry.maxAgeDays;
});
assert.deepEqual(staleLinks.map((link) => link.url), [],
  `링크 확인일이 ${linkRegistry.maxAgeDays}일을 넘었습니다 — 다시 열어 확인하고 checkedAt 을 갱신하세요.`);
// 등록부에만 남은 URL 은 죽은 등록이다 — 목록이 실제 코드와 어긋나면 다음 사람이 등록부를 믿지 못한다.
const orphanLinks = linkRegistry.links.filter((link) => !foundLinks.has(link.url));
assert.deepEqual(orphanLinks.map((link) => link.url), [],
  "코드에서 사라진 URL 이 등록부에 남아 있습니다 — 등록을 지우세요.");

/* 문장 절제 (주인님 지시 2026-11-15 "방문자의 관점에서 필요 이상의 내용과 문장은 삭제") — 화면이 이미 보여 주는 사실,
   한 화면에 두 번 나오는 정보(R6), 라벨·버튼 안 대시·괄호 부연을 되살리지 않는다. 판정은 주석을 걷은 코드로 한다. */
{
  const appCode = app.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/<!--[\s\S]*?-->/gu, "").replace(/(^|[ \t])\/\/[^\n]*/gmu, "$1");
  assert.ok(appCode.includes("function renderSheet(") && appCode.includes("읽음 상태: ${stLabel}"), "주석 제거가 코드까지 지웠습니다.");
  const fnBody = (name) => {
    const start = appCode.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `추출 실패: function ${name}`);
    let depth = 0, i = appCode.indexOf("{", start);
    for (; i < appCode.length; i += 1) {
      if (appCode[i] === "{") depth += 1;
      else if (appCode[i] === "}" && --depth === 0) break;
    }
    return appCode.slice(start, i + 1);
  };
  for (const removed of ["(탭하여 변경)", "개인 기록 전용", "(읽음 기준)", "— 뿌리에서 가지로", "뿌리 고전입니다", "하나의 질문, 뿌리에서 가지까지",
    "— 가지에서 뿌리로", "— 이 질문에 대한 나의 답은", "내보낸 파일은 이 기기 안에서만", "기록과 이름은 이 기기에만", "밖으로 나가지 않습니다",
    "이 기기가 읽은 자리", "(기기에만 보관)", "이 기기에 남아 있던", "엑셀 원문 표기를 보존", "아래 낱말로 다시 물어볼",
    "이번 주의 질문에서 시작해 보세요", "아래 읽은 책에서 이어 봅니다", "책으로 이어질 질문", ">질문 하기<"]) {
    assert.ok(!appCode.includes(removed), `지운 문구가 되살아났습니다: ${removed}`);
  }
  // 버튼·섹션 라벨은 이름만 둔다. 수집 건수 하한은 정규식이 템플릿을 실제로 읽는지 보는 장치다(빈 통과 방지).
  const buttonLabels = [...appCode.matchAll(/<button\b[^>]*>([^<]*)<\/button>/gu)].map((m) => m[1].trim()).filter(Boolean);
  assert.ok(buttonLabels.length >= 20, `버튼 라벨이 ${buttonLabels.length}건만 잡혔습니다 — 정규식이 템플릿을 못 읽습니다.`);
  assert.deepEqual(buttonLabels.filter((label) => / — |\(탭/u.test(label)), [], "버튼 라벨에 대시·괄호 부연이 있습니다.");
  const sectionLabels = [...appCode.matchAll(/<p class="section-label">([^<]*)<\/p>/gu)].map((m) => m[1]);
  assert.ok(sectionLabels.length >= 15, `섹션 라벨이 ${sectionLabels.length}건만 잡혔습니다.`);
  assert.deepEqual(sectionLabels.filter((label) => / — /u.test(label)), [], "섹션 라벨에 대시 부연이 있습니다.");
  assert.doesNotMatch(fnBody("lineageLabel"), / — /u, "계보 라벨에 대시 부연이 있습니다.");
  /* "이 기기" 보관 범위 고지 허용 위치 — 4곳뿐이다. 새 고지를 더하지 말고 아래 두 곳을 고친다.
     ① onboardingHtml 첫 방문 안내(C2-2 · G-12) ② renderSettings 설정 시트 1문장
     ③ SAVE_FAIL_BANNER ④ LOAD_FAIL_BANNER — 저장을 거부·실패한 주체가 이 기기라는 오류 원인이다. */
  const deviceCount = (source) => (source.match(/이 기기/gu) || []).length;
  assert.equal(deviceCount(appCode), 4, `"이 기기" 문구가 허용 위치 4곳과 다릅니다(${deviceCount(appCode)}건).`);
  assert.equal(deviceCount(fnBody("onboardingHtml")), 1, "첫 방문 안내에 보관 범위(이 기기)가 1회 있어야 합니다(C2-2).");
  assert.equal(deviceCount(fnBody("renderSettings")), 1, "설정 시트의 보관 범위 고지는 1문장이어야 합니다.");
  assert.match(appCode, /const SAVE_FAIL_BANNER = "이 기기가/u, "저장 거부 배너 원인 문구 누락");
  assert.match(appCode, /const LOAD_FAIL_BANNER = "이 기기에/u, "읽기 실패 배너 원인 문구 누락");
  assert.equal((appCode.match(/기기에만/gu) || []).length, 1, "\"기기에만\" 고지는 첫 방문 안내 1곳뿐이어야 합니다.");
  // 첫 방문 안내는 제목 1줄 + 설명 1줄 — 등록 수단(이름 저장)과 보관 범위(이 기기)를 함께 담는다(C2-2).
  const onboard = fnBody("onboardingHtml").match(/<div class="card-title">([^<]+)<\/div>\s*<div class="card-meta">([^<]+)<\/div>/u);
  assert.ok(onboard, "첫 방문 안내의 제목·설명 구조 누락");
  assert.ok(onboard[1].includes("이름") && onboard[1].length <= 24, `첫 방문 안내 제목은 이름 저장을 24자 이내로 말해야 합니다: ${onboard[1]}`);
  assert.ok(onboard[2].includes("이 기기에만") && onboard[2].length <= 24, `첫 방문 안내 설명은 보관 범위를 24자 이내로 말해야 합니다: ${onboard[2]}`);
  assert.match(fnBody("onboardingHtml"), /data-open-profile="1"/u, "첫 방문 안내에 이름 저장 진입 버튼이 없습니다.");
  // 홈 검색은 질문뿐 아니라 제목·저자도 찾는다 — 라벨이 실제 범위를 말해야 한다.
  assert.match(fnBody("questionSearchHtml"), /<p class="section-label">[^<]*제목[^<]*저자[^<]*<\/p>/u, "홈 검색 라벨이 제목·저자 검색을 말하지 않습니다.");
  assert.match(fnBody("questionSearchHtml"), /<label class="sr-only" for="question-search">[^<]*제목[^<]*저자[^<]*<\/label>/u,
    "홈 검색 입력의 접근 이름이 제목·저자 검색을 말하지 않습니다.");
  // 책 시트: 읽음 상태는 순환 버튼 한 곳이 원천이다 — 머리 배지와 같이 두면 한 화면에 두 번이다(R6).
  assert.doesNotMatch(fnBody("renderSheet"), /statusBadge\(/u, "책 시트에 읽음 배지와 읽음 상태 버튼이 함께 있습니다(R6).");
  /* 질문 출처 — "『제목』의 핵심 주제" 같은 일반형은 책 시트에서 제목의 되풀이다. 구체 출처(편·장)만 보이고, 책이 달리 식별되지
     않는 문답집에서는 일반형 대신 제목만 남긴다. 판정은 낱말 잔여물로 독립 계산해 두 방향(숨김·노출)을 모두 대조한다. */
  assert.doesNotMatch(fnBody("renderSheet"), /esc\(q\.source\)/u, "책 시트가 출처를 거르지 않고 그립니다.");
  assert.doesNotMatch(fnBody("renderRecord"), /esc\(qObj\.source\)/u, "문답집이 일반형 출처를 그대로 그립니다.");
  const specificSource = new Function(`${fnBody("specificSource")}\nreturn specificSource;`)();
  const { BOOKS } = await import(pathToFileURL(path.join(ROOT, "data/books.js")).href);
  const residue = (book, source) => source.replace(/『([^』]+)』/gu, (all, title) => (book.title.includes(title) ? "" : all))
    .replace(/의|핵심|주제와|주제|원리|기반|자체|질문|\s/gu, "");
  let shownSources = 0;
  const misjudged = [];
  for (const book of BOOKS) for (const question of book.questions) {
    const shown = Boolean(specificSource(book, question));
    if (shown) shownSources += 1;
    if (shown !== Boolean(residue(book, question.source))) misjudged.push(`${book.id}: ${question.source}`);
  }
  assert.deepEqual(misjudged, [], "출처 판정이 어긋났습니다 — 구체 출처를 숨기거나 일반형을 보입니다.");
  // 손실 계수 — 2026-11-15 구체 출처 54건(전체 665건 중). 이보다 줄면 거르기가 구체 출처를 먹은 것이다.
  assert.ok(shownSources >= 54, `보이는 구체 출처가 ${shownSources}건으로 줄었습니다(하한 54).`);
  const lunyu = BOOKS.find((book) => book.id === "lunyu");
  assert.equal(specificSource(lunyu, { source: "『국가』" }), "『국가』", "다른 책을 가리키는 출처를 숨겼습니다.");

  /* §6-4 N-5 오버레이 닫힘 단일 경로 (흐름 2파도 2026-11-15) — 한 칸(history.back)과 여러 칸(history.go(-n)) 모두
     dismissOverlay 안에서만 부른다. 겹친 시트의 [닫기]·배경 탭은 쌓인 전부, [이전]·ESC 는 한 칸이다. 동작은 feature-regression overlayDepthClose 가 잰다. */
  const dismissBody = fnBody("dismissOverlay");
  const goBackCount = (source) => (source.match(/history\.go\(-/gu) || []).length;
  assert.equal((appCode.match(/history\.back\(\)/gu) || []).length, 1, "history.back() 호출이 1곳이 아닙니다(N-5).");
  assert.match(dismissBody, /history\.back\(\)/u, "history.back() 이 dismissOverlay 밖에 있습니다(N-5).");
  assert.ok(goBackCount(dismissBody) >= 1, "겹친 시트를 모두 닫는 여러 칸 경로가 dismissOverlay 에 없습니다.");
  assert.equal(goBackCount(appCode), goBackCount(dismissBody) + goBackCount(fnBody("goHome")),
    "여러 칸 뒤로가기가 dismissOverlay·goHome 밖에 있습니다(N-5 · INV-6).");
  assert.match(appCode, /t\.dataset\.closeOverlay\) \{\s*if \(e\.target === t\) dismissOverlay\(overlayDepth\)/u,
    "[닫기]·배경 탭이 쌓인 시트를 모두 닫지 않습니다.");
  assert.match(appCode, /t\.dataset\.prevOverlay\) \{\s*dismissOverlay\(1\)/u, "[이전]이 한 칸만 돌아가지 않습니다.");
  assert.equal((appCode.match(/\$\{sheetHead\("[^"]+"\)\}/gu) || []).length, 6, "시트 머리를 sheetHead 밖에서 그리는 오버레이가 있습니다.");
  assert.equal((appCode.match(/class="sheet-close"/gu) || []).length, 2, "[닫기] 마크업은 sheetHead 의 두 갈래에만 있어야 합니다.");
  assert.match(css, /\.sheet-close, \.sheet-prev \{[^}]*min-width: 44px; min-height: 44px/u, "[이전]·[닫기] 44px 게이트 누락(§8-1).");
  assert.match(css, /\.search-clear \{[^}]*min-width: 44px; min-height: 44px/u, "홈 검색 [지우기] 44px 게이트 누락(§8-1).");
}

const pkg = JSON.parse(await read("package.json"));
assert.doesNotMatch(pkg.scripts.test, /npm run|pnpm run|yarn/u,
  "테스트 체인이 특정 패키지 매니저 호출에 묶여 있습니다 — 락파일은 pnpm, 내부 호출은 npm 이었습니다(원장 62).");
assert.ok(pkg.scripts["test:production"], "배포 검사 스크립트가 사라졌습니다.");

console.log(JSON.stringify({ result: "pass", siteName: "천책빵", cachedAssets: cachedAssets.length, tabs: 4, templateOrder: true, brandHomeButton: true, contextStripMarkers: true, lineageProgressTabs: true, tabFirstPageReset: true, searchReachability: true, managerAgnosticTests: true, installQuality: true, answerLimitSingleSource: true, skipLinks: true, weeklyQuestions: true, copyRestraint: true, overlayCloseSinglePath: true }, null, 2));
