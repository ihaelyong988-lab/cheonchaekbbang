// 천책빵 — 뿌리를 찾는 서재 (PRD-천책빵.md v1.7)
import { BOOKS, JOURNEYS, DOMAINS, IS_SEED } from "./data/books.js";
import { createQuestionSearch, compactSearchText, TOPIC_CHIPS } from "./lib/search.js";

/* ── 데이터 무결성 검증 (PRD §5) ───────────────────── */
function validateBooks(books) {
  const byId = new Map(books.map((b) => [b.id, b]));
  const bad = new Set();
  for (const b of books) {
    const isRoot = b.tier === "root";
    if (isRoot !== (b.roots.length === 0)) { bad.add(b.id); console.warn("무결성: tier/roots 불일치", b.id); continue; }
    if (!b.principle || !b.questions || b.questions.length === 0) { bad.add(b.id); console.warn("무결성: principle/questions 공란", b.id); continue; }
    if (!isRoot && !b.root_reason) { bad.add(b.id); console.warn("무결성: root_reason 공란", b.id); continue; }
    if (!isRoot) {
      let cur = b, hops = 0, ok = false;
      const seen = new Set();
      while (hops < 50) {
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        const p = byId.get(cur.roots[0]);
        if (!p) break;
        if (p.tier === "root") { ok = true; break; }
        cur = p; hops++;
      }
      if (!ok) { bad.add(b.id); console.warn("무결성: 뿌리 도달 실패(고아/순환)", b.id); }
    }
  }
  return books.filter((b) => !bad.has(b.id));
}
const ALL = validateBooks(BOOKS);
const BY_ID = new Map(ALL.map((b) => [b.id, b]));
const TIER_ORDER = { root: 0, trunk: 1, branch: 2 };
const TIER_KO = { root: "뿌리", trunk: "줄기", branch: "가지" };

/* ── 뿌리까지의 거리 (단일 헬퍼 · roots[0] 체인) ───── */
// 뿌리면 0. 순환·고아·50홉 초과는 그 시점까지의 홉 수를 반환해 NaN/무한루프를 만들지 않는다.
// (validateBooks가 도달 불가 책을 이미 제거하므로 방어 분기는 실전에서 도달하지 않는다.)
function stepsToRoot(book) {
  if (!book || book.tier === "root") return 0;
  let cur = book, steps = 0;
  const seen = new Set([book.id]);
  while (steps < 50) {
    const parent = BY_ID.get(cur.roots?.[0]);
    if (!parent || seen.has(parent.id)) return steps;   // 고아 · 순환 방어
    steps += 1;
    if (parent.tier === "root") return steps;           // 뿌리 도달
    seen.add(parent.id);
    cur = parent;
  }
  return steps;                                          // 50홉 상한 방어
}

/* ── 질문 id (DI-2 안정 id) ─────────────────────────── */
// 저장 키는 데이터가 준 고정 qid 를 먼저 쓰고, 없을 때만 배열 순번으로 만든다.
// 소비 코드는 배열 인덱스를 되짚지 않고 Q_BY_ID 로만 질문을 찾는다 — 문구 순서가 바뀌어도 답이 옮겨 붙지 않는다.
function questionId(book, index) {
  const fixed = book.questions[index]?.qid;
  return typeof fixed === "string" && fixed ? fixed : `${book.id}#${index}`;
}
const Q_POOL = ALL.flatMap((book) => book.questions.map((q, index) => ({
  id: questionId(book, index), bookId: book.id, q,
})));
const Q_BY_ID = new Map(Q_POOL.map((item) => [item.id, item]));
const VALID_QUESTION_IDS = new Set(Q_BY_ID.keys());

/* ── 사용자 상태 (localStorage) ─────────────────────── */
const STORE_KEY = "cheonchaek.v1";
const STORE_VERSION = 2;
const LIB_TIERS = ["전체", "뿌리", "줄기", "가지"];
const ORPHAN_KINDS = new Set(["read", "reading", "question", "journey"]);
const ORPHAN_MAX = 300;
/* 답변 상한 단일 출처(DI-3). 저장·입력·마크업이 각자 리터럴을 들고 있으면 한 곳만 고쳐도
   화면은 더 받고 저장은 잘라내는 무경고 소실이 되살아난다. 값을 바꿀 곳은 여기 하나다. */
const ANSWER_MAX = 10000;

function asArray(value) { return Array.isArray(value) ? value : []; }
function cloneState(value) { return JSON.parse(JSON.stringify(value)); }

function uniqueValidIds(value) {
  return [...new Set(asArray(value))].filter((id) => BY_ID.has(id));
}

// 영속 설정은 화이트리스트로만 통과시킨다. 검색어는 세션 한정이므로 여기에 넣지 않는다(C5-2).
function sanitizePrefs(source) {
  const prefs = source && typeof source === "object" ? source : {};
  return {
    lineageDomain: DOMAINS.includes(prefs.lineageDomain) ? prefs.lineageDomain : "",
    libDomain: prefs.libDomain === "전체" || DOMAINS.includes(prefs.libDomain) ? prefs.libDomain : "전체",
    libTier: LIB_TIERS.includes(prefs.libTier) ? prefs.libTier : "전체",
  };
}

function sanitizeState(source = {}) {
  // 카탈로그에서 참조를 잃은 기록은 지우지 않고 격리 보존한다(DI-1). 같은 항목이 재로드마다 늘어나지 않게 kind+id 로 접는다.
  const orphans = [];
  const orphanKeys = new Set();
  const quarantine = (kind, id, item = {}) => {
    if (typeof id !== "string" || !id) return;
    const key = `${kind}:${id}`;
    if (orphanKeys.has(key) || orphans.length >= ORPHAN_MAX) return;
    orphanKeys.add(key);
    orphans.push({
      kind, id,
      date: typeof item.date === "string" ? item.date.slice(0, 10) : "",
      myAnswer: typeof item.myAnswer === "string" ? item.myAnswer.slice(0, ANSWER_MAX) : "",
    });
  };
  for (const item of asArray(source.orphans)) {
    if (item && ORPHAN_KINDS.has(item.kind)) quarantine(item.kind, item.id, item);
  }

  const storedRead = [...new Set(asArray(source.read))];
  const storedReading = [...new Set(asArray(source.reading))];
  for (const id of storedRead) if (!BY_ID.has(id)) quarantine("read", id);
  for (const id of storedReading) if (!BY_ID.has(id)) quarantine("reading", id);
  const read = storedRead.filter((id) => BY_ID.has(id));
  const readSet = new Set(read);
  const reading = storedReading.filter((id) => BY_ID.has(id) && !readSet.has(id));

  const questionSeen = new Set();
  const questions = [];
  for (const item of asArray(source.questions)) {
    if (!item || typeof item.id !== "string" || questionSeen.has(item.id)) continue;
    questionSeen.add(item.id);
    if (!VALID_QUESTION_IDS.has(item.id)) { quarantine("question", item.id, item); continue; }
    questions.push({
      id: item.id,
      bookId: Q_BY_ID.get(item.id).bookId,
      date: typeof item.date === "string" ? item.date.slice(0, 10) : "",
      myAnswer: typeof item.myAnswer === "string" ? item.myAnswer.slice(0, ANSWER_MAX) : "",
    });
  }

  const journeyDef = JOURNEYS.find((journey) => journey.id === source.journey?.id);
  let journey = null;
  if (journeyDef) {
    const storedDone = new Set(uniqueValidIds(source.journey.doneBookIds));
    // 결번은 건너뛰고 남은 진행은 보존한다 — 중간 한 권이 카탈로그에서 빠져도 진척을 잘라내지 않는다(원장 11).
    journey = { id: journeyDef.id, doneBookIds: journeyDef.bookIds.filter((id) => storedDone.has(id)) };
  }

  /* 여정 체크가 켠 읽음의 직전 상태. 체크를 되돌리면 여기 적힌 책만 원복한다 —
     방문자가 손으로 표시한 읽음까지 걷으면 기록이 사라진다(원장 30). 진행 중 여정의 책으로만 한정한다. */
  const journeyBookIds = new Set(journeyDef ? journeyDef.bookIds : []);
  const autoReadSeen = new Set();
  const journeyAutoRead = [];
  for (const item of asArray(source.journeyAutoRead)) {
    if (!item || typeof item.id !== "string" || autoReadSeen.has(item.id)) continue;
    if (!journeyBookIds.has(item.id)) continue;
    autoReadSeen.add(item.id);
    journeyAutoRead.push({ id: item.id, from: item.from === "reading" ? "reading" : "none" });
  }

  const doneSeen = new Set();
  const journeysDone = [];
  for (const item of asArray(source.journeysDone)) {
    if (!item || typeof item.id !== "string" || doneSeen.has(item.id)) continue;
    doneSeen.add(item.id);
    if (!JOURNEYS.some((journeyItem) => journeyItem.id === item.id)) { quarantine("journey", item.id, item); continue; }
    journeysDone.push({
      id: item.id,
      date: typeof item.date === "string" ? item.date.slice(0, 10) : "",
      myAnswer: typeof item.myAnswer === "string" ? item.myAnswer.slice(0, ANSWER_MAX) : "",
    });
  }

  // 진행 중 여정의 완료 답 초안. 저장 상한은 확정 답변과 같고, 여정이 없으면 남기지 않는다(§5-1).
  const journeyDraft = journey && typeof source.journeyDraft === "string" ? source.journeyDraft.slice(0, ANSWER_MAX) : "";
  const profileName = typeof source.profile?.name === "string" ? source.profile.name.trim().slice(0, 20) : "";
  return {
    version: STORE_VERSION,
    read, reading, questions,
    rootArrivals: Number.isSafeInteger(source.rootArrivals) && source.rootArrivals >= 0 ? source.rootArrivals : 0,
    journey, journeysDone, journeyDraft, journeyAutoRead,
    profile: profileName ? { name: profileName } : null,
    theme: source.theme === "navy" ? "navy" : "silver",
    prefs: sanitizePrefs(source.prefs),
    onboardingDismissed: source.onboardingDismissed === true,
    orphans,
    questionWeek: /^\d{4}-W\d{2}$/u.test(source.questionWeek) ? source.questionWeek : "",
    /* 방문자가 직접 친 질문. 최근 20건·각 60자만 남긴다 — 검색어와 달리 이건 방문자가 만든 것이라
       세션 한정으로 두면 재방문에 통째로 사라진다(원장 48). 입력창 값 자체는 복원하지 않는다(C5-2). */
    askedQuestions: [...new Set(asArray(source.askedQuestions)
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim().slice(0, 60)))].slice(0, 20),
    questionDeck: [...new Set(asArray(source.questionDeck))].filter((id) => VALID_QUESTION_IDS.has(id)),
    lastHeroQuestionId: VALID_QUESTION_IDS.has(source.lastHeroQuestionId) ? source.lastHeroQuestionId : null,
  };
}

function readStored() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch { return null; }
}

// 저장 키가 없던 첫 방문과 읽기 실패를 구분한다. 실패는 배너로 알린다(원장 10).
let storageBroken = false;
function loadState() {
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch { storageBroken = true; }
  if (typeof raw === "string") {
    try { return { raw, state: sanitizeState(JSON.parse(raw)) }; }
    catch { storageBroken = true; }
  }
  return { raw: typeof raw === "string" ? raw : null, state: sanitizeState() };
}
const boot = loadState();
const state = boot.state;
let syncedSnapshot = cloneState(state);   // 병합 기준선 = 내가 마지막으로 읽거나 쓴 저장값
const appStatus = document.getElementById("app-status");
let answerSaveTimer = 0;
const SAVE_FAIL_NOTICE = "기기 저장 공간이 부족해 변경 내용을 저장하지 못했습니다.";
const SAVE_FAIL_BANNER = "이 기기가 기록 저장을 거부했습니다. 저장 공간을 비우거나 비공개 모드를 해제한 뒤 다시 시도하세요.";
const LOAD_FAIL_BANNER = "이 기기에 저장된 기록을 읽지 못했습니다. 이번 방문의 기록은 새로 시작합니다.";

function announce(message) {
  appStatus.textContent = "";
  requestAnimationFrame(() => { appStatus.textContent = message; });
}
/* 화면이 바뀌면 직전 화면의 문구를 걷는다. 채우기만 하면 기록 탭으로 옮겨 간 뒤에도
   '8권을 찾았습니다' 가 남아 스크린리더가 지금 화면과 무관한 문장을 읽는다. */
function clearAnnounce() {
  appStatus.textContent = "";
}
/* 받침을 보고 조사를 붙인다. 값과 조사를 띄어 쓰면 "철학 으로"·"전체 으로" 처럼 읽힌다(A7).
   한글이 아닌 끝 글자는 받침 없음으로 본다. */
function withParticle(word, afterJong, afterVowel) {
  const last = String(word).charCodeAt(String(word).length - 1);
  const isHangul = last >= 0xac00 && last <= 0xd7a3;
  return `${word}${isHangul && (last - 0xac00) % 28 !== 0 ? afterJong : afterVowel}`;
}

// 보이는 통보 1건. #app-alert 자리에 담아 탭 렌더에 지워지지 않게 하고, 기존 라이브 리전 통보는 그대로 유지한다(원장 10).
function saveAlertEl() {
  let el = document.getElementById("save-alert");
  if (!el) {
    el = document.createElement("p");
    el.id = "save-alert";
    el.className = "notice save-alert";
    el.setAttribute("role", "alert");
    el.hidden = true;
    const host = document.getElementById("app-alert");
    if (host) host.append(el);
    else document.getElementById("view").before(el);
  }
  return el;
}
function setAlertHost(el, visible) {
  const host = el.parentElement;
  if (host && host.id === "app-alert") host.hidden = !visible;
}
function showSaveAlert(message) {
  const el = saveAlertEl();
  el.textContent = message;
  el.hidden = false;
  setAlertHost(el, true);
}
function hideSaveAlert() {
  const el = document.getElementById("save-alert");
  if (!el || el.hidden) return;
  el.hidden = true;
  el.textContent = "";
  setAlertHost(el, false);
}

/* ── 병합 저장 (DI-5) ──────────────────────────────────
   타 탭이 새로 남긴 항목만 받아들이고, 내가 지운 항목(기준선에 있던 것)은 되살리지 않는다. */
// 유효성 판정은 sanitizeState 한 곳에 둔다. 병합 단계에서 걸러 버리면 격리 대상이 소리 없이 사라진다(DI-1).
function mergeIds(mine, theirs, base) {
  const known = new Set([...mine, ...base]);
  return [...mine, ...theirs.filter((id) => typeof id === "string" && !known.has(id))];
}
function mergeItems(mine, theirs, base, keyOf) {
  const known = new Set([...mine, ...base].map(keyOf));
  return [...mine, ...theirs.filter((item) => item && typeof item.id === "string" && !known.has(keyOf(item)))];
}
// 홑값·객체 필드는 3방향 비교로 정한다. 내가 손대지 않은 필드는 타 탭 변경을 받아들인다.
function mergeField(mine, theirs, base) {
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return same(mine, base) && !same(theirs, base) ? theirs : mine;
}
function mergedForSave() {
  const stored = readStored();
  if (!stored) return state;
  const base = syncedSnapshot;
  const byId = (item) => item.id;
  return {
    ...state,
    read: mergeIds(state.read, asArray(stored.read), base.read),
    reading: mergeIds(state.reading, asArray(stored.reading), base.reading),
    questions: mergeItems(state.questions, asArray(stored.questions), base.questions, byId),
    journeysDone: mergeItems(state.journeysDone, asArray(stored.journeysDone), base.journeysDone, byId),
    orphans: mergeItems(state.orphans, asArray(stored.orphans), base.orphans, (item) => `${item.kind}:${item.id}`),
    journey: mergeField(state.journey, stored.journey, base.journey),
    journeyDraft: mergeField(state.journeyDraft, stored.journeyDraft, base.journeyDraft),
    journeyAutoRead: mergeField(state.journeyAutoRead, stored.journeyAutoRead, base.journeyAutoRead),
    profile: mergeField(state.profile, stored.profile, base.profile),
    theme: mergeField(state.theme, stored.theme, base.theme),
    prefs: mergeField(state.prefs, stored.prefs, base.prefs),
    onboardingDismissed: mergeField(state.onboardingDismissed, stored.onboardingDismissed, base.onboardingDismissed),
    rootArrivals: mergeField(state.rootArrivals, stored.rootArrivals, base.rootArrivals),
    askedQuestions: [...new Set([...state.askedQuestions, ...asArray(stored.askedQuestions)])].slice(0, 20),
    /* 주차는 뒤로 가지 않는다. 지난주 상태로 열려 있던 탭이 저장하면 이번 주 덱이 통째로 되살아나
       다른 탭이 이미 본 질문을 처음부터 다시 받는다(A5). 더 나중 주차 쪽 덱을 그대로 받는다. */
    ...(String(stored.questionWeek || "") > String(state.questionWeek || "")
      ? {
        questionWeek: stored.questionWeek,
        questionDeck: asArray(stored.questionDeck),
        lastHeroQuestionId: stored.lastHeroQuestionId,
      }
      : {}),
  };
}

function save() {
  const payload = sanitizeState(mergedForSave());   // 병합 후에도 version 은 현행 값이다
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(payload));
  } catch {
    announce(SAVE_FAIL_NOTICE);
    showSaveAlert(SAVE_FAIL_BANNER);
    return false;
  }
  Object.assign(state, payload);      // 병합으로 들어온 타 탭 항목을 메모리에도 싣는다
  syncedSnapshot = cloneState(payload);
  hideSaveAlert();
  return true;
}

// 상태를 바꾼 뒤 저장이 거부되면 직전 상태로 되돌린다. 호출부는 false 에서 성공 UI 로 넘어가지 않는다(DI-4).
function commit(change) {
  const backup = cloneState(state);
  change();
  if (save()) return true;
  Object.assign(state, backup);
  return false;
}

function scheduleSave() {
  clearTimeout(answerSaveTimer);
  answerSaveTimer = setTimeout(() => { answerSaveTimer = 0; save(); }, 250);
}
// 히어로 추첨과 대기 중인 입력을 재방문 전에 1회 확정한다(원장 3).
window.addEventListener("pagehide", () => {
  clearTimeout(answerSaveTimer);
  answerSaveTimer = 0;
  save();
});
// 타 탭 변경을 상태에 반영한 뒤 렌더한다. 보고 있는 질문과 쓰던 초안은 타 탭 값으로 바꾸지 않는다.
window.addEventListener("storage", (event) => {
  if (event.key !== null && event.key !== STORE_KEY) return;
  const stored = readStored();
  if (!stored) return;
  const next = sanitizeState({
    ...stored,
    journeyDraft: state.journeyDraft || stored.journeyDraft,
    questionWeek: state.questionWeek,
    questionDeck: state.questionDeck,
    lastHeroQuestionId: state.lastHeroQuestionId,
  });
  Object.assign(state, next);
  syncedSnapshot = cloneState(next);
  const focused = document.activeElement;
  if (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) return;
  render();
});
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const color = state.theme === "navy" ? "#0F2A43" : "#E4E4DF";
  document.querySelector('meta[name="theme-color"]').setAttribute("content", color);
}
applyTheme();
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ── 읽음 상태 (3단계) ─────────────────────────────── */
function readStatus(id) {
  if (state.read.includes(id)) return "read";
  if (state.reading.includes(id)) return "reading";
  return "none";
}
function applyReadStatus(id, st) {
  state.read = state.read.filter((x) => x !== id);
  state.reading = state.reading.filter((x) => x !== id);
  if (st === "read") state.read.push(id);
  if (st === "reading") state.reading.push(id);
}
function setReadStatus(id, st) {
  return commit(() => {
    applyReadStatus(id, st);
    /* 방문자가 그 책의 읽음을 직접 바꾼 순간 여정 추적은 무효가 된다.
       남겨 두면 나중에 체크를 되돌릴 때 방문자가 손으로 켠 표시까지 덮어쓴다(원장 30 · A1). */
    state.journeyAutoRead = state.journeyAutoRead.filter((entry) => entry.id !== id);
  });
}
function cycleRead(id) {
  const next = { none: "reading", reading: "read", read: "none" };
  return setReadStatus(id, next[readStatus(id)]);
}

/* ── 이번 주의 질문 (주 1회 이상 갱신) ─────────────────
   전에는 방문할 때마다 전체 질문에서 무작위로 뽑았다. 그래서 "이번 주의 질문"이라는 개념이 없었고
   같은 날 열 번을 열면 열 문항이 전부 달랐다 — 화면의 접근 이름만 그렇게 적혀 있었을 뿐이다.
   이제 주차를 씨앗으로 그 주에만 열리는 묶음을 만든다. 같은 주에는 같은 묶음, 주가 바뀌면 반드시 다른 묶음이다.
   서버도 네트워크도 쓰지 않으므로 오프라인에서도 성립한다(INV-3 · INV-5). */
// ISO 주 표기. 그 주의 목요일이 속한 해를 기준 연도로 삼는다(연말·연초 경계에서 주차가 갈리지 않게).
function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// 주차 문자열 하나에서만 나오는 값. 같은 주는 같은 씨앗, 다른 주는 다른 씨앗이다.
function weekSeed(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/* 주차로 바뀌는 것은 "몇 개를 여느냐"가 아니라 "어떤 순서로 여느냐"다.
   전량을 주차 씨앗으로 섞는다 — 묶음을 좁히면 그 주에 못 열리는 질문이 생기고,
   고정 간격으로 뽑으면 도달 불가 구간까지 남는다(1년을 다녀도 590 중 265문항이 안 나왔다).
   같은 주는 같은 순서, 주가 바뀌면 다른 순서이므로 주 1회 갱신은 그대로 성립한다(INV-11). */
function weeklyQuestionIds(key) {
  const ids = Q_POOL.map((item) => item.id);
  let state = weekSeed(key);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;   // 결정적 난수 — 주차가 같으면 결과가 같다
    const j = state % (i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/* 읽은 이력이 있으면 그 분야 질문을 앞쪽에 더 자주 놓는다. 밀도 상한은 자연 비율의 2배이고
   한 문항도 버리지 않는다 — 좁히면 그 주에 못 열리는 질문이 생긴다(원장 32 · 손실 계수). */
function weightByReading(ids) {
  const domain = mostReadDomain();
  if (!domain) return ids;
  const near = [], far = [];
  for (const id of ids) {
    const bookDomain = BY_ID.get(Q_BY_ID.get(id)?.bookId)?.domain;
    (bookDomain === domain ? near : far).push(id);
  }
  if (!near.length || !far.length) return ids;
  const rate = Math.min((2 * near.length) / ids.length, 1);
  const out = [];
  let nearIndex = 0, farIndex = 0, quota = 0;
  while (nearIndex < near.length || farIndex < far.length) {
    quota += rate;
    if (quota >= 1 && nearIndex < near.length) { out.push(near[nearIndex]); nearIndex += 1; quota -= 1; }
    else if (farIndex < far.length) { out.push(far[farIndex]); farIndex += 1; }
    else { out.push(near[nearIndex]); nearIndex += 1; }
  }
  return out;
}

// 추첨은 메모리에만 남긴다. 저장은 [다른 질문]·pagehide·정화 확정 시점에만 일어난다(원장 3).
function drawQuestion() {
  const week = isoWeekKey();
  if (state.questionWeek !== week) {          // 주가 바뀌면 지난주 덱을 버리고 이번 주 묶음으로 갈아탄다
    state.questionWeek = week;
    /* 이번 주 순서로 다시 세우되, 지난주에 아직 안 본 질문을 앞에 둔다. 주가 바뀐다고 버리지도,
       이미 본 질문을 앞머리에서 되풀이하지도 않는다(B3). */
    const unseen = new Set(state.questionDeck.filter((id) => Q_BY_ID.has(id)));
    const fresh = weightByReading(weeklyQuestionIds(week));
    state.questionDeck = unseen.size
      ? [...fresh.filter((id) => unseen.has(id)), ...fresh.filter((id) => !unseen.has(id))]
      : fresh;
    /* 저장이 거부되는 기기(비공개 모드·용량 초과)는 매 방문 이 분기를 탄다. 순서는 그 주의 것을 쓰되
       시작 위치만 흔들어 첫 질문이 그 주 내내 같은 문장으로 고정되지 않게 한다(A6). */
    if (storageBroken) {
      const offset = Math.floor(Math.random() * state.questionDeck.length);
      state.questionDeck = [...state.questionDeck.slice(offset), ...state.questionDeck.slice(0, offset)];
    }
  }
  let deck = state.questionDeck.filter((id) => Q_BY_ID.has(id));
  if (deck.length === 0) deck = weeklyQuestionIds(week);
  let id = deck.shift();
  if (id === state.lastHeroQuestionId && deck.length > 0) {   // 직전 질문 반복 금지(C1-3)
    deck.push(id);
    id = deck.shift();
  }
  state.questionDeck = deck;
  state.lastHeroQuestionId = id;
  return Q_BY_ID.get(id) || Q_POOL[0];
}

let heroQuestion = drawQuestion();
// 저장 키가 이미 있던 재방문에서만 정화·격리 결과와 이번 회차 추첨을 확정한다.
// 입력 0회 첫 방문은 기기에 아무것도 쓰지 않는다(원장 3). 격리 보존은 이 저장으로 영속화된다(원장 11).
if (boot.raw !== null) save();
if (storageBroken) showSaveAlert(LOAD_FAIL_BANNER);
let lastStripKey = null;   // 홈 스트립 2·3번 칸 문맥 전환 감지 (책·수집수 변화 시에만 애니메이션)

/* ── 내비게이션: 히스토리 포인터 + 종료 트랩 (PRD F8, §6) ── */
const HASH = { question: "#question", lineage: "#lineage", library: "#library", record: "#record" };
const TAB_BY_HASH = new Map(Object.entries(HASH).map(([tab, hash]) => [hash, tab]));
const OVERLAY_TYPES = new Set(["sheet", "trail", "jlist", "jdetail", "profile", "settings"]);
// 진입 해시가 탭을 지정하면 그 탭으로 부팅한다. 미지 해시는 홈으로 폴백하되 요청 주소는 그대로 둔다(§6-5).
const bootTab = TAB_BY_HASH.get(location.hash) || "question";
const bootHomeUrl = bootTab === "question" ? location.hash || HASH.question : HASH.question;
let currentView = { tab: "question", overlay: null };
let pointer = 0;                                  // 히스토리 위치 = state.i. 항목을 잘라내지 않는다(N-2)
history.replaceState({ sentinel: true }, "");     // 종료 트랩(센티널) — 고유 값으로만 식별한다(N-1)
history.pushState({ i: 0, view: currentView }, "", bootHomeUrl);   // 기본 화면
if (bootTab !== "question") {
  // 딥링크 탭은 홈 항목 위에 올린다 — 진입 직후 뒤로가기가 종료가 아니라 홈으로 가야 한다(§6-3).
  currentView = { tab: bootTab, overlay: null };
  pointer = 1;
  history.pushState({ i: 1, view: currentView }, "", HASH[bootTab]);
}
const exitEl = document.getElementById("exit-dialog");
const exitBackground = [".topbar", "#view", ".tabbar", "#overlay-root"]
  .map((selector) => document.querySelector(selector));
let exitReturnInProgress = false;
let lastFocus = null;
let appClosed = false;
let overlayReturnFocus = null;

function rememberFocus(element) {
  if (!(element instanceof HTMLElement)) return null;
  if (element.id) return { id: element.id };
  const dataAttribute = [...element.attributes].find((attribute) => attribute.name.startsWith("data-"));
  return dataAttribute ? { name: dataAttribute.name, value: dataAttribute.value } : null;
}

function restoreOverlayFocus() {
  let target = overlayReturnFocus?.id ? document.getElementById(overlayReturnFocus.id) : null;
  if (!target && overlayReturnFocus?.name) {
    target = [...document.querySelectorAll(`[${overlayReturnFocus.name}]`)]
      .find((element) => element.getAttribute(overlayReturnFocus.name) === overlayReturnFocus.value);
  }
  (target || document.querySelector(".tab[aria-current=page]") || viewEl)?.focus();
  overlayReturnFocus = null;
}

function setOverlayBackgroundInert(inert) {
  for (const selector of [".topbar", "#view", ".tabbar"]) {
    const el = document.querySelector(selector);
    el.inert = inert;
    if (inert) el.setAttribute("aria-hidden", "true");
    else el.removeAttribute("aria-hidden");
  }
  document.body.classList.toggle("has-overlay", inert);
}

// 히스토리 페이로드의 뷰를 렌더 가능한 값으로 좁힌다. 되살릴 수 없는 오버레이는 버려 배경만 잠긴 화면을 막는다.
function normalizeView(view) {
  const tab = view && HASH[view.tab] ? view.tab : "question";
  const overlay = view?.overlay;
  if (!overlay || !OVERLAY_TYPES.has(overlay.type)) return { tab, overlay: null };
  if (overlay.type === "sheet" || overlay.type === "trail") {
    return BY_ID.has(overlay.bookId)
      ? { tab, overlay: { type: overlay.type, bookId: overlay.bookId } }
      : { tab, overlay: null };
  }
  if (overlay.type === "jdetail" && !state.journey) return { tab, overlay: null };
  return { tab, overlay: { type: overlay.type } };
}

// 계약 형식이면 그대로 읽고, 미지 항목은 센티널로 접지 않고 현재 주소 기준으로 재구성한다(N-1·N-3).
function readEntry(raw) {
  if (raw && typeof raw.i === "number" && raw.i >= 0 && raw.view) {
    return { i: raw.i, view: normalizeView(raw.view), known: true };
  }
  return {
    i: pointer + 1,
    view: { tab: TAB_BY_HASH.get(location.hash) || currentView.tab, overlay: null },
    known: false,
  };
}

function pushView(view) {
  const previous = currentView;
  if (view.overlay && !top().overlay) overlayReturnFocus = rememberFocus(document.activeElement);
  currentView = view;
  pointer += 1;
  history.pushState({ i: pointer, view }, "", HASH[view.tab]);   // 뷰를 실어 앞으로가기에서 복원한다(N-2)
  rememberTabIndex(view, pointer);
  render();
  // 탭이 바뀌는 이동은 그 화면의 최상단에서 시작한다. 오버레이 push 에는 적용하지 않는다(N-9).
  if (!view.overlay && view.tab !== previous.tab) { scrollPageTop(); clearAnnounce(); }
}
function top() { return currentView; }

/* 탭이 마지막으로 놓인 히스토리 인덱스(세션 한정). 이미 스택에 있는 탭으로 옮길 때 새로 쌓지 않고
   그 자리로 돌아가기 위한 것이다 — 안 그러면 탭을 오갈수록 종료까지의 뒤로가기가 길어진다(원장 47). */
const tabHistoryIndex = new Map();
function rememberTabIndex(view, index) {
  if (!view.overlay) tabHistoryIndex.set(view.tab, index);
}

/* ── 오버레이 닫힘 단일 경로 (§6-4 N-5·N-6·N-7) ────── */
let overlayDismissing = false;   // history.back() 비동기 구간 재진입 잠금
let tabbarLockTimer = 0;
const TABBAR_LOCK_MS = 150;
const TAP_THROUGH_SLOP = 16;          // 같은 자리 판정 허용치(px) — 손가락 흔들림
const TAP_THROUGH_SETTLE_MS = 320;    // 복원 화면이 상호작용 가능해진 다음 프레임부터 세는 여유
const TAP_THROUGH_FALLBACK_MS = 700;  // popstate 미도달 대비 안전 해제
let tapGesture = null;                // 지금 처리 중인 클릭 제스처의 좌표
let tapThrough = null;                // 닫힘을 일으킨 탭의 좌표
let tapThroughTimer = 0;

// 오버레이가 사라진 직후 같은 좌표의 탭바가 눌리는 관통을 막는다. inert는 쓰지 않는다(N-7).
function lockTabbar() {
  const tabbar = document.querySelector(".tabbar");
  tabbar.classList.add("is-tap-locked");
  clearTimeout(tabbarLockTimer);
  tabbarLockTimer = setTimeout(() => tabbar.classList.remove("is-tap-locked"), TABBAR_LOCK_MS);
}

/* 오버레이가 닫히면 아래 화면이 즉시 그 자리로 올라온다. 되살아나는 시트는 배경이 아니어서
   탭바 잠금이 닿지 않고, 시트 전체를 시간 창으로 잠그면 창이 끝난 뒤의 정상 조작까지 죽는다.
   그래서 닫힘을 일으킨 탭의 좌표만 무효로 한다 — 다른 자리 탭은 잠기지 않고 즉시 가드를 걷는다.
   해제 기준은 상수 하나가 아니라 복원 렌더가 화면에 오른 다음 프레임이다(N-7). */
function armTapThrough() {
  if (!tapGesture) return;              // 키보드·프로그램 호출은 관통할 좌표가 없다
  tapThrough = tapGesture;
  clearTimeout(tapThroughTimer);
  tapThroughTimer = setTimeout(releaseTapThrough, TAP_THROUGH_FALLBACK_MS);
}

function releaseTapThrough() {
  tapThrough = null;
  if (tapThroughTimer) { clearTimeout(tapThroughTimer); tapThroughTimer = 0; }
}

function scheduleTapThroughRelease() {
  if (!tapThrough) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!tapThrough) return;
    clearTimeout(tapThroughTimer);
    tapThroughTimer = setTimeout(releaseTapThrough, TAP_THROUGH_SETTLE_MS);
  }));
}

// 같은 자리 = 관통으로 보고 포인터 이벤트를 무효화한다. 다른 자리 = 새 제스처이므로 가드를 걷는다.
function swallowTapThrough(e) {
  if (!tapThrough) return false;
  if (e.type === "click" && e.detail === 0) return false;   // 키보드 활성화는 좌표를 남기지 않는다
  if (Math.abs(e.clientX - tapThrough.x) > TAP_THROUGH_SLOP
    || Math.abs(e.clientY - tapThrough.y) > TAP_THROUGH_SLOP) {
    releaseTapThrough();
    return false;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === "click") releaseTapThrough();              // 한 번 무효화하면 다음 탭은 정상 조작이다
  return true;
}

document.addEventListener("pointerdown", swallowTapThrough, true);
document.addEventListener("pointerup", swallowTapThrough, true);
// 닫힘을 일으킨 제스처의 좌표는 이 제스처가 처리되는 동안에만 유효하다 — 뒤늦은 ESC 닫힘은 무장하지 않는다.
document.addEventListener("click", (e) => {
  if (swallowTapThrough(e)) return;
  tapGesture = e.detail > 0 ? { x: e.clientX, y: e.clientY } : null;
}, true);
window.addEventListener("click", () => { tapGesture = null; });

// 배경 탭·닫기 버튼·ESC·저장 후 닫기가 모두 이 함수만 경유한다. history.back() 호출부는 여기 1곳이다.
function dismissOverlay() {
  if (appClosed) return;
  if (overlayDismissing) return;
  if (!top().overlay) return;
  overlayDismissing = true;
  lockTabbar();
  armTapThrough();
  history.back();
}

window.addEventListener("popstate", (e) => {
  if (appClosed) return;
  overlayDismissing = false;                          // 도착 시 해제 — 조기 return 앞에 두어 고착을 막는다(N-6)
  if (e.state?.closed) return;                        // 닫힘 표식 항목은 뷰 재구성 대상이 아니다
  if (e.state?.sentinel === true) {
    clearHomeNav(); pendingHomeScroll = false;        // 센티널 진입 시 홈 복귀 잠금 해제
    exitReturnInProgress = true;
    showExit();
    history.forward();                                // 팝업 중 반복 뒤로가기로 앱을 벗어나지 않게 복귀
    return;
  }
  const entry = readEntry(e.state);
  /* 센티널에서 forward 로 되돌아온 항목이다. 팝업은 띄운 채 두되 위치·뷰 동기화까지 건너뛰면 안 된다 —
     여러 칸을 한 번에 뒤로 가면(뒤로 제스처 연타) 앱이 기억한 오버레이와 실제 히스토리가 어긋나고,
     그 뒤 어떤 닫기 조작도 dismissOverlay→back→센티널로 되돌아와 새로고침 말고는 빠져나갈 길이 없어진다(N-12). */
  const returningToTrap = exitReturnInProgress && entry.i === 0;
  if (returningToTrap) exitReturnInProgress = false;
  const keepExit = returningToTrap && !exitEl.hidden;
  /* 도착 항목이 지금 보고 있는 화면과 같으면(=첫 화면에서 뒤로 1회 누른 정상 종료 경로)
     다시 그릴 것이 없다. 여기서 render 를 돌리면 팝업이 기억해 둔 복귀 지점 노드가 사라져
     [계속 읽기]·ESC 가 엉뚱한 곳으로 포커스를 보낸다(§2-1 C7-3). 재구성은 실제로 어긋난 때만 한다. */
  const inSync = entry.i === pointer && JSON.stringify(entry.view) === JSON.stringify(currentView);
  if (keepExit) {
    clearHomeNav();
    pendingHomeScroll = false;
    if (inSync) return;
  } else hideExit();
  const hadOverlay = Boolean(top().overlay);
  const previousTab = top().tab;
  // 앞으로가기로 오버레이가 되살아나는 경로에도 복귀 지점을 남긴다(원장 14 정합).
  if (entry.view.overlay && !hadOverlay && !overlayReturnFocus) {
    overlayReturnFocus = rememberFocus(document.activeElement);
  }
  pointer = entry.i;
  currentView = entry.view;
  rememberTabIndex(currentView, pointer);
  if (!entry.known) history.replaceState({ i: pointer, view: currentView }, "");   // 미지 항목 인덱스 재기입(N-3)
  render();
  scheduleTapThroughRelease();                        // 복원 렌더 다음 프레임부터 관통 가드 해제를 센다(N-7)
  if (keepExit) {
    // render 가 오버레이 기준으로 배경 잠금을 다시 계산했으므로 팝업 몫으로 되돌린다.
    setExitBackgroundInert(true);
    lastFocus = null;                                 // 방금 렌더로 사라진 노드다 — 복귀 지점은 팝업이 닫힐 때 다시 정한다
    document.getElementById("exit-stay").focus();
  } else if (hadOverlay && !top().overlay) {
    lockTabbar();                                     // 해제 직후 배경 탭바 잠금(N-7)
    requestAnimationFrame(restoreOverlayFocus);
  }
  if (previousTab !== currentView.tab) clearAnnounce();
  clearHomeNav();                                     // 도착 시 잠금 해제
  if (pendingHomeScroll) {                            // render→포커스 복귀 뒤에 스크롤
    pendingHomeScroll = false;
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, 0)));
  }
});

function setExitBackgroundInert(inert) {
  for (const el of exitBackground) {
    el.inert = inert;
    if (inert) el.setAttribute("aria-hidden", "true");
    else el.removeAttribute("aria-hidden");
  }
}

function showExit() {
  if (!exitEl.hidden) return;
  lastFocus = document.activeElement;
  exitEl.hidden = false;
  document.getElementById("exit-stay").focus();
  setExitBackgroundInert(true);
}
function hideExit() {
  if (!exitEl.hidden) {
    setExitBackgroundInert(false);
    exitEl.hidden = true;
    // 팝업이 오버레이 위에 떴다면 배경 잠금은 오버레이 몫으로 되돌린다 —
    // 무조건 해제하면 시트가 열린 채 뒤 화면이 다시 조작 가능해진다(원장 39).
    if (top().overlay) setOverlayBackgroundInert(true);
    // 팝업이 떠 있는 동안 렌더가 일어났으면 복귀 지점 노드는 이미 사라졌다. 그때는 현재 탭으로 되돌린다.
    if (lastFocus?.isConnected) lastFocus.focus();
    else (overlayRoot.querySelector(".sheet") || document.querySelector(".tab[aria-current=page]") || viewEl)?.focus();
    lastFocus = null;
  }
}

function stayAtHome() {
  hideExit();
}

// 앱 안의 시트는 배경 탭으로 닫힌다. 종료 팝업만 무반응이면 방문자는 갇힌 것으로 느낀다(원장 66).
exitEl.addEventListener("click", (e) => { if (e.target === exitEl) stayAtHome(); });

/* ── 첫 화면 복귀 goHome (v1.8.0 §11-3) ───────────── */
let homeNavInProgress = false;   // go(-d) 비동기 구간 중복 호출 잠금
let pendingHomeScroll = false;   // popstate·render 이후로 미룬 최상단 스크롤
let homeNavTimer = 0;

function clearHomeNav() {
  homeNavInProgress = false;
  if (homeNavTimer) { clearTimeout(homeNavTimer); homeNavTimer = 0; }
}

function goHome() {
  if (appClosed) return;                    // 닫힘 화면 이후 무동작
  if (!exitEl.hidden) return;               // 종료 팝업 표시 중
  if (exitReturnInProgress) return;         // 센티널 복귀(forward) 대기 중
  if (homeNavInProgress) return;            // 연속 탭
  const d = pointer;                        // 인덱스 0까지의 거리
  if (d <= 0) { scrollPageTop(); return; }  // 이미 첫 화면(=인덱스 0, 오버레이 없음)
  homeNavInProgress = true;
  pendingHomeScroll = true;
  homeNavTimer = setTimeout(clearHomeNav, 700); // popstate 미도달 대비 안전 해제
  history.go(-d);                           // 히스토리 위치를 index 0으로 되돌림(센티널 보존)
}

document.getElementById("exit-stay").addEventListener("click", stayAtHome);

document.addEventListener("keydown", (e) => {
  if (!exitEl.hidden) {
    if (e.key === "Escape") {
      e.preventDefault();
      stayAtHome();
      return;
    }
    if (e.key === "Tab") {
      const buttons = [...exitEl.querySelectorAll("button:not([disabled])")];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    return;
  }
  if (top().overlay) {
    const sheet = overlayRoot.querySelector(".sheet");
    if (e.key === "Escape") {
      e.preventDefault();
      dismissOverlay();
      return;
    }
    if (e.key === "Tab" && sheet) {
      const focusable = [...sheet.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) { e.preventDefault(); sheet.focus(); return; }
      if (!sheet.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
});

/* [닫기] — window.close() 는 스크립트가 연 창이 아니면 브라우저가 항상 차단하고 콘솔 경고만 남긴다
   (실측 3/3). 닫히지도 않으면서 경고를 남기는 호출은 제거하고 닫힘 화면으로 바로 간다(원장 60).
   닫힘 화면은 막다른 길이 아니어야 하므로 다시 열기 버튼을 둔다(§6-7 · 원장 38). */
document.getElementById("exit-leave").addEventListener("click", () => {
  appClosed = true;
  setExitBackgroundInert(false);
  history.replaceState({ closed: true }, "", HASH.question);
  document.body.innerHTML = `
    <div class="goodbye" role="status" aria-live="polite">
      <div class="goodbye-box">
        <p class="t">천책빵 사용을 마쳤습니다.</p>
        <p class="d">읽은 자리와 기록은 이 기기에 그대로 있습니다.</p>
        <button class="btn btn-primary" id="reopen-app">다시 열기</button>
      </div>
    </div>`;
  document.getElementById("reopen-app").focus();
  document.getElementById("reopen-app").addEventListener("click", () => location.reload());
});

/* ── 렌더 공통 ─────────────────────────────────────── */
const viewEl = document.getElementById("view");
const overlayRoot = document.getElementById("overlay-root");
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function tierBadge(b) { return `<span class="tier tier-${b.tier}">${TIER_KO[b.tier]}</span>`; }
function statusBadge(id) {
  const st = readStatus(id);
  if (st === "read") return `<span class="badge-read">읽음</span>`;
  if (st === "reading") return `<span class="badge-reading">읽는 중</span>`;
  return "";
}
function bookCard(b, opts = {}) {
  return `
    <button class="card card-tap ${b.tier === "root" ? "is-root" : ""}" data-open-book="${b.id}">
      ${tierBadge(b)}${statusBadge(b.id)}
      <div class="card-title">${esc(b.title)}</div>
      <div class="card-meta">${esc(b.author)} · ${esc(b.era)} · ${esc(b.domain)}</div>
      ${opts.noPrinciple ? "" : `<div class="card-principle">${esc(b.principle)}</div>`}
    </button>`;
}

/* ── 탭: 질문 (홈 대시보드) ─────────────────────────── */
// 읽음이 가장 많은 분야. 동수는 DOMAINS 순서로 가른다.
function mostReadDomain() {
  const counts = new Map();
  for (const id of state.read) {
    const book = BY_ID.get(id);
    if (book) counts.set(book.domain, (counts.get(book.domain) || 0) + 1);
  }
  let best = "", bestCount = 0;
  for (const domain of DOMAINS) {
    const count = counts.get(domain) || 0;
    if (count > bestCount) { best = domain; bestCount = count; }
  }
  return best;
}
// 기본값 우선순위: 저장된 prefs → 읽음 최다 분야 추론 → 첫 분야(원장 5).
let sessionDomain = state.prefs.lineageDomain || mostReadDomain() || DOMAINS[0];
let libQuery = "", libDomain = state.prefs.libDomain, libTier = state.prefs.libTier;
let libComposing = false;   // 한글 IME 조합 중 재렌더 잠금
const LIB_PAGE_SIZE = 80;
let libVisibleCount = LIB_PAGE_SIZE;
let dropArmedId = null;          // 수집 취소를 한 번 확인받는 대상 질문 id (세션 한정)
let openProgressDomain = null;   // 기록 탭 계보 진행률에서 펼쳐 둔 분야 1개(세션 한정 — 복원 대상 아님, C5-2)
let questionQuery = "", questionResults = [], questionNotice = "";
const findBooksForQuestion = createQuestionSearch(ALL);

function questionSearchHtml() {
  const results = questionResults.length
    ? `<div class="question-results" aria-label="연관 책">
        ${questionResults.map(({ book, matchedQuestion }) => `
          <button class="card card-tap question-hit" data-open-book="${book.id}">
            ${tierBadge(book)}
            <div class="card-title">${esc(book.title)}</div>
            <div class="card-meta">${esc(book.author)} · ${esc(book.domain)}</div>
            <div class="match-question">${esc(matchedQuestion.text)}</div>
          </button>`).join("")}
      </div>`
    : questionQuery
      // 빈 결과를 막다른 길로 두지 않는다 — 이 서재가 실제로 답할 수 있는 낱말을 눌러 갈 수 있게 준다(원장 18).
      ? `<p class="empty">${esc(questionQuery)} 로는 연결된 책을 찾지 못했습니다. 아래 낱말로 다시 물어볼 수 있습니다.</p>
         <div class="chips" role="group" aria-label="다시 물어볼 낱말">
           ${TOPIC_CHIPS.map((term) => `<button class="chip" data-ask-term="${esc(term)}">${esc(term)}</button>`).join("")}
         </div>`
      : "";
  // 내가 물었던 것을 다시 물을 수 있게 둔다. 칩은 기존 재검색 경로를 그대로 쓴다.
  const asked = state.askedQuestions.length && !questionQuery
    ? `<p class="section-label">내가 물었던 것</p>
       <div class="chips" role="group" aria-label="다시 물어보기">
         ${state.askedQuestions.slice(0, 5).map((term) => `<button class="chip" data-ask-term="${esc(term)}">${esc(term)}</button>`).join("")}
       </div>`
    : "";
  const status = questionNotice || (questionQuery
    ? `${questionResults.length}권을 찾았습니다.`
    : "질문을 입력하면 책을 찾습니다.");
  return `
    <p class="section-label">질문 하기</p>
    ${questionNotice ? `<p class="empty">${esc(questionNotice)}</p>` : ""}
    <form id="question-search-form" class="question-search">
      <label class="sr-only" for="question-search">책으로 이어질 질문</label>
      <input id="question-search" class="search" type="search" minlength="1"
        placeholder="예: 어떻게 살아야 하는가" value="${esc(questionQuery)}" required>
      <button class="btn btn-primary" type="submit">책 찾기</button>
    </form>
    <p class="sr-only" id="question-search-status" role="status" aria-live="polite">${esc(status)}</p>
    ${asked}
    ${results}`;
}

/* 기록 0건 첫 방문자에게만 1회 노출한다. 삽입 위치는 히어로 직후로 고정한다(INV-1 · 원장 7). */
function hasAnyRecord() {
  return state.read.length > 0 || state.reading.length > 0 || state.questions.length > 0
    || state.journeysDone.length > 0 || Boolean(state.journey) || Boolean(state.profile);
}
function onboardingHtml() {
  if (state.onboardingDismissed || hasAnyRecord()) return "";
  return `
    <div class="card onboard">
      <div class="card-title">이름을 저장하면 이 기기가 읽은 자리를 기억합니다</div>
      <div class="card-meta">읽음 표시와 수집한 질문, 직접 쓴 답은 이 기기에만 남고 밖으로 나가지 않습니다.</div>
      <div class="onboard-actions">
        <button class="btn btn-primary" data-open-profile="1">내 서재 열기</button>
        <button class="btn btn-ghost" data-dismiss-onboard="1">다음에</button>
      </div>
    </div>`;
}

/* 히어로 한 장에 들어가는 값은 여기서만 계산한다. 템플릿과 부분 갱신이 각자 계산하면
   한쪽만 고쳐졌을 때 화면과 저장이 어긋난다(R6). */
function heroFacts() {
  const item = heroQuestion;
  const book = BY_ID.get(item.bookId);
  const length = item.q.text.length;
  const collectedHere = state.questions.filter((x) => x.bookId === item.bookId).length;
  const bookSteps = stepsToRoot(book);
  const stripKey = `${item.bookId}:${collectedHere}`;
  const flip = lastStripKey !== null && lastStripKey !== stripKey ? " q-flip" : "";
  lastStripKey = stripKey;
  // 압축 임계는 여기가 단일 출처다. 게이트가 이 매핑을 그대로 읽어 재므로 형태를 바꾸지 않는다(§4-4).
  const qSize = length <= 22 ? "" : length <= 29 ? " q-mid" : length <= 40 ? " q-long" : " q-xlong";
  return {
    item, book, flip,
    size: qSize,
    collected: state.questions.some((x) => x.id === item.id),
    domain: book ? book.domain : "",
    stats: [
      `${state.read.length}<small>/${ALL.length}</small>`,
      `${collectedHere}<small>/${book ? book.questions.length : 0}</small>`,
      bookSteps === 0 ? "도달" : `${bookSteps}단계`,
      `${state.journeysDone.length}<small>/${JOURNEYS.length}</small>`,
    ],
  };
}

/* 히어로는 제자리에서 고친다. 화면을 다시 그리면 방금 누른 [수집]·[다른 질문] 노드가 사라져
   포커스가 BODY 로 떨어지고 스크린리더는 어디에 있는지 잃는다(원장 20 · §9 E-017).
   구조가 바뀌는 경우(첫 기록으로 안내 카드가 사라지거나 최근 질문 블록이 새로 생길 때)에만
   false 를 돌려 호출부가 전체 렌더로 넘어가게 한다. */
function updateHero() {
  const card = viewEl.querySelector(".q-card");
  if (!card) return false;
  const facts = heroFacts();
  if (!facts.book) return false;
  const textEl = card.querySelector(".q-text");
  textEl.className = `q-text${facts.size}`;
  textEl.querySelector("span").textContent = facts.item.q.text;
  card.querySelector("[data-open-book]").dataset.openBook = facts.book.id;
  const collectBtn = card.querySelector("[data-collect]");
  collectBtn.dataset.collect = facts.item.id;
  collectBtn.disabled = facts.collected;
  collectBtn.textContent = facts.collected ? "수집됨" : "수집";
  const stats = card.querySelectorAll(".qstat");
  if (stats.length !== facts.stats.length) return false;
  stats.forEach((stat, index) => {
    stat.querySelector("b").innerHTML = facts.stats[index];
    if (index === 1 || index === 2) stat.classList.toggle("q-flip", Boolean(facts.flip));   // 스트립 2·3번 칸만 문맥 전환
  });
  const lineageStat = card.querySelector('.qstat[data-tab="lineage"]');
  if (lineageStat) lineageStat.dataset.landDomain = facts.domain;
  return true;
}

/* 최근 질문 카드도 제자리에서 고친다. 블록이 아직 없으면(첫 수집) 구조가 바뀌므로 false 를 돌린다. */
function updateRecentQuestion() {
  const card = viewEl.querySelector("[data-land-question]");
  const last = state.questions[state.questions.length - 1];
  const text = last ? Q_BY_ID.get(last.id)?.q.text : null;
  if (!card || !text) return false;
  card.dataset.landQuestion = last.id;
  card.querySelector(".card-title").textContent = text;
  return true;
}

function renderQuestion() {
  const item = heroQuestion;
  const b = BY_ID.get(item.bookId);
  const collected = state.questions.some((x) => x.id === item.id);
  const j = state.journey ? JOURNEYS.find((x) => x.id === state.journey.id) : null;
  const readingNow = state.reading.map((id) => BY_ID.get(id)).filter(Boolean);
  const lastQ = state.questions[state.questions.length - 1];
  const lastQObj = lastQ ? Q_BY_ID.get(lastQ.id)?.q : null;

  let journeyHtml;
  if (j) {
    const done = state.journey.doneBookIds.length, total = j.bookIds.length;
    journeyHtml = `
      <button class="card card-tap" data-open-jdetail="1">
        <div class="card-meta">${esc(j.domain)} 여정 진행 중 · ${done}/${total}권</div>
        <div class="card-title" style="font-family:var(--serif)">${esc(j.question.text)}</div>
        <div class="jprogress" aria-hidden="true"><i style="width:${Math.round((done / total) * 100)}%"></i></div>
      </button>`;
  } else {
    journeyHtml = `
      <button class="card card-tap" data-open-jlist="1">
        <div class="card-title">여정 시작하기</div>
        <div class="card-meta">질문 하나를 따라 뿌리까지 읽습니다</div>
      </button>`;   // 완료 수치는 위 스트립이 원천이다 — 한 화면에 두 번 두지 않는다(R6 · 원장 45)
  }

  const gaugeRows = DOMAINS.map((d) => {
    const books = ALL.filter((x) => x.domain === d);
    const done = books.filter((x) => state.read.includes(x.id)).length;
    const pct = books.length ? Math.round((done / books.length) * 100) : 0;
    return `
      <button class="gauge-row" data-open-domain-list="${esc(d)}"
        aria-label="${esc(d)} 책 목록 보기, ${done}권 읽음, 전체 ${books.length}권">
        <span class="name">${esc(d)}</span>
        <span class="bar"><i style="width:${pct}%"></i></span>
      </button>`;
  }).join("");

  const facts = heroFacts();   // 2줄 고정 — 길이에 따라 글자만 압축, 박스 높이 불변
  const flip = facts.flip;

  viewEl.innerHTML = `
    <section aria-label="이번 주의 질문">
      <div class="q-card">
        <p class="q-text${facts.size}"><span>${esc(item.q.text)}</span></p>
        <div class="q-actions">
          <button class="btn btn-light" data-open-book="${b.id}">이 질문의 책</button>
          <button class="btn btn-outline" data-collect="${item.id}" ${collected ? "disabled" : ""}>${collected ? "수집됨" : "수집"}</button>
          <button class="btn-quiet" data-shuffle="1">다른 질문</button>
        </div>
        <div class="q-stats" role="group" aria-label="나의 기록">
          <button class="qstat" data-tab="record"><b>${facts.stats[0]}</b><span>읽은 책</span></button>
          <button class="qstat is-ctx${flip}" data-tab="record"><b>${facts.stats[1]}</b><span>수집한 질문</span></button>
          <button class="qstat is-ctx${flip}" data-tab="lineage" data-land-domain="${esc(facts.domain)}"><b>${facts.stats[2]}</b><span>뿌리까지</span></button>
          <button class="qstat" data-open-jlist="1"><b>${facts.stats[3]}</b><span>여정 완료</span></button>
        </div>
      </div>
    </section>
    ${onboardingHtml()}

    ${questionSearchHtml()}
    ${lastQObj ? `
      <p class="section-label">최근 질문</p>
      <button class="card card-tap" data-tab="record" data-land-question="${esc(lastQ.id)}">
        <div class="card-title" style="font-family:var(--serif)">${esc(lastQObj.text)}</div>
      </button>` : ""}

    <p class="section-label">질문 여정</p>
    ${journeyHtml}
    ${readingNow.length ? `<p class="section-label">읽는 중</p>` + readingNow.map((x) => bookCard(x, { noPrinciple: true })).join("") : ""}

    <p class="section-label">분야별 진행</p>
    <div class="gauge">${gaugeRows}</div>`;
}

/* ── 탭: 계보 ─────────────────────────────────────── */
function lineageBooks() {
  return ALL.filter((b) => b.domain === sessionDomain)
    .sort((a, z) => TIER_ORDER[a.tier] - TIER_ORDER[z.tier]);
}
function lineageLabel() { return `${sessionDomain}의 계보 — 뿌리에서 가지로`; }

function renderLineage() {
  viewEl.innerHTML = `
    <div class="chips" role="group" aria-label="분야 선택">
      ${DOMAINS.map((d) => `<button class="chip" data-domain="${esc(d)}" aria-pressed="${d === sessionDomain}">${esc(d)}</button>`).join("")}
    </div>
    <p class="section-label">${esc(lineageLabel())}</p>
    <div class="stream">${lineageBooks().map((b) => bookCard(b)).join("")}</div>`;
}

/* 분야를 바꿔도 칩 줄은 그대로 두고 라벨과 목록만 고친다. 화면을 통째로 다시 그리면
   방금 누른 칩 노드가 사라져 포커스가 BODY 로 떨어진다(원장 20 · §9 E-017). */
function updateLineageDomain() {
  const stream = viewEl.querySelector(".stream");
  if (!stream) { render(); return; }
  for (const chip of viewEl.querySelectorAll("[data-domain]")) {
    chip.setAttribute("aria-pressed", String(chip.dataset.domain === sessionDomain));
  }
  viewEl.querySelector(".section-label").textContent = lineageLabel();
  stream.innerHTML = lineageBooks().map((b) => bookCard(b)).join("");
}

/* ── 탭: 서재 ─────────────────────────────────────── */
function libraryBooks() {
  const q = libQuery.trim();
  let books = ALL.slice().sort((a, z) =>
    TIER_ORDER[a.tier] - TIER_ORDER[z.tier] || DOMAINS.indexOf(a.domain) - DOMAINS.indexOf(z.domain));
  if (libDomain !== "전체") books = books.filter((b) => b.domain === libDomain);
  if (libTier !== "전체") books = books.filter((b) => TIER_KO[b.tier] === libTier);
  // 홈 질문 검색과 같은 정규화를 쓴다 — 띄어쓰기·구두점 차이로 결과가 사라지지 않는다(원장 16).
  const compact = compactSearchText(q);
  if (compact) {
    books = books.filter((b) => compactSearchText(b.title).includes(compact)
      || compactSearchText(b.author).includes(compact));
  }
  return books;
}

// 목록 갱신 경계는 #lib-list 하나다. 검색 입력·칩·요약줄은 컨테이너 밖이라 타이핑 중 파괴되지 않는다(원장 1).
// 권수는 목록과 같은 계산에서 나오므로 요약줄도 여기서 함께 맞춘다.
function renderLibList() {
  const books = libraryBooks();
  const total = books.length;
  const visibleBooks = books.slice(0, libVisibleCount);
  document.getElementById("lib-list").innerHTML = `
    ${total ? visibleBooks.map((b) => bookCard(b)).join("") : `<p class="empty">조건에 맞는 책이 없습니다.</p>`}
    ${visibleBooks.length < total
      ? `<button class="btn btn-light load-more" data-load-more="1">더 보기 · ${visibleBooks.length}/${total}권</button>`
      : ""}`;
  viewEl.querySelector(".library-summary").textContent =
    `${libDomain === "전체" ? "전체 서재" : libDomain} · ${total}권`;
  /* 좁혀진 상태에서 되돌릴 길을 한 곳에 둔다. 칩을 두 번 눌러 원복하는 방식은 지금 무엇이 걸려 있는지를
     방문자가 스스로 추적해야 한다 — 홈 게이지로 들어온 방문자는 필터가 걸린 사실조차 모른다(원장 50 · 36). */
  const narrowed = libDomain !== "전체" || libTier !== "전체" || Boolean(libQuery.trim());
  document.getElementById("lib-reset").innerHTML = narrowed
    ? `<button class="btn btn-light lib-reset" data-lib-reset="1">전체 보기로 되돌리기</button>`
    : "";
}

function renderLibrary() {
  viewEl.innerHTML = `
    ${IS_SEED ? `<div class="notice">시드 데이터 ${ALL.length}권 — 정식 천 권 리스트 교체 예정</div>` : ""}
    <p class="library-summary"></p>
    <input class="search" type="search" id="lib-search" placeholder="제목 또는 저자 검색" value="${esc(libQuery)}" aria-label="서재 검색">
    <div class="chips" role="group" aria-label="분야 필터">
      ${["전체", ...DOMAINS].map((d) => `<button class="chip" data-libdomain="${esc(d)}" aria-pressed="${d === libDomain}">${esc(d)}</button>`).join("")}
    </div>
    <div class="chips" role="group" aria-label="계단 필터">
      ${LIB_TIERS.map((t) => `<button class="chip" data-libtier="${esc(t)}" aria-pressed="${t === libTier}">${esc(t)}</button>`).join("")}
    </div>
    <div id="lib-reset"></div>
    <div id="lib-list"></div>`;
  renderLibList();
  const input = document.getElementById("lib-search");
  libComposing = false;                      // 새 입력 노드 — 조합 잠금 초기화
  input.addEventListener("compositionstart", () => { libComposing = true; });
  input.addEventListener("input", (e) => {
    if (e.isComposing || libComposing) { libQuery = input.value; return; }  // 조합 중: 값만 갱신하고 렌더 보류
    applyLibQuery(input);
  });
  input.addEventListener("compositionend", () => {
    libComposing = false;
    applyLibQuery(input);                    // 조합 확정 시 1회만 렌더
  });
}

/* 필터 변경도 같은 경계를 쓴다 — 칩 줄은 남기고 눌린 상태와 목록만 고친다(원장 20). */
// 서재 탭의 칩은 지금 보고 있는 필터를 그린다(저장값이 아니다 — 설정 시트가 저장값을 맡는다).
function updateLibraryFilters() {
  for (const chip of viewEl.querySelectorAll("[data-libdomain]")) {
    chip.setAttribute("aria-pressed", String(chip.dataset.libdomain === libDomain));
  }
  for (const chip of viewEl.querySelectorAll("[data-libtier]")) {
    chip.setAttribute("aria-pressed", String(chip.dataset.libtier === libTier));
  }
  const input = document.getElementById("lib-search");
  if (input && input.value !== libQuery) input.value = libQuery;
  if (document.getElementById("lib-list")) renderLibList();   // 서재 탭을 보고 있을 때만 목록이 있다
}

// 목록만 다시 그리므로 입력 노드와 선택 위치는 그대로 남는다 — 조합 잠금은 조합 중 렌더 보류용이다(원장 1).
function applyLibQuery(input) {
  if (!input.isConnected) return;            // 이미 렌더로 교체된 노드의 뒤늦은 이벤트
  libQuery = input.value;
  libVisibleCount = LIB_PAGE_SIZE;
  renderLibList();
}

/* ── 탭: 기록 ─────────────────────────────────────── */
function domainBooks(domain) {
  return ALL.filter((b) => b.domain === domain).sort((a, z) => TIER_ORDER[a.tier] - TIER_ORDER[z.tier]);
}

// 계보 진행률 탭을 펼쳤을 때 보이는 책 한 줄. 카드가 아니라 목록 행으로 둔다.
function progressBookRow(b) {
  return `
    <button class="progress-book" data-open-book="${b.id}">
      ${tierBadge(b)}
      <span class="t">${esc(b.title)}<span class="a">${esc(b.author)}</span></span>
    </button>`;
}

/* 진행률은 읽음 기준이므로 펼친 목록은 아직 손대지 않은 책만 담는다. 읽음·읽는 중 책은
   같은 화면 아래 개인 기록 섹션이 원천이고, 여기서 다시 그리면 한 화면에 같은 책이 두 번
   나온다(R6 1정보 1표시). 전권 읽음 + 문학 펼침 조건에서 64권 전량이 중복됐다(§9 E-016). */
function progressPanelHtml(domain) {
  const remaining = domainBooks(domain).filter((b) => readStatus(b.id) === "none");
  if (!remaining.length) return `<p class="progress-note">남은 책이 없습니다. 아래 읽은 책에서 이어 봅니다.</p>`;
  return `<p class="progress-note">아직 읽지 않은 책</p>${remaining.map((b) => progressBookRow(b)).join("")}`;
}

function progressRowsHtml() {
  // 분야마다 탭 1개 — 누르면 그 분야 목록이 바로 아래 펼쳐진다. 한 번에 한 분야만 열린다.
  return DOMAINS.map((d, index) => {
    const books = domainBooks(d);
    const done = books.filter((b) => state.read.includes(b.id)).length;
    const open = openProgressDomain === d;
    const panelId = `progress-panel-${index}`;
    return `
      <button class="progress-row" data-progress-domain="${esc(d)}"
        aria-expanded="${open}" aria-controls="${panelId}">
        <span class="name">${esc(d)}</span>
        <b>${done} / ${books.length}권</b>
      </button>
      <div class="progress-panel" id="${panelId}" role="group"
        aria-label="${esc(d)} 아직 읽지 않은 책"${open ? "" : " hidden"}>
        ${open ? progressPanelHtml(d) : ""}
      </div>`;
  }).join("");
}

/* 개폐는 진행률 패널만 갱신한다. 기록 화면을 통째로 다시 그리면 문답집·책 카드 수백 장이
   함께 그려져 동기 렌더가 §7 승격선을 넘고, 눌린 버튼까지 사라져 포커스가 날아간다.
   갱신 경계를 좁히는 방식은 renderLibList 가 이미 확립한 패턴이다(§9 E-017). */
function renderProgressPanels() {
  for (const row of viewEl.querySelectorAll("[data-progress-domain]")) {
    const domain = row.dataset.progressDomain;
    const open = openProgressDomain === domain;
    row.setAttribute("aria-expanded", String(open));
    const panel = document.getElementById(row.getAttribute("aria-controls"));
    panel.hidden = !open;
    panel.innerHTML = open ? progressPanelHtml(domain) : "";
  }
}

function renderRecord() {
  const reading = state.reading.map((id) => BY_ID.get(id)).filter(Boolean);
  const read = state.read.map((id) => BY_ID.get(id)).filter(Boolean);
  const domainRows = progressRowsHtml();

  const qa = state.questions.map((x, index) => {
    const b = BY_ID.get(x.bookId);
    const qObj = Q_BY_ID.get(x.id)?.q;
    if (!b || !qObj) return "";
    // 답칸의 접근 이름은 질문 문단이다 — placeholder 는 입력이 시작되면 사라져 이름 노릇을 못 한다(원장 52).
    return `
      <div class="card qa-item">
        <p class="q" id="qa-q-${index}">${esc(qObj.text)}</p>
        <span class="src">${esc(b.author)}, ${esc(qObj.source)} · ${esc(x.date)} 수집</span>
        <textarea data-answer-q="${x.id}" aria-labelledby="qa-q-${index}" maxlength="${ANSWER_MAX}"
          placeholder="나의 답을 적어 둡니다 (기기에만 보관)">${esc(x.myAnswer || "")}</textarea>
        <div class="qa-actions">${dropArmedId === x.id
          ? `<span class="qa-warn">쓴 답도 함께 지워집니다.</span>
             <button class="btn btn-ghost" data-drop-confirm="${x.id}">지우기</button>
             <button class="btn btn-light" data-drop-cancel="1">취소</button>`
          : `<button class="btn btn-light" data-drop-question="${x.id}">수집 취소</button>`}</div>
      </div>`;
  }).join("");

  const jqa = state.journeysDone.map((x, index) => {
    const j = JOURNEYS.find((y) => y.id === x.id);
    if (!j) return "";
    return `
      <div class="card qa-item">
        <p class="q" id="jqa-q-${index}">${esc(j.question.text)}</p>
        <span class="src">${esc(j.domain)} 여정 완료 · ${esc(x.date)}</span>
        <textarea data-answer-j="${x.id}" aria-labelledby="jqa-q-${index}" maxlength="${ANSWER_MAX}"
          placeholder="이 질문에 대한 나의 답">${esc(x.myAnswer || "")}</textarea>
      </div>`;
  }).join("");

  // 격리 보존 고지 — 기록 탭에서만 1회 알린다(DI-1 · 원장 11).
  const orphanNotice = state.orphans.length
    ? `<div class="notice" data-orphan-notice="1">책 목록이 바뀌어 연결이 끊긴 기록 ${state.orphans.length}건을 지우지 않고 따로 보관했습니다. 해당 책이 목록에 돌아오면 다시 이어집니다.</div>`
    : "";

  viewEl.innerHTML = `
    ${orphanNotice}
    <p class="section-label">계보 진행률 (읽음 기준)</p>
    <div class="card">${domainRows}</div>
    <p class="section-label">나만의 문답집 — 개인 기록 전용</p>
    ${qa || jqa ? jqa + qa : `<p class="empty">수집한 질문이 아직 없습니다. 이번 주의 질문에서 시작해 보세요.</p>`}
    ${reading.length ? `<p class="section-label">읽는 중 (${reading.length}권)</p>` + reading.map((b) => bookCard(b, { noPrinciple: true })).join("") : ""}
    ${read.length ? `<p class="section-label">읽은 책 (${read.length}권)</p>` + read.map((b) => bookCard(b, { noPrinciple: true })).join("") : ""}`;
}

/* ── 오버레이: 책 상세 시트 (F6) ────────────────────── */
function renderSheet(bookId) {
  const b = BY_ID.get(bookId);
  if (!b) { overlayRoot.innerHTML = ""; return; }
  const st = readStatus(b.id);
  const stLabel = { none: "안 읽음", reading: "읽는 중", read: "읽음" }[st];
  const qs = b.questions.map((q, i) => {
    const qid = questionId(b, i);
    const collected = state.questions.some((x) => x.id === qid);
    return `
      <div class="book-q">
        <p>${esc(q.text)}<span class="src">${esc(q.source)}</span></p>
        <button class="btn btn-ghost" data-collect="${qid}" ${collected ? "disabled" : ""}>${collected ? "수집됨" : "수집"}</button>
      </div>`;
  }).join("");

  overlayRoot.innerHTML = `
    <div class="sheet-backdrop" data-close-overlay="1">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(b.title)} 상세" tabindex="-1">
        <div class="sheet-handle"></div>
        <button class="sheet-close" data-close-overlay="1" aria-label="책 상세 닫기">닫기</button>
        ${tierBadge(b)}${statusBadge(b.id)}
        <h2>${esc(b.title)}</h2>
        <p class="meta">${esc(b.author)} · ${esc(b.era)} · ${esc(b.domain)}</p>
        ${b.celeb2025?.verificationStatus === "source-text-retained"
          ? `<div class="notice source-note">엑셀 원문 표기를 보존한 항목입니다. 정확한 서지는 확인되지 않았습니다.</div>`
          : ""}
        <div class="principle-box">${esc(b.principle)}</div>
        <p class="section-label">이 책이 던지는 질문</p>
        ${qs}
        <div class="sheet-actions">
          ${b.tier === "root"
            ? `<button class="btn btn-primary" data-goto-lineage="${esc(b.domain)}">이 책이 뿌리 고전입니다 — 계보 보기</button>`
            : `<button class="btn btn-primary" data-open-trail="${b.id}">뿌리 따라가기</button>`}
          <button class="btn btn-ghost" data-cycle-read="${b.id}">읽음 상태: ${stLabel} (탭하여 변경)</button>
        </div>
      </div>
    </div>`;
  overlayRoot.querySelector(".sheet").focus();
}

/* ── 오버레이: 뿌리 따라가기 (F1) ───────────────────── */
function renderTrail(bookId) {
  const chain = [];
  let cur = BY_ID.get(bookId);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    if (cur.tier === "root") break;
    cur = BY_ID.get(cur.roots[0]);
  }
  const root = chain[chain.length - 1];
  const steps = chain.map((b, i) => {
    const why = i < chain.length - 1
      ? `<p class="trail-why">${esc(b.root_reason)}</p>` : "";
    return `<div class="trail-step">${bookCard(b, { noPrinciple: true })}${why}</div>`;
  }).join("");

  overlayRoot.innerHTML = `
    <div class="sheet-backdrop" data-close-overlay="1">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="뿌리 따라가기" tabindex="-1">
        <div class="sheet-handle"></div>
        <button class="sheet-close" data-close-overlay="1" aria-label="뿌리 따라가기 닫기">닫기</button>
        <p class="section-label">뿌리 따라가기 — 가지에서 뿌리로</p>
        ${steps}
        <div class="trail-end">
          <p class="label">이 책의 뿌리</p>
          <p class="name">${esc(root.title)} — ${esc(root.author)}, ${esc(root.era)}</p>
        </div>
        <div class="sheet-actions">
          <button class="btn btn-primary" data-goto-lineage="${esc(root.domain)}">${esc(root.domain)} 계보 보기</button>
        </div>
      </div>
    </div>`;
  overlayRoot.querySelector(".sheet").focus();
}

/* ── 오버레이: 여정 목록 / 여정 상세 (F7) ───────────── */
function renderJourneyList() {
  const items = JOURNEYS.map((j) => {
    const done = state.journeysDone.some((x) => x.id === j.id);
    const active = state.journey && state.journey.id === j.id;
    const locked = state.journey && !active;
    return `
      <button class="card card-tap" data-start-journey="${j.id}" ${done || locked ? "disabled" : ""}>
        <div class="card-meta">${esc(j.domain)} · ${j.bookIds.length}권${done ? " · 완료" : active ? " · 진행 중" : ""}</div>
        <div class="card-title" style="font-family:var(--serif)">${esc(j.question.text)}</div>
        <div class="card-meta">${esc(j.question.source)}</div>
      </button>`;
  }).join("");
  overlayRoot.innerHTML = `
    <div class="sheet-backdrop" data-close-overlay="1">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="여정 선택" tabindex="-1">
        <div class="sheet-handle"></div>
        <button class="sheet-close" data-close-overlay="1" aria-label="여정 선택 닫기">닫기</button>
        <p class="section-label">질문 여정 — 하나의 질문, 뿌리에서 가지까지</p>
        ${JOURNEYS.every((item) => state.journeysDone.some((x) => x.id === item.id))
          // 완주 수치는 홈 스트립이 원천이므로 문구에 넣지 않는다(R6 · 원장 65).
          ? `<div class="notice">모든 갈래의 질문을 지나 왔습니다. 남긴 답은 기록 탭 문답집에 그대로 있습니다.</div>`
          : ""}
        ${state.journey ? `<div class="notice">진행 중인 여정을 완료한 뒤 새 여정을 시작할 수 있습니다.</div>` : ""}
        ${items}
      </div>
    </div>`;
  overlayRoot.querySelector(".sheet").focus();
}

function renderJourneyDetail() {
  const j = state.journey ? JOURNEYS.find((x) => x.id === state.journey.id) : null;
  if (!j) { overlayRoot.innerHTML = ""; return; }
  const doneIds = state.journey.doneBookIds;
  const allDone = j.bookIds.every((id) => doneIds.includes(id));
  const books = j.bookIds.map((id, index) => {
    const b = BY_ID.get(id);
    const checked = doneIds.includes(id);
    const unlocked = j.bookIds.slice(0, index).every((previousId) => doneIds.includes(previousId));
    const locked = !checked && !unlocked;
    return `
      <div class="card journey-check${locked ? " is-locked" : ""}">
        <input type="checkbox" id="jc-${id}" data-jcheck="${id}" ${checked ? "checked" : ""} ${locked ? "disabled" : ""} aria-label="${esc(b.title)} 읽음 체크">
        <label for="jc-${id}" style="flex:1">
          ${tierBadge(b)}
          <div class="card-title">${esc(b.title)}</div>
          <div class="card-meta">${esc(b.author)} · ${esc(b.era)}</div>
          ${locked ? `<div class="lock-why">앞의 책을 먼저 읽으면 열립니다</div>` : ""}
        </label>
      </div>`;
  }).join("");

  overlayRoot.innerHTML = `
    <div class="sheet-backdrop" data-close-overlay="1">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="여정 진행" tabindex="-1">
        <div class="sheet-handle"></div>
        <button class="sheet-close" data-close-overlay="1" aria-label="여정 진행 닫기">닫기</button>
        <div class="q-card" style="margin-bottom:12px">
          <p class="q-kicker">${esc(journeyProgressText(j, doneIds))}</p>
          <p class="q-text" style="font-size:19px">${esc(j.question.text)}</p>
          <p class="q-source">${esc(j.question.source)}</p>
        </div>
        ${books}
        <div id="journey-done-wrap">${journeyDoneHtml(j, allDone)}</div>
        <div class="sheet-actions">
          <button class="btn btn-ghost" data-quit-journey="${j.id}">여정 그만두기</button>
        </div>
      </div>
    </div>`;
  overlayRoot.querySelector(".sheet").focus();
}

function journeyProgressText(j, doneIds) {
  return `${j.domain} 여정 · ${doneIds.length}/${j.bookIds.length}권`;
}

// 완료 답 초안은 state.journeyDraft 가 원천이므로 이 카드가 다시 그려져도 쓰던 답이 남는다.
function journeyDoneHtml(j, allDone) {
  if (!allDone) return "";
  const next = JOURNEYS.find((x) => x.id !== j.id && !state.journeysDone.some((d) => d.id === x.id));
  return `
    <div class="journey-done">
      <p class="q-kicker">여정 완료</p>
      <p class="q">${esc(j.question.text)} — 이 질문에 대한 나의 답은 무엇인가.</p>
      <label class="sr-only" for="j-answer">이 질문에 대한 나의 답</label>
      <textarea id="j-answer" data-answer-draft="1" maxlength="${ANSWER_MAX}"
        placeholder="나의 답 (기기에만 보관)">${esc(state.journeyDraft)}</textarea>
      <div class="sheet-actions">
        <button class="btn btn-light" data-finish-journey="${j.id}">여정 완료로 저장</button>
      </div>
    </div>
    ${next ? `<p class="next-suggest">다음 여정 — ${esc(next.domain)} · ${esc(next.question.text)}</p>` : ""}`;
}

/* 체크박스 조작은 전면 재렌더 대신 체크 상태·진행 문구·완료 카드 표시 여부만 갱신한다(원장 9). */
function updateJourneyDetail() {
  const j = state.journey ? JOURNEYS.find((x) => x.id === state.journey.id) : null;
  if (!j) { render(); return; }
  const doneIds = state.journey.doneBookIds;
  j.bookIds.forEach((id, index) => {
    const box = overlayRoot.querySelector(`[data-jcheck="${id}"]`);
    if (!box) return;
    const checked = doneIds.includes(id);
    const locked = !checked && !j.bookIds.slice(0, index).every((previousId) => doneIds.includes(previousId));
    box.checked = checked;
    box.disabled = locked;
    box.closest(".journey-check").classList.toggle("is-locked", locked);
  });
  const kicker = overlayRoot.querySelector(".q-card .q-kicker");
  if (kicker) kicker.textContent = journeyProgressText(j, doneIds);
  const wrap = overlayRoot.querySelector("#journey-done-wrap");
  const allDone = j.bookIds.every((id) => doneIds.includes(id));
  if (wrap && Boolean(wrap.firstElementChild) !== allDone) wrap.innerHTML = journeyDoneHtml(j, allDone);
}

/* ── 오버레이: 내 서재 (F9, 로컬 프로필) ───────────── */
function renderProfile() {
  const p = state.profile;
  overlayRoot.innerHTML = `
    <div class="sheet-backdrop" data-close-overlay="1">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="profile-title" aria-describedby="profile-note" tabindex="-1">
        <div class="sheet-handle"></div>
        <button class="sheet-close" data-close-overlay="1" aria-label="내 서재 닫기">닫기</button>
        <h2 id="profile-title">${p ? esc(p.name) + "님의 서재" : "내 서재"}</h2>
        <p class="meta">${p ? "저장된 이름을 바꾸거나 지울 수 있습니다." : "이름 또는 별명을 저장합니다."}</p>
        <form id="profile-form">
          <input class="profile-input" id="profile-name" type="text" maxlength="20"
            placeholder="이름 또는 별명" value="${p ? esc(p.name) : ""}" aria-label="이름"
            aria-describedby="profile-note" enterkeyhint="done">
          <p id="profile-note" class="profile-note">기록과 이름은 이 기기에만 보관됩니다.</p>
          <div class="sheet-actions">
            <button class="btn btn-primary" type="submit" data-save-profile="1">${p ? "이름 변경" : "저장"}</button>
            ${p ? `<button class="btn btn-ghost" type="button" data-clear-profile="1">이름 지우기</button>` : ""}
          </div>
        </form>
        <p id="profile-alert" role="alert" hidden>이름 또는 별명을 입력해 주세요.</p>
      </div>
    </div>`;
  overlayRoot.querySelector(".sheet").focus();
}

/* ── 오버레이: 설정 (F4 맞춤설정·기록 관리, 원장 8) ─── */
let resetArmed = false;   // 기록 초기화는 확인 1회를 받는다(C6-4)

function renderSettings() {
  overlayRoot.innerHTML = `
    <div class="sheet-backdrop" data-close-overlay="1">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
        <div class="sheet-handle"></div>
        <button class="sheet-close" data-close-overlay="1" aria-label="설정 닫기">닫기</button>
        <h2 id="settings-title">설정</h2>
        <p class="meta">고른 값은 이 기기에 저장되어 다음 방문에도 그대로 열립니다.</p>
        <p class="section-label">관심 분야</p>
        <div class="chips" role="group" aria-label="관심 분야 선택">
          ${DOMAINS.map((d) => `<button class="chip" data-setdomain="${esc(d)}" aria-pressed="${d === sessionDomain}">${esc(d)}</button>`).join("")}
        </div>
        <p class="section-label">서재 필터</p>
        <!-- 설정은 저장된 값을 보여준다. 서재 탭의 칩은 지금 보고 있는 값(세션)을 보여주므로 속성을 나눈다 —
             한 속성으로 두 화면을 그리면, 홈 게이지로 걸린 세션 필터가 저장된 설정인 것처럼 보인다(A4). -->
        <div class="chips" role="group" aria-label="저장할 서재 분야">
          ${["전체", ...DOMAINS].map((d) => `<button class="chip" data-setlibdomain="${esc(d)}" aria-pressed="${d === state.prefs.libDomain}">${esc(d)}</button>`).join("")}
        </div>
        <div class="chips" role="group" aria-label="저장할 서재 계단">
          ${LIB_TIERS.map((tier) => `<button class="chip" data-setlibtier="${esc(tier)}" aria-pressed="${tier === state.prefs.libTier}">${esc(tier)}</button>`).join("")}
        </div>
        <div class="settings-list">
          <button class="settings-row" data-toggle-theme="1" aria-label="화면 색 바꾸기, 지금은 ${state.theme === "navy" ? "남색" : "은회"}">
            <span>화면 색</span><span class="value">${state.theme === "navy" ? "남색" : "은회"}</span>
          </button>
          <button class="settings-row" data-tab="record">
            <span>내 기록 보기</span><span class="value">기록 탭</span>
          </button>
        </div>
        <p class="section-label">기록 관리</p>
        <div class="sheet-actions">
          <button class="btn btn-light" data-export-records="1">파일로 내보내기</button>
          <label class="sr-only" for="import-file">불러올 기록 파일</label>
          <input class="search" id="import-file" type="file" accept="application/json,.json">
          <button class="btn btn-light" data-import-records="1">고른 파일 불러오기</button>
          ${resetArmed
            ? `<p class="profile-note">지우면 되돌릴 수 없습니다. 읽음 표시·수집한 질문·답·여정 진행·저장한 이름이 함께 사라집니다.</p>
               <button class="btn btn-primary" data-reset-confirm="1">기록 모두 지우기 실행</button>
               <button class="btn btn-ghost" data-reset-cancel="1">취소</button>`
            : `<button class="btn btn-ghost" data-reset-records="1">기록 모두 지우기</button>`}
        </div>
        <p class="profile-note">내보낸 파일은 이 기기 안에서만 만들어집니다.</p>
      </div>
    </div>`;
  overlayRoot.querySelector(".sheet").focus();
}

// 내보내기는 Blob 과 a[download] 로만 만든다 — 어떤 경로로도 기록을 밖으로 보내지 않는다(DI-7).
function exportRecords() {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
  link.href = url;
  link.download = `천책빵-기록-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  announce("기록 파일을 내보냈습니다.");
}

// 불러오기는 sanitizeState 를 반드시 통과시킨다. 기준선을 현재 저장값으로 맞춰 불러온 기록이 병합에 밀리지 않게 한다.
async function importRecords(file, button) {
  let payload = null;
  try { payload = JSON.parse(await file.text()); } catch { payload = null; }
  if (!payload || typeof payload !== "object") {
    button.disabled = false;
    announce("파일 형식이 달라 기록을 불러오지 못했습니다.");
    showSaveAlert("고른 파일이 천책빵 기록 형식이 아닙니다. 내보내기로 만든 파일을 고르세요.");
    return;
  }
  const backup = cloneState(state);
  const stored = readStored();
  syncedSnapshot = stored ? sanitizeState(stored) : sanitizeState();
  Object.assign(state, sanitizeState(payload));
  if (!save()) {
    Object.assign(state, backup);
    syncedSnapshot = cloneState(backup);
    button.disabled = false;
    return;
  }
  heroQuestion = Q_BY_ID.get(state.lastHeroQuestionId) || heroQuestion;
  applyTheme();
  sessionDomain = state.prefs.lineageDomain || mostReadDomain() || DOMAINS[0];
  libDomain = state.prefs.libDomain;
  libTier = state.prefs.libTier;
  libVisibleCount = LIB_PAGE_SIZE;
  announce("파일에서 기록을 불러왔습니다.");
  render();
}

// 저장소만 지우면 다음 save 에서 되살아난다. 인메모리 state 와 병합 기준선을 정화 함수로 재초기화한다(C6-3).
function resetRecords() {
  /* 화면 색과 관심 분야는 기기 설정이라 남긴다. 안내 해제 표식은 기록과 함께 지운다 —
     공용 기기에서 다음 사용자가 첫 방문자인데 등록 안내를 못 받으면 C2-2 가 무력화된다. */
  const fresh = sanitizeState({ theme: state.theme, prefs: state.prefs });
  try { localStorage.removeItem(STORE_KEY); } catch { /* 실패 여부는 아래 save 결과로 판정한다 */ }
  Object.assign(state, fresh);
  syncedSnapshot = cloneState(fresh);
  heroQuestion = drawQuestion();
  resetArmed = false;
  announce(save() ? "이 기기에 남아 있던 기록을 모두 지웠습니다." : SAVE_FAIL_NOTICE);
  dismissOverlay();
}

/* ── 배포 갱신 통지 수신 (§6-3, 원장 12) ───────────── */
let updateReady = false;

// 통지를 받자마자 reload 하면 읽던 자리와 히스토리를 잃는다. 안전한 시점에만 안내를 띄운다.
function updateMomentSafe() {
  if (!exitEl.hidden) return false;                              // 종료 팝업 표시 중
  if (top().overlay) return false;                               // 오버레이 표시 중
  const focused = document.activeElement;
  return !(focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement);   // 입력 중
}

function updateNoticeHtml() {
  return `
    <div class="notice" role="status">
      <p>새 버전을 받았습니다.</p>
      <button class="btn btn-light" data-apply-update="1">지금 적용하기</button>
    </div>`;
}

// 홈은 히어로 질문 다음에 끼운다 — 최상단은 질문 카드 자리다(INV-1). 다른 탭은 화면 첫머리에 둔다.
function insertUpdateNotice() {
  const hero = viewEl.querySelector(".q-card")?.closest("section");
  if (hero) hero.insertAdjacentHTML("afterend", updateNoticeHtml());
  else viewEl.insertAdjacentHTML("afterbegin", updateNoticeHtml());
}

/* ── 전체 렌더 ─────────────────────────────────────── */
function render() {
  const v = top();
  setOverlayBackgroundInert(Boolean(v.overlay));
  document.querySelectorAll(".tab").forEach((t) => {
    if (t.dataset.tab === v.tab) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  if (v.tab === "question") renderQuestion();
  else if (v.tab === "lineage") renderLineage();
  else if (v.tab === "library") renderLibrary();
  else renderRecord();
  if (updateReady && updateMomentSafe()) insertUpdateNotice();

  if (!v.overlay) overlayRoot.innerHTML = "";
  else if (v.overlay.type === "sheet") renderSheet(v.overlay.bookId);
  else if (v.overlay.type === "trail") renderTrail(v.overlay.bookId);
  else if (v.overlay.type === "jlist") renderJourneyList();
  else if (v.overlay.type === "jdetail") renderJourneyDetail();
  else if (v.overlay.type === "profile") renderProfile();
  else if (v.overlay.type === "settings") renderSettings();

  syncTopbar();
}

function syncTopbar() {
  const pb = document.getElementById("profile-btn");
  pb.textContent = state.profile ? `${state.profile.name}님` : "내 서재";
  const themeButton = document.getElementById("theme-btn");
  themeButton.textContent = state.theme === "navy" ? "은회" : "남색";
  themeButton.removeAttribute("aria-pressed");
  themeButton.setAttribute("aria-label", `${themeButton.textContent} 테마로 바꾸기`);
}

/* 설정 시트의 값 변경은 그 시트의 바뀐 부분만 고친다. 화면 전체를 다시 그리면 방금 누른 컨트롤이
   사라져 포커스가 시트 루트로 떨어지고, 키보드 사용자는 값을 바꿀 때마다 Tab 순회를 처음부터 한다(§9 E-017). */
function updateSettingsControls() {
  for (const chip of overlayRoot.querySelectorAll("[data-setdomain]")) {
    chip.setAttribute("aria-pressed", String(chip.dataset.setdomain === sessionDomain));
  }
  for (const chip of overlayRoot.querySelectorAll("[data-setlibdomain]")) {
    chip.setAttribute("aria-pressed", String(chip.dataset.setlibdomain === state.prefs.libDomain));
  }
  for (const chip of overlayRoot.querySelectorAll("[data-setlibtier]")) {
    chip.setAttribute("aria-pressed", String(chip.dataset.setlibtier === state.prefs.libTier));
  }
  const themeRow = overlayRoot.querySelector(".settings-row[data-toggle-theme]");
  if (themeRow) {
    const label = state.theme === "navy" ? "남색" : "은회";
    themeRow.querySelector(".value").textContent = label;
    themeRow.setAttribute("aria-label", `화면 색 바꾸기, 지금은 ${label}`);
  }
  syncTopbar();
}

/* ── 이벤트 위임 ───────────────────────────────────── */
function scrollPageTop() {
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

/* 백링크가 가리킨 문답집 항목으로 데려간다. 문답집은 수집순이라 최근 질문일수록 아래에 놓여,
   식별자 없이 기록 탭만 열면 착지점이 화면 밖 1,000px 아래가 된다(원장 37).
   질문 id 에는 `#` 가 들어가므로 선택자로 쓰기 전에 반드시 이스케이프한다. */
function landOnQuestion(questionKey) {
  if (!questionKey) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const item = viewEl.querySelector(`[data-answer-q="${CSS.escape(questionKey)}"]`)?.closest(".qa-item");
    if (!item) return;
    for (const marked of viewEl.querySelectorAll(".is-landed")) marked.classList.remove("is-landed");
    item.classList.add("is-landed");   // 정적 강조 — 어느 항목을 보러 왔는지 남긴다
    item.scrollIntoView({ block: "center" });
  }));
}

// 하단 탭으로 화면을 열면 그 화면의 첫 페이지에서 시작한다 — 이어 보던 목록 페이지와 펼쳐 둔 항목을 되돌린다.
function resetTabToFirstPage(tab) {
  if (tab === "library") libVisibleCount = LIB_PAGE_SIZE;
  if (tab === "record") { openProgressDomain = null; dropArmedId = null; }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-skip-to],[data-home],[data-tab],[data-open-book],[data-collect],[data-shuffle],[data-domain],[data-open-domain-list],[data-progress-domain],[data-ask-term],[data-drop-question],[data-drop-confirm],[data-drop-cancel],[data-libdomain],[data-libtier],[data-lib-reset],[data-load-more],[data-open-trail],[data-cycle-read],[data-goto-lineage],[data-open-jlist],[data-open-jdetail],[data-start-journey],[data-finish-journey],[data-quit-journey],[data-open-profile],[data-clear-profile],[data-toggle-theme],[data-apply-update],[data-close-overlay],[data-open-settings],[data-dismiss-onboard],[data-setdomain],[data-setlibdomain],[data-setlibtier],[data-export-records],[data-import-records],[data-reset-records],[data-reset-confirm],[data-reset-cancel]");
  if (!t) return;

  if (t.dataset.skipTo) {
    const target = t.dataset.skipTo === "tabbar" ? document.querySelector(".tabbar .tab") : viewEl;
    target?.focus();
    if (t.dataset.skipTo === "tabbar") target?.scrollIntoView({ block: "nearest" });
  } else if (t.dataset.home) {
    goHome();
  } else if (t.dataset.applyUpdate) {
    t.disabled = true;                        // 확인은 1회만 받는다
    location.reload();
  } else if (t.dataset.toggleTheme) {
    // 상단 토글과 설정 오버레이가 같은 값을 바꾼다 — 단일 출처는 state.theme 다.
    const next = state.theme === "navy" ? "silver" : "navy";
    if (!commit(() => { state.theme = next; })) return;
    applyTheme();
    // 색은 CSS 토큰이 바꾸므로 본문을 다시 그릴 필요가 없다. 설정 시트에서는 눌린 행만 갱신한다.
    if (top().overlay?.type === "settings") updateSettingsControls();
    else render();
    announce(`화면 색을 ${withParticle(next === "navy" ? "남색" : "은회", "으로", "로")} 바꿨습니다.`);
  } else if (t.dataset.openProfile) {
    pushView({ tab: top().tab, overlay: { type: "profile" } });
  } else if (t.dataset.openSettings) {
    resetArmed = false;
    pushView({ tab: top().tab, overlay: { type: "settings" } });
  } else if (t.dataset.dismissOnboard) {
    if (!commit(() => { state.onboardingDismissed = true; })) return;
    render();
  } else if (t.dataset.setdomain) {
    const domain = t.dataset.setdomain;
    if (!commit(() => { state.prefs.lineageDomain = domain; })) return;
    sessionDomain = domain;
    updateSettingsControls();   // 시트를 닫을 때 popstate 가 본문을 다시 그린다
    announce(`관심 분야를 ${withParticle(domain, "으로", "로")} 정했습니다.`);
  } else if (t.dataset.setlibdomain) {
    // 설정에서 고른 값은 저장과 이번 세션을 함께 맞춘다 — 저장했는데 화면이 다르면 안 된다.
    const domain = t.dataset.setlibdomain;
    if (!commit(() => { state.prefs.libDomain = domain; state.prefs.libTier = state.prefs.libTier; })) return;
    libDomain = domain;
    libVisibleCount = LIB_PAGE_SIZE;
    updateSettingsControls();
    announce(domain === "전체"
      ? "서재를 모든 분야로 저장했습니다."
      : `서재 분야를 ${withParticle(domain, "으로", "로")} 저장했습니다.`);
  } else if (t.dataset.setlibtier) {
    const tier = t.dataset.setlibtier;
    if (!commit(() => { state.prefs.libTier = tier; })) return;
    libTier = tier;
    libVisibleCount = LIB_PAGE_SIZE;
    updateSettingsControls();
    announce(tier === "전체" ? "계단 조건을 걷어 저장했습니다." : `${withParticle(tier, "으로", "로")} 저장했습니다.`);
  } else if (t.dataset.exportRecords) {
    exportRecords();
  } else if (t.dataset.importRecords) {
    const input = document.getElementById("import-file");
    const file = input?.files?.[0];
    if (!file) { announce("불러올 파일을 먼저 고르세요."); return; }
    t.disabled = true;
    importRecords(file, t);
  } else if (t.dataset.resetRecords) {
    resetArmed = true;
    render();
  } else if (t.dataset.resetCancel) {
    resetArmed = false;
    render();
  } else if (t.dataset.resetConfirm) {
    t.disabled = true;
    resetRecords();
  } else if (t.dataset.clearProfile) {
    t.disabled = true;
    if (!commit(() => { state.profile = null; })) { t.disabled = false; return; }
    dismissOverlay();
  } else if (t.dataset.tab) {
    if (t.dataset.tab === "question") { goHome(); return; }   // 홈 탭 = 첫 화면 복귀로 통일
    /* 백링크가 착지 분야를 실어 오면 그 분야로 연다. 저장된 관심 분야는 바꾸지 않는다 —
       이동 버튼 하나가 방문자가 고른 값을 덮어써서는 안 된다(원장 34 · N-11). */
    if (t.dataset.landDomain && DOMAINS.includes(t.dataset.landDomain)) sessionDomain = t.dataset.landDomain;
    const landQuestion = t.dataset.landQuestion || "";
    const cur = top();
    resetTabToFirstPage(t.dataset.tab);
    // 탭이 바뀌는 이동은 pushView 가 최상단으로 내린다(N-9). 착지 대상이 있으면 그 뒤 프레임에서 덮어쓴다.
    if (cur.tab !== t.dataset.tab) {
      /* 그 탭이 이미 스택에 있으면 새로 쌓지 않고 그 자리로 돌아간다(원장 47).
         착지 대상을 실은 백링크는 이 경로를 쓰지 않는다 — history.go 는 비동기라 착지 시점이 어긋난다. */
      const known = tabHistoryIndex.get(t.dataset.tab);
      if (!landQuestion && !t.dataset.landDomain && !cur.overlay
        && typeof known === "number" && known < pointer) {
        history.go(known - pointer);
        return;
      }
      pushView({ tab: t.dataset.tab, overlay: null });
      landOnQuestion(landQuestion);
      return;
    }
    // 이미 보고 있는 탭을 다시 눌러도 그 화면의 첫 페이지 최상단으로 되돌아온다.
    if (cur.overlay) pushView({ tab: cur.tab, overlay: null });
    else render();
    scrollPageTop();
    landOnQuestion(landQuestion);
  } else if (t.dataset.openBook) {
    pushView({ tab: top().tab, overlay: { type: "sheet", bookId: t.dataset.openBook } });
  } else if (t.dataset.openTrail) {
    commit(() => { state.rootArrivals += 1; });   // 저장 거부는 배너로 알리고 카운터만 되돌린다
    pushView({ tab: top().tab, overlay: { type: "trail", bookId: t.dataset.openTrail } });
  } else if (t.dataset.openJlist) {
    pushView({ tab: top().tab, overlay: { type: "jlist" } });
  } else if (t.dataset.openJdetail) {
    pushView({ tab: top().tab, overlay: { type: "jdetail" } });
  } else if (t.dataset.startJourney) {
    const journeyId = t.dataset.startJourney;
    if (!state.journey) {
      if (!commit(() => {
        state.journey = { id: journeyId, doneBookIds: [] };
        state.journeyDraft = "";
        state.journeyAutoRead = [];
      })) return;
    }
    pushView({ tab: top().tab, overlay: { type: "jdetail" } });
  } else if (t.dataset.finishJourney) {
    t.disabled = true;
    const journeyId = t.dataset.finishJourney;
    // 중복 기록 가드(N-8): 이미 완료했거나 진행 중 여정이 아니면 닫기만 한다.
    if (state.journey?.id !== journeyId || state.journeysDone.some((x) => x.id === journeyId)) {
      dismissOverlay();
      return;
    }
    const ans = document.getElementById("j-answer");
    const myAnswer = ans ? ans.value : state.journeyDraft;
    if (!commit(() => {
      state.journeysDone.push({ id: journeyId, date: today(), myAnswer });
      state.journey = null;
      state.journeyDraft = "";
      state.journeyAutoRead = [];   // 완주한 여정의 읽음은 방문자의 실적으로 확정한다
    })) { t.disabled = false; return; }
    dismissOverlay(); // 여정 화면 닫기 → 이전 화면
  } else if (t.dataset.quitJourney) {
    t.disabled = true;
    // 그만두기와 체크 해제는 결과가 다르다 — 앞의 것은 읽음을 남기고 뒤의 것은 되돌린다. 미리 알린다(B2).
    const keptReads = state.journeyAutoRead.filter((entry) => readStatus(entry.id) === "read").length;
    if (!commit(() => {
      state.journey = null;
      state.journeyDraft = "";
      state.journeyAutoRead = [];   // 그만두어도 이미 읽은 책은 읽은 것이다 — 추적만 걷는다
    })) { t.disabled = false; return; }
    announce(keptReads
      ? `여정을 그만두었습니다. 체크로 켜진 읽음 ${keptReads}권은 그대로 남습니다.`
      : "진행 중이던 여정을 그만두었습니다.");
    dismissOverlay();
  } else if (t.dataset.collect) {
    const questionKey = t.dataset.collect;
    if (!state.questions.some((x) => x.id === questionKey)) {
      const bookId = Q_BY_ID.get(questionKey)?.bookId;
      if (!bookId) return;
      // 저장이 거부되면 수집됨 표시로 넘어가지 않는다(DI-4).
      if (!commit(() => { state.questions.push({ id: questionKey, bookId, date: today(), myAnswer: "" }); })) return;
      /* 첫 기록이면 안내 카드가 사라지고 최근 질문 블록이 새로 생긴다 — 구조가 바뀌는 그때만 전체 렌더다.
         그 밖에는 제자리에서 고쳐 방금 누른 버튼을 살려 둔다(원장 20). */
      if (!updateHero() || !updateRecentQuestion()) render();
      announce("질문을 수집했습니다. 기록 탭 문답집에서 답을 적을 수 있습니다.");
      return;
    }
    render();
  } else if (t.dataset.shuffle) {
    heroQuestion = drawQuestion();
    save();                                   // 추첨 확정 시점(원장 3). 실패는 save 안에서 배너·낭독으로 알린다
    if (!updateHero()) render();              // 히어로 한 장만 바뀐다 — 화면을 다시 그리지 않는다(원장 20)
    announce(`다음 질문으로 바꿨습니다. ${heroQuestion.q.text}`);
  } else if (t.dataset.openDomainList) {
    const domain = t.dataset.openDomainList;
    /* 이동이 건 필터는 이번 세션에만 적용한다. 저장된 서재 필터까지 덮어쓰면 방문자가 골라 둔 값이
       다른 화면의 이동 버튼 하나로 사라지고 재방문에도 그대로 남는다(N-11 · 원장 50). */
    libQuery = "";
    libDomain = domain;
    libTier = "전체";
    libVisibleCount = LIB_PAGE_SIZE;
    pushView({ tab: "library", overlay: null });   // 최상단 이동은 pushView 의 N-9 경로가 맡는다
    announce(`${domain} 분야로 좁혀 서재를 열었습니다.`);
  } else if (t.dataset.askTerm) {
    // 빈 결과 화면의 낱말 칩 — 이 서재가 답할 수 있는 질의로 곧장 갈아탄다(원장 18)
    runQuestionSearch(t.dataset.askTerm);
    requestAnimationFrame(() => document.querySelector(".question-results, .empty")?.scrollIntoView({ block: "start" }));
  } else if (t.dataset.dropQuestion) {
    dropArmedId = t.dataset.dropQuestion;      // 실행 전 1회 확인(C6-4)
    render();
  } else if (t.dataset.dropCancel) {
    dropArmedId = null;
    render();
  } else if (t.dataset.dropConfirm) {
    const questionKey = t.dataset.dropConfirm;
    t.disabled = true;
    if (!commit(() => { state.questions = state.questions.filter((x) => x.id !== questionKey); })) { t.disabled = false; return; }
    dropArmedId = null;
    announce("수집을 취소했습니다.");
    render();
  } else if (t.dataset.progressDomain) {
    // 계보 진행률 분야 탭 — 같은 분야를 다시 누르면 접고, 다른 분야를 누르면 그쪽만 펼친다.
    const domain = t.dataset.progressDomain;
    openProgressDomain = openProgressDomain === domain ? null : domain;
    renderProgressPanels();   // 눌린 버튼이 그대로 남으므로 포커스도 그대로다
  } else if (t.dataset.domain) {
    const domain = t.dataset.domain;
    if (!commit(() => { state.prefs.lineageDomain = domain; })) return;
    sessionDomain = domain;
    updateLineageDomain();
    announce(`${domain} 계보를 열었습니다.`);
  } else if (t.dataset.libdomain) {
    const domain = t.dataset.libdomain;
    /* 지금 화면에 걸린 짝을 통째로 저장한다. 한쪽만 저장하면 홈 게이지로 들어온 세션 값과 섞여
       방문자가 고른 적 없는 조합이 재방문 화면이 된다(B1). */
    if (!commit(() => { state.prefs.libDomain = domain; state.prefs.libTier = libTier; })) return;
    libDomain = domain;
    libVisibleCount = LIB_PAGE_SIZE;
    updateLibraryFilters();
    announce(domain === "전체"
      ? "서재를 모든 분야로 되돌렸습니다."
      : `서재를 ${withParticle(domain, "으로", "로")} 좁혔습니다.`);
  } else if (t.dataset.libtier) {
    const tier = t.dataset.libtier;
    if (!commit(() => { state.prefs.libDomain = libDomain; state.prefs.libTier = tier; })) return;
    libTier = tier;
    libVisibleCount = LIB_PAGE_SIZE;
    updateLibraryFilters();
    announce(tier === "전체"
      ? "계단 조건을 걷었습니다."
      : `${withParticle(tier, "으로", "로")} 좁혔습니다.`);
  } else if (t.dataset.libReset) {
    // 명시적 되돌림이므로 저장된 필터까지 함께 푼다. 검색어는 세션 값이라 지우기만 한다(C5-2).
    if (!commit(() => { state.prefs.libDomain = "전체"; state.prefs.libTier = "전체"; })) return;
    libDomain = "전체";
    libTier = "전체";
    libQuery = "";
    libVisibleCount = LIB_PAGE_SIZE;
    updateLibraryFilters();
    // 되돌림 버튼은 지금 사라졌다. 포커스를 잃지 않게 그 자리를 대신하는 분야 칩으로 넘긴다.
    viewEl.querySelector('[data-libdomain="전체"]')?.focus();
    announce("서재를 전체 보기로 되돌렸습니다.");
  } else if (t.dataset.loadMore) {
    libVisibleCount += LIB_PAGE_SIZE;
    renderLibList();                               // 목록만 이어 그린다 — 검색 입력·칩은 그대로 둔다
  } else if (t.dataset.cycleRead) {
    if (!cycleRead(t.dataset.cycleRead)) return;   // 저장 실패 시 읽음 배지를 켜지 않는다(DI-4)
    render();
    announce(`읽음 상태를 ${withParticle({ none: "안 읽음", reading: "읽는 중", read: "읽음" }[readStatus(t.dataset.cycleRead)], "으로", "로")} 바꿨습니다.`);
  } else if (t.dataset.gotoLineage) {
    sessionDomain = t.dataset.gotoLineage;
    pushView({ tab: "lineage", overlay: null });
  } else if (t.dataset.closeOverlay) {
    if (e.target === t) dismissOverlay(); // 배경 탭·닫기 버튼 = 같은 단일 경로
  }
});

function runQuestionSearch(value) {
  const query = String(value).trim();
  // 공백만 넣고 제출하면 required 를 통과하면서 화면은 아무 반응이 없었다(원장 17).
  questionNotice = query ? "" : "찾을 낱말을 한 글자 이상 적어 주세요.";
  questionQuery = query;
  questionResults = query ? findBooksForQuestion(query) : [];
  if (query) {
    // 최근 것이 앞에 오게 다시 쌓는다. 같은 질문을 두 번 물으면 자리만 옮긴다.
    state.askedQuestions = [query.slice(0, 60), ...state.askedQuestions.filter((item) => item !== query.slice(0, 60))].slice(0, 20);
    save();
  }
  renderQuestion();
  announce(questionNotice || `${questionResults.length}권을 찾았습니다.`);
  if (!query) { document.getElementById("question-search")?.focus(); return false; }
  return true;
}

/* 이름 저장은 이 함수 하나를 지난다. 버튼 클릭과 Enter 가 각각 저장하면 이중 실행이 된다(원장 27). */
function saveProfile(button) {
  const input = document.getElementById("profile-name");
  const alertEl = document.getElementById("profile-alert");
  const name = input.value.trim();
  if (!name) {
    alertEl.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", "profile-alert profile-note");
    input.focus();
    return;
  }
  if (button) button.disabled = true;          // 진입 즉시 중복 탭 차단
  if (!commit(() => { state.profile = { name }; })) { if (button) button.disabled = false; return; }
  dismissOverlay();
}

// 다시 입력하면 경고를 걷는다 — 고쳐 썼는데 빨간 문구가 남아 있으면 저장이 안 된 줄 안다(원장 28).
document.addEventListener("input", (e) => {
  if (e.target.id !== "profile-name") return;
  const alertEl = document.getElementById("profile-alert");
  if (alertEl && !alertEl.hidden) {
    alertEl.hidden = true;
    e.target.removeAttribute("aria-invalid");
    e.target.setAttribute("aria-describedby", "profile-note");
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.id === "profile-form") {
    e.preventDefault();
    saveProfile(e.target.querySelector("[data-save-profile]"));
    return;
  }
  if (e.target.id !== "question-search-form") return;
  e.preventDefault();
  const input = document.getElementById("question-search");
  if (!runQuestionSearch(input.value)) return;
  requestAnimationFrame(() => {
    const result = document.querySelector(".question-results, .empty");
    if (result) result.scrollIntoView({ block: "start" });
  });
});

document.addEventListener("change", (e) => {
  const c = e.target.closest("[data-jcheck]");
  if (!c || !state.journey) return;
  const id = c.dataset.jcheck;
  const journey = JOURNEYS.find((item) => item.id === state.journey.id);
  const index = journey ? journey.bookIds.indexOf(id) : -1;
  const checked = c.checked;
  if (checked) {
    const previousDone = index >= 0 && journey.bookIds.slice(0, index)
      .every((previousId) => state.journey.doneBookIds.includes(previousId));
    if (!previousDone) { c.checked = false; return; }
  }
  // 진행과 읽음 처리를 한 번에 확정한다. 저장이 거부되면 체크 상태도 되돌려 그린다(DI-4).
  commit(() => {
    if (checked) {
      if (!state.journey.doneBookIds.includes(id)) state.journey.doneBookIds.push(id);
      const before = readStatus(id);
      // 여정이 켠 읽음만 기록한다. 이미 읽음이던 책은 되돌릴 것이 없다.
      if (before !== "read" && !state.journeyAutoRead.some((x) => x.id === id)) {
        state.journeyAutoRead.push({ id, from: before });
      }
      applyReadStatus(id, "read"); // 여정 체크 = 읽음 처리
    } else {
      const removeIds = new Set(journey ? journey.bookIds.slice(index) : [id]);
      state.journey.doneBookIds = state.journey.doneBookIds.filter((x) => !removeIds.has(x));
      // 진행을 되돌리면 그때 켜진 읽음도 함께 되돌린다(원장 30).
      for (const entry of state.journeyAutoRead) {
        /* 되돌릴 대상은 여정이 켠 '읽음' 그대로일 때뿐이다. 그 사이 방문자가 손으로 바꿨거나
           타 탭에서 바뀌었으면 건드리지 않는다 — 추적표를 믿고 덮으면 방문자 조작이 사라진다(A1). */
        if (removeIds.has(entry.id) && readStatus(entry.id) === "read") applyReadStatus(entry.id, entry.from);
      }
      state.journeyAutoRead = state.journeyAutoRead.filter((x) => !removeIds.has(x.id));
    }
  });
  updateJourneyDetail();
});

document.addEventListener("input", (e) => {
  const qa = e.target.closest("[data-answer-q]");
  if (qa) {
    const item = state.questions.find((x) => x.id === qa.dataset.answerQ);
    if (item) { item.myAnswer = qa.value.slice(0, ANSWER_MAX); scheduleSave(); }
    return;
  }
  const ja = e.target.closest("[data-answer-j]");
  if (ja) {
    const item = state.journeysDone.find((x) => x.id === ja.dataset.answerJ);
    if (item) { item.myAnswer = ja.value.slice(0, ANSWER_MAX); scheduleSave(); }
    return;
  }
  const draft = e.target.closest("[data-answer-draft]");
  if (draft && state.journey) {
    state.journeyDraft = draft.value.slice(0, ANSWER_MAX);
    scheduleSave();
  }
});

/* ── 시작 ─────────────────────────────────────────── */
render();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
  });
  // 서비스워커는 갱신 사실만 통지한다. 적용 시점은 방문자가 고른다(원장 12).
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type !== "ccb-updated" || updateReady) return;
    updateReady = true;
    if (updateMomentSafe()) render();
  });
}
