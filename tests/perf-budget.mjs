/* 성능 예산 — 전송 바이트와 모듈 체인 (§7 · 2단 예산, §7-2 V3b)
 *
 * 왜 이 형태인가: 브라우저 실측은 느리고 기계마다 흔들려 상시 게이트로 쓸 수 없다. 2026-08-21 재측정은 느린 회선의
 * 첫 질문카드 지연이 **전송 바이트 증가 하나로** 설명된다는 것을 짝차이 부호 12/12 일치로 확인했다. 그래서 바이트를
 * 막으면 그 지연을 막는다 — 결정적이고 빠르다.
 *
 * 2026-10-24 구조 변경(V3b) 뒤 예산은 두 단이다.
 *   1단 정적 폐쇄 — app.js 의 정적 import 를 따라간 집합(app.js · lib/search.js · data/boot-index.js). 첫 페인트 전 반드시 받는 바이트.
 *   2단 히어로까지 — 1단 + 가장 큰 질문 샤드. 첫 질문 본문이 화면에 나오기까지의 상한.
 * 샤드는 디스크에서 세고 1개 상한을 둔다 — 한 분야가 커지면 그 분야 방문자만 늦어지므로 합계가 아니라 개별이 상한이다.
 * 대상 파일 목록을 손으로 적지 않는다. 새 모듈이 늘 때 조용히 빠져 에러 없이 초록이 된다(§9 E-028).
 * 1,000권 환산은 정보용이다(판정 아님) — 분야 목표(data/books.js DOMAIN_TARGETS)에 분야별 권당 바이트를 곱한다.
 */
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { BOOT, SHARDS, DOMAINS } = await import("../data/boot-index.js");
const { DOMAIN_TARGETS } = await import("../data/books.js");

/* §7 예산(2026-10-24 V3b 실측 기준 · 단위는 바이트). 실측값에 소폭 여유만 얹었다 — 넉넉히 잡으면 다음 확장이 조용히 통과한다. */
const BUDGET = {
  hops: 1,              // app.js → boot-index · search.js
  modules: 3,
  rawBytes: 220_000,    // 1단 원바이트 (실측 138,731 · 1,000권 환산 약 190K)
  gzipBytes: 80_000,    // 1단 gzip     (실측 41,353 · 1,000권 환산 약 51K)
  heroGzip: 100_000,    // 2단 gzip = 1단 + 최대 질문 샤드 (실측 49,798 · 1,000권 환산 약 77K)
  shardGzip: 45_000,    // 샤드 1개 gzip 상한 (1,000권 환산 최대 약 31K)
  perFile: { "app.js": 126_000, "data/boot-index.js": 80_000 },   // app.js 는 샤드 지연 로드 코드로 121,898 B 가 됐다(2026-10-24)
};

const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const gzFile = (rel) => gz(readFileSync(path.join(ROOT, rel)));

// app.js 에서 시작해 상대 경로 정적 import 를 따라간다. 홉 수는 app.js 를 0단으로 센 최대 깊이다. 동적 import() 는 2단에서 따로 센다.
function importClosure(entry) {
  const seen = new Map([[entry, 0]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    const source = readFileSync(path.join(ROOT, file), "utf8");
    for (const [, spec] of source.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+"(\.[^"]+)"/gu)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (!existsSync(path.join(ROOT, resolved))) throw new Error(`import 해석 실패: ${resolved}`);
      if (seen.has(resolved)) continue;
      seen.set(resolved, seen.get(file) + 1);
      queue.push(resolved);
    }
  }
  return seen;
}

const closure = importClosure("app.js");
const files = [...closure.keys()].sort();
const hops = Math.max(...closure.values());
const sizes = Object.fromEntries(files.map((file) => [file, readFileSync(path.join(ROOT, file)).length]));
const rawBytes = Object.values(sizes).reduce((sum, size) => sum + size, 0);
const gzipBytes = files.reduce((sum, file) => sum + gzFile(file), 0);

// 폐쇄가 무너지면(정규식이 못 읽으면) 0개를 세고도 통과한다. 준비 실패를 통과로 만들지 않는다.
assert.ok(files.includes("app.js") && files.includes("data/boot-index.js") && files.length >= 3,
  `모듈 폐쇄를 세지 못했습니다(${files.length}개: ${files.join(", ")}) — 측정 실패입니다.`);
assert.ok(!files.includes("data/books.js"), "카탈로그 원천 모듈이 정적 폐쇄에 들어 있습니다 — 초기 번들에 카탈로그를 실으면 안 됩니다(§7-2).");

// 샤드 — 디스크에서 센다. 분야마다 질문·메타 2종이 전부 있어야 한다(없으면 그 분야는 영원히 "불러오는 중"이다).
const shardDir = readdirSync(path.join(ROOT, "data/shards")).filter((file) => file.endsWith(".js"));
for (const domain of DOMAINS) {
  for (const kind of ["questions", "meta"]) {
    assert.ok(shardDir.includes(`${SHARDS[domain]}.${kind}.js`), `샤드 누락: ${domain} ${kind} — npm run build:shards`);
  }
}
const shards = shardDir.map((file) => ({ file: `data/shards/${file}`, gzip: gzFile(`data/shards/${file}`), kind: file.endsWith(".questions.js") ? "questions" : "meta" }));
const maxQuestionShard = Math.max(...shards.filter((s) => s.kind === "questions").map((s) => s.gzip));
const heroGzip = gzipBytes + maxQuestionShard;

assert.ok(hops <= BUDGET.hops, `모듈 체인 깊이 ${hops}홉 > 예산 ${BUDGET.hops}홉 — 부팅 파도가 늘었습니다.`);
assert.ok(files.length <= BUDGET.modules, `정적 모듈 ${files.length}개 > 예산 ${BUDGET.modules}개`);
assert.ok(rawBytes <= BUDGET.rawBytes,
  `1단 원바이트 ${rawBytes.toLocaleString()} B > 예산 ${BUDGET.rawBytes.toLocaleString()} B — 첫 페인트가 늦어집니다.`);
assert.ok(gzipBytes <= BUDGET.gzipBytes,
  `1단 gzip ${gzipBytes.toLocaleString()} B > 예산 ${BUDGET.gzipBytes.toLocaleString()} B`);
assert.ok(heroGzip <= BUDGET.heroGzip,
  `히어로까지 gzip ${heroGzip.toLocaleString()} B > 예산 ${BUDGET.heroGzip.toLocaleString()} B — 느린 회선의 첫 질문카드가 늦어집니다.`);
for (const shard of shards) {
  assert.ok(shard.gzip <= BUDGET.shardGzip, `${shard.file} gzip ${shard.gzip.toLocaleString()} B > 샤드 예산 ${BUDGET.shardGzip.toLocaleString()} B — 분야를 나누거나 질문·메타를 더 쪼개야 합니다.`);
}
for (const [file, limit] of Object.entries(BUDGET.perFile)) {
  assert.ok(sizes[file] !== undefined, `예산이 지목한 ${file} 이 모듈 폐쇄에 없습니다 — 예산표가 낡았습니다.`);
  assert.ok(sizes[file] <= limit, `${file} ${sizes[file].toLocaleString()} B > 예산 ${limit.toLocaleString()} B`);
}

// 정보용 1,000권 환산 — 분야 목표에 분야별 권당 바이트를 곱한다. 판정에는 쓰지 않는다.
const booksPerDomain = Object.fromEntries(DOMAINS.map((d) => [d, BOOT.filter((row) => row[1] === d).length]));
const scaledQuestionShards = DOMAINS.map((d) => {
  const shard = shards.find((s) => s.file === `data/shards/${SHARDS[d]}.questions.js`);
  return Math.round((shard.gzip / booksPerDomain[d]) * DOMAIN_TARGETS[d]);
});
const bootGzipAt1000 = Math.round((gzFile("data/boot-index.js") / BOOT.length) * Object.values(DOMAIN_TARGETS).reduce((a, b) => a + b, 0));
const heroAt1000 = gzipBytes - gzFile("data/boot-index.js") + bootGzipAt1000 + Math.max(...scaledQuestionShards);

console.log(JSON.stringify({
  result: "pass",
  hops,
  modules: files.length,
  rawBytes,
  gzipBytes,
  heroGzip,
  shards: shards.length,
  maxShardGzip: Math.max(...shards.map((s) => s.gzip)),
  headroomGzip: `${(100 - (gzipBytes / BUDGET.gzipBytes) * 100).toFixed(1)}%`,
  headroomHero: `${(100 - (heroGzip / BUDGET.heroGzip) * 100).toFixed(1)}%`,
  projectedHeroGzipAt1000: heroAt1000,
  largest: Object.entries(sizes).sort((a, z) => z[1] - a[1]).slice(0, 3).map(([f, b]) => `${f} ${b.toLocaleString()}B`),
}, null, 2));
