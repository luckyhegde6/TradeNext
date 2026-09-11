---
handoff: v3.34.0-monthly-query-consumption
session_id: v3.34.0-monthly-query-consumption
date: 2026-09-11
branch: feat/db-health-monthly-ops (on top of committed v3.30.0 `653b617`; v3.34.0 work is in the WORKING TREE, NOT committed/pushed; branch now on `main` tip `7e21569` = v3.32.1 docs; v3.32.0 MERGED via PR #117 `38a27bf`)
last_commits: 7e21569 (HEAD — v3.32.1 docs changelog), bcde7ae (v3.32.1 fix commit), b75deb0 (v3.32.0 docs), 38a27bf (PR #117 merge), 653b617 (v3.31.0 tail / branch base)
dev: no dev server needed (unit-test only) — MCP 4096 do not kill, pg docker 5432 do not kill
status: in_progress
commit: pending user approval
---

# Handoff — v3.34.0 — Monthly Query Consumption (db-health monthly-ops window, Plan 09 rev-v3 c/d)

## Summary
**Code + tests are DONE and VERIFIED on branch `feat/db-health-monthly-ops` (on top of committed v3.30.0 `653b617`); DOC PHASE IN PROGRESS; COMMIT/PUSH/PR PENDING USER — no merge/deploy without explicit approval.**
User directive (v3.31.0): plan limit **MONTHLY 200K ops/mo (resetting 2nd)** + Prisma calls only at 3 moments — boot hydration, 6h SQLite→Prisma push, ONE hourly ops-usage write — zero between. db-health only showed TODAY's ops; with a monthly plan that's the wrong unit and a restarted instance loses the month's history → this implements the deferred Plan 09 rev-v3 c/d monthly-ops window. `query_cache` STAYS deferred.

## What shipped (v3.34.0)
- **Ledger module (pure)** — NEW `lib/services/opsMonthly.ts`: `OpsMonthlyState {monthKey, days}` on globalThis `__opsMonthly`; monthKey = `getIstDayKey().slice(0, 7)` (YYYY-MM); `getOpsMonthlyState()` lazily seeds + fresh ledger at month rollover; `foldOpsCounterIntoMonthly()` idempotent `Math.max` high-water merge; `buildQueryConsumption()` pure aggregation (live day merged over persisted — restarted instance keeps high-water, current-day replaced before summing, no double count; perDay newest-first ≤ 31; `DB_PLAN_LIMIT_OPS_MONTHLY` default 200_000). PURE: only imports `getIstDayKey` from `@/lib/prisma`, NEVER invoked at module load (several suites mock `@/lib/prisma` without named exports).
- **Persistence** (`lib/sqlite.ts` +64) — `persistOpsMonthly()`/`restoreOpsMonthly()` (iface :244-250) under `_backup_meta` key `"ops_monthly"` (`OPS_MONTHLY_KEY` :1653); restored in `initSqliteBackup()` (:1421) + persisted after initial sync (:1440) + 60s `startOpsCounterPersistence()` tick folds+persists (:1705); `restoreOpsMonthly` discards stale previous-month snapshots.
- db-health GET `queryConsumption` block (+12) + "Monthly Query Consumption" card (+77); `.env.example` +5.
- **No hot-path change** — `$allOperations` keeps bumping the live counter; `lib/prisma.ts` diff = 6-line pointer comment only.

## Verification
- sqlite.test.ts **83/83**; targeted **94/94** across 7 suites (opsMonthly, dbHealthRoute, timeCorrection, backtestDataService, worker-engine, recommendationPerformanceService, recommendationCronService); tsc **46 = exact baseline (0 new)**; no migration; no new packages; diff 7 files +310/−2 + 2 new.
- **Test-trap fixed (Lesson #113)**: `resetSqliteStateForTests()` nulls state IN PLACE → sqlite monthly test-3 ends `await ensureSqliteBackup();` before `resetOpsMonthlyForTests()`.

## Deferred / Next
- **Deferred**: `query_cache` (Plan 09 rev-v3 c/d).
- **Next**: doc set DONE (`.agents/changelog/versions-v3.34.md` + `.agents/sessions/2026-09-11-monthly-ops/` + AGENTS.md row + CHANGELOG index + TODO.md row + agent-memory + Primer + Lessons #113 + HANDOFF + latest.md + session-todos) → run `/pre-commit-check` → stage the v3.34.0 set (?? `lib/services/opsMonthly.ts` + ?? `lib/__tests__/opsMonthly.test.ts` + M `.env.example`, `app/api/admin/db-health/route.ts`, `app/admin/utils/db-health/page.tsx`, `lib/__tests__/dbHealthRoute.test.ts`, `lib/__tests__/sqlite.test.ts`, `lib/prisma.ts`, `lib/sqlite.ts` + doc set) → commit on `feat/db-health-monthly-ops` → **push + open NEW PR (NOT #118)** → **no merge/deploy without explicit approval**.

## Session archive
`.agents/sessions/2026-09-11-monthly-ops/` — decisions.md (D1-D6) + flow.md. Plus `.agents/changelog/versions-v3.34.md` (NEW full detail file, template `versions-v3.32.md`).