# Decisions — 2026-08-27 (DB Health enhancements + price cache)

## Decisions
1. **Scope = DB Health tab + price cache batch writer** (v3.20.1 + v3.20.2). v3.20.1 (DB ops reduction) was committed earlier as `5156eb3`; this session adds the DB failure ring buffer + Daily Price Cache batch writer + DB Health API/UI enhancements.
2. **DB failure ring buffer** (`lib/prisma.ts`): in-memory ring buffer (last 50 errors) with `recordDbError()`/`getDbErrorLog()` on `globalThis.__dbErrorLog`, auto-recorded in the `$allOperations` extension on every rejected query (timeout/write-budget/connection). Rationale: give the admin Health tab live visibility into DB failures without any DB reads/writes of its own (no extra ops budget cost). Fire-and-forget `.catch` so recording never blocks the original rejection.
3. **Daily Price Cache batch writer** (`lib/services/priceCache.ts`): keep the SSE `PriceCache` class untouched; ADD a separate `DailyPriceAccumulator`. During market hours (9:15–15:30 IST) `cacheDailyPrice()` accumulates in memory; after 4 PM IST a single bulk `$executeRawUnsafe` upsert (chunked 200, `ON CONFLICT (ticker,"tradeDate") DO UPDATE`) flushes everything → ~1 write/day for price data instead of thousands of per-poll writes. Use `$executeRawUnsafe` (never blocked by the write-budget guard). Auto-flush timer (5-min check) started in `instrumentation.ts`.
4. **DB Health API/UI**: GET returns direct `dbOpsCounter` values (reads/writes/budget/exceeded/remaining/dayKey), `dailyPriceCache` status, `dbErrors`; POST accepts `{action:"flush_prices"}` alongside default `sync_sqlite`. UI adds a 5th "Cached Prices" stat card, Daily Price Cache section, Recent DB Errors table (scrollable, clear), Flush Prices button, day key in write-budget header.
5. **IST time helpers**: computed in-memory (no TZ db). `getIstNow()` via `toLocaleString("Asia/Kolkata")`. `isPostMarket()` = strictly after 16:00 (h>16 || (h===16&&m===0)); `isMarketAccumulationWindow()` = 9:15–15:30.
6. **Docs**: added v3.20.2 row to AGENTS.md, new v3.20.2 section in versions-v3.20.md, CHANGELOG index, TODO.md, Primer.md, agent-memory.md. Session memory in `.agents/sessions/2026-08-27-db-health-price-cache/`.
7. **Commit/push/PR**: user requested commit + push + create PR. Branch `feat/db-health-price-cache` from main.

## Meta
- Never `migrate dev` locally (no `_prisma_migrations` ledger). No schema change this session — no migration needed.
- Verification: suite 869 pass / 4 skip = baseline; tsc 57 = baseline (0 production errors; all 57 are pre-existing test-only jest-dom/Prisma-mock).
