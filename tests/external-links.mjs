import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 외부 링크 도달 검사 — 등록부의 URL 이 **지금도 열리는가**.
//
// 왜 있는가: 2026-08-20 CanaryLab 에서 근거 원문 52건 중 2건이 404 였고, 게이트 6종 중 링크를 열어보는
// 것이 없었다(스키마는 url 존재·형식만 봤다). 이 앱은 외부 링크가 1건이라 지금은 안전하지만
// VERIFIED_CORRECTIONS 는 검증 URL 을 늘려가는 설계다 — 늘어난 뒤에 게이트를 만들면 늦다.
//
// 역할 분담(정보 1곳):
//   · 등록 여부·확인일 기한·죽은 등록 → tests/static-rules.mjs (오프라인, PR 마다)
//   · 실제 도달                      → 이 파일 (네트워크, main 푸시 잡에서만)
//   · 자기 배포 URL                  → tests/production-smoke.mjs (실브라우저)
//
// 판정 규약: 404·5xx·DNS·타임아웃 = 실패. **403·429 는 봇 차단이라 판정하지 않고 목록으로 보고한다** —
// 서버가 스크립트를 막는 것은 링크 결함이 아니다. 다만 차단이 새로 생기면 사람이 실브라우저로 확인해야
// 하므로 등록부 note 에 남긴다. 조회 자체가 실패하면 통과가 아니라 실패다(측정 실패는 통과가 아니다).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(await readFile(path.join(ROOT, "data", "external-links.json"), "utf8"));
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = Number(process.env.LINK_TIMEOUT_MS || 25000);

assert.ok(registry.links.length > 0, "등록부가 비었습니다 — 측정 대상 0건은 통과가 아니라 측정 실패입니다.");

const blocked = [];
const failed = [];

for (const link of registry.links) {
  let status = 0;
  let reason = "";
  try {
    const response = await fetch(link.url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = response.status;
    if (status === 403 || status === 429) {
      blocked.push(`${link.url} (HTTP ${status})`);
      continue;
    }
    if (!response.ok) reason = `HTTP ${status}`;
    else {
      const text = await response.text();
      if (text.length < 500) reason = `본문 ${text.length}자(내용 없음)`;
    }
  } catch (error) {
    reason = `조회 실패 — ${error?.message || String(error)}`;
  }
  if (reason) failed.push(`${link.url} — ${reason}`);
}

for (const line of blocked) console.log(`차단(판정 제외) ${line} — 실브라우저로 확인하고 note 를 갱신하세요.`);
assert.deepEqual(failed, [], `외부 링크 도달 실패:\n  ${failed.join("\n  ")}`);
console.log(`외부 링크 도달 OK — ${registry.links.length - blocked.length}/${registry.links.length}건 확인` +
  (blocked.length ? ` · 차단 ${blocked.length}건(판정 제외)` : ""));
