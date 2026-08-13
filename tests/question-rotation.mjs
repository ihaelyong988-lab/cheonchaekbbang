/* 주간 질문 회전 게이트 — 590문항이 1번 자리에 실제로 도달하는가, 선호 분야가 앞칸에 섞이는가.
 *
 * 왜 브라우저가 아니라 소스 추출인가: 판정 대상이 100년치 5,200주에 걸친 순서 분포다.
 * `weeklyQuestionIds`·`weightByReading` 은 모듈 스코프라 page.evaluate 로 부를 수 없고,
 * 주차마다 페이지를 다시 여는 것은 5,200회 로드다. 그래서 순수 함수만 **소스 텍스트 그대로**
 * 꺼내 같은 데이터 위에서 돌린다. 추출이 엉뚱한 것을 집었으면 마커 단언이 먼저 죽는다 —
 * "정규식이 통과했다"를 근거로 삼지 않는다.
 *
 * 하한값의 출처: 2026-08-14 A/B 실측(기준 origin/main 대비). 각 항목의 BEFORE 를 주석에 남긴다.
 * 값을 바꾸는 변경은 이 하한을 먼저 넘겨야 한다(AGENTS §0-3 항목 0 · 손실 계수).
 */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* 하한 — BEFORE 는 고친 결함의 크기이고, 하한은 그보다 나빠지면 실패하는 선이다. */
const FLOOR = {
  neverFirst: 0,        // BEFORE 10문항이 100년을 돌려도 1번 자리에 못 왔다
  topShare: 0.006,      // BEFORE 2.98% 가 한 문항에 몰렸다(균등 0.17%)
  firstNearRate: 0.15,  // BEFORE 전 분야 0.0% — 1번 자리가 선호 분야를 통째로 배제했다
  top5NearAvg: 0.85,    // BEFORE 역사·예술 0.00 — 앞 5칸에 선호 분야가 한 개도 없었다
};

/* 중괄호 균형으로 함수 하나를 통째로 꺼낸다. 정규식으로 끝을 잡으면 중첩 블록에서 잘린다. */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `추출 실패: function ${name} 를 찾지 못했다`);
  let depth = 0, i = source.indexOf("{", start);
  for (; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") { depth -= 1; if (depth === 0) break; }
  }
  assert.equal(depth, 0, `추출 실패: function ${name} 의 블록이 닫히지 않았다`);
  return source.slice(start, i + 1);
}

async function loadRotation() {
  const source = readFileSync(path.join(ROOT, "app.js"), "utf8");
  const validate = extractFunction(source, "validateBooks");
  const qid = extractFunction(source, "questionId");
  const seed = extractFunction(source, "weekSeed");
  const weekly = extractFunction(source, "weeklyQuestionIds");
  const weight = extractFunction(source, "weightByReading");

  // 마커 단언 — 꺼낸 것이 정말 그 함수인지 내용으로 확인한다.
  assert.ok(seed.includes("16777619"), "weekSeed 가 FNV 상수를 잃었다");
  assert.ok(weekly.includes("Q_POOL"), "weeklyQuestionIds 가 Q_POOL 을 안 읽는다");
  assert.ok(weight.includes("mostReadDomain"), "weightByReading 가 선호 분야를 안 읽는다");
  assert.ok(/weightByReading\(ids,\s*key\)/.test(weight), "weightByReading 가 주차 키를 안 받는다");

  const booksUrl = pathToFileURL(path.join(ROOT, "data", "books.js")).href;
  const harness = `
import { BOOKS, DOMAINS } from ${JSON.stringify(booksUrl)};
${validate}
const ALL = validateBooks(BOOKS);
const BY_ID = new Map(ALL.map((b) => [b.id, b]));
${qid}
const Q_POOL = ALL.flatMap((book) => book.questions.map((q, index) => ({
  id: questionId(book, index), bookId: book.id, q,
})));
const Q_BY_ID = new Map(Q_POOL.map((item) => [item.id, item]));
let __domain = null;
function mostReadDomain() { return __domain; }
function setDomain(d) { __domain = d; }
${seed}
${weekly}
${weight}
export { Q_POOL, Q_BY_ID, BY_ID, DOMAINS, weeklyQuestionIds, weightByReading, setDomain };
`;
  const file = path.join(mkdtempSync(path.join(tmpdir(), "ccb-rot-")), "harness.mjs");
  writeFileSync(file, harness, "utf8");
  return import(pathToFileURL(file).href);
}

/* 100년치 실제 ISO 주차 키. 씨앗은 달력이 아니라 키 문자열이므로 키만 있으면 된다. */
function weekKeys(years = 100, fromYear = 2026) {
  const keys = [];
  for (let y = fromYear; y < fromYear + years; y += 1) {
    for (let w = 1; w <= 52; w += 1) keys.push(`${y}-W${String(w).padStart(2, "0")}`);
  }
  return keys;
}

const mod = await loadRotation();
const keys = weekKeys();
const total = mod.Q_POOL.length;
const fail = [];
const check = (ok, message) => { if (!ok) fail.push(message); };

/* ① 같은 주는 같은 순서다(INV-11). 결정성이 깨지면 나머지 측정이 의미를 잃는다. */
{
  const key = keys[7];
  const a = mod.weeklyQuestionIds(key).join(",");
  const b = mod.weeklyQuestionIds(key).join(",");
  check(a === b, "같은 주차 키가 다른 순서를 냈다 — 결정성 붕괴(INV-11)");
  check(mod.weeklyQuestionIds(keys[8]).join(",") !== a, "다른 주차가 같은 순서를 냈다 — 주간 갱신이 성립하지 않는다");
}

/* ② 1번 자리 도달 — 100년을 돌려도 첫 질문이 못 되는 문항이 있으면 안 된다. */
mod.setDomain(null);
const firstCount = new Map();
for (const key of keys) {
  const ids = mod.weeklyQuestionIds(key);
  check(ids.length === total, `문항 손실: ${ids.length} !== ${total} (${key})`);
  firstCount.set(ids[0], (firstCount.get(ids[0]) || 0) + 1);
}
const never = total - firstCount.size;
const topShare = Math.max(...firstCount.values()) / keys.length;
check(never <= FLOOR.neverFirst, `1번 자리 미도달 문항 ${never} > 하한 ${FLOOR.neverFirst}`);
check(topShare <= FLOOR.topShare, `1번 자리 최대 점유율 ${(topShare * 100).toFixed(2)}% > 하한 ${(FLOOR.topShare * 100).toFixed(2)}%`);

/* ③ 선호 분야가 앞칸에 섞인다 — 다만 한 문항도 버리지 않는다(원장 32 · 손실 계수). */
const rows = [];
for (const domain of mod.DOMAINS) {
  mod.setDomain(domain);
  let firstNear = 0, top5Near = 0, sampled = 0;
  for (const key of keys.slice(0, 520)) {
    const ordered = mod.weightByReading(mod.weeklyQuestionIds(key), key);
    check(ordered.length === total, `가중 후 문항 손실: ${ordered.length} !== ${total} (${domain} ${key})`);
    check(new Set(ordered).size === total, `가중이 문항을 중복시켰다 (${domain} ${key})`);
    const isNear = (id) => mod.BY_ID.get(mod.Q_BY_ID.get(id)?.bookId)?.domain === domain;
    if (isNear(ordered[0])) firstNear += 1;
    top5Near += ordered.slice(0, 5).filter(isNear).length;
    sampled += 1;
  }
  const firstNearRate = firstNear / sampled;
  const top5NearAvg = top5Near / sampled;
  rows.push({ domain, firstNearRate, top5NearAvg });
  check(firstNearRate >= FLOOR.firstNearRate, `${domain}: 1번 자리가 선호 분야일 확률 ${(firstNearRate * 100).toFixed(1)}% < 하한 ${(FLOOR.firstNearRate * 100).toFixed(0)}%`);
  check(top5NearAvg >= FLOOR.top5NearAvg, `${domain}: 앞 5칸 선호 분야 평균 ${top5NearAvg.toFixed(2)} < 하한 ${FLOOR.top5NearAvg.toFixed(2)}`);
}

console.log(`질문 ${total} · 주차 ${keys.length}`);
console.log(`1번 자리 미도달 ${never} · 최대 점유율 ${(topShare * 100).toFixed(2)}%`);
for (const row of rows) {
  console.log(`  ${row.domain.padEnd(6)} 1번 ${(row.firstNearRate * 100).toFixed(1).padStart(5)}% · 앞5칸 ${row.top5NearAvg.toFixed(2)}`);
}

if (fail.length) {
  console.error(`\n주간 질문 회전 게이트 실패 ${fail.length}건`);
  for (const message of fail) console.error(`  - ${message}`);
  process.exit(1);
}
console.log("주간 질문 회전 게이트 OK");
