// 천책빵 — 역사 분야 확장 1차 (2026-08-21)
//
// 출처: 서울대 권장도서 100선 · 하버드 클래식 · 널리 인정된 정사(正史). 목록 선정은 공개 권장도서
// 목록에서만 했고, 제목·저자·시기·계보(roots)는 사실 주장이라 임의로 만들지 않았다.
//
// 이 파일이 채우는 것: principle 한 문장 · 질문 3문항 · root_reason 한 문장.
// 질문 규약은 기존과 같다 — 44자 이하 · 물음표 종결 · 원문 인용 없음 · 전체에서 문구 유일.
// 출전(source)은 편·권을 확신하는 경우에만 적고, 그렇지 않으면 작품명 또는 자체 질문 표기를 쓴다.
// 없는 편명을 지어내지 않는다 — 이 앱은 질문이 그 책에서 나왔다는 주장 위에 서 있다.
//
// 계보: 기존 뿌리 3권(사기·역사·펠로폰네소스 전쟁사)에 전량이 닿는다. 새 뿌리를 만들지 않았다.
export const HISTORY_CLASSICS = [
  {
    id: "hanshu", title: "한서", author: "반고",
    era: "1세기", domain: "역사", tier: "trunk",
    principle: "한 왕조를 처음과 끝이 있는 단위로 끊어 적는다.",
    roots: ["shiji"],
    root_reason: "사기의 통사 체제를 한 왕조의 단대사로 다시 짰다.",
    questions: [
      { text: "한 왕조의 시작과 끝은 누구의 기준으로 끊는가?", source: "『한서』" },
      { text: "앞선 역사가의 문장을 이어 쓸 때 무엇을 고치는가?", source: "『한서』" },
      { text: "나라가 남긴 제도와 책의 목록도 역사가 되는가?", source: "『한서』 예문지" },
    ],
  },
  {
    id: "zizhi-tongjian", title: "자치통감", author: "사마광",
    era: "1084", domain: "역사", tier: "trunk",
    principle: "지난 통치의 성패를 모아 오늘의 정치에 거울로 쓴다.",
    roots: ["shiji"],
    root_reason: "인물 중심의 통사를 연대순으로 다시 세워 통치에 썼다.",
    questions: [
      { text: "통치에 도움이 될 것만 골라 적어도 역사인가?", source: "『자치통감』 핵심 원리 기반 자체 질문" },
      { text: "천 년을 한 줄기로 이어 적으면 흥망에 법칙이 보이는가?", source: "『자치통감』" },
      { text: "왕이 읽을 것을 알고 쓴 신하의 붓은 무엇을 지웠는가?", source: "『자치통감』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "samguk-sagi", title: "삼국사기", author: "김부식",
    era: "1145", domain: "역사", tier: "trunk",
    principle: "지난 왕조의 흥망을 정리해 지금의 거울로 삼는다.",
    roots: ["shiji"],
    root_reason: "기전체로 인물을 세워 삼국을 하나의 역사로 묶었다.",
    questions: [
      { text: "사라진 나라의 역사는 누가 이어서 적어야 하는가?", source: "『삼국사기』 핵심 원리 기반 자체 질문" },
      { text: "세 나라의 연표를 한 장에 겹치면 무엇이 지워지는가?", source: "『삼국사기』 연표" },
      { text: "나라가 무너진 책임을 임금 한 사람에게 물어도 되는가?", source: "『삼국사기』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "samguk-yusa", title: "삼국유사", author: "일연",
    era: "13세기", domain: "역사", tier: "trunk",
    principle: "신이한 이야기도 나라의 시원을 전하는 기록이다.",
    roots: ["shiji"],
    root_reason: "인간의 행적을 적는 일을 신화와 전승까지 넓혔다.",
    questions: [
      { text: "증명할 수 없는 이야기도 역사에 남길 자격이 있는가?", source: "『삼국유사』 기이편" },
      { text: "정사에 없는 이야기를 노인에게서 들었다면 적을 것인가?", source: "『삼국유사』 핵심 원리 기반 자체 질문" },
      { text: "아이가 단군 이야기가 사실인지 물으면 무엇부터 답하는가?", source: "『삼국유사』 기이편 고조선" },
    ],
  },
  {
    id: "joseon-sanggosa", title: "조선상고사", author: "신채호",
    era: "1931", domain: "역사", tier: "branch",
    principle: "역사는 나와 나 아닌 것의 투쟁 기록이다.",
    roots: ["shiji"],
    root_reason: "사마천의 기록 정신을 민족 주체의 사관으로 밀었다.",
    questions: [
      { text: "우리와 남을 가르는 선은 시대마다 달라지는가?", source: "『조선상고사』 총론" },
      { text: "남의 나라 사서에 적힌 우리 이야기를 어디까지 믿는가?", source: "『조선상고사』" },
      { text: "사라진 나라의 땅 이름만 남았다면 무엇을 알 수 있는가?", source: "『조선상고사』" },
    ],
  },
  {
    id: "plutarch-lives", title: "플루타르코스 영웅전", author: "플루타르코스",
    era: "1세기", domain: "역사", tier: "trunk",
    principle: "위대한 행적보다 사람의 성품이 역사를 설명한다.",
    roots: ["herodotus"],
    root_reason: "잊히지 않게 할 행적을 사람의 성품 문제로 좁혔다.",
    questions: [
      { text: "사소한 일화가 큰 전투보다 사람을 더 잘 말하는가?", source: "『플루타르코스 영웅전』 알렉산드로스 전(傳) 서두" },
      { text: "두 나라의 인물을 나란히 놓고 견주면 무엇이 보이는가?", source: "『플루타르코스 영웅전』" },
      { text: "인물의 결점을 알고도 그를 본보기로 삼을 수 있는가?", source: "『플루타르코스 영웅전』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "caesar-gallic", title: "갈리아 전기", author: "카이사르",
    era: "BC 1세기", domain: "역사", tier: "trunk",
    principle: "지휘관이 자신이 치른 전쟁을 직접 기록한다.",
    roots: ["thucydides"],
    root_reason: "겪은 사람이 쓰는 당대사를 지휘관 자신에게까지 밀었다.",
    questions: [
      { text: "싸운 사람이 남긴 기록을 무엇으로 검증하는가?", source: "『갈리아 전기』 핵심 원리 기반 자체 질문" },
      { text: "상관에게 보낼 보고서에서 내 실수는 몇 줄이 되는가?", source: "『갈리아 전기』 핵심 원리 기반 자체 질문" },
      { text: "먼저 친 싸움도 방어라고 부를 수 있는가?", source: "『갈리아 전기』 1권, 헬베티족 원정" },
    ],
  },
  {
    id: "tacitus-annals", title: "연대기", author: "타키투스",
    era: "2세기", domain: "역사", tier: "trunk",
    principle: "권력은 사람과 말을 함께 타락시킨다.",
    roots: ["thucydides"],
    root_reason: "인간 본성의 반복을 제정 권력의 타락으로 좁혀 읽었다.",
    questions: [
      { text: "분노도 편애도 없이 쓴 기록이 과연 가능한가?", source: "『연대기』 1권" },
      { text: "아무도 반대하지 않는 회의에서 결정된 일은 누구의 뜻인가?", source: "『연대기』 핵심 원리 기반 자체 질문" },
      { text: "폭군 하나를 지우면 그 시대는 나아지는가?", source: "『연대기』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "machiavelli-discourses", title: "로마사 논고", author: "마키아벨리",
    era: "1531", domain: "역사", tier: "branch",
    principle: "공화국의 자유는 시민의 갈등과 제도가 함께 지킨다.",
    roots: ["thucydides"],
    root_reason: "본성이 반복시킨다는 전제를 제도 설계의 근거로 삼았다.",
    questions: [
      { text: "옛 나라의 사례를 오늘의 정치에 그대로 적용할 수 있는가?", source: "『로마사 논고』" },
      { text: "내부의 갈등이 오히려 나라를 오래 버티게 하는가?", source: "『로마사 논고』 1권" },
      { text: "새 조직의 규칙을 짤 때 나는 무엇을 먼저 정하겠는가?", source: "『로마사 논고』" },
    ],
  },
  {
    id: "nanjung-ilgi", title: "난중일기", author: "이순신",
    era: "1598", domain: "역사", tier: "branch",
    principle: "전장의 하루를 꾸밈없이 적어 사실로 남긴다.",
    roots: ["jingbirok"],
    root_reason: "환란을 뒤에서 반성하는 기록을 전장의 매일로 옮겼다.",
    questions: [
      { text: "싸움을 앞둔 밤에 적은 한 줄은 무엇을 남기는가?", source: "『난중일기』" },
      { text: "지휘관의 사사로운 슬픔도 전쟁의 기록에 들어가는가?", source: "『난중일기』" },
      { text: "날씨와 군량을 적는 일이 승패를 얼마나 가르는가?", source: "『난중일기』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "hanjungnok", title: "한중록", author: "혜경궁 홍씨",
    era: "1805", domain: "역사", tier: "branch",
    principle: "왕실 참변의 전말을 당사자가 적어 후손에게 남긴다.",
    roots: ["jingbirok"],
    root_reason: "환란을 적어 경계로 남기는 일을 집안 안쪽으로 끌어왔다.",
    questions: [
      { text: "그날 방에 있던 사람만 아는 일은 어떻게 전해지는가?", source: "『한중록』" },
      { text: "억울함을 풀려는 글은 어디에서 사실과 갈라지는가?", source: "『한중록』 핵심 원리 기반 자체 질문" },
      { text: "수십 년 뒤에 떠올린 그 하루는 얼마나 정확한가?", source: "『한중록』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "taengniji", title: "택리지", author: "이중환",
    era: "1751", domain: "역사", tier: "branch",
    principle: "살 만한 곳은 지리와 생리, 인심과 산수로 가린다.",
    roots: ["yeolha"],
    root_reason: "이용후생의 시선을 살 만한 땅을 고르는 기준으로 옮겼다.",
    questions: [
      { text: "살기 좋은 땅의 조건은 시대가 바뀌면 달라지는가?", source: "『택리지』 복거총론" },
      { text: "벌이는 좋은데 인심이 사나운 고을에 자리를 잡겠는가?", source: "『택리지』 복거총론" },
      { text: "지금 사는 동네를 고른 이유를 네 가지로 적을 수 있는가?", source: "『택리지』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "burke-reflections", title: "프랑스 혁명에 관한 성찰", author: "에드먼드 버크",
    era: "1790", domain: "역사", tier: "branch",
    principle: "사회는 설계가 아니라 오래 이어진 관습의 축적물이다.",
    roots: ["gibbon-rome"],
    root_reason: "쇠퇴의 원인을 급진적 단절에서 찾아 보수의 논리로 세웠다.",
    questions: [
      { text: "오래됐다는 이유만으로 지켜야 할 것이 있는가?", source: "『프랑스 혁명에 관한 성찰』" },
      { text: "아직 태어나지 않은 세대의 몫을 지금 정해도 되는가?", source: "『프랑스 혁명에 관한 성찰』" },
      { text: "집을 고칠 때 기둥까지 뽑아야 하는 때는 언제인가?", source: "『프랑스 혁명에 관한 성찰』" },
    ],
  },
  {
    id: "tocqueville-ancien", title: "구체제와 프랑스 혁명", author: "알렉시 드 토크빌",
    era: "1856", domain: "역사", tier: "branch",
    principle: "혁명은 구체제를 끊지 않고 그 중앙집권을 완성했다.",
    roots: ["gibbon-rome"],
    root_reason: "번영 속에서 쇠퇴가 자란다는 시선을 혁명의 기원에 돌렸다.",
    questions: [
      { text: "낡은 체제를 무너뜨린 힘은 그 체제가 길러낸 것인가?", source: "『구체제와 프랑스 혁명』" },
      { text: "살림이 나아진 곳에서 저항이 먼저 터진 이유는?", source: "『구체제와 프랑스 혁명』" },
      { text: "정권이 바뀐 뒤에도 그대로 남은 관청은 무엇을 이어가는가?", source: "『구체제와 프랑스 혁명』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "guns-of-august", title: "8월의 포성", author: "바버라 터크먼",
    era: "1962", domain: "역사", tier: "branch",
    principle: "정교한 계획과 작은 오판이 전쟁을 불러들인다.",
    roots: ["gibbon-rome"],
    root_reason: "쇠퇴를 서술하는 시선을 한 세기에서 한 달로 좁혔다.",
    questions: [
      { text: "아무도 원하지 않은 전쟁은 누구의 책임인가?", source: "『8월의 포성』 핵심 원리 기반 자체 질문" },
      { text: "시간표가 정해진 계획은 멈추라는 말을 들을 수 있는가?", source: "『8월의 포성』" },
      { text: "첫 한 달의 판단이 몇 해의 결과를 가두는가?", source: "『8월의 포성』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "kennedy-great-powers", title: "강대국의 흥망", author: "폴 케네디",
    era: "1987", domain: "역사", tier: "branch",
    principle: "강대국은 경제력을 넘어선 군사 부담에 무너진다.",
    roots: ["gibbon-rome"],
    root_reason: "쇠퇴의 원리를 경제력과 군사비의 균형으로 계량했다.",
    questions: [
      { text: "힘을 지키려는 지출은 어디서부터 힘을 깎기 시작하는가?", source: "『강대국의 흥망』 핵심 원리 기반 자체 질문" },
      { text: "국방비를 늘린 나라와 공장을 늘린 나라 중 누가 이기는가?", source: "『강대국의 흥망』 핵심 원리 기반 자체 질문" },
      { text: "오늘 가장 강한 나라가 다음 세기에도 강할 근거는 무엇인가?", source: "『강대국의 흥망』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "bloch-feudal", title: "봉건사회", author: "마르크 블로크",
    era: "1939", domain: "역사", tier: "branch",
    principle: "봉건은 사람과 사람을 잇는 종속 관계로 짜인 사회다.",
    roots: ["carr-history"],
    root_reason: "역사가의 물음을 사회 전체의 구조를 읽는 방법으로 바꿨다.",
    questions: [
      { text: "한 시대를 이해하는 데 제도만 보면 충분한가?", source: "『봉건사회』" },
      { text: "땅을 빌려 쓰는 대가로 사람은 무엇까지 내주는가?", source: "『봉건사회』" },
      { text: "시계가 없던 시절 사람들은 약속 시각을 어떻게 정했는가?", source: "『봉건사회』" },
    ],
  },
  {
    id: "braudel-mediterranean", title: "지중해", author: "페르낭 브로델",
    era: "1949", domain: "역사", tier: "branch",
    principle: "역사를 움직이는 것은 사건이 아니라 오래 지속되는 구조다.",
    roots: ["carr-history"],
    root_reason: "역사가의 물음을 사건에서 지리와 시간의 층으로 옮겼다.",
    questions: [
      { text: "사건이 아니라 바다와 산이 역사의 주인공일 수 있는가?", source: "『지중해』" },
      { text: "왕의 죽음과 밀값의 변화 중 무엇이 삶을 더 바꾸는가?", source: "『지중해』" },
      { text: "백 년을 하루처럼 보는 시선은 무엇을 놓치는가?", source: "『지중해』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "toynbee-study", title: "역사의 연구", author: "아널드 토인비",
    era: "1934", domain: "역사", tier: "branch",
    principle: "문명은 도전에 응전하며 자라고 실패하면 쇠퇴한다.",
    roots: ["carr-history"],
    root_reason: "역사를 어떻게 볼 것인가라는 물음을 문명 단위로 옮겼다.",
    questions: [
      { text: "문명의 흥망을 하나의 법칙으로 설명할 수 있는가?", source: "『역사의 연구』 핵심 원리 기반 자체 질문" },
      { text: "힘든 조건에 놓인 집단이 더 크게 자라는 때는 언제인가?", source: "『역사의 연구』" },
      { text: "앞장선 소수가 존경을 잃으면 무엇이 먼저 무너지는가?", source: "『역사의 연구』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "hobsbawm-extremes", title: "극단의 시대", author: "에릭 홉스봄",
    era: "1994", domain: "역사", tier: "branch",
    principle: "20세기는 재앙과 황금기가 잇달아 온 짧은 세기다.",
    roots: ["carr-history"],
    root_reason: "현재와 과거의 대화를 자신이 겪은 세기에 직접 적용했다.",
    questions: [
      { text: "자기가 살아낸 시대를 당사자가 역사로 쓸 수 있는가?", source: "『극단의 시대』 서문" },
      { text: "한 세기의 시작과 끝을 다시 정한다면 어느 해로 끊겠는가?", source: "『극단의 시대』 핵심 원리 기반 자체 질문" },
      { text: "부모 세대가 좋은 시절이라 부르는 시기를 나는 왜 다르게 보는가?", source: "『극단의 시대』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "said-orientalism", title: "오리엔탈리즘", author: "에드워드 사이드",
    era: "1978", domain: "역사", tier: "branch",
    principle: "동양은 서양이 자신을 세우려 만들어낸 표상이다.",
    roots: ["carr-history"],
    root_reason: "현재가 과거를 쓴다는 통찰을 지식과 권력의 문제로 옮겼다.",
    questions: [
      { text: "남을 설명하는 지식은 누구의 이익에 봉사하는가?", source: "『오리엔탈리즘』 서론" },
      { text: "당사자가 스스로 말하기 전에 대신 말해도 되는가?", source: "『오리엔탈리즘』" },
      { text: "외국인이 우리를 소개한 글에서 무엇이 어긋나 보이는가?", source: "『오리엔탈리즘』" },
    ],
  },
  {
    id: "fukuyama-end-history", title: "역사의 종말", author: "프랜시스 후쿠야마",
    era: "1992", domain: "역사", tier: "branch",
    principle: "자유민주주의가 인류 통치의 마지막 형태로 남았다.",
    roots: ["carr-history"],
    root_reason: "현재가 과거에 묻는 대화를 역사의 방향과 종점 문제로 밀었다.",
    questions: [
      { text: "역사가 끝났다는 말은 무엇이 멈췄다는 뜻인가?", source: "『역사의 종말』 핵심 원리 기반 자체 질문" },
      { text: "싸울 이념이 사라진 사회의 젊은이는 무엇을 원하는가?", source: "『역사의 종말』" },
      { text: "선거로 뽑은 정부가 곳곳에서 흔들리면 무엇이 틀렸는가?", source: "『역사의 종말』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "huntington-clash", title: "문명의 충돌", author: "새뮤얼 헌팅턴",
    era: "1996", domain: "역사", tier: "branch",
    principle: "냉전 이후의 갈등은 이념이 아니라 문명의 경계에서 일어난다.",
    roots: ["carr-history"],
    root_reason: "현재의 관심이 과거를 가른다는 명제를 문명 지도로 그려냈다.",
    questions: [
      { text: "사람을 문명으로 나누는 선은 어디서 그어지는가?", source: "『문명의 충돌』 핵심 원리 기반 자체 질문" },
      { text: "이웃과 다투는 까닭을 종교에서 찾으면 무엇을 놓치는가?", source: "『문명의 충돌』" },
      { text: "한 도시에서 두 언어를 쓰는 사람들은 무엇으로 갈리는가?", source: "『문명의 충돌』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "diamond-collapse", title: "문명의 붕괴", author: "재레드 다이아몬드",
    era: "2005", domain: "역사", tier: "branch",
    principle: "사회의 붕괴는 환경 앞에서 내린 선택의 결과다.",
    roots: ["diamond-ggs"],
    root_reason: "환경이 갈랐다는 설명에 사회의 선택이라는 변수를 더했다.",
    questions: [
      { text: "환경이 무너진 사회는 다른 길을 고를 수 있었는가?", source: "『문명의 붕괴』 핵심 원리 기반 자체 질문" },
      { text: "마지막 나무를 베는 사람은 그것이 마지막임을 아는가?", source: "『문명의 붕괴』 이스터섬 사례" },
      { text: "마을이 자랑하던 방식이 마을을 해칠 때 누가 말하는가?", source: "『문명의 붕괴』 핵심 원리 기반 자체 질문" },
    ],
  },
  {
    id: "harari-homo-deus", title: "호모 데우스", author: "유발 하라리",
    era: "2015", domain: "역사", tier: "branch",
    principle: "인류의 다음 과제는 불멸이고 권위는 데이터로 넘어간다.",
    roots: ["sapiens"],
    root_reason: "공유된 허구의 역사를 인류의 미래 의제로 이어 물었다.",
    questions: [
      { text: "굶주림과 역병이 줄어든 뒤 인류는 무엇을 목표로 삼는가?", source: "『호모 데우스』" },
      { text: "알고리즘이 나보다 나를 잘 알면 결정은 누가 하는가?", source: "『호모 데우스』" },
      { text: "건강 기록을 넘기는 대가로 더 오래 산다면 넘기겠는가?", source: "『호모 데우스』" },
    ],
  },
];
