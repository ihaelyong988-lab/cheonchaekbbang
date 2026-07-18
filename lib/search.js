const TOPIC_GROUPS = [
  { terms: ["돈", "투자", "부", "경제", "시장", "경영", "재무"], domains: ["경제·사회"] },
  { terms: ["삶", "인생", "의미", "행복", "고통", "죽음"], domains: ["철학", "문학"] },
  { terms: ["사랑", "관계", "가족", "우정", "돌봄", "공감"], domains: ["문학", "철학"] },
  { terms: ["정의", "공정", "차별", "자유", "권리", "책임"], domains: ["철학", "경제·사회"] },
  { terms: ["습관", "성장", "배움", "공부", "실천", "변화"], domains: ["철학", "경제·사회"] },
  { terms: ["역사", "전쟁", "권력", "국가", "문명", "정치", "부패"], domains: ["역사", "경제·사회"] },
  { terms: ["과학", "기술", "우주", "생명", "진화", "에너지"], domains: ["과학"] },
  { terms: ["예술", "문학", "그림", "아름다움", "창작", "상상"], domains: ["예술", "문학"] },
  { terms: ["지식", "이성", "진리", "인식", "지혜", "논리", "도덕", "윤리", "양심", "확실"], domains: ["철학"] },
];

const STOP_WORDS = new Set([
  "어떻게", "무엇", "무슨", "왜", "하는가", "인가", "있는가",
  "무엇인가", "어떤가", "일까", "해야", "할까", "대한", "대해", "질문", "책", "우리", "나는",
]);

const GENERIC_QUESTION = /내 삶에서 바꿀 한 가지|핵심 원리는 어떤 조건/;
const JOSA = /(으로|에서|에게|부터|까지|처럼|보다|이란|란|은|는|이|가|을|를|과|와|의|로)$/u;
const INTERROGATIVE = /(하는가|되는가|있는가|없는가|지는가)$/u;

export function normalizeSearchText(value) {
  return String(value)
    .toLocaleLowerCase("ko-KR")
    .normalize("NFKC")
    .replace(/[^0-9a-z가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 조사를 떼되, 제거가 과해 한 글자만 남으면(예: "정의"→"정") 원 토큰을 보존한다(direct 토큰용).
function stripJosa(term) {
  const stripped = term.replace(JOSA, "");
  return stripped.length >= 2 ? stripped : term;
}
// 조사를 전부 떼어 형태소 토큰을 만든다(한 글자 허용). 토큰 경계 매칭용.
function bareToken(term) {
  return term.replace(JOSA, "");
}
function bareTokenSet(target) {
  return new Set(target.split(" ").filter(Boolean).map(bareToken));
}

// 한 글자 주제어(돈·부·삶…)는 형태소 토큰으로만 매칭해 '부'(富)가 '공부'에 우연히
// 걸리는 부분문자열 오탐을 막는다. 두 글자 이상은 부분문자열 매칭으로 재현율을 지킨다.
function termHits(term, target, bareSet) {
  return term.length >= 2 ? target.includes(term) : bareSet.has(term);
}

function queryIntent(input) {
  const query = normalizeSearchText(input);
  const rawTokens = query.split(" ").filter(Boolean);
  const bareSet = new Set(rawTokens.map(bareToken));
  const direct = [...new Set(rawTokens
    .map((raw) => ({ raw, term: stripJosa(raw) }))
    .filter(({ raw, term }) => term.length > 1
      && !STOP_WORDS.has(term) && !STOP_WORDS.has(raw)
      && !INTERROGATIVE.test(term) && !INTERROGATIVE.test(raw))
    .map(({ term }) => term))];
  const inQuery = (term) => (term.length >= 2 ? query.includes(term) : bareSet.has(term));
  const groups = TOPIC_GROUPS.filter((group) => group.terms.some(inQuery));
  const anchors = [...new Set(groups.flatMap((group) => group.terms.filter(inQuery)))];
  const related = [...new Set(groups.flatMap((group) => group.terms)
    .filter((term) => !direct.includes(term) && !anchors.includes(term)))];
  const domains = new Set(groups.flatMap((group) => group.domains));
  return { query, direct, anchors, related, domains };
}

function scoreText(intent, target, bareSet) {
  if (!target) return { score: 0, matched: false };
  let score = intent.query.length > 3 && target.includes(intent.query) ? 20 : 0;
  let matched = score > 0;
  for (const term of intent.anchors) {
    if (!termHits(term, target, bareSet)) continue;
    score += Math.min(14, term.length * 3 + 4);
    matched = true;
  }
  for (const term of intent.direct) {
    if (!termHits(term, target, bareSet)) continue;
    score += Math.min(10, term.length * 2 + 2);
    matched = true;
  }
  for (const term of intent.related) {
    if (!termHits(term, target, bareSet)) continue;
    score += Math.min(4, term.length + 1);
    matched = true;
  }
  return { score, matched };
}

function indexText(text) {
  const target = normalizeSearchText(text);
  return { target, bareSet: bareTokenSet(target) };
}

export function createQuestionSearch(books) {
  const index = books.map((book) => ({
    book,
    identity: indexText(`${book.title} ${book.author} ${book.domain}`),
    principle: indexText(book.principle),
    questions: book.questions.map((question) => ({ question, ...indexText(question.text) })),
  }));

  return (input, limit = 8) => {
    const intent = queryIntent(input);
    // 등록된 주제어(앵커)면 한 글자 질의도 허용해 '돈'↔'돈은' 0↔8권 불안정을 없앤다.
    if (intent.query.length < 2 && intent.anchors.length === 0) return [];
    if (intent.direct.length === 0 && intent.anchors.length === 0) return [];

    return index.map(({ book, identity, principle, questions }) => {
      const matches = questions.map(({ question, target, bareSet }) => {
        const result = scoreText(intent, target, bareSet);
        const genericPenalty = GENERIC_QUESTION.test(question.text) ? 8 : 0;
        return { question, score: Math.max(0, result.score - genericPenalty), matched: result.matched };
      }).sort((a, b) => b.score - a.score);
      const best = matches[0];
      const principleScore = scoreText(intent, principle.target, principle.bareSet);
      const identityScore = scoreText(intent, identity.target, identity.bareSet);
      const hasTextMatch = best?.matched || principleScore.matched || identityScore.matched;
      const base = (best?.score || 0) * 2.4 + principleScore.score * 1.7 + identityScore.score * 1.5;
      // 도메인 의도가 뚜렷하면 곱셈 가중: 같은 분야는 살짝 올리고, 다른 분야가 주제어를
      // 한 번 언급했다는 이유만으로 정본을 앞서지 못하도록 크게 낮춘다.
      const domainFactor = intent.domains.size === 0
        ? 1
        : intent.domains.has(book.domain) ? 1.15 : 0.55;
      const score = hasTextMatch ? base * domainFactor : base;
      return { book, score, matchedQuestion: best?.question, hasTextMatch };
    })
      .filter((item) => item.hasTextMatch && item.score >= 10)
      .sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title, "ko"))
      .slice(0, limit);
  };
}
