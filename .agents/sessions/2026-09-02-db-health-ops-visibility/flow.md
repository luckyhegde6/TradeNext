# Flow — 2026-09-02 (DB Health ops visibility: SQLite ops-counter persistence + Total Operations/Plan Usage UI + sql.js WASM fix)

## Execution path
1. Read session state (AGENTS.md / TODO / Primer / CHANGELOG context + current git state: `main`, 7 modified files uncommitted).
2. Confirmed user request from prior session: fix "SQLite Not Ready" on `/admin/utils/db-health` AND reconcile the IO-count gap — user approved **"Display + persist"**.
3. Verified the 7 modified code files before docs: `next.config.ts`, `lib/prisma.ts`, `lib/sqlite.ts`, `instrumentation.ts`, `app/api/admin/db-health/route.ts`, `app/admin/utils/db-health/page.tsx`, `lib/__tests__/sqlite.test.ts`.
4. Reviewed `git diff --stat` (7 files, +277/−10) for cleanliness — clean.

## Code touched (prior session, verified this session)
- `next.config.ts` — `serverExternalPackages` += `'sql.js'` (native/WASM module excluded from webpack).
- `lib/prisma.ts` — `export const getIstDayKey = todayKey;` (shared IST-day-key source).
- `lib/sqlite.ts` — `resolveSqlWasm(file)` + `initSqlJs({ locateFile })`; `persistOpsCounter()`/`restoreOpsCounter()` (key `ops_counter` in `_backup_meta`, IST-day guard, `Math.max` merge); `startOpsCounterPersistence()` (60s, globalThis state)/`stopOpsCounterPersistence()`; restore at init + after initial sync; `SqliteFallback` + `HealthStatus.prisma` extended; `getHealthStatus()` computes `totalOperations`/`planLimit` (`DB_PLAN_LIMIT_OPS` default 10,000)/`planOperationsRemaining`.
- `instrumentation.ts` — boots `startOpsCounterPersistence()` after `startDailyPriceFlushTimer()`.
- `app/api/admin/db-health/route.ts` — uses `getIstDayKey`; GET ops adds `totalOperations`/`planLimit`/`planOperationsRemaining` + `sqlite.persistOpsCounter()`; POST sync persists after `syncFromPrisma()`.
- `app/admin/utils/db-health/page.tsx` — 6-card stat grid ("Total Ops Today"), "Plan Operations Usage" bar (reads vs writes vs plan + remaining + footnote), "Plan Ops {n}% Used" badge > 80%.
- `lib/__tests__/sqlite.test.ts` — mock fixes (`getIstDayKey`, `exec()` column projection, `INSERT OR REPLACE`) + 3 new tests (health totals, persist/restore roundtrip, persist no-throw).

## Docs touched (this session)
- `AGENTS.md` (v3.21.1 row at top of version table).
- `.agents/CHANGELOG.md` (index row for versions-v3.21.md now covers v3.21.0 + v3.21.1).
- `.agents/changelog/versions-v3.21.md` (NEW v3.21.1 section — Problem/Solution/Files/Design/Verification).
- `TODO.md` (v3.21.1 Complete row at top of Quick Reference).
- `Primer.md` (Last Updated + v3.21.1 status section).
- `agent-memory.md` (2026-09-02 v3.21.1 entry incl. Lesson 95 reference).
- `Lessons.md` (NEW Lesson 95 — WASM/native packages need serverExternalPackages + locateFile; sql.js mock semantics).
- `.agents/session-todos.md` (updated below).
- This session folder `.agents/sessions/2026-09-02-db-health-ops-visibility/` (decisions + flow).

## Verification
- `npx jest --testPathPatterns="sqlite.test"` → **20/20** (was 17).
- Full `npx jest` → **920 pass / 4 skip** (was 917/4, +3; 4 skips = pre-existing client-cache IndexedDB tests).
- `npx tsc --noEmit` → **46 errors, ALL pre-existing** (test-file jest-dom/module-resolution noise); **0 new production errors**.
- No schema change → no migration needed.

## Next
- Present to user: commit decision pending (7 modified files on `main`, docs updated). No auto-commit/push/deploy.
- After deploy: live-verify `/admin/utils/db-health` on Netlify — expect SQLite Ready + Total Ops Today restored from snapshot + Plan Usage bar.