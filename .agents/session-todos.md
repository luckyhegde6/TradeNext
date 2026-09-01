# Session Todos

## Current (v3.21.1 — DB Health ops visibility: SQLite ops-counter persistence + Total Operations/Plan Usage UI + sql.js WASM fix)

Branch: `main` (7 modified files, uncommitted)

- [x] Live-site bug FIX — `/admin/utils/db-health` "SQLite Not Ready": sql.js WASM never located → `next.config.ts` `serverExternalPackages: ['sql.js']` + `lib/sqlite.ts` `resolveSqlWasm()` into `initSqlJs({ locateFile })` — DONE
- [x] IO-count reconciliation (user-approved "Display + persist"): `lib/prisma.ts` exports `getIstDayKey`; `lib/sqlite.ts` `persistOpsCounter()`/`restoreOpsCounter()` (key `ops_counter` in `_backup_meta`, IST-day guard + `Math.max` merge) + 60s `startOpsCounterPersistence()` booted from `instrumentation.ts` — DONE
- [x] `/api/admin/db-health` GET returns `totalOperations`/`planLimit` (`DB_PLAN_LIMIT_OPS` default 10,000)/`planOperationsRemaining` + persists (POST sync too) — DONE
- [x] UI: 6th "Total Ops Today" stat card + "Plan Operations Usage" bar (reads vs writes vs plan, remaining, footnote) + "Plan Ops n% Used" badge > 80% — DONE
- [x] Tests: `sqlite.test.ts` mock fixes (`getIstDayKey`, `exec()` column projection, `INSERT OR REPLACE`) + 3 new tests — **suite 920 pass / 4 skip (was 917/4), tsc 46 = baseline** — DONE
- [x] Docs: AGENTS.md/CHANGELOG/versions-v3.21.md/TODO/Primer/agent-memory/Lessons(#95)/session-todos + session `2026-09-02-db-health-ops-visibility/` (decisions + flow) — DONE
- [ ] Present commit/PR decision to user (no auto-commit/push/merge) — PENDING

## Completed This Session
- [x] Verified code diff (7 files, +277/−10) — clean, secrets-free
- [x] Full suite re-run: 920 pass / 4 skip; tsc 46 = baseline (0 new production errors)
- [x] `npx jest --testPathPatterns="sqlite.test"` → 20/20
- [x] `.agents/handoffs/active/latest.md` — pending update

## Deferred / Other Workstreams
- [ ] Separate: v3.21.0 (`feat/stock-analysis-skill`) — commit/push/PR pending (code + docs verified earlier)
- [ ] Separate: PR #107 (`feat/plan-limit-resilience`) — merged via #108; v3.20.5 prod DIRECT_URL fix applied
- [ ] Post-deploy: live-verify `/admin/utils/db-health` on Netlify (SQLite Ready + Total Ops restored)
- [ ] Prod (post-hold): corporate-actions backfill; remove Prisma Postgres extension from Netlify Dashboard then deploy
