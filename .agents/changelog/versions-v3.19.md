# v3.19.0–v3.19.3 — DB Plan Limit Resilience + SQLite Backup Layer + Graceful Degradation

> **Date**: Aug 26 2026 · **Branch**: `feature/ai-intelligence` · **Suite**: 869 pass / 4 skip · **tsc**: 46 = exact baseline

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
- **Commits**: v3.19.0 = `552041d` (PR #101); v3.19.1 below

---

# v3.19.3 — Graceful Degradation When DB Is Unavailable

> **Date**: Aug 26 2026 · **Branch**: `feature/ai-intelligence` · **Suite**: 869 pass / 4 skip (unchanged) · **tsc**: 46 = exact baseline

## Problem

When the Prisma DB is down (plan limit exceeded), multiple API routes throw unhandled errors returning HTTP 500, flooding the console with noise and breaking the UX. Additionally, the SQLite recovery probe had a logic bug that prevented it from ever detecting when Prisma came back online.

## Files Modified

| File | Change |
|------|--------|
| `app/api/metrics/web-vitals/route.ts` | `prisma.serverLog.create()` wrapped in inner try/catch — fire-and-forget, always returns 201 |
| `app/api/portfolio/route.ts` | Returns empty portfolio (`holdings: [], totalValue: 0`) + `warning` field with HTTP 200 on DB failure (was raw 500) |
| `app/api/notifications/route.ts` | Returns `{notifications: [], unreadCount: 0, warning}` with HTTP 200 on DB failure (was raw 500) |
| `app/api/nse/advance-decline/route.ts` | Catch block returns HTTP 200 with empty data + `warning` (was HTTP 500) |
| `lib/sqlite.ts` | Recovery probe bug: `state.prismaAvailable = true` was running unconditionally in the catch block, overriding the `false` set for DB unavailable errors. Fixed with `else` branch. |

## Fix Details

### 1. web-vitals POST (noise reduction)
Every client page-load fires 12+ metric writes via `prisma.serverLog.create()`. When DB is down, each throws HTTP 500 → console flood. Fix: inner try/catch wraps the DB write — failure silently ignored, route always returns 201.

### 2. Portfolio API (empty instead of error)
`GET /api/portfolio` threw raw 500 on any DB error. Fix: returns `holdings: [], totalValue: 0` + `warning` field with HTTP 200, so the Portfolio page shows "No Portfolio Found" empty state instead of an error page.

### 3. Notifications API (empty instead of error)
`GET /api/notifications` threw 500 on DB failure. Fix: returns `{notifications: [], unreadCount: 0}` + `warning` with HTTP 200, so the header notification badge doesn't cascade errors.

### 4. NSE advance-decline (200 not 500)
The catch block returned HTTP 500 for NSE fetch failures — but data unavailability is not a server error. Fix: returns HTTP 200 with empty data + `warning`, matching the events/IPOs pattern established in v3.19.0.

### 5. SQLite recovery probe bug (critical)
`state.prismaAvailable = true` ran unconditionally in the catch block of the recovery probe, overriding the `false` that was set when a DB unavailable error was detected. The probe never detected Prisma unavailability → never triggered recovery sync → SQLite stayed empty even after Prisma came back online. Fix: `else` branch ensures `true` is only set for non-DB-error exceptions.

## Impact After Deploy

- Console errors drop from ~12+ per page to ~5 (web-vitals noise eliminated)
- Portfolio page shows empty state instead of error when DB is down
- Notifications header no longer cascades 500 errors
- Analytics Advances/Declines shows 0 with "data unavailable" instead of 500
- SQLite recovery probe correctly detects Prisma recovery and populates backup

## Verification

- **Suite**: 869 pass / 4 skip = exact baseline (unchanged)
- **tsc**: 46 = exact baseline (0 new)
- **Commit**: `35f3c6a`

---

# v3.19.1 — SQLite Backup Layer

> **Date**: Aug 25 2026 · **Branch**: `feature/ai-intelligence` · **Suite**: 861 pass / 4 skip (+9) · **tsc**: 46 = exact baseline

## Problem

When Prisma DB ops budget is exceeded, all DB-dependent routes return 500 — no graceful degradation to an in-memory fallback. Need a persistent in-memory SQLite layer seeded from Prisma on startup.

## Files Created

| File | Purpose |
|------|---------|
| `lib/sqlite.ts` | sql.js pure-JS in-memory SQLite singleton (globalThis pattern matching `lib/prisma.ts`); 5 tables; `initSqliteBackup()` + `syncFromPrisma()`; `SqliteFallback` interface with query helpers |
| `lib/__tests__/sqlite.test.ts` | 9 tests — initialization, empty state, data roundtrip, Prisma failure handling |

## Files Modified

| File | Change |
|------|--------|
| `instrumentation.ts` | Imports + awaits `initSqliteBackup()` on startup |
| `app/api/recommendations/route.ts` | SQLite fallback chain (DB→SQLite→memory→500) + background SQLite sync after successful DB writes |
| `app/api/corporate-actions/combined/route.ts` | SQLite fallback in catch block |
| `app/api/screener/chartink/route.ts` | SQLite fallback with category rebuild from DB |
| `lib/db-utils.ts` | Expanded `isDbUnavailableError()` for Accelerate proxy errors (ECONNREFUSED, ECONNRESET, etc.) |
| `package.json` | Added `sql.js` + `@types/sql.js` |

## SQLite Schema

| Table | Purpose |
|-------|---------|
| `daily_recommendation_run` | Latest recommendation runs (id, runDate, status, metadata, triggeredBy) |
| `daily_recommendation_stock` | Per-stock picks (symbol, verdict, confidence, targetPrice, stopLoss, analysis, screenerAttribution) |
| `corporate_action` | Corporate actions (symbol, type, exDate, dividendPerShare, etc.) |
| `chartink_screener` | Screener results cache (symbol, screenerName, percentageChange, volume, etc.) |
| `_backup_meta` | Sync metadata (lastSyncAt, rowsSynced per table) |

## Verification

- **Suite**: 861 pass / 4 skip (+9 from v3.19.0's 852)
- **tsc**: 46 = exact baseline (0 new)
- **Commit**: `4f6ff89`

---

# v3.19.2 — SQLite Expanded + Re-sync + Admin DB Health Dashboard

> **Date**: Aug 25 2026 · **Branch**: `feature/ai-intelligence` · **Suite**: 869 pass / 4 skip (+8 from v3.19.1) · **tsc**: 46 = exact baseline

## Problem

SQLite backup (v3.19.1) only covered recommendation/screener/corp-action tables — logs, auth, monitoring, and cron data were not backed up. No automatic recovery when Prisma comes back online. No admin visibility into DB health status.

## Files Created

| File | Purpose |
|------|---------|
| `app/api/admin/db-health/route.ts` | `GET/POST /api/admin/db-health` — Prisma connectivity probe, ops counters, table row counts, SQLite health status, manual sync trigger |
| `app/admin/utils/db-health/page.tsx` | Admin DB health monitoring dashboard: status badges, stat cards, write budget progress bar, table row count comparison (Prisma vs SQLite), recent sync history table, manual "Sync Now" button, 30s auto-refresh |

## Files Modified

| File | Change |
|------|--------|
| `lib/sqlite.ts` | Expanded schema: 6 new tables (`worker_status`, `server_log`, `audit_log`, `cron_job`, `cron_run`, `worker_task`); `syncFromPrisma()` covers all 10 tables; new query helpers (`getServerLogs`, `getAuditLogs`, `getCronJobs`, `getCronRuns`, `getWorkerStatuses`, `getWorkerTasks`); `getHealthStatus()` returns Prisma ops + SQLite table counts + sync history; `startRecoveryProbe()` background 5-min interval when Prisma is unavailable |
| `app/admin/utils/layout.tsx` | Added "DB Health" nav entry under Admin Utils |
| `lib/__tests__/sqlite.test.ts` | Expanded from 9 to 17 tests: new table roundtrips for all 6 expanded tables, health status with all table counts, failure history tracking |

## SQLite Expanded Schema

| Table | Source Prisma Model | Purpose |
|-------|-------------------|---------|
| `worker_status` | `WorkerStatus` | Worker heartbeat/liveness status |
| `server_log` | `ServerLog` | Server-level structured logs |
| `audit_log` | `AuditLog` | Audit trail (user actions, admin ops) |
| `cron_job` | `CronJob` | Cron schedule definitions |
| `cron_run` | (placeholder) | Cron execution history (no Prisma model yet) |
| `worker_task` | `WorkerTask` | Background worker task history |

## Recovery Sync

When Prisma is down:
1. Routes use existing SQLite fallback data
2. `startRecoveryProbe()` polls Prisma every 5 minutes via `prisma.cronJob.findFirst()`
3. When probe succeeds → full `syncFromPrisma()` refreshes all 10 tables
4. Prisma availability flag resets

## Admin DB Health Dashboard

`/admin/utils/db-health` shows:
- **Status badges**: Prisma Online/Offline, SQLite Ready, Write Budget Exceeded
- **Stat cards**: Prisma latency, DB reads, DB writes, SQLite last sync time
- **Write budget bar**: progress bar with percentage used
- **Table row counts**: side-by-side Prisma vs SQLite for all 10 tables
- **Recent sync history**: last 10 syncs with time, rows, duration, status
- **Manual sync button**: triggers immediate SQLite re-sync from Prisma
- **Auto-refresh**: every 30 seconds

## Verification

- **Suite**: 869 pass / 4 skip (+8 from v3.19.1's 861)
- **tsc**: 46 = exact baseline (0 new)
- **Commit**: pending push
