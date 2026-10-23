/* 카탈로그 생성기 — 부팅 색인 + 분야별 질문·메타 샤드 (AGENTS §7-2 구조 결정 V3b · 2026-10-24)
 *
 * 왜: 카탈로그를 초기 번들에 통째로 실으면 1,000권에서 첫 질문카드 전 전송량이 예산의 3배가 된다(§7-2 파일럿).
 * INV-5(전 자산 프리캐시) 때문에 총 전송량은 어떤 구조든 같으므로, 바꿀 것은 **첫 페인트를 막는 바이트**만이다.
 * 홈 히어로는 부팅 색인(질문 id 열 · 분야 · 계단 · roots)과 첫 질문이 속한 분야의 질문 샤드 1개로 그린다.
 *
 * 입력은 data/books.js 가 export 하는 최종 BOOKS(ensureQuestionDepth 적용 후)·JOURNEYS·DOMAINS·IS_SEED 다.
 * 출력(전부 생성물 — 손으로 고치지 않는다. 데이터가 바뀌면 `npm run build:shards`):
 *   data/boot-index.js              BOOT = [[id, 분야, 질문 수, 계단, roots], …] · DOMAINS · SHARDS(분야→파일 slug) · JOURNEYS · IS_SEED
 *   data/shards/<slug>.questions.js QUESTIONS = { 책id: [질문…] }
 *   data/shards/<slug>.meta.js      META = [{ id, 제목, 저자, 시대, 원리, 뿌리 이유, 그 밖의 모든 필드 }]
 * 질문 id 는 app.js 의 questionId() 와 같은 `${책id}#${순번}` 으로 부팅 색인에서 그대로 복원된다(데이터에 qid 없음).
 * 메타 필드 목록을 손으로 적지 않는다 — 부팅 색인 키와 questions 를 뺀 나머지를 통째로 옮기므로 새 필드가 조용히 빠지지 않는다(§9 E-028).
 * 신선도는 tests/data-integrity.mjs 가 이 함수를 다시 돌려 디스크와 대조한다.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SHARD_SLUG = Object.freeze({
  "철학": "philosophy",
  "역사": "history",
  "과학": "science",
  "문학": "literature",
  "경제·사회": "economy-society",
  "예술": "arts",
});
const BOOT_KEYS = ["id", "domain", "tier", "roots", "questions"];
const HEADER = "// 생성물 — scripts/build-shards.mjs 가 data/books.js 에서 만든다. 손으로 고치지 않는다(npm run build:shards).\n";

/** @returns {Map<string, string>} 저장소 상대 경로 → 파일 내용(LF) */
export function buildArtifacts({ BOOKS, JOURNEYS, DOMAINS, IS_SEED }) {
  for (const domain of DOMAINS) if (!SHARD_SLUG[domain]) throw new Error(`샤드 slug 없는 분야: ${domain}`);
  const out = new Map();
  const boot = BOOKS.map((b) => [b.id, b.domain, Array.isArray(b.questions) ? b.questions.length : 0, b.tier, b.roots]);
  out.set("data/boot-index.js",
    HEADER +
    `export const DOMAINS = ${JSON.stringify(DOMAINS)};\n` +
    `export const SHARDS = ${JSON.stringify(SHARD_SLUG)};\n` +
    `export const IS_SEED = ${JSON.stringify(Boolean(IS_SEED))};\n` +
    `export const JOURNEYS = ${JSON.stringify(JOURNEYS)};\n` +
    `export const BOOT = ${JSON.stringify(boot)};\n`);
  for (const domain of DOMAINS) {
    const books = BOOKS.filter((b) => b.domain === domain);
    const questions = Object.fromEntries(books.map((b) => [b.id, b.questions]));
    const meta = books.map((b) => {
      const rest = { id: b.id };
      for (const [key, value] of Object.entries(b)) if (!BOOT_KEYS.includes(key)) rest[key] = value;
      return rest;
    });
    const slug = SHARD_SLUG[domain];
    out.set(`data/shards/${slug}.questions.js`,
      HEADER + `export const DOMAIN = ${JSON.stringify(domain)};\nexport const QUESTIONS = ${JSON.stringify(questions)};\n`);
    out.set(`data/shards/${slug}.meta.js`,
      HEADER + `export const DOMAIN = ${JSON.stringify(domain)};\nexport const META = ${JSON.stringify(meta)};\n`);
  }
  return out;
}

// CLI: `node scripts/build-shards.mjs` 로 실행될 때만 디스크에 쓴다. import 만으로는 아무것도 바꾸지 않는다.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const data = await import("../data/books.js");
  const artifacts = buildArtifacts(data);
  mkdirSync(path.join(ROOT, "data/shards"), { recursive: true });
  for (const [rel, content] of artifacts) writeFileSync(path.join(ROOT, rel), content, "utf8");
  console.log(JSON.stringify({ written: [...artifacts.keys()], books: data.BOOKS.length }));
}
