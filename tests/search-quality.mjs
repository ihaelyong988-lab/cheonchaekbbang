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

// 구조적 개선 회귀 (v1.7.5): 형태소 토큰 매칭·도메인 가중·인식론 어휘·1자 안정성
// ① 부분문자열 오탐 제거: '부'(富)가 '공부'에 걸리지 않고, 분야 의도가 정본을 상위로 올린다.
assert.ok(
  search("부는 어떻게 쌓이는가").slice(0, 3).every((item) => item.book.domain === "경제·사회"),
  "'부'(富) 질의 상위 3권은 경제·사회여야 합니다('공부' 부분문자열 오탐 금지)."
);
assert.equal(
  search("공부는 어떻게 하는가")[0]?.book.title, "거인의 공부",
  "'공부' 질의는 '부'(富) 오발동 없이 공부 주제서를 최상위로 올려야 합니다."
);
assert.ok(
  search("문명은 어떻게 흥망하는가").slice(0, 3).every((item) => item.book.domain === "역사"),
  "'문명 흥망' 질의 상위 3권은 역사여야 합니다(타 분야 우발 매칭 금지)."
);
// ② 인식론·윤리 어휘로 철학 정전서 재현율 확보.
assert.equal(
  search("이성과 도덕은 무엇인가")[0]?.book.domain, "철학",
  "'이성과 도덕' 질의 최상위는 철학이어야 합니다."
);
assert.ok(
  search("우리는 무엇을 확실하게 알 수 있는가").length > 0,
  "인식론 자연 질의가 빈 결과가 되면 안 됩니다."
);
// ③ 등록된 1자 주제어는 조사 유무와 무관하게 결과를 낸다.
assert.ok(
  search("돈").length > 0 && search("돈")[0].book.domain === "경제·사회",
  "1자 주제어 '돈'도 경제·사회 결과를 내야 합니다(0↔8권 불안정 금지)."
);

console.log(JSON.stringify({ result: "pass", benchmarks: cases.length, maxResults: 8 }, null, 2));
