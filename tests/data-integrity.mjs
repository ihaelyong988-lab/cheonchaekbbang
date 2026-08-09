import assert from "node:assert/strict";
import { principleQuoteQuestion } from "../data/celeb-books-2025.js";
import { readFile } from "node:fs/promises";
import { BOOKS, DOMAIN_TARGETS, DOMAINS, JOURNEYS } from "../data/books.js";
import {
  CELEB_BOOKS,
  CELEB_EXISTING_ENRICHMENTS,
  CELEB_NEW_TOTAL,
  CELEB_SOURCE_TOTAL,
  CELEB_UNIQUE_TOTAL,
} from "../data/celeb-books-2025.js";

assert.equal(CELEB_SOURCE_TOTAL, 66, "인생책 시트 66행만 보존해야 합니다.");
assert.equal(CELEB_UNIQUE_TOTAL, 65, "동일 작품 Good to Great 두 행은 한 작품으로 합쳐야 합니다.");
assert.equal(CELEB_NEW_TOTAL, 56, "신규 작품 수가 예상과 다릅니다.");
assert.equal(Object.keys(CELEB_EXISTING_ENRICHMENTS).length, 9, "기존 ID 결합 수가 예상과 다릅니다.");
assert.equal(BOOKS.length, 175, "최종 앱 도서 수가 예상과 다릅니다.");
assert.equal(new Set(BOOKS.map((book) => book.id)).size, BOOKS.length, "도서 id가 중복됩니다.");
assert.equal(
  new Set(BOOKS.map((book) => book.title.replace(/[\s,·.]/g, "").toLocaleLowerCase("ko-KR"))).size,
  BOOKS.length,
  "정규화 제목이 중복됩니다."
);

/* 배포 검사(`test:production`)는 `npm test` 체인 밖이라 로컬에서 한 번도 돌지 않는다.
   그 안에 박힌 카탈로그 수치가 데이터와 어긋나면 배포 직후에야 빨강이 된다 — §9 E-015 와 같은
   실패 모드다. 지점을 열거하는 대신 실제 데이터와 대조해 드리프트를 여기서 잡는다. */
{
  const smoke = await readFile(new URL("./production-smoke.mjs", import.meta.url), "utf8");
  const declared = smoke.match(/\[(\d+),\s*(\d+)\]/u);
  assert.ok(declared, "production-smoke 의 카탈로그 수치 선언을 찾지 못했습니다.");
  assert.deepEqual(
    [Number(declared[1]), Number(declared[2])],
    [BOOKS.length, BOOKS.reduce((sum, book) => sum + book.questions.length, 0)],
    "production-smoke 의 도서·질문 수가 실제 데이터와 어긋납니다(배포 후에야 빨강이 됩니다)."
  );
}

const byId = new Map(BOOKS.map((book) => [book.id, book]));
for (const book of BOOKS) {
  assert.ok(DOMAINS.includes(book.domain), `${book.id}: 허용되지 않은 분야`);
  assert.ok(book.principle, `${book.id}: 핵심 원리 누락`);
  assert.ok(book.questions.length >= 3, `${book.id}: 질문 3개 미만`);
  assert.ok(book.questions.every((question) => question.text && question.source), `${book.id}: 질문 또는 출처 누락`);
  assert.ok(book.questions.every((question) => question.text.length <= 44), `${book.id}: 홈 2줄 기준 초과 질문`);
  if (book.tier === "root") {
    assert.deepEqual(book.roots, [], `${book.id}: 뿌리 고전 roots 불일치`);
    continue;
  }
  assert.ok(book.roots.length > 0 && book.root_reason, `${book.id}: 계보 연결 누락`);
  let current = book;
  const seen = new Set();
  while (current.tier !== "root") {
    assert.ok(!seen.has(current.id), `${book.id}: 계보 순환`);
    seen.add(current.id);
    current = byId.get(current.roots[0]);
    assert.ok(current, `${book.id}: 고아 계보`);
  }
}

assert.ok(CELEB_BOOKS.every((book) => book.questions.length === 4), "Celeb 신규 책은 질문 4개여야 합니다.");
assert.equal(
  CELEB_BOOKS.filter((book) => book.celeb2025.verificationStatus === "source-text-retained").length,
  4,
  "서지 확인 불가 항목은 원문 보존 상태로 표시해야 합니다."
);
const verifiedCorrection = byId.get("later-youth-leaving");
assert.deepEqual(
  [verifiedCorrection.title, verifiedCorrection.author, verifiedCorrection.era, verifiedCorrection.celeb2025.verificationStatus],
  ["느린 청춘, 문득 떠남", "티어라이너", "2013", "verified-correction"],
  "검증된 서지 교정이 반영되어야 합니다."
);
for (const id of Object.keys(CELEB_EXISTING_ENRICHMENTS)) {
  assert.ok(byId.get(id).questions.length >= 4, `${id}: 기존 책 질문 보강 누락`);
}

const tierRank = { root: 0, trunk: 1, branch: 2 };
assert.equal(JOURNEYS.length, DOMAINS.length, "분야별 여정은 하나씩 있어야 합니다.");
assert.equal(new Set(JOURNEYS.map((journey) => journey.id)).size, JOURNEYS.length, "여정 id가 중복됩니다.");
for (const journey of JOURNEYS) {
  assert.ok(DOMAINS.includes(journey.domain), `${journey.id}: 허용되지 않은 여정 분야`);
  assert.ok(journey.question.text && journey.question.source, `${journey.id}: 여정 질문 출처 누락`);
  assert.ok(journey.bookIds.length >= 4 && journey.bookIds.length <= 5, `${journey.id}: 여정은 4~5권이어야 합니다.`);
  assert.equal(new Set(journey.bookIds).size, journey.bookIds.length, `${journey.id}: 여정 책 중복`);
  const journeyBooks = journey.bookIds.map((id) => byId.get(id));
  assert.ok(journeyBooks.every(Boolean), `${journey.id}: 존재하지 않는 책`);
  assert.ok(journeyBooks.every((book) => book.domain === journey.domain), `${journey.id}: 분야가 다른 책`);
  assert.equal(journeyBooks[0].tier, "root", `${journey.id}: 첫 책은 뿌리여야 합니다.`);
  for (let index = 1; index < journeyBooks.length; index += 1) {
    assert.ok(tierRank[journeyBooks[index - 1].tier] <= tierRank[journeyBooks[index].tier], `${journey.id}: 뿌리→줄기→가지 순서 위반`);
  }
}

assert.deepEqual(Object.keys(DOMAIN_TARGETS), DOMAINS, "분야 목표의 순서와 이름이 앱 분야와 같아야 합니다.");
assert.equal(Object.values(DOMAIN_TARGETS).reduce((sum, count) => sum + count, 0), 1000, "분야 목표 합계는 1,000권이어야 합니다.");
for (const domain of DOMAINS) {
  assert.ok(BOOKS.filter((book) => book.domain === domain).length <= DOMAIN_TARGETS[domain], `${domain}: 현재 목록이 확장 목표를 초과합니다.`);
}

const questionTexts = BOOKS.flatMap((book) => book.questions.map((question) => question.text));
assert.equal(new Set(questionTexts.map((text) => text.replace(/\s+/gu, " ").trim())).size, questionTexts.length, "질문 문구가 중복됩니다.");
assert.ok(questionTexts.every((text) => !/내 삶에서 바꿀 한 가지/u.test(text)), "일괄 생성형 질문 문구가 남아 있습니다.");

/* G-10 인용 질문 종결 (§11-2, §10-2 원장 2) — 전수 판정.
   원문보다 짧은 접두를 인용하면 반드시 말줄임표로 닫고, 절단 지점은 어절 경계여야 한다.
   원문 전문 인용은 절단이 아니므로 대상에서 제외한다. 정규화는 생성부와 같은 규칙을 여기서 다시 쓴다. */
const statementText = (value) => String(value).replace(/[.!?]$/u, "").replace(/\s+/gu, " ");
let quotedPrefixCount = 0;
for (const book of BOOKS) {
  const statements = [book.principle, book.root_reason].filter(Boolean).map(statementText);
  for (const question of book.questions) {
    const quoted = /^“([^”]*)”/u.exec(question.text);
    if (!quoted) continue;
    const body = quoted[1];
    const core = body.endsWith("…") ? body.slice(0, -1) : body;
    const statement = statements.find((text) => text.startsWith(core) && core.length < text.length);
    if (!statement) continue;
    quotedPrefixCount += 1;
    assert.ok(body.endsWith("…"), `${book.id}: 원문 접두 인용이 말줄임표로 끝나지 않습니다 — ${question.text}`);
    assert.ok(!core.endsWith(" "), `${book.id}: 인용부가 공백으로 끝납니다 — ${question.text}`);
    assert.equal(statement.charAt(core.length), " ", `${book.id}: 인용부가 어절 중간에서 잘렸습니다 — ${question.text}`);
  }
}
/* 2026-08-10 — 사람이 쓴 질문이 276개 들어오면서 데이터에는 접두 인용 질문이 0건이 됐다.
   그래도 생성 경로는 AUTHORED_QUESTIONS 에 없는 새 책의 마지막 방어로 남아 있으므로,
   판정 대상을 데이터에서 함수로 옮긴다 — 데이터가 비었다고 규칙 검사를 그만두면 다음 책에서 재발한다. */
{
  const generated = principleQuoteQuestion({
    statement: "품위라는 명분으로 감정을 미룬 선택은 뒤늦게 후회로 돌아온다",
    title: "긴 제목 대체 확인용 책",
    quoteSuffix: "라는 관점은 언제 성립하는가?",
    titleSuffix: "의 핵심 원리는 언제 성립하는가?",
  });
  const quoted = /^“([^”]*)”/u.exec(generated);
  assert.ok(quoted, "생성 경로가 인용 질문을 만들지 못했습니다.");
  assert.ok(quoted[1].endsWith("…"), "원문보다 짧은 접두 인용은 말줄임표로 닫아야 합니다(원장 2).");
  assert.ok(!/\S…$/u.test(quoted[1].replace(/…$/u, "")) || !quoted[1].slice(0, -1).endsWith(" "),
    "절단 지점이 어절 경계가 아닙니다.");
  assert.ok([...generated].length <= 44, "생성 질문이 홈 2줄 기준을 넘습니다.");
}

console.log(JSON.stringify({
  result: "pass",
  sourceSheet: "인생책",
  sourceRows: CELEB_SOURCE_TOTAL,
  sourceUniqueWorks: CELEB_UNIQUE_TOTAL,
  newBooks: CELEB_NEW_TOTAL,
  existingBooksEnriched: Object.keys(CELEB_EXISTING_ENRICHMENTS).length,
  totalBooks: BOOKS.length,
  totalQuestions: BOOKS.reduce((sum, book) => sum + book.questions.length, 0),
  domains: Object.fromEntries(DOMAINS.map((domain) => [
    domain,
    BOOKS.filter((book) => book.domain === domain).length,
  ])),
}, null, 2));
