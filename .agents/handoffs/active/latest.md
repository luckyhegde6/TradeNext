---
handoff_version: "1.1"
session_id: "sess-20260905-v3284-recs-read-first"
agent: "system"
timestamp: "2026-09-05T00:00:00Z"
status: "in_progress"
priority: "high"
parent_session: "sess-20260905-v3283-audit-wb-queued-at"
child_sessions: []
checkpoint: "v3.28.4 read-first recommendations route + edge-cache heavy latest-run reads — code + regression test + docs complete & VERIFIED (tsc 46 exact baseline, recs 34/34, readTier/recPerf 25/25, full suite 1004 pass / 4 skip / 2 fail = pre-existing intelligence flake only); commit/push pending user (no merge)"
---

# Active Session Handoff

## Context
- **Task**: Fix the two compounding issues surfaced by db-health read-tier (`recommendations.prisma` 14/14 huge-query misses on every request): **(1) key collision** — `app/api/recommendations/route.ts` wrote its serialized `responseBody` under the **service's** `LATEST_KEY` (`"recommendations:latest"`), clobbering the `LatestCacheEntry {runId, newestRunId, data}` → `cached.runId === undefined` → the heavy stocks-include query re-ran on EVERY request; **(2) heavy latest-run reads unedge-cached** despite v3.27.0's `withAccelerateCache`. User approved the **"Both"** fix.
- **Branch**: `fix/v3.28.1-sqlite-self-heal` (on top of v3.28.3 `a1dd094`). **v3.28.4 code + test + docs VERIFIED, commit/push PENDING USER (no merge).** Do not amend `718b5d2`/`8020dee`/`a6d902e`/`24e3586`/`3605c64`/`5a63fc4`/`c86f7ef`/`a1dd094`.

## Progress
- [x] **Root cause**: route wrote `{success, run, latestRun, stocks, timestamp}` under the service's `LATEST_KEY` → `LatestCacheEntry` replaced by flat body → fingerprint check `cached.runId === undefined` → stocks-include query (95 rows) ran on EVERY request; plus the heavy reads had no edge caching on busy dashboards.
- [x] **Fix (route, `app/api/recommendations/route.ts`)**: `ROUTE_CACHE_KEY = "recommendations:api:latest"` (distinct from service key) + `ROUTE_CACHE_TTL_SECONDS = 60` + typed `RouteRecommendationsCacheBody {success, stocks, timestamp}`; read-first memory fast path AFTER the plan-limit breaker block (`recommendationsCache.get(ROUTE_CACHE_KEY)`, `recordRead("recommendations.memory", {source:"memory", latencyMs:0, rows, hit:true})`, `servedFrom: "memory_cache"`, zero Prisma); all three legacy `"recommendations:latest"` refs (breaker fallback, response `set`, DB-error fallback) switched to the route key — the service key is never touched by the route. Breaker-block ordering preserved → SQLite-mirror priority unchanged.
- [x] **Fix (service, `lib/services/dailyRecommendationService.ts`)**: `import prisma, { withAccelerateCache }`; both heavy `findFirst` reads in `getLatestRecommendations` (`latestRun` stocks-include :1273-1289, `newestRun` lightweight select :1294-1299) wrapped in `withAccelerateCache({ ttl: 60, swr: 30 })`; **fingerprint probes stay uncached** (cross-instance staleness guard is load-bearing). The wrapper's `Parameters<T>[0]` generic cannot re-infer `findFirst`+`include` payload → added the existing `as RunWithStocks | null` cast at the `serializedStocks` usage wherever `.stocks` is accessed (matches the pre-existing cast at :1308).
- [x] **Regression test (+1 → 34)**: factory (`dailyRecommendationService.test.ts`) gains the pure `withAccelerateCache` stub `(strategy) => (args) => ({...(args as object), cacheStrategy: strategy})` (pattern from `recommendationPerformanceService.test.ts:61-62`; spread preserves keys so existing `findFirst.mock.calls[0][0]?.where/select` assertions still pass). NEW **"v3.28.4: heavy latestRun/newestRun reads carry Accelerate cacheStrategy; fingerprint probes stay uncached"** — seeds cache `{runId,newestRunId}`, mocks 4 `findFirst` resolves, asserts calls length 4; `calls[0]`/`calls[1]` (fingerprints) lack `cacheStrategy`; `calls[2]`/`calls[3]` carry `cacheStrategy: {ttl: 60, swr: 30}`.
- [x] **Verification**: tsc **46 = exact baseline (0 new)** (zero errors in route/service/prisma/readTier); targeted `dailyRecommendationService.test.ts` **34/34**; `readTier.test.ts` + `recommendationPerformanceService.test.ts` **25/25** (boundary-helper provenance suites); full suite **1004 pass / 4 skip / 2 fail** — both failures = documented pre-existing `intelligence.test.ts` async cache-flake (fails run-to-run, `intelligence.ts`/`cache.ts` untouched; excluding it: **72 suites / 1004 pass / 4 skip / 0 fail from these changes**). No schema change → no migration.
- [x] **Docs (v3.28.4)**: AGENTS.md version-table row, `.agents/CHANGELOG.md` index row, `.agents/changelog/versions-v3.28.md` detail section (also removed the orphaned duplicate `# v3.28.2 — Lost-leader engine stop` header at EOF), session-todos, this file. (TODO.md/Primer/agent-memory pending in the same pass.)
- [x] **Earlier branch state (unchanged, still pending user)**: v3.28.3 `a1dd094` (committed + pushed); v3.28.2 `5a63fc4` (committed + pushed); v3.28.1 `718b5d2` (committed); v3.28.0 SQLite-first NSE store (uncommitted, incl. regression-fix `8020dee`); v3.27.0 Accelerate (spec/plan `db5a5cc`); v3.26.0 prod-failure triage (PR #114 merged `3605c64` — reconcile PR #114 doc status in a later doc pass).
- [x] **v3.28.2 findings recap**: (1) audit promotion `queued_at` failure — FIXED by v3.28.3; (2) 4× benign `WorkerStatus create` P2002 — informational (leader claim races; v3.26.0 skip filters once the running dev server hot-reloads — dev server PID 34672 pre-existing, do not kill/restart).

## Decisions
- Fix scope = "Both" per user: route read-first fast path under its own key (kills the collision → kills the per-request heavy query) + edge-cache the two heavy reads (`{ttl: 60, swr: 30}`). Route TTL 60s (not the earlier 600s) — the 95-row query only re-runs when the fingerprint actually changes or the 15-min service cache expires; fingerpprint probes intentionally uncached.
- Route cache stores only `{success, stocks, timestamp}` (not the clobbered run/latestRun) — the service remains the sole owner of the validated `LatestCacheEntry`.
- `invalidateRecommendationsCache()` = `flushAll()` clears both `"recommendations:api:latest"` and `"recommendations:latest"` — no stale-service-cache risk.
- Type-safety: the `as RunWithStocks | null` cast is the same pattern already used at :1308 — acceptable, documented in code comment.
- Verification gate = tsc 46 exact baseline + targeted suites + full suite with documented `intelligence.test.ts` flake excluded from attribution.
- No auto commit/push/merge/deploy without explicit user approval.

## Blockers
- **Commit/push of v3.28.4 + merge/deploy of v3.28.1-4 (and older v3.28.0/v3.27.0/v3.26.0 diff + PR #114 reconciliation) await explicit user approval.** No schema change → no migration.
- Deferred: **daily recommendation job failures** (Issue 3) — on the audit the primary persistence paths all verify; any remaining job-failure cause is a distinct follow-up.

## Next Move
1. Report v3.28.4 result to user (code + regression test + docs done; tsc 46 baseline, recs 34/34, readTier/recPerf 25/25, full suite 1004 pass / 4 skip / 2 fail = pre-existing flake only).
2. Await explicit user approval to **commit + push** v3.28.4 (separate commit, no amend) and then to **merge** `fix/v3.28.1-sqlite-self-heal` → `main` + deploy (Netlify rebuild applies v3.28.1 + v3.28.2 + v3.28.3 + v3.28.4).
3. Remind user of pending v3.28.0/v3.27.0/v3.26.0 commits + PR #114 doc reconcile + BUGS.md #14 (Prisma Postgres Phase 0 REQUIRED before Dec 1 2026 Accelerate retirement) + deferred daily-recommendation job failure investigation (Issue 3).
4. Optional post-push live-verify via running dev server PID 34672 + db-health: `recommendations.memory` readTier hits appearing, `recommendations.prisma` no longer 14/14.