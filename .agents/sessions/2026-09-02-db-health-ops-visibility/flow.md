# Flow — 2026-09-02 (DB Health ops visibility: SQLite ops-counter persistence + Total Operations/Plan Usage UI + sql.js WASM fix + per-type DB-error summary + lazy SQLite re-init)

## Execution path
1. Read session state (AGENTS.md / TODO / Primer / CHANGELOG context + current git state).
2. Confirmed user request from prior session: fix "SQLite Not Ready" on `/admin/utils/db-health` AND reconcile the IO-count gap — user approved **"Display + persist"**.
3. Verified the 7 modified code files before docs: `next.config.ts`, `lib/prisma.ts`, `lib/sqlite.ts`, `instrumentation.ts`, `app/api/admin/db-health/route.ts`, `app/admin/utils/db-health/page.tsx`, `lib/__tests__/sqlite.test.ts`.
4. Reviewed `git diff --stat` for cleanliness — clean.
5. **Created branch `feat/db-health-ops-visibility` off `main`** (user decision), committed base `4c47348` (20 files, +451/−62) + docs `47e6677`, pushed to `origin`. PR NOT created — offer to user.
6. **Implemented the follow-up increment** (per-type DB-error classification + SQLite persistence + lazy re-init), fixed mock semantics surfaced by the new tests (stale-day reset test caught `getIstDayKey` mock needing lifecycle reassignment), re-ran full verification, updated ALL tracking docs.

## Code touched (log)
### Base (committed `4c47348`)
- `next.config.ts` — `serverExternalPackages` += `'sql.js'` (native/WASM module excluded from webpack).
- `lib/prisma.ts` — `export const getIstDayKey = todayKey;` (shared IST-day-key source).
- `lib/sqlite.ts` — `resolveSqlWasm(file)` + `initSqlJs({ locateFile })`; `persistOpsCounter()`/`restoreOpsCounter()` (key `ops_counter` in `_backup_meta`, IST-day guard, `Math.max` merge); `startOpsCounterPersistence()` (60s, globalThis state)/`stopOpsCounterPersistence()`; restore at init + after initial sync; `SqliteFallback` + `HealthStatus.prisma` extended; `getHealthStatus()` computes `totalOperations`/`planLimit`/`planOperationsRemaining`.
- `instrumentation.ts` — boots `startOpsCounterPersistence()` after `startDailyPriceFlushTimer()`.
- `app/api/admin/db-health/route.ts` — uses `getIstDayKey`; GET adds `totalOperations`/`planLimit`/`planOperationsRemaining` + `sqlite.persistOpsCounter()`; POST sync persists after `syncFromPrisma()`.
- `app/admin/utils/db-health/page.tsx` — 6-card stat grid ("Total Ops Today"), "Plan Operations Usage" bar (reads vs writes vs plan + remaining + footnote), "Plan Ops {n}% Used" badge > 80%.
- `lib/__tests__/sqlite.test.ts` — mock fixes (`getIstDayKey`, `exec()` column projection, `INSERT OR REPLACE`) + 3 new tests (health totals, persist/restore roundtrip, persist no-throw).

### Increment (uncommitted, 8 files)
- `lib/db-utils.ts` — NEW `DbErrorType` union + `classifyDbError()` (ordered latest-first checks: non-Error→other; P6003/hold/plan-limit→plan_limit; write-budget→write_budget; timeouts→timeout; Accelerate/proxy→accelerate_proxy; connection→connection; else other).
- `lib/prisma.ts` — globalThis `dbErrorCounts` (`__dbErrorCounts` = `{_day, counts}`) + `seedErrorCounts()`; lazy IST-day rollover through `getDbErrorCounts()/recordDbError()`; write-budget strings aligned with the classifier.
- `lib/sqlite.ts` — `persistDbErrorCounts()`/`restoreDbErrorCounts()` (key `db_error_counts`, IST-day guard, per-key `Math.max` merge, same 60s tick); NEW `ensureSqliteBackup()` (`_initPromise` module-let with `.finally` reset — failed init retried next call); `resetSqliteStateForTests()` (stops timers, nulls `state` IN PLACE — never reassign the global the module captured — + re-null `_instance`/`_initPromise`); interface + createFallback wiring.
- `app/api/admin/db-health/route.ts` — GET+POST call `ensureSqliteBackup()` first; GET returns `dbErrorSummary {day, counts}`.
- `app/admin/utils/db-health/page.tsx` — per-type summary chips strip (`DB_ERROR_META`: plan_limit/connection red w/ ring >0, timeout/accelerate_proxy/write_budget amber, other gray) + error total + IST-day footnote above Recent DB Errors.
- `instrumentation.ts` — comment updated (60s timer persists ops + error counts).
- `lib/__tests__/db-utils.test.ts` — NEW `classifyDbError` describe (7 cases: real prod Accelerate message; P6003/hold/plan-limit; P2024/P1008/ETIMEDOUT/"Request timeout"; ECONNREFUSED/P1001/"Connection refused"/P1017; write-budget strings; benign P2021/P2002/P2025; null/undefined/string/plain Error).
- `lib/__tests__/sqlite.test.ts` — prisma mock gains `dbErrorCounts` + `getIstDayKey` reassignment; +5 tests (error-count persist/restore roundtrip; stale-day ignore; Math.max per-key merge; `ensureSqliteBackup` returns-ready when already initialized; re-initializes after `resetSqliteStateForTests` — runs against leftover "DB down" prisma rejections → fallback still reaches ready=true).

## Docs touched
- `AGENTS.md` (v3.21.1 row — branch/commits corrected, increment bullets, suite 932).
- `CHANGELOG.md` (root) (v3.21.1 row — increment appended, suite 932).
- `.agents/CHANGELOG.md` (index row for versions-v3.21.md — v3.21.0 + v3.21.1 + increment; **line 11 tail contains literal `???` from an old doc corruption — the Edit tool kept rejecting the match; resolved via node JSON dump → exact `→ **suite` oldString → applied**).
- `.agents/changelog/versions-v3.21.md` (v3.21.1 base section + NEW follow-up increment section).
- `TODO.md` (v3.21.1 Complete row — increment summary, suite 932).
- `Primer.md` (Last Updated + v3.21.1 status section — increment, suite 932).
- `agent-memory.md` (v3.21.1 entry — increment appended, suite 932).
- `Lessons.md` (NEW Lesson 96 — lazy-init `_initPromise` finally-reset + in-place test-hook mutation; update log extended).
- `.agents/session-todos.md` (current section rewritten for the increment).
- `HANDOFF.md` + `.agents/handoffs/active/latest.md` (increment context + verification; checkpoint bumped).
- This session folder (decisions + flow — increment appended).

## Verification (this session)
- `npx jest --testPathPatterns="db-utils|sqlite"` two-file run → **48/48**.
- Full `npx jest` → **932 pass / 4 skip** (was 920/4, +12; 4 skips = pre-existing client-cache IndexedDB tests).
- `npx tsc --noEmit` → **46 errors, ALL pre-existing** (test-file jest-dom/module-resolution noise); **0 new production errors**.
- No schema change → no migration needed.

## Next
- Present to user: base committed `4c47348` + docs `47e6677` pushed on `feat/db-health-ops-visibility`; **increment code + tests + docs complete (932/4, tsc 46 baseline)** — awaiting user decision: commit increment → push → PR to main. No auto-commit/push/deploy.
- After deploy: live-verify `/admin/utils/db-health` on Netlify — expect SQLite Ready + Total Ops Today restored from snapshot + Plan Usage bar + per-type error chips.