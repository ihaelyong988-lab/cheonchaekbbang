/* 성능 예산 — 전송 바이트와 모듈 체인 (§7)
 *
 * 왜 이 형태인가: 브라우저 실측은 느리고 기계마다 흔들려 상시 게이트로 쓸 수 없다. 반면 2026-08-21
 * 재측정은 느린 회선의 첫 질문카드 지연 약 200ms 가 **전송 바이트 증가 하나로** 설명된다는 것을
 * 짝차이 부호 12/12 일치로 확인했다(CPU·렌더 노드 수·저장 페이로드는 무변). 그래서 바이트를 막으면
 * 그 지연을 막는다 — 결정적이고 빠르다.
 *
 * 대상 파일 목록을 손으로 적지 않는다. 새 모듈이 늘 때 조용히 빠져 에러 없이 초록이 된다(§9 E-028).
 * app.js 의 import 를 따라가 폐쇄를 직접 센다.
 */
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* §7 예산 (2026-08-21 재측정 기준).
   단위와 대상 집합을 여기 못박는다 — 전에는 "약 116KB" 만 적혀 있어 원바이트로 재면 초과,
   gzip 으로 재면 예산 내가 되어 어느 쪽으로도 판정할 수 없었다(측정 실패). */
/* 2026-08-21 역사 25권 확장으로 상향. 실측 증가분(원바이트 +20,888 B · gzip +6,321 B)에
   소폭 여유만 얹었다 — 예산을 넉넉히 잡으면 다음 확장이 조용히 통과한다.
   **경고: 이 방식은 1,000권까지 확장할 수 없다.** 1권당 836 B(gzip 253 B)이므로 825권을 더하면
   gzip 총 296,537 B 로 이 예산의 3.2배가 되고 Fast-3G 첫 질문카드가 약 1초 늦어진다.
   카탈로그를 초기 번들에서 빼는 구조 변경이 선행돼야 한다(§7-2). */
const BUDGET = {
  hops: 3,
  modules: 7,
  rawBytes: 310_000,
  gzipBytes: 100_000,
  perFile: { "app.js": 122_000, "data/authored-questions.js": 29_000, "data/history-classics.js": 23_000 },
};

// app.js 에서 시작해 상대 경로 import 를 따라간다. 홉 수는 app.js 를 0단으로 센 최대 깊이다.
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
const gzipBytes = files.reduce((sum, file) => sum + gzipSync(readFileSync(path.join(ROOT, file)), { level: 9 }).length, 0);

// 폐쇄가 무너지면(정규식이 못 읽으면) 0개를 세고도 통과한다. 준비 실패를 통과로 만들지 않는다.
assert.ok(files.includes("app.js") && files.length >= 4,
  `모듈 폐쇄를 세지 못했습니다(${files.length}개) — 측정 실패입니다.`);

assert.ok(hops <= BUDGET.hops, `모듈 체인 깊이 ${hops}홉 > 예산 ${BUDGET.hops}홉 — 부팅 파도가 늘었습니다.`);
assert.ok(files.length <= BUDGET.modules, `모듈 ${files.length}개 > 예산 ${BUDGET.modules}개`);
assert.ok(rawBytes <= BUDGET.rawBytes,
  `JS 원바이트 ${rawBytes.toLocaleString()} B > 예산 ${BUDGET.rawBytes.toLocaleString()} B — 느린 회선의 첫 질문카드가 늦어집니다.`);
assert.ok(gzipBytes <= BUDGET.gzipBytes,
  `JS gzip ${gzipBytes.toLocaleString()} B > 예산 ${BUDGET.gzipBytes.toLocaleString()} B`);
for (const [file, limit] of Object.entries(BUDGET.perFile)) {
  assert.ok(sizes[file] !== undefined, `예산이 지목한 ${file} 이 모듈 폐쇄에 없습니다 — 예산표가 낡았습니다.`);
  assert.ok(sizes[file] <= limit, `${file} ${sizes[file].toLocaleString()} B > 예산 ${limit.toLocaleString()} B`);
}

console.log(JSON.stringify({
  result: "pass",
  hops,
  modules: files.length,
  rawBytes,
  gzipBytes,
  headroomRaw: `${(100 - (rawBytes / BUDGET.rawBytes) * 100).toFixed(1)}%`,
  headroomGzip: `${(100 - (gzipBytes / BUDGET.gzipBytes) * 100).toFixed(1)}%`,
  largest: Object.entries(sizes).sort((a, z) => z[1] - a[1]).slice(0, 3).map(([f, b]) => `${f} ${b.toLocaleString()}B`),
}, null, 2));
