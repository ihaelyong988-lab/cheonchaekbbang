import assert from "node:assert/strict";
import { BOOKS, DOMAINS } from "../data/books.js";
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

const byId = new Map(BOOKS.map((book) => [book.id, book]));
for (const book of BOOKS) {
  assert.ok(DOMAINS.includes(book.domain), `${book.id}: 허용되지 않은 분야`);
  assert.ok(book.principle, `${book.id}: 핵심 원리 누락`);
  assert.ok(book.questions.length > 0, `${book.id}: 질문 누락`);
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
  5,
  "서지 확인 불가 항목은 원문 보존 상태로 표시해야 합니다."
);
for (const id of Object.keys(CELEB_EXISTING_ENRICHMENTS)) {
  assert.ok(byId.get(id).questions.length >= 4, `${id}: 기존 책 질문 보강 누락`);
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
