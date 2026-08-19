# v3.19.0 — DB Plan Limit Resilience (Prisma Postgres 10K ops/day exceeded)

> **Date**: Aug 19 2026 · **Branch**: `feature/ai-intelligence` (on top of v3.18.0) · **Suite**: 852 pass / 4 skip · **tsc**: 46 = exact baseline

## Problem

Prisma Postgres monthly plan limit (10K ops/day) exceeded on prod → all DB-dependent routes return 500. Top offenders:
- Historical price sync: 3K-6K ops/day (was syncing up to 300 symbols)
- Dual heartbeats: 2,880 ops/day (worker + daemon, 60s interval)
- Chartink templates: no cache, every read hits DB
- Recommendations fingerprint: always hits DB for duplicate check

## Files Created

| File | Purpose |
|------|---------|
| `lib/db-utils.ts` | `isDbUnavailableError(error)` — shared helper to detect Prisma plan limit / connection errors |
| `app/api/admin/db-usage/route.ts` | `GET /api/admin/db-usage` — admin DB usage dashboard (reads, writes, budget, remaining) |

## Files Modified

| File | Change |
|------|--------|
| `lib/prisma.ts` | Added `dbOpsCounter` (globalThis, tracks reads/writes per IST day), `isDbWriteBudgetExceeded()`, write budget guard in `$allOperations` extension (default 8K, configurable `DB_WRITE_BUDGET`); `executeRaw`/`executeRawUnsafe` never blocked |
| `lib/auth.ts` | Admin OTP fallback: bypasses DB entirely when `ADMIN_OTP` env matches; `ADMIN_EMAIL` defaults to `admin@tradenext6.app` |
| `lib/services/dailyRecommendationService.ts` | Fingerprint bypass on DB error → returns cached last good run |
| `lib/services/chartinkScreenerService.ts` | NodeCache (5-min) + DB error fallback → stale served on failure; cache invalidation after `completeChartinkRun`; fixed cache key to `chartink:screeners:overview` |
| `lib/services/historicalPriceSyncService.ts` | Scope narrowed to NIFTY 50 only; `DEFAULT_MAX_SYMBOLS=300→50` |
| `lib/services/worker/cron-daemon.ts` | `HEARTBEAT_INTERVAL_MS=300_000` (was 60K) |
| `lib/services/worker/worker-engine.ts` | `HEARTBEAT_INTERVAL_MS=300_000`, `WORKER_ALIVE_WINDOW_MS=600_000` (was 180K) |
| `lib/market-cache.ts` | TTL defaults: open 300→600s, closed 3600→7200s |
| `app/api/corporate-actions/combined/route.ts` | NodeCache (5-min) + DB error fallback + variable scope fix |
| `app/api/events/route.ts` | Graceful empty on failure (200 with `warning` field, not 500) |
| `app/api/recommendations/ipos/route.ts` | Graceful empty on failure (200 with `warning` field, not 500) |
| `.env.example` | Added `ADMIN_OTP` and `DB_WRITE_BUDGET` documentation |

## Phase 1 — Graceful Degradation (stop-the-bleeding)

### 1a. Recommendations fingerprint bypass
`dailyRecommendationService.ts`: when `isDbUnavailableError(err)`, skip the DB fingerprint check and return the cached last good run instead of 500.

### 1b. Chartink templates → NodeCache
`chartinkScreenerService.ts`: `getChartinkScreeners()` now reads from `staticCache` (5-min TTL) first, falls back to DB on miss. DB errors return stale cache if available.

### 1c. Corporate actions → NodeCache
`corporate-actions/combined/route.ts`: wraps the DB query in a 5-min NodeCache. On DB error, returns stale cache.

### 1d. Events/IPOs graceful empty
`events/route.ts` + `ipos/route.ts`: catch DB/NSE errors and return `{ success: true, events: [], warning: "Data temporarily unavailable" }` (status 200) instead of 500.

## Phase 2 — Op Reduction

### 2a. Historical price sync → NIFTY 50 only
`historicalPriceSyncService.ts`: `resolveSyncScope()` now returns only NIFTY 50 constituents (removed `prisma.recommendationTracker.findMany` + `prisma.chartinkScreenerResult.findMany` queries). `DEFAULT_MAX_SYMBOLS=300→50`. Estimated savings: 2,500–5,500 ops/day.

### 2b. Heartbeat throttle
`cron-daemon.ts` + `worker-engine.ts`: `HEARTBEAT_INTERVAL_MS` 60K→300K (5 min). `WORKER_ALIVE_WINDOW_MS` 180K→600K (10 min). Estimated savings: ~1,152 ops/day.

### 2d. MarketCache TTL increase
`market-cache.ts`: defaults 300→600 open, 3600→7200 closed.

## Phase 3 — Write Budget Guard

`lib/prisma.ts`: `dbOpsCounter` on globalThis tracks reads/writes per IST day. `$allOperations` extension increments counters. When `dbOpsCounter.writes > WRITE_BUDGET` (default 8K, configurable `DB_WRITE_BUDGET` env), non-critical writes are rejected with a descriptive error. `executeRaw`/`executeRawUnsafe` never blocked (critical infra).

## Phase 4 — Admin Tooling

### 4a. Admin OTP fallback
`lib/auth.ts`: before DB lookup, checks `ADMIN_OTP` env + `ADMIN_EMAIL` env match → returns admin session without DB hit.

### 4b. Admin DB usage dashboard
`GET /api/admin/db-usage`: returns `{ reads, writes, budget, remaining, budgetExceeded }`.

## Test Fixes (3 regressions from v3.19.0 changes)

| Test | Issue | Fix |
|------|-------|-----|
| `chartinkScreenerService.test.ts` "screener with future nextRunAt is fresh" | `beforeEach` cache clear used wrong key `"chartink-screeners:list"` → cached result leaked | Changed to `"chartink:screeners:overview"` (matches service) |
| `historicalPriceSyncService.test.ts` "scope defaults to NIFTY50 constituents" | Expected `syncSymbols.length === 50`, got 200 | Updated to 50 (NIFTY50-only scope) |
| `cron-daemon.test.ts` "startCronDaemon sets workerStatus on heartbeat" | Expected heartbeat within 70s, actual 600s window | Changed assertion to ≤620s |

## Verification

- **Suite**: 852 pass / 4 skip = exact baseline (62 suites, 4 intentional client-cache IndexedDB skips)
- **tsc**: 46 errors = exact baseline (0 new)
- **Commits**: pending user approval
