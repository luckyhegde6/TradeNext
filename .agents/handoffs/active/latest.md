---
handoff: v3.35.0-intelligence-test-fix
session_id: v3.35.0-intelligence-test-fix
date: 2026-09-11
branch: fix/leader-watchdog-self-heal (on top of v3.34.1 merge 05b91e8; v3.33.0 6e22eca + v3.33.1 f86d9d0 + v3.34.0 5d754b7 + v3.34.1 d91fb01 all merged into this PR #118 branch)
last_commits: 05b91e8 (v3.34.1 merge into PR #118 branch), d91fb01 (v3.34.1 wasm gate fix), 5d754b7 (v3.34.0 monthly ops), f86d9d0 (v3.33.1 swing), 6e22eca (v3.33.0 watchdog), bcde7ae (v3.32.1 committed)
dev: local :3000 (dev PID 12096 — do not kill; MCP 4096 do not kill; pg docker 5432 do not kill)
status: in_progress
commit: pending user approval (v3.35.0 test-only +21 — lib/__tests__/intelligence.test.ts; docs phase done)
---

# Handoff — v3.35.0 Flaky intelligence.test.ts CI fix + v3.34.0 Monthly Query Consumption + v3.34.1 sql.js WASM gate fix + v3.33.0 Leader watchdog self-heal + v3.33.1 Swing touch-tracking fix — merged into PR #118 branch

## v3.35.0 — Flaky `intelligence.test.ts` CI fix — prisma mock isolates the fire-and-forget `IntelligenceCache` upsert (zero real-DB writes in tests)
**Test-only +21 UNCOMMITTED on PR #118 branch `fix/leader-watchdog-self-heal` (on top of v3.34.1 merge `05b91e8`); docs phase DONE; diff/commit pending user approval.**
Root cause: `setIntelligenceCache` (`lib/services/intelligence/cache.ts` :101-124) fires `prisma.intelligenceCache.upsert(...)` UN-AWAITED → the real-Postgres `beforeEach` `deleteMany` teardown (`intelligence.test.ts` :73-80) races the in-flight upsert → stale row → spurious `INTELLIGENCE_CACHE_HIT` → flaky failures at :187/:246/:279 (the "documented pre-existing flake" since v3.25.0, now FIXED).
Fix: NEW full prisma mock factory (`{ __esModule: true, default: { intelligenceCache: { findUnique/upsert/delete/deleteMany/count/findMany → jest.fn() } } }`) inserted between the `beforeEach` close and the Tests header; `jest.clearAllMocks()` clears call history but keeps impls. Single-file surgical change, test-only (+21).
**Tests**: `intelligence.test.ts` **13/13 PASS**; full **86/86 suites / 1170 pass / 4 skip / 0 fail** — FIRST fully-green full run (no more pre-existing-flake asterisk); tsc **46 = exact baseline (0 new)**; no migration; no new packages.

## v3.34.0 — Monthly Query Consumption (db-health monthly-ops window, Plan 09 rev-v3 c/d)
**Code + tests DONE and VERIFIED on `feat/db-health-monthly-ops` and MERGED into PR #118 branch `fix/leader-watchdog-self-heal` (per user-approved plan); PR #118 push/merge/deploy pending user.**
User directive (v3.31.0): plan limit **MONTHLY 200K ops/mo (resetting 2nd)** + Prisma calls only at 3 moments — boot hydration, 6h SQLite→Prisma push, ONE hourly ops-usage write — zero between. db-health only showed TODAY's ops; with a monthly plan that's the wrong unit and a restarted instance loses the month's history → this implements the deferred Plan 09 rev-v3 c/d monthly-ops window. `query_cache` STAYS deferred.

### What shipped (v3.34.0)
- **Ledger module (pure)** — NEW `lib/services/opsMonthly.ts`: `OpsMonthlyState {monthKey, days}` on globalThis `__opsMonthly`; monthKey = `getIstDayKey().slice(0, 7)` (YYYY-MM); `getOpsMonthlyState()` lazily seeds + fresh ledger at month rollover; `foldOpsCounterIntoMonthly()` idempotent `Math.max` high-water merge; `buildQueryConsumption()` pure aggregation (live day merged over persisted — restarted instance keeps high-water, current-day replaced before summing, no double count; perDay newest-first ≤ 31; `DB_PLAN_LIMIT_OPS_MONTHLY` default 200_000). PURE: only imports `getIstDayKey` from `@/lib/prisma`, NEVER invoked at module load (several suites mock `@/lib/prisma` without named exports).
- **Persistence** (`lib/sqlite.ts` +64) — `persistOpsMonthly()`/`restoreOpsMonthly()` (iface :244-250) under `_backup_meta` key `"ops_monthly"` (`OPS_MONTHLY_KEY` :1653); restored in `initSqliteBackup()` (:1421) + persisted after initial sync (:1440) + 60s `startOpsCounterPersistence()` tick folds+persists (:1705); `restoreOpsMonthly` discards stale previous-month snapshots.
- db-health GET `queryConsumption` block (+12) + "Monthly Query Consumption" card (+77); `.env.example` +5.
- **No hot-path change** — `$allOperations` keeps bumping the live counter; `lib/prisma.ts` diff = 6-line pointer comment only.

### Test-trap fixed (Lesson #114)
- **Test-trap fixed (Lesson #114)**: `resetSqliteStateForTests()` nulls state IN PLACE → sqlite monthly test-3 ends `await ensureSqliteBackup();` before `resetOpsMonthlyForTests()`.

## v3.34.1 — sql.js WASM async-load gate fix
- `getSqlJs()` loaded `sql-wasm.wasm` via async `fs.readFile`/stream → sql.js init + stray "Cannot log after tests are done" lines landed after a Jest file finished. Fix: synchronous `wasmBinary` load (`fs.readFileSync`, try/catch per candidate path) so sql.js boots fully before any test finishes; `getSqlJs()` memoized. sqlite + cron-daemon **88/88** under `CI=true --runInBand` zero noise; full **1154 pass / 4 skip / 1 fail** (the 1 = the pre-existing `intelligence.test.ts` flake — FIXED in v3.35.0 above); tsc **46 = exact baseline (0 new)**; no migration; no new packages. Commit `d91fb01`.

## v3.33.0 — Leader watchdog self-heal (spec 11)
User directive: "don't let this happen again" — prod scheduler dead since ~2026-09-08 07:06 UTC, NO automatic recovery (only manual admin "Start Engine"). Root cause: leadership was ONE-SHOT — `acquireLeaderLock()` at boot + `startLeaderHeartbeat(role, onLost)`; v3.28.2 stops engines on `onLost` but NOTHING ever re-acquires → standby pollers forever.
- NEW `watchLeaderRole(role, handlers)` (`lib/services/leader.ts`): standby → adaptive probe (fresh foreign row = SLOW re-probe `LEADER_CLAIM_SLOW_MS` 300s; stale/absent = claim via `updateMany` count>0 | `create` | P2002 → false | `isDbUnavailableError` → fail-open) → re-probe OWN row (null/not-ours → `failOpenEvents++`) → **leader** + heartbeat `LEADER_HEARTBEAT_MS` 300s; renewal 0 → internal onLost → standby + `handlers.onLost` + FAST re-probe `LEADER_CLAIM_FAST_MS` 60s; `stop()`; phase-guard (no double `onAcquired`); steady-state 1 `findUnique`/300s/instance.
- `LEADER_STALENESS_MS` 15→**10 min** (human-approved); NEW `LeaderWatchHandlers`/`LeaderWatchStatus` + `getLeaderWatchStatuses()` (globalThis `__leaderWatchStatus`, zero-Prisma, mirrors `readTier`).
- Wiring (`instrumentation.ts`, "LEADER WATCHDOGS (v3.33.0, spec 11): replaces the one-shot boot election"): worker `onAcquired → startWorker(30_000)` / `onLost → stopWorkerEngine`; cron-daemon `onAcquired → startCronDaemon().then(...)` / `onLost → stopCronDaemon`; sqlite-sync log-only (`onAcquired: () => {}`).

## v3.33.1 — Swing touch-tracking fix
Root cause: `checkSwingPerformance` evaluated target/stop hits with the LATEST CLOSE only → an intraday HIGH/LOW touch that closed back inside the range was never counted (missed exits / wrong "still open"). Fix: `SwingSignalStatusInput` NEW `maxHighSincePosting`/`minLowSincePosting` (omit/null → close-only preserved); windowByTicker from ONE `$queryRaw` over `daily_prices` (`WHERE ticker = ANY(${symbols}) AND "tradeDate" >= MIN(postedAt)`, ASC; per-signal JS filter); live-quote bridge captures `dayHigh`/`dayLow`; BUY intraday-touch target-wins the tie; reason strings `touched … intraday (high/low X, close Y)` vs `crossed`; status-change audit metadata +2 fields. Files for the commit: `lib/services/swingPerformanceService.ts` + `lib/__tests__/swingPerformanceService.test.ts` ONLY.

## Verification (all workstreams incl. v3.35.0)
- v3.35.0: `intelligence.test.ts` **13/13**; full **86/86 suites / 1170 pass / 4 skip / 0 fail** — FIRST fully-green full run; tsc **46 = exact baseline (0 new)**; no migration; no new packages.
- v3.33.0 + v3.34.x: `leaderWatch.test.ts` **8/8** + `instrumentation.test.ts` 7 rewritten + `dbHealthRoute.test.ts` +1 + `cron-daemon.test.ts` +1 (engine restart); constant fixes `leader.test.ts:68`/`sqlite.test.ts:282`; targeted **125/125**; swing **27/27**; tsc **46 = exact baseline (0 new)**; +17 new tests.

## Deferred / Next (consolidated)
- **Deferred (unchanged)**: `query_cache` (Plan 09 rev-v3 c/d); live `probe_time` DB check; durable Netlify `TZ`/`UTC` env fix (v3.32.0). v3.32.1 (`bcde7ae`) is merged into this branch but NOT deployed — live admin Save Correction still 400s until PR #118 merges/deploys.
- **Next**: v3.35.0 docs phase DONE (AGENTS.md/CHANGELOG/TODO/Primer/Lessons #115/agent-memory/session-todos/HANDOFF + versions-v3.35.md + latest.md + session archive `2026-09-11-intelligence-test-fix`); run `/pre-commit-check` (delete `.dev-otel.log` if present) → **no push/merge/deploy of PR #118 without explicit user approval**.

## Session archive
- `.agents/sessions/2026-09-11-intelligence-test-fix/` — decisions.md (D1-D4) + flow.md. Plus `.agents/changelog/versions-v3.35.md` (v3.35.0 full-detail file).
- `.agents/sessions/2026-09-11-monthly-ops/` — decisions.md (D1-D6) + flow.md. Plus `.agents/changelog/versions-v3.34.md` (v3.34.0 + v3.34.1 full-detail file). v3.33.x: no session archive (per approved 15-item plan); spec/plan 11: `.agents/specs/11-scheduler-self-heal.md` + `.agents/plans/11-scheduler-self-heal.md`.