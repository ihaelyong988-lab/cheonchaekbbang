const TOPIC_GROUPS = [
  { terms: ["돈", "투자", "부", "경제", "시장", "경영", "재무"], domains: ["경제·사회"] },
  { terms: ["삶", "인생", "의미", "행복", "고통", "죽음"], domains: ["철학", "문학"] },
  { terms: ["사랑", "관계", "가족", "우정", "돌봄", "공감"], domains: ["문학", "철학"] },
  { terms: ["정의", "공정", "차별", "자유", "권리", "책임"], domains: ["철학", "경제·사회"] },
  { terms: ["습관", "성장", "배움", "공부", "실천", "변화"], domains: ["철학", "경제·사회"] },
  { terms: ["역사", "전쟁", "권력", "국가", "문명", "정치", "부패"], domains: ["역사", "경제·사회"] },
  { terms: ["과학", "기술", "우주", "생명", "진화", "에너지"], domains: ["과학"] },
  { terms: ["예술", "문학", "그림", "아름다움", "창작", "상상"], domains: ["예술", "문학"] },
];

const STOP_WORDS = new Set([
  "어떻게", "무엇", "무슨", "왜", "하는가", "인가", "있는가",
  "무엇인가", "어떤가", "일까", "해야", "할까", "대한", "대해", "질문", "책", "우리", "나는",
]);

const GENERIC_QUESTION = /내 삶에서 바꿀 한 가지|핵심 원리는 어떤 조건/;

export function normalizeSearchText(value) {
  return String(value)
    .toLocaleLowerCase("ko-KR")
    .normalize("NFKC")
    .replace(/[^0-9a-z가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryIntent(input) {
  const query = normalizeSearchText(input);
  const normalizedTerms = query.split(" ").map((term) => term
    .replace(/(으로|에서|에게|부터|까지|처럼|보다|은|는|이|가|을|를|과|와|의|로)$/u, ""));
  const direct = [...new Set(normalizedTerms
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term)
      && !/(하는가|되는가|있는가|없는가|지는가)$/u.test(term)))];
  const groups = TOPIC_GROUPS.filter((group) => group.terms.some((term) => query.includes(term)));
  const anchors = [...new Set(groups.flatMap((group) => group.terms.filter((term) => query.includes(term))))];
  const related = [...new Set(groups.flatMap((group) => group.terms)
    .filter((term) => !direct.includes(term) && !anchors.includes(term)))];
  const domains = new Set(groups.flatMap((group) => group.domains));
  return { query, direct, anchors, related, domains };
}

function scoreText(intent, text) {
  const target = normalizeSearchText(text);
  if (!target) return { score: 0, matched: false };
  let score = intent.query.length > 3 && target.includes(intent.query) ? 20 : 0;
  let matched = score > 0;
  for (const term of intent.anchors) {
    if (!target.includes(term)) continue;
    score += Math.min(14, term.length * 3 + 4);
    matched = true;
  }
  for (const term of intent.direct) {
    if (!target.includes(term)) continue;
    score += Math.min(10, term.length * 2 + 2);
    matched = true;
  }
  for (const term of intent.related) {
    if (!target.includes(term)) continue;
    score += Math.min(4, term.length + 1);
    matched = true;
  }
  return { score, matched };
}

export function createQuestionSearch(books) {
  const index = books.map((book) => ({
    book,
    titleAuthorDomain: `${book.title} ${book.author} ${book.domain}`,
    questions: book.questions.map((question) => ({ question, text: question.text })),
  }));

  return (input, limit = 8) => {
    const intent = queryIntent(input);
    if (intent.query.length < 2 || intent.direct.length === 0) return [];

    return index.map(({ book, titleAuthorDomain, questions }) => {
      const matches = questions.map(({ question, text }) => {
        const result = scoreText(intent, text);
        const genericPenalty = GENERIC_QUESTION.test(text) ? 8 : 0;
        return { question, score: Math.max(0, result.score - genericPenalty), matched: result.matched };
      }).sort((a, b) => b.score - a.score);
      const best = matches[0];
      const principle = scoreText(intent, book.principle);
      const identity = scoreText(intent, titleAuthorDomain);
      const hasTextMatch = best?.matched || principle.matched || identity.matched;
      const domainAdjustment = intent.domains.size === 0
        ? 0
        : intent.domains.has(book.domain) ? 10 : -8;
      const score = (best?.score || 0) * 2.4 + principle.score * 1.7 + identity.score * 1.5
        + (hasTextMatch ? domainAdjustment : 0);
      return { book, score, matchedQuestion: best?.question, hasTextMatch };
    })
      .filter((item) => item.hasTextMatch && item.score >= 10)
      .sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title, "ko"))
      .slice(0, limit);
  };
}
