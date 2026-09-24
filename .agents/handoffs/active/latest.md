# v3.41.2 handoff — Recommendations plan-limit fallbacks (Spec 01) + HistoryTab error state, commit pending approval

> **Branch**: `feature/ph22-decision-engine` (HEAD `a269057` = v3.41.1 COMMITTED — monitoring + auth-gate hardening; parent `ab6fd65` = v3.41.0 COMMITTED — engine core + POC A/B; grandparent `2909b22` = v3.40.8 spike VERDICT APPROVE). **CODE + TESTS + VERIFICATION + DOCS DONE — NEXT = user approves `git commit` as v3.41.2 (no push, no PR). v3.41.0 + v3.41.1 are committed but NOT pushed — push/PR after this commit carries all three.**
> **Read next**: `.agents/changelog/versions-v3.41.md` §v3.41.2 + `.agents/sessions/2026-09-25-recs-plan-limit-fallbacks/{flow.md, decisions.md}` + `Lessons.md` 138 + `Lessons.md` 136/137

## Status (v3.41.2 — spec 01, P6003 plan-limit-hold fallbacks; zero Prisma ops in fallback branches)
- NEW `lib/sqlite.ts getRecommendationRuns(opts)` — mirror query: camelCase rows (`id`, `generatedAt` Date, `source`, `status`, `uniqueStocks`), newest-first, `unique_stocks > 0`, status filter, limit clamp 1..2000 (default 200). Zero Prisma.
- `app/api/recommendations/top-stocks/route.ts` — NEW `topStocksFromSqlite()` fallback: `getSqliteFallback()` → `getRecommendationRuns()` → `getRecommendationStocks()` → serializer (same result shape + `source: "sqlite_mirror_degraded"`), 1 h cache via `getWithCache` (fresh key); Prisma `$queryRaw` branch KEPT (run-status filter); mirror-exhausted/not-ready → RETHROW original 500.
- `lib/services/recommendationPerformanceService.ts` — NEW `listItemFromMirrorTracker()` + `getPerformanceListFromSqlite()` (JS-side status filter mirroring SQL semantics — the mock mirror's tracker getter returns rows independent of SQL args, Lesson 138), timerange-aware; Prisma branch wrapped → only `isDbUnavailableError` (message/code-based → P6003 "hold on your account") falls to mirror; non-hold errors propagate.
- `lib/services/syncedDataService.ts` — steps 2+3 rewritten breaker/hold-aware: `mirrorWriteThrough` (write mirror EXCEPT when breaker open/plan-limit hold — mirror-only writes) + `mirrorReadMarketCache` (breaker open/hold → mirror read with DateTime-safe cache key; rethrows original when mirror not ready). Prisma happy path byte-identical.
- **HistoryTab (Phase 5, `app/components/recommendations/HistoryTab.tsx`)** — NEW `error` state (reset per fetch, set on `data.success === false` OR fetch throw → `"Failed to load recommendations history"`); error card (title + message + Retry) rendered BEFORE the empty-state list even if stale rows exist (same pattern as PerformanceTab). This was the **masked-500-as-empty-state** — a failed fetch previously rendered the silent "no recommendations yet" empty state.
- No migration, no packages, no env, no OpenAPI change (no new routes).

## Tests
- NEW `lib/__tests__/recommendationsPlanLimitFallbacks.test.ts` — **21/21** (6 History route + 7 Performance service + 8 syncedDataService). Mocks `@/lib/logger`, `@/lib/prisma`, `@/lib/sqlite`, `@/lib/cache`, `@/lib/audit`; real `@/lib/db-utils` with test hooks `openPlanLimitBreaker`/`closePlanLimitBreaker`/`resetPlanLimitBreaker` (default CLOSED — prod safety: no breaker = pure Prisma path).
- `lib/__tests__/sqliteMirror.test.ts` — 11/11 (golden sql.js WASM), now exercises the syncedDataService path.

## Verification (2026-09-25)
- `npx tsc --noEmit`: **46 = exact baseline (0 new)** — all 46 are pre-existing `*.test.ts(x)` matcher noise (some in the new suite file too, verified pre-existing semantics; prod source 0).
- `npm run lint`: **0 errors** (1153 warnings pre-existing).
- `npm run test`: **109/109 suites, 1440 pass, 4 skip, 0 fail** (new Spec 01 suite 21/21 included).
- `npm run quickbuild`: **189/189 pages** Compiled successfully.
- Live dev server API sanity (user-approved): `/api/recommendations/top-stocks` 200, `/api/recommendations/performance` 200 (items include LODHA), `/api/recommendations/ideas` 200.
- `npm run test:e2e` — `e2e/recommendations.spec.ts`: **10/10 passed** (Chromium, live dev server, 29.3 s). Cleanup done: dev server killed (PID 35424), port 3000 free, `next-dev.log` + `dev-server.pid` deleted.
- MCP/Playwright verification of HistoryTab error state: error card + Retry render before empty-state when fetch fails (mocked).
- Full unit output: `C:\Users\lucky\.local\share\opencode\tool-output\` (Phase 6 jest run).

## NEXT (awaiting user)
1. Approve commit as **v3.41.2** (working tree = 6 modified + 3 untracked: `.agents/specs/01-recommendations-plan-limit-fallbacks.md`, `.agents/plans/01-recommendations-plan-limit-fallbacks.md`, `lib/__tests__/recommendationsPlanLimitFallbacks.test.ts`; 679 insertions / 154 deletions; no junk — `.next/dev/types/*` noise only). Then push + PR (carries v3.41.0 `ab6fd65` + v3.41.1 `a269057` + v3.41.2).
2. After commit: P1–P3 real Laya inference behind a parity gate (laya-mock stays default) — needs user grant (install + key).

## From prior turn (context)
- v3.41.1 (spec 17): decision-engine monitoring ring + admin surface + e2e hardening; Auth.js double-submit CSRF race fixed via in-context 2-attempt resubmit loop (Lessons 136/137); committed `a269057`.
- v3.41.0 (spec 16): Laya-only mock decision engine, confidence-gated ACT/REVIEW, POC A screener + POC B swing, evaluate/ping routes, admin panel; committed `ab6fd65`.
- v3.40.8 P0 spike VERDICT **APPROVE** (onnxruntime-node; SPLIT graphs; chain median 2316 ms; RSS 611 MB).
- Don't read conversation memory — read the session `flow.md`/`decisions.md` files.