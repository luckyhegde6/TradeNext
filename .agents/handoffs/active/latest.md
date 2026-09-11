---
handoff: v3.34.1-ci-gate-fix
session_id: v3.34.1-ci-gate-fix
date: 2026-09-11
branch: fix/leader-watchdog-self-heal (v3.33.0 6e22eca + v3.33.1 f86d9d0 HEAD; v3.34.0 5d754b7 + v3.34.1 d91fb01 merged into this PR #118 branch)
last_commits: d91fb01 (v3.34.1 wasm gate fix), 5d754b7 (v3.34.0 monthly ops), f86d9d0 (v3.33.1 swing), 6e22eca (v3.33.0 watchdog), bcde7ae (v3.32.1 committed)
dev: local :3000 (dev PID 12096 — do not kill; MCP 4096 do not kill; pg docker 5432 do not kill)
status: in_progress
commit: pending user approval (commit 1 = v3.33.0 watchdog + docs, commit 2 = v3.33.1 swing; staged by workstream, not yet committed)
---

# Handoff — v3.34.0 Monthly Query Consumption + v3.34.1 sql.js WASM gate fix + v3.33.0 Leader watchdog self-heal + v3.33.1 Swing touch-tracking fix — MERGED into PR #118 branch

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
- `getSqlJs()` loaded `sql-wasm.wasm` via async `fs.readFile`/stream → sql.js init + stray "Cannot log after tests are done" lines landed after a Jest file finished. Fix: synchronous `wasmBinary` load (`fs.readFileSync`, try/catch per candidate path) so sql.js boots fully before any test finishes; `getSqlJs()` memoized. sqlite + cron-daemon **88/88** under `CI=true --runInBand` zero noise; full **1154 pass / 4 skip / 1 fail** (pre-existing flake); tsc **46 = exact baseline (0 new)**; no migration; no new packages. Commit `d91fb01`.

## v3.33.0 — Leader watchdog self-heal (spec 11)
User directive: "don't let this happen again" — prod scheduler dead since ~2026-09-08 07:06 UTC, NO automatic recovery (only manual admin "Start Engine"). Root cause: leadership was ONE-SHOT — `acquireLeaderLock()` at boot + `startLeaderHeartbeat(role, onLost)`; v3.28.2 stops engines on `onLost` but NOTHING ever re-acquires → standby pollers forever.
- NEW `watchLeaderRole(role, handlers)` (`lib/services/leader.ts`): standby → adaptive probe (fresh foreign row = SLOW re-probe `LEADER_CLAIM_SLOW_MS` 300s; stale/absent = claim via `updateMany` count>0 | `create` | P2002 → false | `isDbUnavailableError` → fail-open) → re-probe OWN row (null/not-ours → `failOpenEvents++`) → **leader** + heartbeat `LEADER_HEARTBEAT_MS` 300s; renewal 0 → internal onLost → standby + `handlers.onLost` + FAST re-probe `LEADER_CLAIM_FAST_MS` 60s; `stop()`; phase-guard (no double `onAcquired`); steady-state 1 `findUnique`/300s/instance.
- `LEADER_STALENESS_MS` 15→**10 min** (human-approved); NEW `LeaderWatchHandlers`/`LeaderWatchStatus` + `getLeaderWatchStatuses()` (globalThis `__leaderWatchStatus`, zero-Prisma, mirrors `readTier`).
- Wiring (`instrumentation.ts`, "LEADER WATCHDOGS (v3.33.0, spec 11): replaces the one-shot boot election"): worker `onAcquired → startWorker(30_000)` / `onLost → stopWorkerEngine`; cron-daemon `onAcquired → startCronDaemon().then(...)` / `onLost → stopCronDaemon`; sqlite-sync log-only (`onAcquired: () => {}`).

## v3.33.1 — Swing touch-tracking fix
Root cause: `checkSwingPerformance` evaluated target/stop hits with the LATEST CLOSE only → an intraday HIGH/LOW touch that closed back inside the range was never counted (missed exits / wrong "still open"). Fix: `SwingSignalStatusInput` NEW `maxHighSincePosting`/`minLowSincePosting` (omit/null → close-only preserved); windowByTicker from ONE `$queryRaw` over `daily_prices` (`WHERE ticker = ANY(${symbols}) AND "tradeDate" >= MIN(postedAt)`, ASC; per-signal JS filter); live-quote bridge captures `dayHigh`/`dayLow`; BUY intraday-touch target-wins the tie; reason strings `touched … intraday (high/low X, close Y)` vs `crossed`; status-change audit metadata +2 fields. Files for the commit: `lib/services/swingPerformanceService.ts` + `lib/__tests__/swingPerformanceService.test.ts` ONLY.

## Verification (both workstreams)
- NEW `leaderWatch.test.ts` **8/8** + `instrumentation.test.ts` 7 rewritten + `dbHealthRoute.test.ts` +1 + `cron-daemon.test.ts` +1 (engine restart); constant fixes `leader.test.ts:68`/`sqlite.test.ts:282`; targeted **125/125**; full **1154 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake); swing **27/27**; tsc **46 = exact baseline (0 new)**; no migration; no new packages; **+17 new tests**.

## Deferred / Next (consolidated)
- **Deferred (unchanged)**: `query_cache` (Plan 09 rev-v3 c/d); live `probe_time` DB check; durable Netlify `TZ`/`UTC` env fix (v3.32.0). v3.32.1 (`bcde7ae`) is merged into this branch but NOT deployed — live admin Save Correction still 400s until PR #118 merges/deploys.
- **Next**: all workstreams committed — v3.33.0 watchdog `6e22eca`, v3.33.1 swing `f86d9d0`, v3.34.0 monthly-ops `5d754b7`, v3.34.1 wasm gate-fix `d91fb01` — and MERGED into PR #118 branch `fix/leader-watchdog-self-heal`; run `/pre-commit-check` → **no push/merge/deploy of PR #118 without explicit user approval**.

## Session archive
- `.agents/sessions/2026-09-11-monthly-ops/` — decisions.md (D1-D6) + flow.md. Plus `.agents/changelog/versions-v3.34.md` (v3.34.0 + v3.34.1 full-detail file). v3.33.x: no session archive (per approved 15-item plan); spec/plan 11: `.agents/specs/11-scheduler-self-heal.md` + `.agents/plans/11-scheduler-self-heal.md`.

