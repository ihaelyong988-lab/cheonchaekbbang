// 천책빵 — 뿌리를 찾는 서재 (PRD-천책빵.md v1.0)
import { BOOKS, JOURNEYS, DOMAINS, IS_SEED } from "./data/books.js";

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
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        read: s.read || [], reading: s.reading || [],
        questions: s.questions || [], rootArrivals: s.rootArrivals || 0,
        journey: s.journey || null, journeysDone: s.journeysDone || [],
        profile: s.profile || null
      };
    }
  } catch { /* 손상 시 초기화 */ }
  return { read: [], reading: [], questions: [], rootArrivals: 0, journey: null, journeysDone: [], profile: null };
}
const state = loadState();
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
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

/* ── 오늘의 질문 ───────────────────────────────────── */
const Q_POOL = ALL.filter((b) => b.tier === "root")
  .flatMap((b) => b.questions.map((q, i) => ({ id: `${b.id}#${i}`, bookId: b.id, q })));
let shuffleOffset = 0; // 세션 임시 — 새로고침 시 일자 질문 복귀 (PRD F2)
function dailyIndex() {
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return (seed + shuffleOffset) % Q_POOL.length;
}

/* ── 내비게이션: 히스토리 스택 + 종료 트랩 (PRD F8, §6) ── */
let stack = [{ tab: "question", overlay: null }];
const HASH = { question: "#question", lineage: "#lineage", library: "#library", record: "#record" };
history.replaceState({ i: -1 }, "");                 // 종료 트랩(센티널)
history.pushState({ i: 0 }, "", HASH.question);      // 기본 화면

function pushView(view) {
  stack.push(view);
  history.pushState({ i: stack.length - 1 }, "", HASH[view.tab]);
  render();
}
function top() { return stack[stack.length - 1]; }

window.addEventListener("popstate", (e) => {
  const i = e.state && typeof e.state.i === "number" ? e.state.i : -1;
  if (i < 0) { showExit(); return; }                 // 맨 첫 화면에서 뒤로가기
  hideExit();
  stack = stack.slice(0, i + 1);
  if (stack.length === 0) stack = [{ tab: "question", overlay: null }];
  render();
});

const exitEl = document.getElementById("exit-dialog");
let lastFocus = null;
function showExit() {
  lastFocus = document.activeElement;
  exitEl.hidden = false;
  document.getElementById("exit-stay").focus();
}
function hideExit() {
  if (!exitEl.hidden) {
    exitEl.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
}
document.getElementById("exit-stay").addEventListener("click", () => {
  hideExit();
  history.forward(); // 센티널에서 기본 화면으로 복귀
});
// [닫기] 결정적 폴백 (PRD F8): ① 창 닫기 시도 ② 차단되면 닫힘 화면 — 어떤 환경에서도 무반응 금지
document.getElementById("exit-leave").addEventListener("click", () => {
  window.close();
  setTimeout(() => {
    document.body.innerHTML = `
      <div class="goodbye">
        <div class="goodbye-box">
          <p class="t">천책빵을 닫았습니다.</p>
          <p class="d">이 탭은 닫으셔도 됩니다. 오늘의 질문은 내일 새로 도착합니다.</p>
          <button class="btn btn-light" data-reopen="1">다시 열기</button>
        </div>
      </div>`;
    document.querySelector("[data-reopen]").addEventListener("click", () => location.reload());
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

function renderQuestion() {
  const item = Q_POOL[dailyIndex()];
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
        <div class="card-meta">하나의 질문을 골라 뿌리에서 가지까지 읽어갑니다 · ${state.journeysDone.length}/${JOURNEYS.length} 완료</div>
      </button>`;
  }

  const gaugeRows = DOMAINS.map((d) => {
    const books = ALL.filter((x) => x.domain === d);
    const done = books.filter((x) => state.read.includes(x.id)).length;
    const pct = books.length ? Math.round((done / books.length) * 100) : 0;
    return `
      <div class="gauge-row">
        <span class="name">${esc(d)}</span>
        <span class="bar"><i style="width:${pct}%"></i></span>
        <span class="num">${done}/${books.length}</span>
      </div>`;
  }).join("");

  viewEl.innerHTML = `
    ${state.profile ? `<p class="greeting">${esc(state.profile.name)}님의 서재 계기판</p>` : ""}
    <section aria-label="오늘의 질문">
      <div class="q-card">
        <p class="q-kicker">오늘의 질문</p>
        <p class="q-text">${esc(item.q.text)}</p>
        <p class="q-source">${esc(b.author)}, ${esc(item.q.source)}</p>
        <div class="q-actions">
          <button class="btn btn-light" data-open-book="${b.id}">이 질문을 다루는 책 보기</button>
          <button class="btn btn-outline" data-collect="${item.id}" ${collected ? "disabled" : ""}>${collected ? "수집됨" : "질문 수집"}</button>
        </div>
      </div>
      <button class="btn-quiet" data-shuffle="1">다른 질문</button>
      <p class="q-hint">질문에서 시작해 뿌리 고전까지 내려가는 서재입니다.</p>
    </section>

    <p class="section-label">탐구 계기판</p>
    <div class="stats">
      <div class="stat"><b>${state.read.length}<small> /${ALL.length}</small></b><span>읽은 책</span><span class="lamp"></span></div>
      <div class="stat"><b>${state.questions.length}</b><span>수집한 질문</span><span class="lamp"></span></div>
      <div class="stat"><b>${state.rootArrivals}</b><span>뿌리 도달</span><span class="lamp"></span></div>
      <div class="stat"><b>${state.journeysDone.length}<small> /${JOURNEYS.length}</small></b><span>여정 완료</span><span class="lamp"></span></div>
    </div>

    <p class="section-label">분야별 계보 진행</p>
    <div class="gauge">${gaugeRows}</div>

    <p class="section-label">질문 여정</p>
    ${journeyHtml}
    ${readingNow.length ? `<p class="section-label">지금 읽는 중</p>` + readingNow.map((x) => bookCard(x, { noPrinciple: true })).join("") : ""}
    ${lastQObj ? `
      <p class="section-label">최근 수집한 질문</p>
      <button class="card card-tap" data-tab="record">
        <div class="card-title" style="font-family:var(--serif)">${esc(lastQObj.text)}</div>
        <div class="card-meta">${esc(lastQBook.author)}, ${esc(lastQObj.source)} · 기록에서 나의 답 적기</div>
      </button>` : ""}`;
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

  viewEl.innerHTML = `
    ${IS_SEED ? `<div class="notice">시드 데이터 ${ALL.length}권 — 정식 천 권 리스트 교체 예정</div>` : ""}
    <input class="search" type="search" id="lib-search" placeholder="제목 또는 저자 검색" value="${esc(libQuery)}" aria-label="서재 검색">
    <div class="chips" role="group" aria-label="분야 필터">
      ${["전체", ...DOMAINS].map((d) => `<button class="chip" data-libdomain="${esc(d)}" aria-pressed="${d === libDomain}">${esc(d)}</button>`).join("")}
    </div>
    <div class="chips" role="group" aria-label="계단 필터">
      ${["전체", "뿌리", "줄기", "가지"].map((t) => `<button class="chip" data-libtier="${esc(t)}" aria-pressed="${t === libTier}">${esc(t)}</button>`).join("")}
    </div>
    ${books.length ? books.map((b) => bookCard(b)).join("") : `<p class="empty">조건에 맞는 책이 없습니다.</p>`}`;
  const input = document.getElementById("lib-search");
  input.addEventListener("input", () => {
    libQuery = input.value;
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
        ${tierBadge(b)}${statusBadge(b.id)}
        <h2>${esc(b.title)}</h2>
        <p class="meta">${esc(b.author)} · ${esc(b.era)} · ${esc(b.domain)}</p>
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
  state.rootArrivals += 1; // 뿌리 도달 시마다 +1 (중복 허용, PRD F1)
  save();
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
  const books = j.bookIds.map((id) => {
    const b = BY_ID.get(id);
    const checked = doneIds.includes(id);
    return `
      <div class="card journey-check">
        <input type="checkbox" id="jc-${id}" data-jcheck="${id}" ${checked ? "checked" : ""} aria-label="${esc(b.title)} 읽음 체크">
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

/* ── 오버레이: 프로필 로그인 (F9, 로컬 전용) ────────── */
function renderProfile() {
  const p = state.profile;
  overlayRoot.innerHTML = `
    <div class="sheet-backdrop" data-close-overlay="1">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="프로필" tabindex="-1">
        <div class="sheet-handle"></div>
        <h2>${p ? esc(p.name) + "님" : "로그인"}</h2>
        <p class="meta">${p ? "이 기기의 서재에 로그인되어 있습니다" : "이름으로 나의 서재를 시작합니다"}</p>
        <input class="profile-input" id="profile-name" type="text" maxlength="20"
          placeholder="이름 또는 별명" value="${p ? esc(p.name) : ""}" aria-label="이름">
        <p class="profile-note">기록은 이 기기에만 보관됩니다. 계정 연동과 기기 간 동기화는 다음 버전에서 제공합니다.</p>
        <div class="sheet-actions">
          <button class="btn btn-primary" data-login="1">${p ? "이름 변경" : "로그인"}</button>
          ${p ? `<button class="btn btn-ghost" data-logout="1">로그아웃</button>` : ""}
        </div>
        <p id="profile-alert" role="alert" hidden>이름을 입력해 주세요.</p>
      </div>
    </div>`;
  overlayRoot.querySelector(".sheet").focus();
}

/* ── 전체 렌더 ─────────────────────────────────────── */
function render() {
  const v = top();
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
  pb.textContent = state.profile ? `${state.profile.name}님` : "로그인";
}

/* ── 이벤트 위임 ───────────────────────────────────── */
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab],[data-open-book],[data-collect],[data-shuffle],[data-domain],[data-libdomain],[data-libtier],[data-open-trail],[data-cycle-read],[data-goto-lineage],[data-open-jlist],[data-open-jdetail],[data-start-journey],[data-finish-journey],[data-open-profile],[data-login],[data-logout],[data-close-overlay]");
  if (!t) return;

  if (t.dataset.openProfile) {
    pushView({ tab: top().tab, overlay: { type: "profile" } });
  } else if (t.dataset.login) {
    const input = document.getElementById("profile-name");
    const name = input.value.trim();
    const alertEl = document.getElementById("profile-alert");
    if (!name) { alertEl.hidden = false; input.focus(); return; }
    state.profile = { name };
    save();
    history.back(); // 프로필 시트 닫기
  } else if (t.dataset.logout) {
    state.profile = null;
    save();
    history.back();
  } else if (t.dataset.tab) {
    const cur = top();
    if (cur.tab === t.dataset.tab && !cur.overlay) return;
    pushView({ tab: t.dataset.tab, overlay: null });
  } else if (t.dataset.openBook) {
    pushView({ tab: top().tab, overlay: { type: "sheet", bookId: t.dataset.openBook } });
  } else if (t.dataset.openTrail) {
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
    shuffleOffset += 1;
    render();
  } else if (t.dataset.domain) {
    sessionDomain = t.dataset.domain;
    render();
  } else if (t.dataset.libdomain) {
    libDomain = t.dataset.libdomain;
    render();
  } else if (t.dataset.libtier) {
    libTier = t.dataset.libtier;
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

document.addEventListener("change", (e) => {
  const c = e.target.closest("[data-jcheck]");
  if (!c || !state.journey) return;
  const id = c.dataset.jcheck;
  if (c.checked) {
    if (!state.journey.doneBookIds.includes(id)) state.journey.doneBookIds.push(id);
    setReadStatus(id, "read"); // 여정 체크 = 읽음 처리
  } else {
    state.journey.doneBookIds = state.journey.doneBookIds.filter((x) => x !== id);
  }
  save();
  render();
});

document.addEventListener("input", (e) => {
  const qa = e.target.closest("[data-answer-q]");
  if (qa) {
    const item = state.questions.find((x) => x.id === qa.dataset.answerQ);
    if (item) { item.myAnswer = qa.value; save(); }
    return;
  }
  const ja = e.target.closest("[data-answer-j]");
  if (ja) {
    const item = state.journeysDone.find((x) => x.id === ja.dataset.answerJ);
    if (item) { item.myAnswer = ja.value; save(); }
  }
});

/* ── 시작 ─────────────────────────────────────────── */
render();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js"); });
}
