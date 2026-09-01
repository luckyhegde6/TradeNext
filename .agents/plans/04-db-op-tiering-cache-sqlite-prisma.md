# Plan: Cache → SQLite → Prisma stock-quote read/write refactor (minimize DB calls)

**Status:** DRAFT — pending user approval
**Date:** 2026-09-02
**Branch:** `feat/db-health-ops-visibility`
**Backs:** v3.21.x increment — DB ops minimization (live-site 2 QPS / 14,166 ops-day observed)

## Problem (live evidence)

Prisma monitoring shows sustained **2.0 QPS** (avg 0.12ms) even in a closed after-market window, and the user pasted a **14,166 Total Operations / day** figure. Directives from user:

> "do not do a db write for every NSE fetch during after market hours and only write to cache and only sync if DB is out of sync during the market open status"
> "make sure every db IO is tracked... make the 1st hit be cache, then sqlite and then eventually the prisma db for the longer storage"
> "the db calls either read or write all can be minimized"

## Root-cause map (verified by reading the code)

### A. Write flood — `lib/stock-service.ts` `getStockQuote` (lines 184-212)
The `fetchQuote` fire-and-forget IIFE runs **`prisma.dailyPrice.upsert` on EVERY successful NSE fetch, regardless of market status or symbol.** During market hours the SSE poll calls `getStockQuote` every 10s for up to 50 tracked symbols → up to ~12K upserts/writes per day. The v3.20.1/2 `DailyPriceAccumulator` was built exactly to batch these, but this per-fetch upsert **bypasses** it.

### B. Closed-market read bundle — same function (lines 44-117)
When `!isMarketOpen()`, a cache-miss triggers **3 Prisma reads** per symbol:
1. `dailyPrice.findFirst` latest (line 51)
2. `dailyPrice.aggregate` 52W high/low (line 60)
3. `dailyPrice.findFirst` prev-day close (line 79)

The SSE 60s closed poll → first-tick burst fires these for every tracked symbol → the "2 QPS every ~10s" pattern.

### C. TTL unit bug — `lib/enhanced-cache.ts` `getWithCache`
NodeCache `set(key, val, ttl)` treats `ttl` as **seconds**. `getWithCache` line 50/99 passes `getRecommendedTTL(ttl)` which returns **milliseconds**. 
- Market open: `getRecommendedTTL(120000)` → 120000 → cached **120,000 seconds = ~33h**.
- Market closed: `getRecommendedTTL` → time-until-next-open (ms) → treated as **seconds** → ~1000× too long.
Net effect: quote cache effectively never expires → **stale quotes served for the entire closed period and beyond**, AND the "refresh on open" intent is defeated. (Note: `stock-service.ts` line 111 correctly does `Math.floor(getRecommendedTTL(120000)/1000)` — the inconsistency is in the shared `enhancedCache` path.)

### D. `cacheDailyPrice` runs every poll tick — `lib/services/priceSyncService.ts` (line 175)
`fetchAndEmit` calls `cacheDailyPrice()` **unconditionally each tick** (10s open / 60s closed). Even post-4PM (accumulation window closed) it keeps refilling the accumulator map → the `flushDailyPricesToDb` may run on partially-refreshed data and the map never drains cleanly. Should be gated to `isMarketAccumulationWindow()`.

### E. Other `getStockQuote` callers (read fan-out, mostly fine)
- `portfolioService.ts` (per-holding, user-initiated) — blocked by cache/SQLite/DB chain, fine.
- `alert-engine.ts`, `alerts/check` — alert evaluation; benefits from cache chain.
- `dailyRecommendationService.ts:958`, `swingPerformanceService.ts:204`, `ipos/closed`, `intelligence/adapters.ts` — best-effort, already cache-first.
- `mcp.ts` — has its own `generateCacheKey` mem cache (no Prisma).

## Design

Adopt the user's tiering: **cache → SQLite → Prisma** for closed-market quote reads, and **write-once-per-symbol-per-trading-day** (market-open only) for `daily_prices` writes. This kills the write flood AND the read flood while keeping Prisma as the durable long-term store.

### Fix A — Gate the `dailyPrice.upsert` (stock-service.ts)
- Move the IIFE into a guarded helper `syncDailyPriceOnce(quote)`.
- Guard: only run when `isMarketOpen()`. When closed → **no DB write at all** (user directive "do not do a db write during after market hours ... only write to cache").
- Seed-once per IST trading day per symbol via a `globalThis` Set keyed `${getIstDayKey()}:${symbol}` (day-key rolls over, set auto-empties next day). On upsert failure, remove the key so it retries later. This is the "only sync if DB is out of sync during market open" semantics — one write per symbol per trading day, no per-fetch flood.
- Uses `getIstDayKey()` from `@/lib/prisma` (single shared IST day source, already used by sqlite persist).

### Fix B — Closed-market read chain: cache → SQLite → Prisma
- Keep the `hotCache` as tier 1.
- **Tier 2 = SQLite** (`SqliteFallback`): add a `getDailyPriceSnapshot(symbol)` helper to `lib/sqlite.ts` backed by a new `daily_price_snapshot` table (symbol, tradeDate, open, high, low, close, volume, updatedAt — Prisma-agnostic, synced during `syncFromPrisma` from the latest `daily_prices` rows on the same IST day). Return a partial quote from SQLite on cache miss, WITHOUT touching Prisma.
- **Tier 3 = Prisma** only when SQLite is not ready or has no row for the symbol.
- This converts the closed-market path from 3 Prisma reads/symbol to **0 Prisma reads/symbol** (SQLite is in-process, free).

### Fix C — TTL unit fix (enhanced-cache.ts)
- `getWithCache` / polling-refresh: convert `getRecommendedTTL(ttl)` ms → seconds (`Math.ceil(ms/1000)`) before `cacheInstance.set`. Keeps existing intent; fixes the ~33h stale-serve and restores "cache until next open".
- `stock-service.ts` line 111 already correct; keep.

### Fix D — Gate `cacheDailyPrice`
- In `priceSyncService.fetchAndEmit`, only call `cacheDailyPrice` when `isMarketAccumulationWindow()`. Post-4PM the accumulator stops refilling; existing 5-min flush drains it once. Also prevents midnight-crossing partial re-accumulation.

### Fix E — DB-health/monitoring consistency (from prior fix B)
- Snapshot `dbOpsCounter` at the top of `GET /api/admin/db-health` (before its own probe + table counts) so the displayed total stops growing on every refresh.
- Align any ops fields in `/api/admin/monitoring` to the same snapshot.

## Files

| File | Change |
|------|--------|
| `lib/stock-service.ts` | Fix A (gate upsert, seed-once), Fix B tier-2 SQLite read |
| `lib/sqlite.ts` | Add `daily_price_snapshot` table + `getDailyPriceSnapshot`/sync helper |
| `lib/enhanced-cache.ts` | Fix C (ms→s TTL) |
| `lib/services/priceSyncService.ts` | Fix D (gate cacheDailyPrice) |
| `app/api/admin/db-health/route.ts` | Fix E (snapshot before probe) |

## Verification
- New tests: (1) stock-service guard — market-closed writes nothing; market-open writes once/symbol/day then no-op; upsert-failure retries. (2) sqlite snapshot helper. (3) TTL conversions. (4) cacheDailyPrice gating.
- Full suite: expect **932 pass / 4 skip** baseline + new tests.
- `npx tsc --noEmit`: expect **46** = baseline (0 new production errors).
- Live check: after deploy, Prisma monitoring QPS should drop to near-zero in after-hours, and `daily_prices` write count ≈ number of unique symbols tracked per trading day (not per fetch).
- No schema change to Prisma → **no migration**. SQLite schema change only (in-memory, additive).

## Open questions for user
1. Confirm Fix C (TTL unit) is in-scope — it changes cache expiry semantics site-wide. Recommended: YES (fixes stale + matches intent). → **RESOLVED (user approved; included in bundle).**
2. Approve adding the `daily_price_snapshot` SQLite table (additive, in-memory; seeded by `syncFromPrisma`, not from live polling). → **RESOLVED (user approved).**
3. Commit/branch: same `feat/db-health-ops-visibility` or new `feat/db-op-tiering`? → **RESOLVED (user chose same `feat/db-health-ops-visibility`; whole bundle = Fix C + quote tiering + SQLite backup/restore as ONE increment).**
4. Prisma ORM attribution package install. → **RESOLVED (user = `@prisma/instrumentation`, OpenTelemetry; to be installed + wired as a SEPARATE follow-up increment, NOT bundled).**