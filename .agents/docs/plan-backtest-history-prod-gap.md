# PLAN (docs only — do not build yet): Prod `backtest_history` gap → MCP `getHistoricalData` 500

> **Status**: ⏸ Planned — user decision 2026-08-14: *plan it, don't build*. Companion to the
> historical-price-sync work (v3.10.0) which fixes the **daily_prices** side of the same
> "prod has no price history" problem.

## Symptom (live-verified 2026-08-14, prod tradenext6.netlify.app)

`MCP getHistoricalData` returns 500: the `public.backtest_history` table does **not** exist in the
prod database. Error surfaces through the backtest data chain (memory → temp table → daily_prices → NSE):

- `lib/services/backtestDataService.ts` calls `prisma.backtestHistory.findUnique/upsert/deleteMany`
  unconditionally → on prod every call throws "relation `backtest_history` does not exist".
- Local DB works because the local database was migrated with the full schema; prod's
  `backtest_history` (and possibly other late-model tables) was never created — the table is
  **created by the app at runtime only in tests/mocks**, never by a real migration on prod.

## Root cause

- `BacktestHistory` model exists in `prisma/schema.prisma` but the prod database lacks the table.
  The model was added (v1.16.0) and its migration either (a) was never applied to prod, or
  (b) is part of a migration set that was superseded/drifted on prod (netlify `npm run build` runs
  `prisma migrate deploy`? — verify which). The temp table was likely **only ever created manually
  on the local DB** or by `db push` in dev, which is why prod has it missing while local works.

## Options (pick at build time — owner: user)

### A. Apply the missing migration on prod (recommended, smallest change)
1. Identify the migration that creates `backtest_history` (`grep -r "backtest_history" prisma/migrations`).
2. Run `npx prisma migrate deploy` against prod (or apply just that migration's SQL).
3. Verify: `SELECT to_regclass('public.backtest_history');` → non-null; then a live
   `getHistoricalData` call returns `source: "db"`/`"nse"` with bars.
- **Risk**: minimal (new empty table); prod write permission required before executing.

### B. Create the table lazily in `backtestDataService` (code change)
- Before first use, `CREATE TABLE IF NOT EXISTS` mirroring the Prisma model (raw SQL, camelCase
  columns as Prisma maps them). Self-healing on serverless; no migration needed.
- **Risk**: schema drift if the model changes; duplicating DDL in code.

### C. Point `backtestHistory` at `daily_prices` (bigger change)
- The new v3.10.0 historical-price sync now populates **daily_prices** with N-day EQ bars. The
  backtest chain could prefer `daily_prices` (already the swing/performance source) and drop the
  temp-table leg for symbol+window when the main table is fresh enough.
- **Risk**: daily_prices is the *main* table — backtests would share it with indicators/performance
  (fine) but the 30-day temp-table pruning semantics change; NSE live-upserting into the main table
  contradicts the current "never write backtest bars to daily_prices" design (AGENTS.md Caching).

## Impact today

- MCP `getHistoricalData` (function #23, used by external agents/tools) 500s on prod.
- Backtest UI/engine falls back? (`backtestDataService` chain — if it throws, callers catch and
  degrade; verify per-caller). Swing tab uses `fetchRecentCloses` directly on daily_prices — NOT
  affected by this gap (fixed separately by v3.10.0).

## Unblock order (when approved)

1. Verify which migrations prod is missing: `prisma migrate status` against prod URL.
2. Option A: `prisma migrate deploy` (or the single CREATE TABLE).
3. Live-verify `getHistoricalData` → 200 + bars.
4. Optionally later: B (lazy DDL) or C (daily_prices-first chain) as hardening.
