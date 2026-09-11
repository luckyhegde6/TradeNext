# Session Decisions — 2026-09-11 — v3.34.0 Monthly Query Consumption

> Decision journal for the v3.34.0 session. Format per `.agents/sessions/README.md`.
> Feature branch: `feat/db-health-monthly-ops` (on top of committed v3.30.0 `653b617`).
> v3.32.1 docs/commit remain pending on `main` — NOT part of this branch's commit.

## D1. Ship the db-health monthly-ops window as v3.34.0 (deferred Plan 09 rev-v3 c/d)

- **Decision**: Implement the deferred "db-health monthly-ops window" from Plan 09
  (`.agents/plans/01-db-ops-reduction.md` rev-v3 c/d) as **v3.34.0** on its own branch,
  leaving `query_cache` for a later increment.
- **Context**: The user directive (v3.31.0) changed the plan to **MONTHLY 200K ops/mo,
  resetting on the 2nd** with Prisma calls only at boot hydration / 6h push / ONE hourly
  ops-usage write. The db-health panel still only showed today's ops.
- **Why**: With a monthly plan, "today's ops" is no longer the right dashboard unit;
  the panel needs the whole month, without adding any Prisma ops (the ledger folds
  the existing `dbOpsCounter` at the 60s persistence timer + the route).
- **Impact**: NEW `lib/services/opsMonthly.ts` pure ledger; `lib/sqlite.ts` +64 (iface,
  init restore, 60s fold, exports); db-health GET +12 / UI +77; `.env.example` +5;
  `lib/prisma.ts` +6 (comment only). No schema change -> no migration. No new packages.

## D2. Math.max high-water ledger — idempotent fold, never shrinks

- **Decision**: `foldOpsCounterIntoMonthly` uses `Math.max(day.reads, counter.reads)` per
  day; `buildQueryConsumption` merges the live counter over the persisted entry and
  replaces the current-day entry before summing (no double count).
- **Context**: The counter resets per process/deploy while the ledger persists across
  restarts in `_backup_meta` ("ops_monthly"). A just-restarted instance has a lower
  in-memory counter than the persisted high-water mark.
- **Why**: Re-persisting a restored snapshot must never shrink the ledger; `Math.max`
  keeps the highest value seen so the persisted+live merge is always >= either source.
- **Impact**: Idempotent `persistOpsMonthly()` / `restoreOpsMonthly()` round-trips;
  covered by opsMonthly.test.ts (pure) + sqlite.test.ts monthly describe.

## D3. Restore discards stale previous-month snapshots

- **Decision**: `restoreOpsMonthly` returns early when the persisted
  `monthKey !== getOpsMonthlyState().monthKey` (current IST month) — a snapshot carried
  from a previous month is dropped, never merged.
- **Context**: The Prisma plan resets monthly; a deploy mid-month must not leak the
  prior month's numbers into the new month's dashboard.
- **Why**: Month-scoped correctness; month key derived from `getIstDayKey().slice(0, 7)`.
- **Impact**: Tested in the sqlite monthly describe (stale-month ignore case).

## D4. Pure module — `getIstDayKey` import never invoked at module load

- **Decision**: `lib/services/opsMonthly.ts` imports `getIstDayKey` from `@/lib/prisma`
  but the ONLY use is inside `currentMonthKey()` / `buildQueryConsumption()`, both called
  lazily. No load-time call.
- **Context**: Several suites mock `@/lib/prisma` WITHOUT named exports and pull
  opsMonthly in transitively through `lib/sqlite.ts`; a load-time `getIstDayKey()` call
  would crash them.
- **Why**: Keeps the new module safe under every existing jest factory without mock
  churn (mirrors the v3.32.0 timeCorrection pure-module pattern).
- **Impact**: opsMonthly.test.ts runs standalone (its own prisma mock provides
  `getIstDayKey`); dbHealthRoute.test.ts sqlite mock does NOT grow `persistOpsMonthly`
  — the route only reads the ledger (pre-existing LSP false positives in
  timeCorrection.test.ts :51-52 / leaderWatch.test.ts :49-58 left alone).

## D5. Test isolation fix — `resetSqliteStateForTests` needs re-init (Lesson #113)

- **Decision**: In sqlite.test.ts monthly describe test-3, after
  `resetSqliteStateForTests()` (which nulls real module state IN PLACE without
  re-initializing), the test ends with `await ensureSqliteBackup();` BEFORE calling
  `resetOpsMonthlyForTests()` so the next tests see a ready DB.
- **Context**: Without the re-init, the next test crashed `TypeError: Cannot read
  properties of null (reading 'persistTimeCorrection')` — `state.db` was null.
- **Why**: `resetSqliteStateForTests` is an in-place surgical reset (mirrors the
  globalThis singleton pattern); consumers must re-init before further sqlite work.
- **Impact**: sqlite suite green **83/83**; documented as Lessons.md Lesson #113.

## D6. No hot-path change — folding happens off the request path

- **Decision**: `$allOperations` keeps bumping the live `dbOpsCounter` untouched; the
  ledger is folded ONLY in the 60s `startOpsCounterPersistence()` tick and the db-health
  GET route.
- **Context**: v3.31.0's directive demands Prisma calls only at 3 moments; this adds
  zero Prisma ops — the ledger is a local fold + one `_backup_meta` snapshot.
- **Why**: The monthly window must not add per-request cost.
- **Impact**: `lib/prisma.ts` diff = 6-line pointer comment only; no readTier
  instrumentation needed.