# Session Flow — 2026-09-11 — v3.34.0 Monthly Query Consumption

> Execution trace for the v3.34.0 session (branch `feat/db-health-monthly-ops`).
> Working tree: 7 modified + 2 untracked (see git status below). Docs phase in progress.

## Objective
Ship the deferred db-health monthly-ops window (Plan 09 rev-v3 c/d) as v3.34.0:
monthly query-consumption dashboard = IST-monthly reads+writes mirroring the Prisma
Console "Total Operations" (monthly 200K plan, resets on the 2nd).

## Execution path
1. **Ledger module** — NEW `lib/services/opsMonthly.ts` (130 lines, pure):
   - `OpsMonthlyEntry` / `OpsMonthlyState` / `QueryConsumption` interfaces
   - `getOpsMonthlyState()` — month-scoped accessor, lazy seed; new IST month -> fresh ledger
   - `foldOpsCounterIntoMonthly()` — idempotent Math.max high-water merge
   - `buildQueryConsumption()` — pure aggregation (live merged over persisted, no
     double count, perDay newest-first <= 31)
   - `resetOpsMonthlyForTests()` — in-place test hook
   - Header documents: globalThis `__opsMonthly`, `_backup_meta` key `"ops_monthly"`,
     PURE module (only `getIstDayKey` from @/lib/prisma, NEVER at module load)
2. **Persistence wiring** — `lib/sqlite.ts` (+64):
   - import `foldOpsCounterIntoMonthly, getOpsMonthlyState, type OpsMonthlyEntry` (:28)
   - `SqliteFallback` iface `persistOpsMonthly()` / `restoreOpsMonthly()` (:244-250)
   - `initSqliteBackup()` -> `restoreOpsMonthly()` (:1421) + `persistOpsMonthly()` after
     initial sync (:1440)
   - `OPS_MONTHLY_KEY = "ops_monthly"` (:1653); `persistOpsMonthly` folds the current day
     from `dbOpsCounter` + snapshots `{monthKey, days}`; `restoreOpsMonthly` drops stale
     previous-month snapshots, folds persisted days back in
   - `startOpsCounterPersistence()` tick -> also `persistOpsMonthly()` (:1705)
   - fallback exports at :6037-6041
3. **API** — `app/api/admin/db-health/route.ts` (+12): GET `queryConsumption` block =
   `buildQueryConsumption(getOpsMonthlyState(), dbOpsCounter, planLimitMonthly)`
   (`DB_PLAN_LIMIT_OPS_MONTHLY`, default 200_000). Zero Prisma ops.
4. **UI** — `app/admin/utils/db-health/page.tsx` (+77): "Monthly Query Consumption"
   card — month key, MTD reads/writes/total, plan-usage bar + remaining, today's merged
   row, per-day table (newest-first <= 31).
5. **Env doc** — `.env.example` (+5): `DB_PLAN_LIMIT_OPS_MONTHLY` documented.
6. **Comment** — `lib/prisma.ts` (+6): pointer comment only — NO hot-path change.
7. **Tests**
   - NEW `lib/__tests__/opsMonthly.test.ts` — pure ledger tests
   - `lib/__tests__/sqlite.test.ts` (+92) — monthly describe (:716-:795): persist/restore
     roundtrip, Math.max idempotent merge, stale previous-month drop, re-init isolation
     (test-3 ends `await ensureSqliteBackup();` — Lesson #113), perDay <= 31 + today included
   - `lib/__tests__/dbHealthRoute.test.ts` (+56) — GET health includes `queryConsumption`
     (sqlite mock NOT extended with `persistOpsMonthly` — route reads only)
8. **Verification**
   - sqlite suite **83/83** green (`npm run test -- --runInBand sqlite`, incl.
     daemon-sqlite-first.test.ts)
   - targeted **94/94** across 7 suites (opsMonthly, dbHealthRoute, timeCorrection,
     backtestDataService, worker-engine, recommendationPerformanceService,
     recommendationCronService)
   - `npx tsc --noEmit` **46 = exact baseline (0 new)**
   - no schema change -> no migration; no new packages
9. **Docs phase (current)** — AGENTS.md row, CHANGELOG index + `versions-v3.34.md`,
   TODO.md row, HANDOFF.md + `latest.md`, Primer.md, agent-memory.md, Lessons.md #113,
   `.agents/session-todos.md`, session archive (`decisions.md` + `flow.md`)

## Code touched
- NEW `lib/services/opsMonthly.ts`, `lib/__tests__/opsMonthly.test.ts`
- `lib/sqlite.ts`, `lib/prisma.ts` (comment), `app/api/admin/db-health/route.ts`,
  `app/admin/utils/db-health/page.tsx`, `.env.example`
- `lib/__tests__/sqlite.test.ts`, `lib/__tests__/dbHealthRoute.test.ts`

## git status (working tree)
- Branch `feat/db-health-monthly-ops` (no commits of its own yet)
- Modified (7): `.env.example`, `app/admin/utils/db-health/page.tsx`,
  `app/api/admin/db-health/route.ts`, `lib/__tests__/dbHealthRoute.test.ts`,
  `lib/__tests__/sqlite.test.ts`, `lib/prisma.ts`, `lib/sqlite.ts`
- Untracked (2): `lib/__tests__/opsMonthly.test.ts`, `lib/services/opsMonthly.ts`

## Next
Docs phase -> pre-commit hook -> commit -> push `feat/db-health-monthly-ops` -> NEW PR
(not #118). No merge/deploy without explicit user approval.