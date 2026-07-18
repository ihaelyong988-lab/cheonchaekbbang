import assert from "node:assert/strict";
import { BOOKS } from "../data/books.js";
import { createQuestionSearch } from "../lib/search.js";

const search = createQuestionSearch(BOOKS);
const cases = [
  { query: "돈과 투자는 어떻게 판단해야 하는가", titles: ["현명한 투자자"], domains: ["경제·사회"] },
  { query: "정의와 공정은 무엇인가", titles: ["정의란 무엇인가", "국가"], domains: ["철학", "경제·사회"] },
  { query: "권력과 국가는 왜 부패하는가", titles: ["사회계약론", "정관정요"], domains: ["역사", "경제·사회", "문학"] },
  { query: "우주는 어떻게 시작되었는가", titles: ["시간의 역사", "코스모스"], domains: ["과학", "문학"] },
  { query: "사랑과 관계는 사람을 어떻게 바꾸는가", titles: ["노르웨이의 숲"], domains: ["문학", "철학"] },
  { query: "아름다움과 예술은 누가 판단하는가", titles: ["판단력비판"], domains: ["예술", "문학"] },
];

for (const benchmark of cases) {
  const results = search(benchmark.query);
  assert.ok(results.length > 0 && results.length <= 8, `${benchmark.query}: 결과 수 오류`);
  assert.ok(results.every((item) => item.book && item.matchedQuestion?.text), `${benchmark.query}: 연결 질문 누락`);
  const topTitles = results.slice(0, 5).map((item) => item.book.title);
  for (const title of benchmark.titles) {
    assert.ok(topTitles.includes(title), `${benchmark.query}: 상위 5권에 ${title} 누락`);
  }
  assert.ok(
    results.slice(0, 3).every((item) => benchmark.domains.includes(item.book.domain)),
    `${benchmark.query}: 상위 3권 분야 오탐`
  );
}

assert.deepEqual(search("a"), [], "두 글자 미만 입력은 검색하지 않아야 합니다.");
assert.deepEqual(search("어떻게 무엇 왜"), [], "핵심 낱말이 없는 질문은 임의 추천하지 않아야 합니다.");

// 경계 개선 회귀 (v1.7.4): 2자 핵심어 절단·의문 조각·조사 정규화
assert.ok(
  search("정의").slice(0, 5).map((item) => item.book.title).includes("정의란 무엇인가"),
  "2자 핵심어 '정의'는 조사 과다절단으로 빈 결과가 되면 안 됩니다."
);
assert.deepEqual(search("하는가"), [], "의문 조각 '하는가'는 임의 추천하지 않아야 합니다.");
assert.deepEqual(
  search("정의란").map((item) => item.book.title),
  search("정의").map((item) => item.book.title),
  "'정의란'은 '정의'와 동일한 결과여야 합니다(란/이란 조사 정규화)."
);

console.log(JSON.stringify({ result: "pass", benchmarks: cases.length, maxResults: 8 }, null, 2));
