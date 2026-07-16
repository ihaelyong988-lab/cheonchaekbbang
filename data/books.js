// 천책빵 핵심 계보 60권 + 리서치 실측 목록 신규 59권
// + Celeb 인생책 추천 2025년 신규 56권.
// 중복 작품은 기존 id에 근거와 질문을 결합해 로컬 기록을 보존한다.

import { RESEARCH_BOOKS, RESEARCH_BY_BOOK_ID } from "./research-books.js";
import { CELEB_BOOKS, CELEB_EXISTING_ENRICHMENTS } from "./celeb-books-2025.js";

export const DOMAINS = ["철학", "역사", "과학", "문학", "경제·사회", "예술"];

const CORE_BOOKS = [
  // ── 철학 (뿌리 4 · 줄기 3 · 가지 3) ─────────────────────────
  {
    id: "lunyu", title: "논어", author: "공자", era: "BC 5세기", domain: "철학", tier: "root",
    principle: "배움을 때에 맞게 익히는 것이 앎의 시작이다.",
    questions: [{ text: "남이 나를 알아주지 않아도 성내지 않을 수 있는가?", source: "『논어』 학이편" }],
    roots: [], root_reason: ""
  },
  {
    id: "plato-republic", title: "국가", author: "플라톤", era: "BC 4세기", domain: "철학", tier: "root",
    principle: "정의는 각자가 제 몫의 일을 하는 데 있다.",
    questions: [{ text: "정의란 강자의 이익에 불과한가?", source: "『국가』 1권, 트라시마코스의 도전" }],
    roots: [], root_reason: ""
  },
  {
    id: "aristotle-ethics", title: "니코마코스 윤리학", author: "아리스토텔레스", era: "BC 4세기", domain: "철학", tier: "root",
    principle: "행복은 탁월함에 따른 영혼의 활동이다.",
    questions: [{ text: "행복은 쾌락인가, 탁월함의 활동인가?", source: "『니코마코스 윤리학』 1권" }],
    roots: [], root_reason: ""
  },
  {
    id: "daodejing", title: "도덕경", author: "노자", era: "BC 4세기경", domain: "철학", tier: "root",
    principle: "억지로 하지 않음으로써 이루지 못할 것이 없다.",
    questions: [{ text: "말로 규정한 도는 참된 도인가?", source: "『도덕경』 1장" }],
    roots: [], root_reason: ""
  },
  {
    id: "mencius", title: "맹자", author: "맹자", era: "BC 3세기", domain: "철학", tier: "trunk",
    principle: "사람의 본성은 선하며, 측은지심이 그 증거다.",
    questions: [{ text: "우물에 빠지려는 아이 앞에서 누구나 놀라는 까닭은 무엇인가?", source: "『맹자』 공손추 상" }],
    roots: ["lunyu"], root_reason: "공자의 인(仁)을 인간 본성의 차원으로 밀고 나갔다."
  },
  {
    id: "kant-critique", title: "순수이성비판", author: "이마누엘 칸트", era: "1781", domain: "철학", tier: "trunk",
    principle: "대상이 인식을 따르는 것이지, 인식이 대상을 따르는 것이 아니다.",
    questions: [{ text: "우리는 무엇을 알 수 있는가?", source: "『순수이성비판』 서문" }],
    roots: ["plato-republic"], root_reason: "이성이 붙잡는 참된 실재라는 물음은 플라톤의 이데아론에서 출발했다."
  },
  {
    id: "descartes-method", title: "방법서설", author: "르네 데카르트", era: "1637", domain: "철학", tier: "trunk",
    principle: "모든 것을 의심해도 의심하는 나는 남는다.",
    questions: [{ text: "의심할 수 없는 단 하나의 출발점은 무엇인가?", source: "『방법서설』 4부" }],
    roots: ["plato-republic"], root_reason: "확실한 앎을 향한 이성주의는 플라톤 전통의 근대적 재출발이다."
  },
  {
    id: "sandel-justice", title: "정의란 무엇인가", author: "마이클 샌델", era: "2009", domain: "철학", tier: "branch",
    principle: "정의 논쟁은 결국 좋은 삶이 무엇인가의 논쟁이다.",
    questions: [{ text: "다수를 구하기 위해 한 사람을 희생시켜도 되는가?", source: "『정의란 무엇인가』 1강" }],
    roots: ["aristotle-ethics"], root_reason: "좋은 삶과 미덕에서 정의를 찾는 접근은 아리스토텔레스 목적론의 계승이다."
  },
  {
    id: "weiner-socrates", title: "소크라테스 익스프레스", author: "에릭 와이너", era: "2020", domain: "철학", tier: "branch",
    principle: "철학은 정보가 아니라 삶의 기술이다.",
    questions: [{ text: "잘 산다는 것은 무엇을 묻는 일에서 시작하는가?", source: "『소크라테스 익스프레스』" }],
    roots: ["plato-republic"], root_reason: "철학자를 삶의 안내자로 다시 부르는 여정은 소크라테스와 플라톤에서 시작한다."
  },
  {
    id: "yamaguchi-philosophy", title: "철학은 어떻게 삶의 무기가 되는가", author: "야마구치 슈", era: "2019", domain: "철학", tier: "branch",
    principle: "철학 개념은 세상을 읽는 렌즈다.",
    questions: [{ text: "낡은 상식을 의심할 도구를 갖고 있는가?", source: "『철학은 어떻게 삶의 무기가 되는가』" }],
    roots: ["kant-critique"], root_reason: "개념을 현실 판단의 도구로 쓰는 태도는 근대 비판철학의 실용적 응용이다."
  },

  // ── 역사 (뿌리 3 · 줄기 4 · 가지 3) ─────────────────────────
  {
    id: "shiji", title: "사기", author: "사마천", era: "BC 1세기", domain: "역사", tier: "root",
    principle: "인간의 행적을 기록해 하늘의 뜻을 묻는다.",
    questions: [{ text: "하늘의 도는 과연 옳은가, 그른가?", source: "『사기』 백이열전" }],
    roots: [], root_reason: ""
  },
  {
    id: "herodotus", title: "역사", author: "헤로도토스", era: "BC 5세기", domain: "역사", tier: "root",
    principle: "탐구로 인간이 이룬 일들이 잊히지 않게 한다.",
    questions: [{ text: "사람의 행복은 죽기 전에 판단할 수 있는가?", source: "『역사』 1권, 솔론과 크로이소스" }],
    roots: [], root_reason: ""
  },
  {
    id: "thucydides", title: "펠로폰네소스 전쟁사", author: "투키디데스", era: "BC 5세기", domain: "역사", tier: "root",
    principle: "역사는 인간 본성이 반복시키는 사건의 기록이다.",
    questions: [{ text: "강자는 할 수 있는 일을 하고, 약자는 당해야 할 일을 당할 뿐인가?", source: "『펠로폰네소스 전쟁사』 5권, 멜로스 대화" }],
    roots: [], root_reason: ""
  },
  {
    id: "jingbirok", title: "징비록", author: "유성룡", era: "1604", domain: "역사", tier: "trunk",
    principle: "지난 잘못을 기록하는 것이 다음 환란을 막는 길이다.",
    questions: [{ text: "우리는 같은 실패를 왜 되풀이하는가?", source: "『징비록』 자서" }],
    roots: ["shiji"], root_reason: "환란의 전말을 기록해 훗날을 경계하는 태도는 사관(史官) 전통의 계승이다."
  },
  {
    id: "gibbon-rome", title: "로마제국 쇠망사", author: "에드워드 기번", era: "1776", domain: "역사", tier: "trunk",
    principle: "번영은 그 안에서 쇠퇴의 원리를 성숙시킨다.",
    questions: [{ text: "위대한 제국은 밖이 아니라 안에서 무너지는가?", source: "『로마제국 쇠망사』" }],
    roots: ["thucydides"], root_reason: "제국의 흥망에서 인간 본성의 법칙을 읽는 시선은 투키디데스의 방법이다."
  },
  {
    id: "yeolha", title: "열하일기", author: "박지원", era: "1780", domain: "역사", tier: "trunk",
    principle: "쓰임을 이롭게 해야 삶이 두터워진다(이용후생).",
    questions: [{ text: "오랑캐라 불러온 문명에서 무엇을 배울 수 있는가?", source: "『열하일기』 도강록" }],
    roots: ["shiji"], root_reason: "견문으로 문명을 기록하고 비평하는 글쓰기는 사마천의 유력(遊歷) 전통에 닿는다."
  },
  {
    id: "carr-history", title: "역사란 무엇인가", author: "E. H. 카", era: "1961", domain: "역사", tier: "trunk",
    principle: "역사는 현재와 과거의 끊임없는 대화다.",
    questions: [{ text: "사실은 스스로 말하는가, 역사가가 말하게 하는가?", source: "『역사란 무엇인가』 1장" }],
    roots: ["herodotus"], root_reason: "역사가는 무엇을 기록하는가라는 물음 자체가 헤로도토스의 탐구에서 출발한다."
  },
  {
    id: "diamond-ggs", title: "총, 균, 쇠", author: "재레드 다이아몬드", era: "1997", domain: "역사", tier: "branch",
    principle: "대륙 간 운명의 차이는 민족성이 아니라 환경과 지리가 갈랐다.",
    questions: [{ text: "왜 어떤 문명은 정복하고, 어떤 문명은 정복당했는가?", source: "『총, 균, 쇠』 프롤로그, 얄리의 질문" }],
    roots: ["carr-history"], root_reason: "문명 격차의 원인을 사료 너머 환경에서 찾는 것은 역사 해석 논쟁의 확장이다."
  },
  {
    id: "sapiens", title: "사피엔스", author: "유발 하라리", era: "2011", domain: "역사", tier: "branch",
    principle: "허구를 함께 믿는 능력이 사피엔스를 지배자로 만들었다.",
    questions: [{ text: "국가와 화폐는 실재하는가, 함께 믿는 이야기인가?", source: "『사피엔스』 2부" }],
    roots: ["carr-history"], root_reason: "종(種) 단위의 거대사 역시 역사를 어떻게 볼 것인가라는 물음의 연장이다."
  },
  {
    id: "choi-usefulness", title: "역사의 쓸모", author: "최태성", era: "2019", domain: "역사", tier: "branch",
    principle: "역사는 사람을 만나 삶의 선택지를 넓히는 공부다.",
    questions: [{ text: "당신이라면 그 순간 어떤 선택을 했겠는가?", source: "『역사의 쓸모』" }],
    roots: ["jingbirok"], root_reason: "역사를 오늘의 결정에 쓰는 태도는 징비(懲毖)의 정신 그대로다."
  },

  // ── 과학 (뿌리 3 · 줄기 3 · 가지 4) ─────────────────────────
  {
    id: "euclid", title: "원론", author: "유클리드", era: "BC 3세기", domain: "과학", tier: "root",
    principle: "소수의 공리에서 모든 지식을 연역한다.",
    questions: [{ text: "증명 없이 받아들여도 되는 전제는 몇 개면 충분한가?", source: "『원론』 1권, 공준" }],
    roots: [], root_reason: ""
  },
  {
    id: "copernicus", title: "천구의 회전에 관하여", author: "니콜라우스 코페르니쿠스", era: "1543", domain: "과학", tier: "root",
    principle: "지구가 아니라 태양을 중심에 두면 하늘의 운동이 단순해진다.",
    questions: [{ text: "우리가 서 있는 땅이 돈다면, 왜 느끼지 못하는가?", source: "『천구의 회전에 관하여』 1권" }],
    roots: [], root_reason: ""
  },
  {
    id: "darwin-origin", title: "종의 기원", author: "찰스 다윈", era: "1859", domain: "과학", tier: "root",
    principle: "변이와 자연선택이 쌓여 종이 갈라진다.",
    questions: [{ text: "이토록 정교한 생명이 설계 없이 생겨날 수 있는가?", source: "『종의 기원』 6장, 이론의 난점" }],
    roots: [], root_reason: ""
  },
  {
    id: "newton-principia", title: "프린키피아", author: "아이작 뉴턴", era: "1687", domain: "과학", tier: "trunk",
    principle: "하늘과 땅의 운동은 같은 법칙을 따른다.",
    questions: [{ text: "사과를 떨어뜨리는 힘이 달도 붙잡고 있는가?", source: "『프린키피아』 3권" }],
    roots: ["euclid"], root_reason: "기하학적 공리와 증명의 방법 위에 천상과 지상의 역학을 통일했다."
  },
  {
    id: "kuhn-structure", title: "과학혁명의 구조", author: "토머스 쿤", era: "1962", domain: "과학", tier: "trunk",
    principle: "과학은 축적이 아니라 패러다임의 교체로 도약한다.",
    questions: [{ text: "과학은 정말 진리를 향해 곧게 나아가는가?", source: "『과학혁명의 구조』" }],
    roots: ["copernicus"], root_reason: "패러다임 전환이라는 개념 자체가 코페르니쿠스 혁명의 분석에서 태어났다."
  },
  {
    id: "einstein-relativity", title: "상대성이론", author: "알베르트 아인슈타인", era: "1916", domain: "과학", tier: "trunk",
    principle: "시간과 공간은 절대적이지 않고 관측자에 따라 달라진다.",
    questions: [{ text: "동시에 일어난 두 사건은 누구에게나 동시인가?", source: "『상대성이론』 특수이론부" }],
    roots: ["newton-principia"], root_reason: "뉴턴 역학의 절대 시공간을 물려받아 그 한계 위에서 다시 세웠다."
  },
  {
    id: "dawkins-gene", title: "이기적 유전자", author: "리처드 도킨스", era: "1976", domain: "과학", tier: "branch",
    principle: "생명체는 유전자의 생존 기계다.",
    questions: [{ text: "이타적 행동도 유전자의 전략인가?", source: "『이기적 유전자』" }],
    roots: ["darwin-origin"], root_reason: "자연선택의 단위를 유전자로 내린 다윈주의의 급진적 확장이다."
  },
  {
    id: "sagan-cosmos", title: "코스모스", author: "칼 세이건", era: "1980", domain: "과학", tier: "branch",
    principle: "우리는 별의 먼지로 만들어진, 스스로를 아는 우주다.",
    questions: [{ text: "이 광대한 우주에서 지구의 자리는 어디인가?", source: "『코스모스』 1장" }],
    roots: ["copernicus"], root_reason: "인간을 우주의 중심에서 내려놓은 전통을 대중의 언어로 완성했다."
  },
  {
    id: "hawking-time", title: "시간의 역사", author: "스티븐 호킹", era: "1988", domain: "과학", tier: "branch",
    principle: "우주에는 시작이 있었고, 그 법칙은 물을 수 있다.",
    questions: [{ text: "시간에는 시작이 있는가?", source: "『시간의 역사』" }],
    roots: ["einstein-relativity"], root_reason: "휘어진 시공간의 우주론을 빅뱅과 블랙홀까지 밀고 간 대중적 정리다."
  },
  {
    id: "kim-quantum", title: "김상욱의 양자 공부", author: "김상욱", era: "2017", domain: "과학", tier: "branch",
    principle: "측정하기 전의 세계는 확률로만 존재한다.",
    questions: [{ text: "보지 않을 때도 달은 그 자리에 있는가?", source: "『김상욱의 양자 공부』" }],
    roots: ["kuhn-structure"], root_reason: "고전 물리의 상식을 뒤집은 양자역학이야말로 패러다임 전환의 실례다."
  },

  // ── 문학 (뿌리 4 · 줄기 3 · 가지 3) ─────────────────────────
  {
    id: "iliad", title: "일리아스", author: "호메로스", era: "BC 8세기", domain: "문학", tier: "root",
    principle: "필멸의 인간이기에 명예와 연민이 값지다.",
    questions: [{ text: "분노는 영웅에게 무엇을 남기는가?", source: "『일리아스』 1권, 아킬레우스의 분노" }],
    roots: [], root_reason: ""
  },
  {
    id: "oedipus", title: "오이디푸스 왕", author: "소포클레스", era: "BC 5세기", domain: "문학", tier: "root",
    principle: "진실을 향한 걸음이 곧 비극의 걸음이다.",
    questions: [{ text: "인간은 제 운명을 피할 수 있는가?", source: "『오이디푸스 왕』, 델포이 신탁" }],
    roots: [], root_reason: ""
  },
  {
    id: "shijing", title: "시경", author: "작자 미상(공자 편찬 전승)", era: "BC 11~7세기", domain: "문학", tier: "root",
    principle: "노래는 꾸밈없는 마음의 기록이다.",
    questions: [{ text: "백성의 노래에서 나라의 마음을 읽을 수 있는가?", source: "『시경』 국풍" }],
    roots: [], root_reason: ""
  },
  {
    id: "quixote", title: "돈키호테", author: "미겔 데 세르반테스", era: "1605", domain: "문학", tier: "root",
    principle: "이야기는 현실과 이상 사이의 인간을 비춘다.",
    questions: [{ text: "미친 것은 기사인가, 꿈을 잃은 세상인가?", source: "『돈키호테』 1부" }],
    roots: [], root_reason: ""
  },
  {
    id: "hamlet", title: "햄릿", author: "윌리엄 셰익스피어", era: "1601", domain: "문학", tier: "trunk",
    principle: "생각은 행동을 창백하게 만든다.",
    questions: [{ text: "견디는 것과 맞서는 것 중 무엇이 더 고귀한가?", source: "『햄릿』 3막 1장" }],
    roots: ["oedipus"], root_reason: "운명과 진실 앞에 선 인간의 비극이라는 형식을 그리스 비극에서 물려받았다."
  },
  {
    id: "crime-punishment", title: "죄와 벌", author: "표도르 도스토옙스키", era: "1866", domain: "문학", tier: "trunk",
    principle: "인간은 벌이 아니라 고백으로 구원된다.",
    questions: [{ text: "비범한 인간에게는 도덕을 넘어설 권리가 있는가?", source: "『죄와 벌』 3부, 라스콜니코프의 논문" }],
    roots: ["oedipus"], root_reason: "죄지은 인간이 진실과 심판을 향해 걸어가는 구조는 비극의 계보다."
  },
  {
    id: "guunmong", title: "구운몽", author: "김만중", era: "1687", domain: "문학", tier: "trunk",
    principle: "부귀영화도 하룻밤 꿈과 같다.",
    questions: [{ text: "지금 이 삶이 꿈이 아니라고 어떻게 확신하는가?", source: "『구운몽』" }],
    roots: ["shijing"], root_reason: "동아시아 시가와 서사 전통 위에서 꿈의 형식으로 욕망을 물었다."
  },
  {
    id: "old-man-sea", title: "노인과 바다", author: "어니스트 헤밍웨이", era: "1952", domain: "문학", tier: "branch",
    principle: "인간은 파괴될 수는 있어도 패배하지는 않는다.",
    questions: [{ text: "아무것도 얻지 못한 싸움에도 의미가 있는가?", source: "『노인과 바다』" }],
    roots: ["iliad"], root_reason: "패배 앞에서도 꺾이지 않는 인간이라는 주제는 호메로스 영웅서사의 현대판이다."
  },
  {
    id: "hundred-years", title: "백년의 고독", author: "가브리엘 가르시아 마르케스", era: "1967", domain: "문학", tier: "branch",
    principle: "고독은 반복되는 역사의 이름이다.",
    questions: [{ text: "가족의 역사는 왜 같은 자리를 맴도는가?", source: "『백년의 고독』" }],
    roots: ["quixote"], root_reason: "현실과 환상을 한 화면에 담는 서사는 세르반테스 이래 스페인어 문학의 계보다."
  },
  {
    id: "demian", title: "데미안", author: "헤르만 헤세", era: "1919", domain: "문학", tier: "branch",
    principle: "새는 알을 깨고 나온다 — 자기에게 이르는 길이 가장 어렵다.",
    questions: [{ text: "내 안의 선과 악 중 어느 쪽이 진짜 나인가?", source: "『데미안』" }],
    roots: ["crime-punishment"], root_reason: "선악의 경계에서 자기를 찾는 내면 서사는 도스토옙스키 심리소설의 자장 안에 있다."
  },

  // ── 경제·사회 (뿌리 3 · 줄기 4 · 가지 3) ─────────────────────
  {
    id: "wealth-nations", title: "국부론", author: "애덤 스미스", era: "1776", domain: "경제·사회", tier: "root",
    principle: "각자의 이익 추구가 보이지 않는 손처럼 전체의 부를 만든다.",
    questions: [{ text: "저녁 식탁은 정육점 주인의 자비로 차려지는가, 이기심으로 차려지는가?", source: "『국부론』 1편 2장" }],
    roots: [], root_reason: ""
  },
  {
    id: "social-contract", title: "사회계약론", author: "장자크 루소", era: "1762", domain: "경제·사회", tier: "root",
    principle: "정당한 권력은 계약에서만 나온다.",
    questions: [{ text: "인간은 자유롭게 태어났는데, 왜 어디서나 사슬에 매여 있는가?", source: "『사회계약론』 1권 1장" }],
    roots: [], root_reason: ""
  },
  {
    id: "mongmin", title: "목민심서", author: "정약용", era: "1818", domain: "경제·사회", tier: "root",
    principle: "다스림의 근본은 백성을 아끼는 데 있다.",
    questions: [{ text: "수령이 백성을 위해 있는가, 백성이 수령을 위해 있는가?", source: "정약용 「원목」, 『목민심서』의 문제의식" }],
    roots: [], root_reason: ""
  },
  {
    id: "capital-marx", title: "자본론", author: "카를 마르크스", era: "1867", domain: "경제·사회", tier: "trunk",
    principle: "상품 뒤에는 사람의 노동과 관계가 숨어 있다.",
    questions: [{ text: "이윤은 어디에서 오는가?", source: "『자본론』 1권" }],
    roots: ["wealth-nations"], root_reason: "스미스의 노동가치론을 이어받아 그 모순을 파고들었다."
  },
  {
    id: "weber-protestant", title: "프로테스탄트 윤리와 자본주의 정신", author: "막스 베버", era: "1905", domain: "경제·사회", tier: "trunk",
    principle: "자본주의는 금욕적 노동 윤리라는 정신에서 자라났다.",
    questions: [{ text: "돈 버는 일은 언제부터 소명이 되었는가?", source: "『프로테스탄트 윤리와 자본주의 정신』" }],
    roots: ["wealth-nations"], root_reason: "시장의 탄생을 물질이 아니라 정신과 윤리에서 다시 물었다."
  },
  {
    id: "mill-liberty", title: "자유론", author: "존 스튜어트 밀", era: "1859", domain: "경제·사회", tier: "trunk",
    principle: "타인에게 해가 없는 한 개인의 자유는 침해될 수 없다.",
    questions: [{ text: "다수는 한 사람의 생각을 침묵시킬 권리가 있는가?", source: "『자유론』 2장" }],
    roots: ["social-contract"], root_reason: "사회와 개인의 계약이라는 문제를 개인의 자유 한계론으로 정교화했다."
  },
  {
    id: "keynes-general", title: "고용, 이자 및 화폐의 일반이론", author: "존 메이너드 케인스", era: "1936", domain: "경제·사회", tier: "trunk",
    principle: "시장은 스스로 완전고용에 이르지 못할 수 있다.",
    questions: [{ text: "시장이 스스로 회복하기를 기다리는 동안, 사람들은 어떻게 사는가?", source: "『일반이론』" }],
    roots: ["wealth-nations"], root_reason: "보이지 않는 손의 자기조정 가설을 대공황 앞에서 수정했다."
  },
  {
    id: "nudge", title: "넛지", author: "리처드 탈러 · 캐스 선스타인", era: "2008", domain: "경제·사회", tier: "branch",
    principle: "선택 설계는 강요 없이 행동을 바꾼다.",
    questions: [{ text: "인간은 정말 합리적으로 선택하는가?", source: "『넛지』 1부" }],
    roots: ["mill-liberty"], root_reason: "선택의 자유를 보존한 채 개입한다는 설계는 밀의 자유 원리에 대한 응답이다."
  },
  {
    id: "piketty-capital", title: "21세기 자본", author: "토마 피케티", era: "2013", domain: "경제·사회", tier: "branch",
    principle: "자본수익률이 성장률을 앞서면 불평등은 저절로 커진다.",
    questions: [{ text: "세습되는 부는 능력주의와 양립하는가?", source: "『21세기 자본』" }],
    roots: ["capital-marx"], root_reason: "자본과 분배의 문제를 데이터로 다시 연 현대판 자본 연구다."
  },
  {
    id: "buchholz-dead", title: "죽은 경제학자의 살아있는 아이디어", author: "토드 부크홀츠", era: "1989", domain: "경제·사회", tier: "branch",
    principle: "경제학의 역사는 오늘의 선택지를 비추는 지도다.",
    questions: [{ text: "죽은 경제학자의 생각은 지금 누구의 지갑을 움직이는가?", source: "『죽은 경제학자의 살아있는 아이디어』" }],
    roots: ["keynes-general"], root_reason: "스미스에서 케인스까지, 경제학의 계보 전체를 오늘의 문제로 읽는다."
  },

  // ── 예술 (뿌리 3 · 줄기 3 · 가지 4) ─────────────────────────
  {
    id: "poetics", title: "시학", author: "아리스토텔레스", era: "BC 4세기", domain: "예술", tier: "root",
    principle: "예술은 모방이며, 비극은 연민과 두려움으로 감정을 정화한다.",
    questions: [{ text: "비극은 왜 우리에게 즐거움을 주는가?", source: "『시학』 6장, 카타르시스" }],
    roots: [], root_reason: ""
  },
  {
    id: "kant-judgment", title: "판단력비판", author: "이마누엘 칸트", era: "1790", domain: "예술", tier: "root",
    principle: "아름다움은 개념 없이 보편적으로 만족을 주는 것이다.",
    questions: [{ text: "아름다움은 사물의 성질인가, 판단하는 마음의 형식인가?", source: "『판단력비판』 1부, 미의 분석" }],
    roots: [], root_reason: ""
  },
  {
    id: "vinci-treatise", title: "회화론", author: "레오나르도 다빈치", era: "16세기(1651 간행)", domain: "예술", tier: "root",
    principle: "회화는 자연을 탐구하는 또 하나의 과학이다.",
    questions: [{ text: "그림은 눈에 보이는 자연을 옮기는 학문일 수 있는가?", source: "『회화론』, 회화와 과학" }],
    roots: [], root_reason: ""
  },
  {
    id: "gombrich-art", title: "서양미술사", author: "E. H. 곰브리치", era: "1950", domain: "예술", tier: "trunk",
    principle: "미술이란 없다, 미술가들이 있을 뿐이다.",
    questions: [{ text: "화가는 보는 대로 그리는가, 아는 대로 그리는가?", source: "『서양미술사』 서론" }],
    roots: ["vinci-treatise"], root_reason: "미술을 배우고 설명할 수 있는 지식으로 보는 전통 위에서 미술의 역사를 하나의 이야기로 엮었다."
  },
  {
    id: "tolstoy-art", title: "예술이란 무엇인가", author: "레프 톨스토이", era: "1897", domain: "예술", tier: "trunk",
    principle: "예술은 감정을 전염시켜 사람을 잇는 활동이다.",
    questions: [{ text: "아름답기만 하고 아무도 잇지 못하는 것도 예술인가?", source: "『예술이란 무엇인가』" }],
    roots: ["poetics"], root_reason: "예술의 본질과 효용을 묻는 물음은 아리스토텔레스의 모방·정화론에서 시작됐다."
  },
  {
    id: "berger-seeing", title: "다른 방식으로 보기", author: "존 버거", era: "1972", domain: "예술", tier: "trunk",
    principle: "보는 방식은 아는 것과 믿는 것에 의해 결정된다.",
    questions: [{ text: "우리는 그림을 보는가, 그림에 대한 말들을 보는가?", source: "『다른 방식으로 보기』 1장" }],
    roots: ["kant-judgment"], root_reason: "미적 판단이 과연 순수한가라는 물음을 사회와 정치의 차원으로 확장했다."
  },
  {
    id: "jin-aesthetics", title: "미학 오디세이", author: "진중권", era: "1994", domain: "예술", tier: "branch",
    principle: "미학은 감각으로 세계를 사유하는 법이다.",
    questions: [{ text: "가상은 진리의 반대인가, 또 하나의 진리인가?", source: "『미학 오디세이』 1권" }],
    roots: ["kant-judgment"], root_reason: "칸트 미학을 축으로 서양 미학사를 대중의 언어로 항해한다."
  },
  {
    id: "bang-museum", title: "방구석 미술관", author: "조원재", era: "2018", domain: "예술", tier: "branch",
    principle: "미술은 지식이 아니라 공감으로 만난다.",
    questions: [{ text: "명화 앞에서 주눅 들지 않을 방법은 무엇인가?", source: "『방구석 미술관』" }],
    roots: ["gombrich-art"], root_reason: "미술사의 정전을 일상의 언어로 다시 들려주는 가지다."
  },
  {
    id: "gogh-letters", title: "반 고흐, 영혼의 편지", author: "빈센트 반 고흐", era: "1872~1890(서간)", domain: "예술", tier: "branch",
    principle: "그림은 삶을 견디는 노동이자 신앙이었다.",
    questions: [{ text: "아무도 사주지 않는 그림을 계속 그리게 하는 힘은 무엇인가?", source: "『반 고흐, 영혼의 편지』" }],
    roots: ["gombrich-art"], root_reason: "미술사의 정전 화가를 그의 육성으로 읽는 일차 사료의 가지다."
  },
  {
    id: "root-thinking", title: "생각의 탄생", author: "로버트 · 미셸 루트번스타인", era: "1999", domain: "예술", tier: "branch",
    principle: "창조는 분야를 넘나드는 생각도구에서 나온다.",
    questions: [{ text: "예술가의 훈련과 과학자의 훈련은 정말 다른가?", source: "『생각의 탄생』" }],
    roots: ["vinci-treatise"], root_reason: "관찰·상상·유추라는 다빈치식 통합 훈련을 현대 창조성 연구로 잇는다."
  }
];

const EXISTING_BOOKS = [
  ...CORE_BOOKS.map((book) => RESEARCH_BY_BOOK_ID[book.id]
    ? { ...book, research: RESEARCH_BY_BOOK_ID[book.id] }
    : book),
  ...RESEARCH_BOOKS,
];

export const BOOKS = [
  ...EXISTING_BOOKS.map((book) => {
    const enrichment = CELEB_EXISTING_ENRICHMENTS[book.id];
    return enrichment
      ? { ...book, questions: [...book.questions, ...enrichment.questions], celeb2025: enrichment.celeb2025 }
      : book;
  }),
  ...CELEB_BOOKS,
];

// 질문 여정 6코스 — 분야당 1개, 뿌리→줄기→가지 순
export const JOURNEYS = [
  {
    id: "j-philosophy", domain: "철학",
    question: { text: "정의란 강자의 이익에 불과한가?", source: "플라톤 『국가』 1권" },
    bookIds: ["plato-republic", "mencius", "sandel-justice", "weiner-socrates"]
  },
  {
    id: "j-history", domain: "역사",
    question: { text: "강자는 할 수 있는 일을 하고, 약자는 당해야 할 일을 당할 뿐인가?", source: "투키디데스 『펠로폰네소스 전쟁사』 5권" },
    bookIds: ["thucydides", "gibbon-rome", "diamond-ggs", "sapiens"]
  },
  {
    id: "j-science", domain: "과학",
    question: { text: "우리가 서 있는 땅이 돈다면, 왜 느끼지 못하는가?", source: "코페르니쿠스 『천구의 회전에 관하여』 1권" },
    bookIds: ["copernicus", "kuhn-structure", "sagan-cosmos", "hawking-time"]
  },
  {
    id: "j-literature", domain: "문학",
    question: { text: "인간은 제 운명을 피할 수 있는가?", source: "소포클레스 『오이디푸스 왕』" },
    bookIds: ["oedipus", "crime-punishment", "old-man-sea", "demian"]
  },
  {
    id: "j-economy", domain: "경제·사회",
    question: { text: "인간은 자유롭게 태어났는데, 왜 어디서나 사슬에 매여 있는가?", source: "루소 『사회계약론』 1권 1장" },
    bookIds: ["social-contract", "mill-liberty", "nudge", "piketty-capital"]
  },
  {
    id: "j-art", domain: "예술",
    question: { text: "비극은 왜 우리에게 즐거움을 주는가?", source: "아리스토텔레스 『시학』 6장" },
    bookIds: ["poetics", "tolstoy-art", "jin-aesthetics", "bang-museum"]
  }
];

export const IS_SEED = false;
