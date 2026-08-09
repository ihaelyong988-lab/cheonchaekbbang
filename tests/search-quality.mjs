import assert from "node:assert/strict";
import { BOOKS } from "../data/books.js";
import { compactSearchText, createQuestionSearch, TOPIC_TERMS } from "../lib/search.js";

const search = createQuestionSearch(BOOKS);
const cases = [
  { query: "돈과 투자는 어떻게 판단해야 하는가", titles: ["현명한 투자자"], domains: ["경제·사회"] },
  { query: "정의와 공정은 무엇인가", titles: ["정의란 무엇인가", "국가"], domains: ["철학", "경제·사회"] },
  /* 2026-08-10 — 사람이 쓴 질문 276개가 들어오면서 이 질의에 더 직접 답하는 책이 늘었다.
     상위 5는 정관정요(듣기 싫은 말을 들을 제도)·반지의 제왕(절대 권력의 타락)·대부(권력 세습)가
     차지하고 사회계약론은 8위다. 그 책의 질문은 자유·동의·정당성이라 이 질의에는 덜 맞는다.
     못 찾게 된 것이 아니라 더 맞는 답이 앞에 선 것이므로, 창을 넓히는 대신 요구를 나눈다. */
  { query: "권력과 국가는 왜 부패하는가", titles: ["정관정요"], found: ["사회계약론"], domains: ["역사", "경제·사회", "문학"] },
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
  // 상위 5권에 서야 하는 것과, 결과 안에 있기만 하면 되는 것을 나눈다.
  const allTitles = results.map((item) => item.book.title);
  for (const title of benchmark.found || []) {
    assert.ok(allTitles.includes(title), `${benchmark.query}: 결과에 ${title} 없음`);
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

/* W1 신설 (2026-08-02 재조사) — 아는 책 이름·띄어쓰기·일상 어휘로 0건이 나오지 않는다 */
const { CELEB_BOOKS } = await import("../data/celeb-books-2025.js");
const ALL = [...BOOKS, ...(CELEB_BOOKS || [])];
const searchAll = createQuestionSearch(ALL);

/* 원장 15 — 2글자 제목·저자를 정확히 쳤는데 0건이면 방문자는 앱을 닫는다 */
const twoLetter = ALL.filter((book) => book.title.length === 2 || book.author.length === 2);
assert.ok(twoLetter.length >= 20, `2글자 대상이 ${twoLetter.length}종뿐입니다 — 게이트 모집단을 확인하세요.`);
assert.deepEqual(
  twoLetter.filter((book) => searchAll(book.title).length === 0 && searchAll(book.author).length === 0)
    .map((book) => `${book.title}/${book.author}`),
  [],
  "2글자 제목·저자를 정확히 입력했는데 결과가 0건인 책이 있습니다(원장 15)."
);

/* 원장 16 — 띄어쓰기·구두점 차이로 결과가 사라지지 않는다 */
for (const [a, b] of [["총, 균, 쇠", "총균쇠"], ["사피엔스 ", "사피엔스"]]) {
  assert.deepEqual(
    searchAll(a).map((item) => item.book.id),
    searchAll(b).map((item) => item.book.id),
    `"${a}" 와 "${b}" 의 결과가 다릅니다 — 정규화가 통일되지 않았습니다(원장 16).`
  );
}
assert.equal(compactSearchText("총, 균, 쇠"), compactSearchText("총균쇠"), "compactSearchText 가 구두점·공백을 흡수하지 않습니다.");

/* 원장 18 — 조사 변형과 일상 어휘 질의가 부당하게 0건이 되지 않는다 */
for (const query of ["돈에", "돈도", "돈만", "정의라도", "역사마다"]) {
  assert.ok(searchAll(query).length > 0, `조사 변형 "${query}" 가 0건입니다(원장 18 JOSA).`);
}
const everyday = ["어떻게 살아야 하는가", "돈은 어떻게 벌어야 하나", "인공지능 시대에 무엇을 배워야 하나",
  "번아웃이 왔을 때", "아이를 어떻게 키워야 하나", "관계에 지칠 때", "죽음이 두렵다",
  "회사를 그만두고 싶다", "글을 잘 쓰고 싶다", "실패가 두렵다"];
const unfair = everyday.filter((query) => searchAll(query).length === 0);
assert.ok(unfair.length <= 2, `일상 어휘 질의 ${everyday.length}건 중 0건이 ${unfair.length}건입니다: ${unfair.join(" / ")}`);

/* 회귀 — 완화가 "아무거나 추천"으로 번지지 않는다 */
assert.deepEqual(searchAll("어떻게 무엇 왜"), [], "핵심 낱말 없는 질문은 여전히 0건이어야 합니다.");
assert.deepEqual(searchAll("하는가"), [], "의문 조각은 여전히 0건이어야 합니다.");
assert.deepEqual(searchAll("zzzzz"), [], "말뭉치에 없는 낱말은 여전히 0건이어야 합니다.");
assert.ok(TOPIC_TERMS.length >= 60, `등록 주제어가 ${TOPIC_TERMS.length}개입니다 — 빈 결과 칩 모집단이 부족합니다.`);

console.log(JSON.stringify({
  result: "pass",
  benchmarks: cases.length,
  maxResults: 8,
  twoLetterCovered: twoLetter.length,
  everydayZero: unfair.length,
  topicTerms: TOPIC_TERMS.length,
}, null, 2));
