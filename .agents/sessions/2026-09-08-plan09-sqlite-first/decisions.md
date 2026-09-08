# Session Decisions — 2026-09-08 — Plan 09 SQLite-first (Phases 4–5)

Branch: `fix/v3.29.1-header-watchlist` (local commits only, no push/merge/deploy).
Token budget: continue-to-finish directive per phase; each phase verified + committed
before starting the next.

## Phase 4 — `_sync_outbox` + 6h SQLite→Prisma push engine

1. Outbox = `op:'upsert'` only (no deletes needed for the NSE-captured tables).
2. `pushSqliteToPrisma()` returns `PushSqliteToPrismaResult | null`;
   `synced` = consumed/applied rows when a table drained, or `rowCount` of the
   still-pending snapshot when breaks happen mid-table — counted via the
   installment-delete sweep (only rows the flush actually removed). No double
   counting.
3. `daily_price` drain uses `DELETE ... WHERE JSON(quote(row_id))->'$[1]' = ?`
   to clear ONLY the marker mesa of the flushed partition (supports per-symbol
   proportional trim).
4. **Corrected direction per plan**: the 6h probe tick + down→up recovery now
   PUSH (SQLite→Prisma), NOT pull — replaces the v3.26.0 "pull every tick".

## Phase 4 — Failures found + fixes

1. Test mock sugar: model mocks in `sqlite.test.ts` carry `findUniqueOrThrow` on
   every model object keyed like `prisma.symbol` — not `symbol.findUniqueOrThrow`.
   Access via `prisma[model][method]`.
2. Drafts deep-clone via `structuredClone` (JSON snapshot) to avoid shared-ref bugs.
3. jest `run()` splits SQL on `;` BEFORE stripping comment lines → no `;` in
   SCHEMA_SQL comment lines (Phase-1 stray `;` regression guard).
4. **Real production bug (guard test)**: `doPushSqliteToPrisma` had
   `if (!isLeader("sqlite-sync")) return null;` — `isLeader` returns a Promise
   (always truthy) so the gate never fired. Fixed to `if (!(await isLeader(...)))`.
5. **Real production bug (symbols sink)**: `readMirrorMap` default key built
   `"undefined:RELIANCE"` — the symbols mirror table has NO `id` column → every
   symbol row missed the map and was never applied. Added explicit
   `case "symbols": key = String(obj.symbol ?? "").toUpperCase()`.
6. All `isLeader` usages are async → always await them.

## Phase 5 — NSE captures → SQLite + outbox (remove auto-promote)

1. Plan step 4 (outbox appends in capture helpers) was ALREADY satisfied by
   Phase 4 — `cacheSymbol`/`cacheDailyPriceBars`/`cacheCorporateActions`/
   `cacheChartinkResults` all delegate to the outbox-wired SqliteFallback
   writers (`upsertSymbol`/`setDailyPriceBars`/`setCorporateActions`/
   `replaceChartinkResults`). No new outbox code needed.
2. `startNsePromoteFlush` timer env-gated behind `NSE_PROMOTE_ENABLED === "1"`
   (default off) — functions stay exported (`promoteNseToPrisma` is reused by
   the push engine). `instrumentation.ts` no longer imports/calls it.
3. `flushNseToPrisma()` calls removed from worker-service (stock + corp-actions
   sync) and historicalPriceSyncService end-of-task promote; SQLite captures
   kept. Only the lib/sqlite.ts exports remain.
4. Test: `instrumentation.test.ts` keeps the `startNsePromoteFlush: jest.fn()`
   mock and now asserts `expect(sqlite.startNsePromoteFlush).not.toHaveBeenCalled()`
   (pin that register() does NOT auto-start the timer).
5. `historicalPriceSyncService.test.ts` mock entry `flushNseToPrisma` left
   in-place (no assertion references it; harmless).
6. Docs deferred to Phase 9 per plan (AGENTS.md/CHANGELOG/TODO/Primer/agent-memory/
   Lessons) — NOT updated per-phase.

## Deferred (NOT touched)

- PCJEWELLER "Tracking" bug (root-caused, fixed-later): schema `status` default
  `"active"` vs service writes `"tracking"`; writers update currentPrice without
  re-evaluating target/stop. Do not fix until Plan 09 phases completed.
  Evidence: prisma/schema.prisma:1483; dailyRecommendationService.ts:890/260/641/1467;
  recommendationPerformanceService.ts; swingPerformanceService.ts:349;
  PerformanceTab.tsx:51/220.

## Phase 6 — Jobs write SQLite-first (recs / swing / perf)

Step 1-2 (`ae44431`): mirror parity for `daily_recommendation_run`/
`daily_recommendation_stock` + SCHEMA_SQL additions (`recommendation_tracker`,
`recommendation_status_history`, `recommendation_archive`, `swing_analysis_job`,
`swing_signal`). Step 3 (`63736f5`): SqliteFallback write-through helpers
(upsert run/stock/tracker/statusHistory, insert archive, upsert job/signal) +
`recordSyncOutbox` + push sinks for the 7 rec/swing/perf tables.

Step 4-5 (THIS commit — swaps + re-pointed suites):

1. Pipeline swaps keep result shapes identical; Prisma writes replaced with
   mirror helpers. `dailyRecommendationService.ts`: run row created via
   `upsertDailyRecommendationRun` (SAME object mutated in place on each stage,
   running → stats → failed/completed), stock rows created AND AI-patched via
   `upsertDailyRecommendationStock` (full-row spread, no `update`), failures
   delete rows via `deleteRecommendationStocksByRun` (single-arg = whole run,
   two-arg = keep-symbols list), trackers via `upsertRecommendationTracker`.
2. `swingRecommendationService.ts`: job/signal claim/retry/exhaust/supersede
   semantics preserved via mirrored `status`/`attemptCount` (52/52 suite).
3. `recommendationPerformanceService.ts`: archive inserts mirror row +
   `deleteRecommendationTracker` write-through immediately after the Prisma
   create (read-first mirror never serves archived trackers; Prisma stays the
   writer of truth — 6h sync re-backfills mirror regardless).
4. Perf write path: `checkRecommendationPerformance` still READS via
   `prisma.recommendationTracker.findMany({status:"tracking"})` + `$queryRaw`;
   WRITES go to `upsertRecommendationTracker` + `appendRecommendationStatusHistory`.
   Trackers with no price are `continue`d — NO mirror upsert for those.
5. **Test-mock trap (found today)**: `upsertDailyRecommendationRun.mock.calls[i][0]`
   IS the row object — same ref mutated in place on each service update. You
   cannot assert intermediate `status:"running"` on the first call after the
   run completes (shows "completed"). Assert only never-mutated creation fields
   (`id`, `triggeredBy`) on calls[0] and terminal state on the LAST call.
6. Daily suite mock factory: `mockSqlite = require("@/lib/sqlite").fallback`
   (module namespace) — helpers are directly on `.fallback`, NOT on the module.
   `sqliteStore = require("@/lib/sqlite")` holds the in-memory arrays.
7. Test 7 stock-upsert count is 4 total (2 creation + 2 AI-update) → assert
   `toBeGreaterThanOrEqual(2)`, never `toHaveLength(2)`.
8. Perf "bridges" assertions are per-id on the mirror upsert: t2 → 555,
   t1 → 2500; `recommendationTracker.update` NOT called.

## Phase 7 — Admin long-lived datasets SQLite-first (announcements / corp-actions / alerts / holdings)

1. §4.8 implemented exactly: admin GET = mirror-only; admin writes = mirror +
   `_sync_outbox` (op `upsert`/`delete`) → `pushSqliteToPrisma` drains to Prisma
   at the 6h probe tick. `delete` op routes to `deleteMany` in the sinks
   (corporate_action natural-key delete → `deleteMany`; announcements/alerts/
   transactions keyed on String(mirror row id)).
2. **Co-writers stay Prisma** (not mirrored): alert lifecycle evaluator
   (`evaluateAnomalyAlerts`), announcement broadcast dedupe, corporate PATCH
   `backfillDividends`. The mirror is a read/CRUD surface for the four routes,
   not a sync source for those flows.
3. Route flip pattern: `const sqlite = getSqliteFallback();` → `if (sqlite) {
   mirror } else { original Prisma }` — sqlite-null (init failure/WASM missing)
   falls back to Prisma, so the admin UI never breaks.
4. Helper set (`lib/sqlite.ts`): `upsertAnnouncement(...): number` (returns
   auto/assigned id; second call with same id = REPLACE), `deleteAnnouncement`,
   `upsertAlert` (id = row.id ?? randomUUID()), `deleteAlert`,
   `upsertTransaction` (ticker uppercased), `deleteTransaction`,
   `deleteCorporateAction(id): boolean` (SELECT natural key → DELETE → outbox
   natural-key delete row → true; absent id → false, no outbox row).
5. **Enrichment is NOT daily-limit/breaker-gated** (Phase 4 push engine keeps the
   breaker/leader gate; admin CRUD is low-frequency user/admin traffic that must
   keep working even mid-hold — the mirror is the point of the offline path).
   Every helper try/catches and degrades gracefully (mirror writes fail → no
   throw, route keeps serving Prisma-capable reads).
6. **Mock sql.js needed a faithful single-value DELETE** (L43-81): real sql.js
   `DELETE ... WHERE <col> = ?` removes only the matched row, but the mock
   executor only honored prune/`IN (...)` and fell through to a whole-table wipe.
   Added an equality branch (`WHERE <col> = ?` → filter rows where
   `String(r[col]) !== String(param)`). Both `deleteTransaction` and
   `deleteCorporateAction` tests now assert real semantics (1 row remains).
7. **corporate_action AUTOINCREMENT simulation (test-only)**: `setCorporateActions`
   intentionally omits `id` from the INSERT (real sql.js AUTOINCREMENT assigns
   1, 2, ...). The mock derives table columns from INSERTs → no `id` column →
   `WHERE id = ?` ignored. The delete test patches `sqlModule.__getStore()
   ["corporate_action"]` columns/rows with synthetic ids before deleting (a
   faithful simulation of the real id assignment, not a behaviour change).
8. Verification: sqlite.test.ts **57/57** (4 new Phase 7 tests); full suite
   **1093 pass / 4 skip / 2 fail** (2 = pre-existing `intelligence.test.ts`
   async cache-flake, unrelated); tsc **46 = exact baseline (0 new)**; no schema
   change → no migration. Commit `feat(sqlite): admin long-lived datasets
   SQLite-first (Plan 09 Phase 7)`.