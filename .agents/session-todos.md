# Session Todos

## Current (v3.21.1 — DB Health ops visibility: SQLite ops-counter persistence + Total Operations/Plan Usage UI + sql.js WASM fix + per-type DB-error summary + lazy SQLite re-init)

Branch: `feat/db-health-ops-visibility` — base committed `4c47348` + docs `47e6677`, pushed (PR NOT created — user decision). Increment uncommitted.

- [x] Live-site bug FIX — `/admin/utils/db-health` "SQLite Not Ready": sql.js WASM never located → `next.config.ts` `serverExternalPackages: ['sql.js']` + `lib/sqlite.ts` `resolveSqlWasm()` into `initSqlJs({ locateFile })` — DONE
- [x] IO-count reconciliation (user-approved "Display + persist"): `lib/prisma.ts` exports `getIstDayKey`; `lib/sqlite.ts` `persistOpsCounter()`/`restoreOpsCounter()` (key `ops_counter` in `_backup_meta`, IST-day guard + `Math.max` merge) + 60s `startOpsCounterPersistence()` booted from `instrumentation.ts` — DONE
- [x] `/api/admin/db-health` GET returns `totalOperations`/`planLimit` (`DB_PLAN_LIMIT_OPS` default 10,000)/`planOperationsRemaining` + persists (POST sync too) — DONE
- [x] UI: 6th "Total Ops Today" stat card + "Plan Operations Usage" bar (reads vs writes vs plan, remaining, footnote) + "Plan Ops n% Used" badge > 80% — DONE
- [x] Increment: `classifyDbError()` (`lib/db-utils.ts`, `DbErrorType` 6 buckets) + per-type `dbErrorCounts` (`__dbErrorCounts` globalThis, lazy IST-day rollover) in `recordDbError()` + `getDbErrorCounts()` — DONE
- [x] Increment: `persistDbErrorCounts()`/`restoreDbErrorCounts()` (key `db_error_counts`, IST-day + per-key `Math.max` merge, same 60s tick) + `ensureSqliteBackup()` lazy on-demand init (`_initPromise` finally-reset) + `resetSqliteStateForTests()` in-place hook — DONE
- [x] Increment: `/api/admin/db-health` GET returns `dbErrorSummary {day, counts}` (GET+POST ensure init); UI per-type chips + error total + IST-day footnote above Recent DB Errors — DONE
- [x] Increment tests: `db-utils.test.ts` `classifyDbError` (7 cases) + `sqlite.test.ts` 5 new (error-count roundtrip, stale-day mock reassignment, Math.max merge, ensure-ready, re-init after reset) — **suite 932 pass / 4 skip (was 920/4), tsc 46 = baseline** — DONE
- [x] Docs (increment): AGENTS.md/CHANGELOG/versions-v3.21.md/TODO/Primer/agent-memory/Lessons(#96)/session-todos + session decisions/flow — DONE
- [ ] User decision: commit increment (base already committed `4c47348`) → push → PR to main — PENDING USER

## Deferred / Other Workstreams
- [ ] Separate: v3.21.0 (`feat/stock-analysis-skill`) — commit/push/PR pending (code + docs verified earlier)
- [ ] Separate: PR #107 (`feat/plan-limit-resilience`) — merged via #108; v3.20.5 prod DIRECT_URL fix applied
- [ ] Post-deploy: live-verify `/admin/utils/db-health` on Netlify (SQLite Ready + Total Ops restored)
- [ ] Prod (post-hold): corporate-actions backfill; remove Prisma Postgres extension from Netlify Dashboard then deploy
