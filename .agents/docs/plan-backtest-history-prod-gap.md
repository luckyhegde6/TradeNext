# RESOLVED (2026-08-14): Prod `backtest_history` gap → MCP `getHistoricalData` 500

> **Status**: ✅ **Built** — user override 2026-08-14 ("the backtest_history gap needs to be fixed") shipped
> **Option B (lazy `CREATE TABLE IF NOT EXISTS`)** in `lib/services/backtestDataService.ts`
> (`ensureBacktestHistoryTable` + `resetBacktestHistoryGuard`, memoized per process, failures
> retried, chain degrades to daily_prices/NSE instead of throwing). Companion to the
> historical-price-sync work (v3.10.0) which fixes the **daily_prices** side of the same
> "prod has no price history" problem. Original plan text preserved below for audit trail.

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
  **Verified 2026-08-14: NO migration ever created `backtest_history`** (`grep -r "backtest_history" prisma/migrations` → zero hits) — the table only exists locally because dev `db push` (schema sync) built it, while prod runs `prisma migrate deploy` which never saw it. **This makes Option A (apply a missing migration) impossible — there is no migration to apply**; the lazy-DDL code fix (Option B) is the only durable fix and self-heals on the next deploy.

## Options (decision made 2026-08-14 — B shipped; kept for audit)

### A. Apply the missing migration on prod (recommended, smallest change)
1. Identify the migration that creates `backtest_history` (`grep -r "backtest_history" prisma/migrations`).
2. Run `npx prisma migrate deploy` against prod (or apply just that migration's SQL).
3. Verify: `SELECT to_regclass('public.backtest_history');` → non-null; then a live
   `getHistoricalData` call returns `source: "db"`/`"nse"` with bars.
- **Risk**: minimal (new empty table); prod write permission required before executing.
- **Status: N/A** — the grep returns ZERO hits; no migration exists to apply. (If a future migration
  adds the table, this becomes viable again.)

### B. Create the table lazily in `backtestDataService` (code change) — ✅ SHIPPED
- Before first use, `CREATE TABLE IF NOT EXISTS` mirroring the Prisma model (raw SQL, camelCase
  columns as Prisma maps them). Self-healing on serverless; no migration needed.
- **Implementation (v3.10.0 PR #91)**: `BACKTEST_HISTORY_STATEMENTS` (create + 3 `IF NOT EXISTS`
  indexes), `ensureBacktestHistoryTable(db = prisma)` (memoized per process; `Promise.all` of the 4
  statements; failures logged + returned as `false` and NOT memoized so the next call retries),
  `resetBacktestHistoryGuard()` test hook; `getBacktestData` skips the temp leg + the upsert when
  not ready → chain degrades to daily_prices/NSE (no 500). 7 new tests; suite 660 pass.
- **Risk**: schema drift if the model changes; duplicating DDL in code (accepted — table is a
  private cache with no FK relations).

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

1. ~~Verify which migrations prod is missing: `prisma migrate status` against prod URL.~~ → **Done:
   none — grep shows NO migration ever created `backtest_history`** (Option A impossible).
2. ~~Option A: `prisma migrate deploy` (or the single CREATE TABLE).~~ → **Superseded by Option B
   (shipped)**: `ensureBacktestHistoryTable` creates the table lazily on the next deploy.
3. Live-verify `getHistoricalData` → 200 + bars.
4. Optionally later: C (daily_prices-first chain) as hardening.
