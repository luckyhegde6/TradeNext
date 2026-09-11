# v3.34.0 — Monthly Query Consumption — db-health monthly-ops window (deferred Plan 09 rev-v3 c/d)

- **Date**: Sep 11 2026
- **Branch**: `feat/db-health-monthly-ops` (on top of committed v3.30.0 `653b617`; code complete, docs phase in progress, commit/PR pending user approval)
- **Status**: Code + tests complete and verified; merge/deploy PENDING USER
- **Plan / Spec**: Plan `.agents/plans/01-db-ops-reduction.md` rev-v3 c/d (deferred item) · Spec `.agents/specs/01-db-ops-reduction.md`

## User directive (confirmed, v3.31.0)
"Plan limit is now MONTHLY 200K ops/mo (resetting 2nd)" + "Prisma calls only at 3
moments — boot hydration, 6h SQLite→Prisma push, ONE hourly ops-usage write — zero
between." The db-health monthly-ops window was deferred from Plan 09 rev-v3 c/d and
is implemented here (`query_cache` stays deferred to a later increment).

## Root causes found
- The db-health dashboard only showed TODAY's `dbOpsCounter` (per-IST-day) — with a
  MONTHLY plan view (200K, resets on the 2nd) that is the wrong dashboard unit: you
  cannot see month-to-date consumption vs the monthly limit.
- The live counter resets per process/deploy, so a restarted instance loses the
  month's history unless it is persisted (same class of problem v3.21.1 solved for
  the daily counter via `_backup_meta` "ops_counter").

## Design — per phase
1. **Ledger module (pure)** — NEW `lib/services/opsMonthly.ts`:
   `OpsMonthlyState {monthKey, days}` on globalThis `__opsMonthly`; month key =
   `getIstDayKey().slice(0, 7)` (YYYY-MM). `getOpsMonthlyState()` lazily seeds and
   starts a fresh ledger when the IST month rolls over (prior month intentionally
   dropped — plan resets monthly). `foldOpsCounterIntoMonthly()` merges a day
   idempotently via `Math.max` (high-water — re-persisting a restored snapshot can
   never shrink). `buildQueryConsumption()` is the pure aggregation behind the route:
   merges the live `dbOpsCounter` day over the persisted entry (a just-restarted
   instance keeps the high-water mark), replaces the current-day entry before summing
   (no double count), returns reads/writes/totalOperations/planLimit/
   planOperationsRemaining/today/perDay (newest-first, at most 31). PURE module
   contract: the only import is `getIstDayKey` from `@/lib/prisma` and it is NEVER
   invoked at module load (several suites mock `@/lib/prisma` without named exports
   and pull the module in via `lib/sqlite.ts`).
2. **Persistence** — `lib/sqlite.ts` (+64): `SqliteFallback.persistOpsMonthly()` /
   `restoreOpsMonthly()` (iface :244-250) snapshot the ledger under `_backup_meta`
   key `"ops_monthly"` (`OPS_MONTHLY_KEY` :1653). `initSqliteBackup()` restores
   before the initial sync and persists after it (:1421/:1440); the 60s
   `startOpsCounterPersistence()` tick also folds + persists (:1705).
   `restoreOpsMonthly` discards a stale previous-month snapshot (monthKey mismatch —
   never leaks prior-month numbers into a new month). Fallback exports :6037-6041.
3. **API** — `app/api/admin/db-health/route.ts` (+12): GET gains a `queryConsumption`
   block via `buildQueryConsumption(getOpsMonthlyState(), dbOpsCounter,
   planLimitMonthly)` with `DB_PLAN_LIMIT_OPS_MONTHLY` (default 200_000). Zero Prisma
   ops — local fold + SQLite snapshot only.
4. **UI** — `app/admin/utils/db-health/page.tsx` (+77): "Monthly Query Consumption"
   card — month key, MTD reads/writes/total, plan-usage bar + remaining, today's
   merged row, per-day table (newest-first ≤ 31).
5. **Env doc** — `.env.example` (+5) documents `DB_PLAN_LIMIT_OPS_MONTHLY`.
6. **No hot-path change** — `$allOperations` keeps bumping the live `dbOpsCounter`;
   `lib/prisma.ts` diff is a 6-line pointer comment only.

## Test-trap fixed (Lesson #113)
sqlite.test.ts monthly describe test-3 called `resetSqliteStateForTests()` which
nulls real module state IN PLACE without re-initializing → the next test crashed
`TypeError: Cannot read properties of null (reading 'persistTimeCorrection')`.
Fix: test-3 ends with `await ensureSqliteBackup();` BEFORE `resetOpsMonthlyForTests()`
so `state.db` is rebuilt for the next case. Consumers of `resetSqliteStateForTests`
must re-init before further sqlite-dependent work.

## Tests
- NEW `lib/__tests__/opsMonthly.test.ts` — pure ledger: seed/new-month rollover,
  Math.max idempotent fold, `buildQueryConsumption` merge (no double count,
  restarted-instance high-water), perDay ≤ 31 + today present, reads/writes/total/
  remaining math, reset hook.
- `lib/__tests__/sqlite.test.ts` (+92) — persist/restore roundtrip, high-water merge,
  stale previous-month drop, test-3 re-init isolation, fallback exports present.
- `lib/__tests__/dbHealthRoute.test.ts` (+56) — GET health payload contains
  `queryConsumption` (route reads the ledger; the sqlite mock is NOT extended with
  `persistOpsMonthly` — pre-existing LSP false positives in timeCorrection.test.ts
  :51-52 / leaderWatch.test.ts :49-58 left untouched).

## Verification
- sqlite suite **83/83** (incl. daemon-sqlite-first.test.ts) · targeted **94/94**
  across 7 suites (opsMonthly, dbHealthRoute, timeCorrection, backtestDataService,
  worker-engine, recommendationPerformanceService, recommendationCronService)
- `npx tsc --noEmit` **46 = exact baseline (0 new)** · no schema change → no migration
  · no new packages · diff 7 files +310/−2 + 2 new files

## Deferred
- `query_cache` (Plan 09 rev-v3 c/d) — separate later increment.