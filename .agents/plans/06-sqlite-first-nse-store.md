# Plan — SQLite-First NSE Data Store (Schema Mirror + Read-First + Write-Through + Instant Promote)

**Spec**: `.agents/specs/06-sqlite-first-nse-store.md`. **Version**: v3.28.0 (pending). Branch: current (`v3.26.0-prod-failure-triage`).

## Goal
SQLite becomes the primary store for NSE market data (stocks, corp actions, daily OHLCV/backtest, chartink), reads are cache→SQLite→live-fetch (no Prisma read fallback for NSE data), all NSE syncs write SQLite-first, and a SQLite→Prisma instant promote (timer + end-of-task) keeps Prisma durable/shared. Prisma remains the home for perf-run / recommendation-updates / auth / cross-instance coordination.

## Steps (implement + verify in order)

1. **`lib/sqlite.ts` — schema mirror + indexes.** Add `symbols`, `daily_price` (full OHLCV), `chartink_screener_result` tables; extend `corporate_action` + `chartink_screener` columns. Indexes per spec §3. Verify: sqlite tests pass.
2. **`lib/sqlite.ts` — write primitives + cache setters.** `upsertSymbol`, `setDailyPriceBars`, `setCorporateActions`, `replaceChartinkResults`, backtest-bar helpers. Mirror the existing `db.prepare`/`stmt.run` + `recordSqliteRead` + module-export patterns.
3. **`lib/sqlite.ts` — promote engine.** `promoteNseToPrisma()` reads SQLite tables in chunks → Prisma batched upsert (`createMany`/skipDuplicates + chunked `update`); `startNsePromoteFlush()` (~60s unref'd interval, leader+breaker gated) + `stopNsePromoteFlush()` + non-timer `flushNseToPrisma()` for end-of-task.
4. **Wire sync tasks**: `executeStockSync`→SQLite+flush; `executeCorpActionsSync`→SQLite+flush; `historicalPriceSyncService`→SQLite+flush; Chartink capture→SQLite+flush.
5. **Read paths**: corp-actions combined, screener/chartink, swing/daily OHLCV, `getBacktestData` → cache→SQLite→live; write-through + cache on live success; no Prisma read fallback for NSE data.
6. **Chartink hydrate** (live captures→SQLite+cache) + **backtest** (NSE fetch→cache+SQLite) per directives 1-2.
7. **Boot the timer** from `instrumentation.ts`.
8. **Tests**: NEW sqlite-NSE-store suite + extend sync/chartink/backtest suites.
9. **Verify**: tsc 46 baseline, `npm run test`, observation run with quoted `PRISMA_QUERY_LOG=1`.
10. **Docs**: AGENTS.md v3.28.0 row + `.agents/CHANGELOG.md` + Primer + agent-memory + Lessons; temp scripts cleanup.

## Verification commands
```bash
npx tsc --noEmit | findstr /c:"error TS" | find /c /v ""
npm run test
set "PRISMA_QUERY_LOG=1" && npx tsx scripts/_tmp-nse-obs.ts
```
