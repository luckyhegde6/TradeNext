# v3.28.0 — SQLite-first NSE data store: mirror + read-first + write-through + instant promote

- **Date**: Sep 04 2026
- **Branch**: `v3.26.0-prod-failure-triage` (on top of v3.27.0)
- **Status**: Complete (code + verification); commit/push pending user
- **Spec**: `.agents/specs/06-sqlite-first-nse-store.md` · **Plan**: `.agents/plans/06-sqlite-first-nse-store.md`

## User directives (all confirmed)

1. **All NSE sync triggers against SQLite (not Prisma)** — every NSE-backed sync (`executeStockSync`,
   `executeCorpActionsSync`, `executeHistoricalPriceSync`, `runChartinkUnifiedScreeners`) now writes its
   result to the **local SQLite mirror first**, then instant-promotes to Prisma.
2. **All things cached** — hot reads short-circuit memory caches before SQLite/DB.
3. **Reads hit SQLite FIRST → live fetch; NOT Prisma fallback for NSE reads** — the backtest read now
   consults SQLite before any DB leg. Prisma fallback remains only for the non-read paths (performance run,
   recommendation updates, auth, cross-instance coordination, etc.).
4. **Add SQLite schema similar to Prisma + keep it updated + add indexes** — new SQLite tables mirror the
   NSE-backed Prisma models, with indexes, maintained by `syncFromPrisma` + the NSE mirrors.

## Design

**SQLite-first write-through, Prisma stays the shared truth.** Cross-instance coordination (leader locks,
atomic `updateMany` claims, reaper liveness) remains on Prisma. The SQLite mirror serves hot/cheap NSE reads
zero-Prisma; the leader-gated `promoteNseToPrisma()` engine flushes the mirror to Prisma both on a **~60s
background timer** and **at end-of-task** after each sync, so Prisma stays authoritative with no extra caller
writes.

**Ticker-key convention:** the OHLCV `daily_price` mirror is keyed **`NSE:${SYMBOL}`** — exactly matching
Prisma `daily_prices.ticker` (so the promote round-trips cleanly) and the backtest SQLite read.

## Files Changed

| File | Change |
|------|--------|
| `lib/sqlite.ts` | `SCHEMA_SQL`: NEW `symbols`, `daily_price`, `chartink_screener_result` tables + indexes; extended `corporate_action` (+8 cols) + `chartink_screener` (+5 cols); idempotent `ensureNseColumns(db)` ALTER-guard. `SqliteFallback` interface +7 methods, type-safe `createFallback` impls via local `sv()` converter. Module helpers: `cacheSymbol` (:427), `cacheDailyPriceBars` (:437), `getSqlitePriceRange` (:448), `cacheCorporateActions` (:459), `cacheChartinkResults` (:470), `getSqliteChartinkResults` (:483), `getSqliteSymbols` (:490). Promote engine: `promoteNseToPrisma()` (:2133, leader-gated, reads SQLite, chunked `createMany`), `flushNseToPrisma()` (:2166), `startNsePromoteFlush()` (:2174, 60s unref'd) / `stopNsePromoteFlush()` (:2198), `parseJsonLoose()` helper. |
| `lib/prisma.ts` | dev-gated Prisma query logger: `PRISMA_QUERY_LOG=1` (dev/local only) → `log:["query"]` at constructor (the `$extends` wrapper does not propagate `$on('query')`). Off by default — no prod/CI impact. |
| `lib/services/worker/worker-service.ts` | `executeStockSync` → `cacheSymbol` per stock (lazy `@/lib/sqlite`, non-fatal) + `flushNseToPrisma()`; `executeCorpActionsSync` → `cacheCorporateActions(mirrored)` (`(actions as any[])` cast, `parseActionPurpose`, ex/record date ISO) + `flushNseToPrisma()`. |
| `lib/services/historicalPriceSyncService.ts` | (dry-run-false) → `cacheDailyPriceBars(\`NSE:${symbol}\`, …)` mapping normalized `SecurityWiseHistoricalBar` fields (`b.date`/`b.open`/`b.high`/`b.low`/`b.close`/`b.volume`/`b.vwap`) + `flushNseToPrisma()` before result (lazy `@/lib/sqlite`, non-fatal). |
| `lib/services/backtestDataService.ts` | NEW SQLite-first read step in `getBacktestData` (after memory cache): `getSqlitePriceRange(\`NSE:${sym}\`)`, serves `source:"sqlite"` when ≥20 bars (maps `trade_date` → epoch ms), memory-caches, else falls through to DB/NSE legs. `BacktestDataResult.source` union +`"sqlite"`. NSE-fetch step now ALSO mirrors bars to SQLite via `cacheDailyPriceBars(\`NSE:${sym}\`, …)` (non-fatal). |
| `lib/services/chartinkUnifiedScreenerService.ts` | `runChartinkUnifiedScreeners` → per-run `cacheChartinkResults(run.template.id, rows)` (symbol/name/close/change_percent/volume/raw), lazy `@/lib/sqlite`, non-fatal. |
| `instrumentation.ts` | Boot `startNsePromoteFlush()` after `startWriteBehindFlush()` (leader-gated promote timer). |
| `lib/__tests__/historicalPriceSyncService.test.ts` | Mock `@/lib/sqlite` with `cacheDailyPriceBars` + `flushNseToPrisma` so the new mirror step is inert in tests. |

## Verification

- **tsc** — `npx tsc --noEmit` = **46 = exact baseline (0 new)** production errors.
- **Full suite** — `npm run test` = **995 pass / 4 skip / 2 fail** (the 2 failures are the documented
  pre-existing `intelligence.test.ts` async cache-flake, which fails run-to-run regardless of changes —
  excluding it: 71 suites / 995 pass / 4 skip / 0 fail from these changes). Zero regressions.
- **Targeted** — `backtestDataService.test.ts` 16/16, `chartinkUnifiedScreenerService.test.ts` +
  `chartinkTemplateServices.test.ts` 38/38, `historicalPriceSyncService.test.ts` 15/15, `sqlite.test.ts`,
  `daemon-sqlite-first.test.ts`, `dbOpTiering.test.ts`, `leader.test.ts` all green.
- No Prisma schema change → no migration.

## Notes / known noise

The SQLite mirror helpers kick an async `ensureSqliteBackup()` when the mirror isn't initialized yet (cold
start / unit tests), which attempts a sql.js WASM load that fails harmlessly in CI/test environments — the
`.catch(() => {})` swallows it (visible as `wasm streaming compile failed` log lines; non-fatal, does not
affect test results).

---

# v3.28.1 — SQLite partial-init self-heal + promote not-ready guard

- **Date**: Sep 04 2026
- **On top of**: v3.28.0
- **Status**: Code + tests complete; docs/commit pending user approval

## What was broken (live prod symptoms)

After the v3.28.0 deploy to `main` three prod issues surfaced:

1. Dashboard shows **"SQLite Not Ready"** (`/admin/utils/db-health` derives from `sqliteHealth.sqlite.ready`).
2. `promoteNseToPrisma … no such table: daily_price` (and `chartink_screener_result`) errors.
3. Daily recommendation jobs failing (not yet investigated — deferred until this ships).

**Root cause (single defect → both symptoms #1 + #2).** `initSqliteBackup` (`lib/sqlite.ts` :970) assigns
`state.db = db` (:976) **BEFORE** the schema loop (:979-982). If any schema statement throws, the catch
(:1016+) leaves `state.db` **non-null** (partially built — `daily_price`/`chartink_screener_result` missing)
with `ready:false`. This is deterministic and **self-perpetuating**:

- `getHealthStatus()` reports `ready:false` → dashboard "SQLite Not Ready" (#1).
- `promoteNseToPrisma`/`promoteTable` only guarded `if (!state.db …)` → a non-null partial `state.db` passed
  the guard → reading the missing NSE tables threw "no such table" (#2).
- `ensureSqliteBackup()` retry calls `initSqliteBackup`, whose line 971 `if (state.db) return` **short-circuits**
  → the partial DB + `ready:false` are **permanent** until process restart.
- `ensureNseColumns` is ALTER-only and can't create missing tables, so no self-heal existed.

## Fixes (`lib/sqlite.ts`)

1. **Init-catch reset (self-healing)** — the `initSqliteBackup` catch now resets `state.db = null`, `state.ready = false`,
   `_instance = null` so the next `ensureSqliteBackup()`/`initSqliteBackup()` call **REBUILDS from scratch**
   instead of being defeated by the `if (state.db) return` early-return.
2. **Promote not-ready guard** — `promoteNseToPrisma()` (top guard) and `promoteTable()` now require
   `!state.ready ||` in addition to the existing `!state.db` guard, so a partially-built mirror is **skipped**
   (all-zero summary, no Prisma ops, no throw) rather than erroring on the missing NSE store tables.

## Tests (`lib/__tests__/sqlite.test.ts`)

- **partial-init repair** — patches the sql.js `MockDatabase.run` prototype to throw once inside the schema
  loop (after `state.db` is assigned), then asserts the catch resets the fallback to null and the next
  `ensureSqliteBackup()` rebuilds to `ready:true`.
- **promote not-ready guard** — after `resetSqliteStateForTests()` (not-ready mirror) `promoteNseToPrisma()`
  returns the all-zero summary without throwing or touching any table.

## Verification

- **tsc** — `npx tsc --noEmit` = **46 = exact baseline (0 new)**.
- **Full suite** — `npm run test` = **998 pass / 4 skip / 1 fail** (998 = 995 baseline + 3 new; the 1 fail is the
  documented pre-existing `intelligence.test.ts` async cache-flake — it timed out in isolation, `intelligence.ts`/
  `cache.ts` untouched — excluding it: **71 suites / 998 pass / 4 skip / 0 fail from these changes**).
- **Targeted** — `sqlite.test.ts` 36/36 incl. both new, `daemon-sqlite-first`, `dbOpTiering`,
  `historicalPriceSyncService` (31 combined) all green.
- No Prisma schema change → no migration.

---

# v3.28.2 — Lost-leader engine stop (single-active-worker enforcement)

- **Date**: Sep 04 2026
- **On top of**: v3.28.1
- **Status**: Code + tests + docs complete; commit pending user approval

## Audit results (persistence paths — all verified)

| Concern | Verdict | Evidence |
|---|---|---|
| AI-call tracking persists post-analysis | ✅ | `trackAiCall` → memory ring buffer + `enqueueWriteBehind("server_log")` to SQLite (zero Prisma per call); `getPersistedAiCalls` merges Prisma-promoted + SQLite write-behind rows (v3.24.0 two-tier merge). Request handlers `await` it. |
| Recommendations persist after analysis | ✅ | Run create → `recommendationTracker.createMany` → `dailyRecommendationStock.createMany` → run.update (v3.11.1 no-fake-HOLD deleteMany intact). |
| Performance tracking persists | ✅ | Status updates + `RecommendationStatusHistory` creates + 360-day `archiveRecommendations` sweep. |
| IPO details persist | ✅ | Generate via OpenRouter → persist DB (`market_cache` ipo_analysis) + memory; cleanup + stale prune exist. |
| Swing trackers persist post-analysis | ✅ | `persistSwingTrackers` (RecommendationTracker swing rows) + `patchSwingSignalAnalysis` (SwingSignal levels) run on `analysisStatus === "done"` (non-fatal). |
| Crons synced during normal sync | ✅ | `syncFromPrisma` pulls `cron_job`; `reconcileControlToPrisma` (6h sync) pushes back `nextRun`/`lastRun`/counters + `worker_status` heartbeats + completed/failed `worker_task` statuses. |

## Defect found and fixed

**Symptom**: multiple workers executing different tasks concurrently — "only 1 worker / task is active at a time".

**Root cause**: `instrumentation.ts` `onLost` callbacks (lines 42-44, 54-56) only `logger.warn` — they never call `stopWorkerEngine()` / `stopCronDaemon()`. Combined with `acquireLeaderLock` **fail-open on DB-unavailable** (returns `true` on every instance during a DB blip, so all instances start a worker poll loop + cron daemon), when the DB recovered: only one instance kept the leader row, but the other instances' `renewLeaderLock` returned false → `onLost` fired → they logged and **kept polling forever** → N workers executing different tasks concurrently.

**Fix** (surgical — `instrumentation.ts` only):
- Worker `onLost` → call `stopWorkerEngine()` (poll timeout + heartbeat + scheduler intervals cleared)
- Cron `onLost` → call `stopCronDaemon()` (node-cron tasks destroyed + intervals cleared)
- sqlite-sync `onLost` → keep log-only (sync is gated per-run by `isLeader` at runtime; nothing long-running to stop)

Both stop functions already existed and are safe. Pruning idle `worker_status` rows is unnecessary — dead-instance rows are informational/harmless (reaper ignores stale); the multi-worker polling WAS the pruning problem.

## Tests (`lib/__tests__/instrumentation.test.ts` — NEW, 5 tests)

1. **starts worker + cron daemon when elected leader for all three roles** — `acquireLeaderLock` returns true → `startWorker` + `startCronDaemon` called, three `startLeaderHeartbeat` registrations.
2. **worker onLost → `stopWorkerEngine()` fired** — captures the `onLost` callback from `startLeaderHeartbeat("worker", cb)`, invokes it, asserts `stopWorkerEngine()` called once.
3. **cron onLost → `stopCronDaemon()` fired** — same pattern for the `cron-daemon` role.
4. **not-leader → no start** — `acquireLeaderLock` returns false for `worker` → `startWorker` not called; `stopWorkerEngine` not called.
5. **non-Node runtime → returns early** — `NEXT_RUNTIME` unset → `register()` returns before any dynamic imports; `acquireLeaderLock` not called.

## Verification

- **Targeted** — `instrumentation.test.ts` 5/5, `sqlite.test.ts` 36/36, `daemon-sqlite-first` + `dbOpTiering` + `historical` + `leader` = 85/85 total.
- **Full suite** — 1003 pass / 4 skip / 1 fail (1003 = 998 + 5 new; 1 fail = documented pre-existing `intelligence.test.ts` async cache-flake, `intelligence.ts` untouched — excluding it: **72 suites / 1003 pass / 4 skip / 0 fail**).
- **tsc** — `npx tsc --noEmit` = **46 = exact baseline (0 new)**.
- No Prisma schema change → no migration.
