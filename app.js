// 천책빵 — 뿌리를 찾는 서재 (PRD-천책빵.md v1.7)
import { BOOKS, JOURNEYS, DOMAINS, IS_SEED } from "./data/books.js";
import { createQuestionSearch } from "./lib/search.js";

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

/* ── 사용자 상태 (localStorage) ─────────────────────── */
const STORE_KEY = "cheonchaek.v1";
const STORE_VERSION = 2;
const VALID_QUESTION_IDS = new Set(ALL.flatMap((book) =>
  book.questions.map((question, index) => `${book.id}#${index}`)
));

function uniqueValidIds(value) {
  return [...new Set(Array.isArray(value) ? value : [])].filter((id) => BY_ID.has(id));
}

function sanitizeState(source = {}) {
  const read = uniqueValidIds(source.read);
  const readSet = new Set(read);
  const reading = uniqueValidIds(source.reading).filter((id) => !readSet.has(id));
  const questionSeen = new Set();
  const questions = (Array.isArray(source.questions) ? source.questions : [])
    .filter((item) => item && VALID_QUESTION_IDS.has(item.id) && !questionSeen.has(item.id) && questionSeen.add(item.id))
    .map((item) => ({
      id: item.id,
      bookId: item.id.split("#")[0],
      date: typeof item.date === "string" ? item.date.slice(0, 10) : "",
      myAnswer: typeof item.myAnswer === "string" ? item.myAnswer.slice(0, 10000) : "",
    }));
  const journeyDef = JOURNEYS.find((journey) => journey.id === source.journey?.id);
  let journey = null;
  if (journeyDef) {
    const storedDone = new Set(uniqueValidIds(source.journey.doneBookIds));
    const doneBookIds = [];
    for (const id of journeyDef.bookIds) {
      if (!storedDone.has(id)) break;
      doneBookIds.push(id);
    }
    journey = { id: journeyDef.id, doneBookIds };
  }
  const doneSeen = new Set();
  const journeysDone = (Array.isArray(source.journeysDone) ? source.journeysDone : [])
    .filter((item) => JOURNEYS.some((journeyItem) => journeyItem.id === item?.id)
      && !doneSeen.has(item.id) && doneSeen.add(item.id))
    .map((item) => ({
      id: item.id,
      date: typeof item.date === "string" ? item.date.slice(0, 10) : "",
      myAnswer: typeof item.myAnswer === "string" ? item.myAnswer.slice(0, 10000) : "",
    }));
  const profileName = typeof source.profile?.name === "string" ? source.profile.name.trim().slice(0, 20) : "";
  return {
    version: STORE_VERSION,
    read, reading, questions,
    rootArrivals: Number.isSafeInteger(source.rootArrivals) && source.rootArrivals >= 0 ? source.rootArrivals : 0,
    journey, journeysDone,
    profile: profileName ? { name: profileName } : null,
    theme: source.theme === "navy" ? "navy" : "silver",
    questionDeck: [...new Set(Array.isArray(source.questionDeck) ? source.questionDeck : [])]
      .filter((id) => VALID_QUESTION_IDS.has(id)),
    lastHeroQuestionId: VALID_QUESTION_IDS.has(source.lastHeroQuestionId) ? source.lastHeroQuestionId : null,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return sanitizeState(JSON.parse(raw));
  } catch { /* 손상 시 초기화 */ }
  return sanitizeState();
}
const state = loadState();
const appStatus = document.getElementById("app-status");
let answerSaveTimer = 0;
function announce(message) {
  appStatus.textContent = "";
  requestAnimationFrame(() => { appStatus.textContent = message; });
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    return true;
  } catch {
    announce("기기 저장 공간이 부족해 변경 내용을 저장하지 못했습니다.");
    return false;
  }
}
function scheduleSave() {
  clearTimeout(answerSaveTimer);
  answerSaveTimer = setTimeout(save, 250);
}
window.addEventListener("pagehide", () => {
  if (answerSaveTimer) { clearTimeout(answerSaveTimer); save(); }
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
function setReadStatus(id, st) {
  state.read = state.read.filter((x) => x !== id);
  state.reading = state.reading.filter((x) => x !== id);
  if (st === "read") state.read.push(id);
  if (st === "reading") state.reading.push(id);
  save();
}
function cycleRead(id) {
  const next = { none: "reading", reading: "read", read: "none" };
  setReadStatus(id, next[readStatus(id)]);
}

/* ── 홈 질문: 앱을 열 때마다 한 번씩 순환 ───────────── */
const Q_POOL = ALL.flatMap((b) =>
  b.questions.map((q, i) => ({ id: `${b.id}#${i}`, bookId: b.id, q }))
);
const Q_BY_ID = new Map(Q_POOL.map((item) => [item.id, item]));

function shuffledQuestionIds() {
  const ids = Q_POOL.map((item) => item.id);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

function drawQuestion() {
  let deck = state.questionDeck.filter((id) => Q_BY_ID.has(id));
  if (deck.length === 0) deck = shuffledQuestionIds();
  let id = deck.shift();
  if (id === state.lastHeroQuestionId && deck.length > 0) {
    deck.push(id);
    id = deck.shift();
  }
  state.questionDeck = deck;
  state.lastHeroQuestionId = id;
  save();
  return Q_BY_ID.get(id) || Q_POOL[0];
}

let heroQuestion = drawQuestion();

/* ── 내비게이션: 히스토리 스택 + 종료 트랩 (PRD F8, §6) ── */
let stack = [{ tab: "question", overlay: null }];
const HASH = { question: "#question", lineage: "#lineage", library: "#library", record: "#record" };
history.replaceState({ i: -1 }, "");                 // 종료 트랩(센티널)
history.pushState({ i: 0 }, "", HASH.question);      // 기본 화면
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

function pushView(view) {
  if (view.overlay && !top().overlay) overlayReturnFocus = rememberFocus(document.activeElement);
  stack.push(view);
  history.pushState({ i: stack.length - 1 }, "", HASH[view.tab]);
  render();
}
function top() { return stack[stack.length - 1]; }

window.addEventListener("popstate", (e) => {
  if (appClosed) return;
  const i = e.state && typeof e.state.i === "number" ? e.state.i : -1;
  if (i < 0) {
    exitReturnInProgress = true;
    showExit();
    history.forward();                                // 팝업 중 반복 뒤로가기로 앱을 벗어나지 않게 복귀
    return;
  }
  if (exitReturnInProgress && i === 0) {
    exitReturnInProgress = false;
    if (!exitEl.hidden) return;
  }
  hideExit();
  const hadOverlay = Boolean(top().overlay);
  stack = stack.slice(0, i + 1);
  if (stack.length === 0) stack = [{ tab: "question", overlay: null }];
  render();
  if (hadOverlay && !top().overlay && overlayReturnFocus) {
    requestAnimationFrame(restoreOverlayFocus);
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
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
}

function stayAtHome() {
  hideExit();
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
      history.back();
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

// [닫기] 결정적 폴백 (PRD F8): ① 창 닫기 시도 ② 차단되면 닫힘 화면 — 어떤 환경에서도 무반응 금지
document.getElementById("exit-leave").addEventListener("click", () => {
  window.close();
  setTimeout(() => {
    appClosed = true;
    setExitBackgroundInert(false);
    history.replaceState({ closed: true }, "", HASH.question);
    document.body.innerHTML = `
      <div class="goodbye" role="status" aria-live="polite">
        <div class="goodbye-box">
          <p class="t">천책빵 사용을 마쳤습니다.</p>
          <p class="d">브라우저가 창 닫기를 제한한 경우 기기의 홈 화면으로 돌아가세요.</p>
        </div>
      </div>`;
  }, 120);
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
let sessionDomain = DOMAINS[0];
let libQuery = "", libDomain = "전체", libTier = "전체";
const LIB_PAGE_SIZE = 80;
let libVisibleCount = LIB_PAGE_SIZE;
let questionQuery = "", questionResults = [];
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
      ? `<p class="empty">연결된 책을 찾지 못했습니다. 핵심 낱말을 바꿔 질문해 보세요.</p>`
      : "";
  const status = questionQuery
    ? `${questionResults.length}권을 찾았습니다.`
    : "질문을 입력하면 책을 찾습니다.";
  return `
    <p class="section-label">질문 하기</p>
    <form id="question-search-form" class="question-search">
      <label class="sr-only" for="question-search">책으로 이어질 질문</label>
      <input id="question-search" class="search" type="search" minlength="2"
        placeholder="예: 어떻게 살아야 하는가" value="${esc(questionQuery)}" required>
      <button class="btn btn-primary" type="submit">책 찾기</button>
    </form>
    <p class="sr-only" id="question-search-status" role="status" aria-live="polite">${esc(status)}</p>
    ${results}`;
}

function renderQuestion() {
  const item = heroQuestion;
  const b = BY_ID.get(item.bookId);
  const collected = state.questions.some((x) => x.id === item.id);
  const j = state.journey ? JOURNEYS.find((x) => x.id === state.journey.id) : null;
  const readingNow = state.reading.map((id) => BY_ID.get(id)).filter(Boolean);
  const lastQ = state.questions[state.questions.length - 1];
  const lastQBook = lastQ ? BY_ID.get(lastQ.bookId) : null;
  const lastQObj = lastQBook ? lastQBook.questions[Number(lastQ.id.split("#")[1])] : null;

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
        <div class="card-meta">${state.journeysDone.length}/${JOURNEYS.length} 완료</div>
      </button>`;
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
        <span class="num">${done}/${books.length}</span>
      </button>`;
  }).join("");

  const qLen = item.q.text.length; // 2줄 고정 — 길이에 따라 글자만 압축, 박스 높이 불변
  const qSize = qLen <= 22 ? "" : qLen <= 29 ? " q-mid" : qLen <= 40 ? " q-long" : " q-xlong";
  viewEl.innerHTML = `
    <section aria-label="오늘의 질문">
      <div class="q-card">
        <p class="q-text${qSize}"><span>${esc(item.q.text)}</span></p>
        <div class="q-actions">
          <button class="btn btn-light" data-open-book="${b.id}">이 질문의 책</button>
          <button class="btn btn-outline" data-collect="${item.id}" ${collected ? "disabled" : ""}>${collected ? "수집됨" : "수집"}</button>
          <button class="btn-quiet" data-shuffle="1">다른 질문</button>
        </div>
        <div class="q-stats" role="group" aria-label="나의 기록">
          <button class="qstat" data-tab="record"><b>${state.read.length}<small>/${ALL.length}</small></b><span>읽은 책</span></button>
          <button class="qstat" data-tab="record"><b>${state.questions.length}</b><span>수집한 질문</span></button>
          <button class="qstat" data-tab="lineage"><b>${state.rootArrivals}</b><span>뿌리 도달</span></button>
          <button class="qstat" data-open-jlist="1"><b>${state.journeysDone.length}<small>/${JOURNEYS.length}</small></b><span>여정 완료</span></button>
        </div>
      </div>
    </section>

    ${questionSearchHtml()}
    ${lastQObj ? `
      <p class="section-label">최근 질문</p>
      <button class="card card-tap" data-tab="record">
        <div class="card-title" style="font-family:var(--serif)">${esc(lastQObj.text)}</div>
      </button>` : ""}

    <p class="section-label">질문 여정</p>
    ${journeyHtml}
    ${readingNow.length ? `<p class="section-label">읽는 중</p>` + readingNow.map((x) => bookCard(x, { noPrinciple: true })).join("") : ""}

    <p class="section-label">분야별 진행</p>
    <div class="gauge">${gaugeRows}</div>`;
}

/* ── 탭: 계보 ─────────────────────────────────────── */
function renderLineage() {
  const books = ALL.filter((b) => b.domain === sessionDomain)
    .sort((a, z) => TIER_ORDER[a.tier] - TIER_ORDER[z.tier]);
  viewEl.innerHTML = `
    <div class="chips" role="group" aria-label="분야 선택">
      ${DOMAINS.map((d) => `<button class="chip" data-domain="${esc(d)}" aria-pressed="${d === sessionDomain}">${esc(d)}</button>`).join("")}
    </div>
    <p class="section-label">${esc(sessionDomain)}의 계보 — 뿌리에서 가지로</p>
    <div class="stream">${books.map((b) => bookCard(b)).join("")}</div>`;
}

/* ── 탭: 서재 ─────────────────────────────────────── */
function renderLibrary() {
  const q = libQuery.trim();
  let books = ALL.slice().sort((a, z) =>
    TIER_ORDER[a.tier] - TIER_ORDER[z.tier] || DOMAINS.indexOf(a.domain) - DOMAINS.indexOf(z.domain));
  if (libDomain !== "전체") books = books.filter((b) => b.domain === libDomain);
  if (libTier !== "전체") books = books.filter((b) => TIER_KO[b.tier] === libTier);
  if (q) books = books.filter((b) => b.title.includes(q) || b.author.includes(q));
  const total = books.length;
  const visibleBooks = books.slice(0, libVisibleCount);

  viewEl.innerHTML = `
    ${IS_SEED ? `<div class="notice">시드 데이터 ${ALL.length}권 — 정식 천 권 리스트 교체 예정</div>` : ""}
    <p class="library-summary">${libDomain === "전체" ? "전체 서재" : esc(libDomain)} · ${total}권</p>
    <input class="search" type="search" id="lib-search" placeholder="제목 또는 저자 검색" value="${esc(libQuery)}" aria-label="서재 검색">
    <div class="chips" role="group" aria-label="분야 필터">
      ${["전체", ...DOMAINS].map((d) => `<button class="chip" data-libdomain="${esc(d)}" aria-pressed="${d === libDomain}">${esc(d)}</button>`).join("")}
    </div>
    <div class="chips" role="group" aria-label="계단 필터">
      ${["전체", "뿌리", "줄기", "가지"].map((t) => `<button class="chip" data-libtier="${esc(t)}" aria-pressed="${t === libTier}">${esc(t)}</button>`).join("")}
    </div>
    ${total ? visibleBooks.map((b) => bookCard(b)).join("") : `<p class="empty">조건에 맞는 책이 없습니다.</p>`}
    ${visibleBooks.length < total
      ? `<button class="btn btn-light load-more" data-load-more="1">더 보기 · ${visibleBooks.length}/${total}권</button>`
      : ""}`;
  const input = document.getElementById("lib-search");
  input.addEventListener("input", () => {
    libQuery = input.value;
    libVisibleCount = LIB_PAGE_SIZE;
    const pos = input.selectionStart;
    renderLibrary();
    const again = document.getElementById("lib-search");
    again.focus();
    again.setSelectionRange(pos, pos);
  });
}

/* ── 탭: 기록 ─────────────────────────────────────── */
function renderRecord() {
  const reading = state.reading.map((id) => BY_ID.get(id)).filter(Boolean);
  const read = state.read.map((id) => BY_ID.get(id)).filter(Boolean);
  const domainRows = DOMAINS.map((d) => {
    const books = ALL.filter((b) => b.domain === d);
    const done = books.filter((b) => state.read.includes(b.id)).length;
    return `<div class="progress-row"><span>${esc(d)}</span><b>${done} / ${books.length}권</b></div>`;
  }).join("");

  const qa = state.questions.map((x) => {
    const b = BY_ID.get(x.bookId);
    const qObj = b ? b.questions[Number(x.id.split("#")[1])] : null;
    if (!qObj) return "";
    return `
      <div class="card qa-item">
        <p class="q">${esc(qObj.text)}</p>
        <span class="src">${esc(b.author)}, ${esc(qObj.source)} · ${esc(x.date)} 수집</span>
        <textarea data-answer-q="${x.id}" placeholder="나의 답을 적어 둡니다 (기기에만 보관)">${esc(x.myAnswer || "")}</textarea>
      </div>`;
  }).join("");

  const jqa = state.journeysDone.map((x) => {
    const j = JOURNEYS.find((y) => y.id === x.id);
    if (!j) return "";
    return `
      <div class="card qa-item">
        <p class="q">${esc(j.question.text)}</p>
        <span class="src">${esc(j.domain)} 여정 완료 · ${esc(x.date)}</span>
        <textarea data-answer-j="${x.id}" placeholder="이 질문에 대한 나의 답">${esc(x.myAnswer || "")}</textarea>
      </div>`;
  }).join("");

  viewEl.innerHTML = `
    <p class="section-label">계보 진행률 (읽음 기준)</p>
    <div class="card">${domainRows}</div>
    <p class="section-label">나만의 문답집 — 개인 기록 전용</p>
    ${qa || jqa ? jqa + qa : `<p class="empty">수집한 질문이 아직 없습니다. 오늘의 질문에서 시작해 보세요.</p>`}
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
    const qid = `${b.id}#${i}`;
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
        </label>
      </div>`;
  }).join("");

  const next = JOURNEYS.find((x) => x.id !== j.id && !state.journeysDone.some((d) => d.id === x.id));
  const doneCard = allDone ? `
    <div class="journey-done">
      <p class="q-kicker">여정 완료</p>
      <p class="q">${esc(j.question.text)} — 이 질문에 대한 나의 답은 무엇인가.</p>
      <textarea id="j-answer" placeholder="나의 답 (기기에만 보관)"></textarea>
      <div class="sheet-actions">
        <button class="btn btn-light" data-finish-journey="${j.id}">여정 완료로 저장</button>
      </div>
    </div>
    ${next ? `<p class="next-suggest">다음 여정 — ${esc(next.domain)} · ${esc(next.question.text)}</p>` : ""}` : "";

  overlayRoot.innerHTML = `
    <div class="sheet-backdrop" data-close-overlay="1">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="여정 진행" tabindex="-1">
        <div class="sheet-handle"></div>
        <button class="sheet-close" data-close-overlay="1" aria-label="여정 진행 닫기">닫기</button>
        <div class="q-card" style="margin-bottom:12px">
          <p class="q-kicker">${esc(j.domain)} 여정 · ${doneIds.length}/${j.bookIds.length}권</p>
          <p class="q-text" style="font-size:19px">${esc(j.question.text)}</p>
          <p class="q-source">${esc(j.question.source)}</p>
        </div>
        ${books}
        ${doneCard}
      </div>
    </div>`;
  overlayRoot.querySelector(".sheet").focus();
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
        <input class="profile-input" id="profile-name" type="text" maxlength="20"
          placeholder="이름 또는 별명" value="${p ? esc(p.name) : ""}" aria-label="이름">
        <p id="profile-note" class="profile-note">기록과 이름은 이 기기에만 보관됩니다.</p>
        <div class="sheet-actions">
          <button class="btn btn-primary" data-save-profile="1">${p ? "이름 변경" : "저장"}</button>
          ${p ? `<button class="btn btn-ghost" data-clear-profile="1">이름 지우기</button>` : ""}
        </div>
        <p id="profile-alert" role="alert" hidden>이름 또는 별명을 입력해 주세요.</p>
      </div>
    </div>`;
  overlayRoot.querySelector(".sheet").focus();
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

  if (!v.overlay) overlayRoot.innerHTML = "";
  else if (v.overlay.type === "sheet") renderSheet(v.overlay.bookId);
  else if (v.overlay.type === "trail") renderTrail(v.overlay.bookId);
  else if (v.overlay.type === "jlist") renderJourneyList();
  else if (v.overlay.type === "jdetail") renderJourneyDetail();
  else if (v.overlay.type === "profile") renderProfile();

  const pb = document.getElementById("profile-btn");
  pb.textContent = state.profile ? `${state.profile.name}님` : "내 서재";
  const themeButton = document.getElementById("theme-btn");
  themeButton.textContent = state.theme === "navy" ? "은회" : "남색";
  themeButton.removeAttribute("aria-pressed");
  themeButton.setAttribute("aria-label", `${themeButton.textContent} 테마로 바꾸기`);
}

/* ── 이벤트 위임 ───────────────────────────────────── */
function scrollPageTop() {
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab],[data-open-book],[data-collect],[data-shuffle],[data-domain],[data-open-domain-list],[data-libdomain],[data-libtier],[data-load-more],[data-open-trail],[data-cycle-read],[data-goto-lineage],[data-open-jlist],[data-open-jdetail],[data-start-journey],[data-finish-journey],[data-open-profile],[data-save-profile],[data-clear-profile],[data-toggle-theme],[data-close-overlay]");
  if (!t) return;

  if (t.dataset.toggleTheme) {
    state.theme = state.theme === "navy" ? "silver" : "navy";
    applyTheme();
    save();
    render();
  } else if (t.dataset.openProfile) {
    pushView({ tab: top().tab, overlay: { type: "profile" } });
  } else if (t.dataset.saveProfile) {
    const input = document.getElementById("profile-name");
    const name = input.value.trim();
    const alertEl = document.getElementById("profile-alert");
    if (!name) { alertEl.hidden = false; input.focus(); return; }
    state.profile = { name };
    save();
    history.back(); // 프로필 시트 닫기
  } else if (t.dataset.clearProfile) {
    state.profile = null;
    save();
    history.back();
  } else if (t.dataset.tab) {
    const cur = top();
    if (cur.tab === t.dataset.tab && !cur.overlay) {
      if (cur.tab === "question") scrollPageTop();
      return;
    }
    pushView({ tab: t.dataset.tab, overlay: null });
    if (t.dataset.tab === "question") scrollPageTop();
  } else if (t.dataset.openBook) {
    pushView({ tab: top().tab, overlay: { type: "sheet", bookId: t.dataset.openBook } });
  } else if (t.dataset.openTrail) {
    state.rootArrivals += 1;
    save();
    pushView({ tab: top().tab, overlay: { type: "trail", bookId: t.dataset.openTrail } });
  } else if (t.dataset.openJlist) {
    pushView({ tab: top().tab, overlay: { type: "jlist" } });
  } else if (t.dataset.openJdetail) {
    pushView({ tab: top().tab, overlay: { type: "jdetail" } });
  } else if (t.dataset.startJourney) {
    if (!state.journey) { state.journey = { id: t.dataset.startJourney, doneBookIds: [] }; save(); }
    pushView({ tab: top().tab, overlay: { type: "jdetail" } });
  } else if (t.dataset.finishJourney) {
    const ans = document.getElementById("j-answer");
    state.journeysDone.push({ id: t.dataset.finishJourney, date: today(), myAnswer: ans ? ans.value : "" });
    state.journey = null;
    save();
    history.back(); // 여정 화면 닫기 → 이전 화면
  } else if (t.dataset.collect) {
    const [bookId] = t.dataset.collect.split("#");
    if (!state.questions.some((x) => x.id === t.dataset.collect)) {
      state.questions.push({ id: t.dataset.collect, bookId, date: today(), myAnswer: "" });
      save();
    }
    render();
  } else if (t.dataset.shuffle) {
    heroQuestion = drawQuestion();
    render();
  } else if (t.dataset.openDomainList) {
    libQuery = "";
    libDomain = t.dataset.openDomainList;
    libTier = "전체";
    libVisibleCount = LIB_PAGE_SIZE;
    pushView({ tab: "library", overlay: null });
    scrollPageTop();
  } else if (t.dataset.domain) {
    sessionDomain = t.dataset.domain;
    render();
  } else if (t.dataset.libdomain) {
    libDomain = t.dataset.libdomain;
    libVisibleCount = LIB_PAGE_SIZE;
    render();
  } else if (t.dataset.libtier) {
    libTier = t.dataset.libtier;
    libVisibleCount = LIB_PAGE_SIZE;
    render();
  } else if (t.dataset.loadMore) {
    libVisibleCount += LIB_PAGE_SIZE;
    render();
  } else if (t.dataset.cycleRead) {
    cycleRead(t.dataset.cycleRead);
    render();
  } else if (t.dataset.gotoLineage) {
    sessionDomain = t.dataset.gotoLineage;
    pushView({ tab: "lineage", overlay: null });
  } else if (t.dataset.closeOverlay) {
    if (e.target === t) history.back(); // 배경 탭 = 뒤로가기와 동일
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.id !== "question-search-form") return;
  e.preventDefault();
  const input = document.getElementById("question-search");
  questionQuery = input.value.trim();
  questionResults = findBooksForQuestion(questionQuery);
  renderQuestion();
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
  if (c.checked) {
    const previousDone = index >= 0 && journey.bookIds.slice(0, index)
      .every((previousId) => state.journey.doneBookIds.includes(previousId));
    if (!previousDone) { c.checked = false; return; }
    if (!state.journey.doneBookIds.includes(id)) state.journey.doneBookIds.push(id);
    setReadStatus(id, "read"); // 여정 체크 = 읽음 처리
  } else {
    const removeIds = new Set(journey ? journey.bookIds.slice(index) : [id]);
    state.journey.doneBookIds = state.journey.doneBookIds.filter((x) => !removeIds.has(x));
  }
  save();
  render();
});

document.addEventListener("input", (e) => {
  const qa = e.target.closest("[data-answer-q]");
  if (qa) {
    const item = state.questions.find((x) => x.id === qa.dataset.answerQ);
    if (item) { item.myAnswer = qa.value.slice(0, 10000); scheduleSave(); }
    return;
  }
  const ja = e.target.closest("[data-answer-j]");
  if (ja) {
    const item = state.journeysDone.find((x) => x.id === ja.dataset.answerJ);
    if (item) { item.myAnswer = ja.value.slice(0, 10000); scheduleSave(); }
  }
});

/* ── 시작 ─────────────────────────────────────────── */
render();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js"); });
}
