# Spec Document — SQLite-First NSE Data Store (Schema Mirror + Read-First + Write-Through + Instant Promote)

## 1. Overview

**What**: Make the **local SQLite (sql.js) mirror the PRIMARY store for NSE-backed market data** — stock list, corporate actions, daily OHLCV prices (incl. backtest/analysis data) and Chartink captures — with a hot memory cache on top. The read path becomes **cache → SQLite → live NSE/Chartink fetch** (Prisma is **not** a read fallback for NSE data). All NSE sync tasks write to SQLite **first** (write-through), and a SQLite→Prisma **instant promote** (both a ~1 min background timer AND an end-of-task flush) keeps Prisma durable/shared as the source for cross-instance consumers.

**Why (user directives, 2026-09-04)**:
1. "use the live chartink captures to check and hydrate the SQLITE also cache it"
2. "use the NSE api and skill to fetch the historic data for the SYMBOL and cache it and add to SQLITE for the analysis"
3. "all the NSE Sync will trigger against the SQLITE not against the Prisma and also add the Prisma sync to trigger the instant sync from SQLITE to prisma for the required tables"
4. "also all the things should be cached also the reads should hit SQLITE first, check SQLITE and then do the live fetch not fallback on Prisma (the fallback on prisma should be applicable for the cases like the performance run, recommendation updates, auth etc)"
5. "also add the Schema in SQLITE similar to the PRISMA and also update them also add the required indexes to make it optimised"

**Confirmed architecture (user-approved via Q&A)**: **SQLite-first write-through** (Prisma stays shared truth; cross-instance coordination — leader locks, atomic task claims — stays on Prisma). Scope = **all** NSE syncs. Promote cadence = **both** (~1 min timer + end-of-task flush).

**Scope**:
- IN: Add Prisma-mirrored SQLite tables: `symbols` (↔ Prisma `Symbol`), `daily_price` (↔ `DailyPrice`, full OHLCV for backtest/analysis; distinct from the existing latest-per-symbol `daily_price_snapshot`), `chartink_screener_result` (↔ `ChartinkScreenerResult` captured rows). Extend existing `corporate_action` + `chartink_screener` to mirror the relevant Prisma columns. **Add indexes** on the query hot-paths.
- IN: Write primitives (upserts) for each NSE table + cache setters.
- IN: Reads → **cache → SQLite → live fetch** for stocks, corp actions, OHLCV/backtest, chartink; Prisma NOT consulted in these read paths.
- IN: Refactor `executeStockSync` / `executeCorpActionsSync` / `executeHistoricalPriceSync` / Chartink capture into **SQLite-first write-through**, then flush → Prisma (instant promote).
- IN: Per-table SQLite→Prisma promote engine (batched copy) + ~1 min timer + end-of-task flush.
- IN: Chartink hydrate (live captures → SQLite + cache) + backtest NSE fetch → cache + SQLite.
- OUT: **Leader locks, atomic `updateMany` claims, reaper liveness, `fireJob` re-fetch, auth, performance-run, recommendation-update writes** — all stay on Prisma (cross-instance coordination / per user directive).
- OUT: The existing control-plane SQLite mirroring (`worker_task`/`cron_job`/etc.) and write-behind log store (unchanged).

**Depends on**: `lib/sqlite.ts` (sql.js singleton, sqlite-first read tier, write-behind pattern) + `lib/services/chartinkScreenerService.ts` + `lib/services/backtestDataService.ts` + `lib/index-service.ts` + worker-service sync tasks + `lib/nse-api.ts` (`fetchSecurityWiseHistoricalData`/`securityWiseBarsToOHLCV`) + `lib/enhanced-cache.ts`.

## 2. Routes

Mostly service-layer; a small number of hot-read routes gain the SQLite-first gate + cache. No new auth routes.

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/corporate-actions/combined` | SQLite-first corp-actions read (cache → SQLite → live) |
| GET | `/api/screener/chartink` | SQLite-first chartink capture read (cache → SQLite → live) |
| GET | `/api/recommendations/swing` + rec pipelines | OHLCV/daily-price reads via SQLite-first `daily_price` range query |
| GET | `/api/mcp getHistoricalData` + backtest route | Backtest data source prefers SQLite `daily_price`; NSE fetch cached + written to SQLite |

## 3. Database Schema

**No Prisma schema change, no migration.** SQLite-only additive tables/columns (sql.js uses its own DDL):

| SQLite table | Mirrors (Prisma model / @@map) | New | Indexes |
|--------------|--------------------------------|-----|---------|
| `symbols` | `Symbol` / `symbols` | new | `PRIMARY KEY(symbol)`; idx on `company_name` |
| `daily_price` | `DailyPrice` / `daily_prices` | new (full OHLCV; distinct from `daily_price_snapshot`) | `PRIMARY KEY(ticker, trade_date)`; idx on `ticker` |
| `corporate_action` | `CorporateAction` / `corporate_actions` | extend cols | idx on `symbol`, `ex_date`, `action_type`, `source` |
| `chartink_screener` | `ChartinkScreener` / `chartink_screeners` | extend cols (`scan_clause`, `enabled`, `result_count`, `last_run_at`, `next_run_at` already present) | idx on `category_id`, `enabled` |
| `chartink_screener_result` | `ChartinkScreenerResult` / `chartink_screener_results` | new (captured rows) | idx on `screener_id`, `symbol`, `captured_at`, `expires_at` |

Column sets map Prisma camelCase → SQLite snake_case (existing convention). DDL added to `SCHEMA_SQL` (idempotent `CREATE TABLE IF NOT EXISTS`); column adds via `ensureControlColumns`-style `PRAGMA table_info` guard.

## 4. Functions to Implement / Modify

### A. `lib/sqlite.ts`
- Extend `SCHEMA_SQL` with the 3 new tables + indexes; extend existing tables' columns.
- New `SqliteFallback` methods: `upsertSymbol`, `getSymbols(limit)`, `upsertDailyPriceBars(bars)`, `getDailyPriceRange(ticker, from, to)`, `upsertCorporateActions(rows)`, `replaceChartinkResults(templateId, rows)`, `getChartinkResults(templateId)`, plus a generic `promoteNseTablesToPrisma()`.
- Module-level exported helpers delegating to `getSqliteFallback()` (existing pattern), e.g. `setSymbols`, `setDailyPriceBars`, `setCorporateActions`, `setChartinkResults`, `setBacktestBars`, `getBacktestBars`.
- **Promote engine**: `promoteNseToPrisma()` — for each of the 4 tables (`symbols`, `daily_price`, `corporate_action`, `chartink_screener_result`) read fresh SQLite rows in chunks and batched-upsert into Prisma (`createMany` + `skipDuplicates` where possible; `$transaction`-chunked `update` for existing keys). Leader-gated + breaker-gated (mirror `startWriteBehindFlush`/`syncFromPrisma` guards).
- `startNsePromoteFlush()` (unref'd `~60s setInterval`, `stopNsePromoteFlush()`), booted from `instrumentation.ts` alongside `startWriteBehindFlush()`.
- `flushNseToPrisma()` — non-timer callable for end-of-task flushes.

### B. Worker sync tasks (`lib/services/worker/worker-service.ts`)
- `executeStockSync` → write stocks to SQLite `symbols` (instead of `prisma.symbol.createMany/update`) → `flushNseToPrisma()`.
- `executeCorpActionsSync` → SQLite `corporate_action` upserts → flush.
- `executeHistoricalPriceSync` (`historicalPriceSyncService`) → write bars to SQLite `daily_price` → flush.
- Chartink capture completion → write captured rows to SQLite `chartink_screener_result` → flush.

### C. Read paths (cache → SQLite → live)
- Corp-actions combined route, screener/chartink route, swing/daily-recs OHLCV reads, backtest `getBacktestData` — attempt memory cache, then SQLite, then live NSE/Chartink fetch; on live success, write-through to SQLite + cache. Prisma not read in these paths.

### D. Chartink hydrate
- `runChartinkUnifiedScreeners` — when fresh captured DB rows are absent, run live Chartink/TV fetch, write the resulting `ChartinkScreenerResult`-shaped rows to SQLite `chartink_screener_result`, cache, and flush → Prisma (so future reads hit SQLite/cache).

### E. Backtest
- `getBacktestData(symbol)` — add SQLite `daily_price`/`daily_price_snapshot` range as a source step; on miss, `fetchSecurityWiseHistoricalData` + `securityWiseBarsToOHLCV` via `nseFetch`, cache with `enhancedCache`/`nseCache`, write bars to SQLite `daily_price`, flush.

## 5. Tests
- NEW `lib/__tests__/sqliteNseStore.test.ts` (or extend `sqlite.test.ts`): schema/indexes presence, stock upsert+get, OHLCV bar upsert+range query, corp-action upsert+get, chartink result replace+get, promote copy to mocked Prisma (createMany + skipDuplicates), both flush triggers.
- Extend worker-service sync tests for SQLite-first write-through + end-of-task flush.

## 6. Verification
- `npx tsc --noEmit` = **46 = exact baseline (0 new)**.
- `npm run test` full suite green (targeted suites: sqlite, worker-service, chartink*, backtest*).
- Observation run (`set "PRISMA_QUERY_LOG=1"` quoted) confirms sync writes land in SQLite and promote reaches Prisma; reads hit cache/SQLite with **zero** direct-Prisma NSE-read traffic in the hot path.
- No schema change → no migration.

## 7. Notes / Risks
- SQLite is per-instance: promoting to Prisma is what keeps multi-instance Netlify consistent; leader-gating the timer prevent duplicate promotes.
- `daily_price` full OHLCV in sql.js could grow; reads are range-scoped per symbol; indexes added to bound scan cost. The 72h-relevant slices (backtest, swing) dominate.
- Command/Docs workflow applied after implementation.
