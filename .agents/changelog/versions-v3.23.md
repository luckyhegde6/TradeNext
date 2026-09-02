# v3.23.0 — SQLite-primary READ tier during plan-limit breaker holds + DB-log & worker-log download/export UI + readTier telemetry

> **Date**: Sep 02 2026 · **Branch**: `feat/db-ops-reduction-read-tier` (on top of v3.22.0) · **Suite**: 986 pass / 4 skip / 0 fail (70 suites) · **tsc**: 46 = exact baseline (0 new) · **No schema change → no migration**. Commit/PR/deploy pending user.

---

## Problem

When the Prisma plan-limit circuit breaker (v3.20.3) is OPEN, every route that still tries to read from Prisma either stalls for 120s or fails immediately — even for data that is already mirrored in SQLite. The v3.22.0 write-behind model addressed the *write* side (SQLite = primary durable log store, only important logs promoted), but hot *reads* (recommendations, swing, screener, corp-actions) still touched Prisma first, so the breaker's 5-minute hold window left the site partially dead for reads.

Separately, the db-health admin panel had no way to download or export the SQLite-backed API/server/audit log files or the worker/task/cron log files — operational visibility required SSH or log streaming.

Finally, there was no way to see *which* readers (SQLite, memory, Prisma, NSE, filesystem) were actually being hit, at what latency, with what hit rate — the NodeCache `getStats()` metric in the db-health dashboard always showed 0% because hot reads short-circuit before generic NodeCaches, and `getStats()` resets on deploy anyway.

---

## Solution

### 1. SQLite-first read gating (`isPlanLimitBreakerOpen()`)

When the circuit breaker is OPEN, hot reads serve entirely from the SQLite mirror — **zero Prisma touches** for the read path (atomic `updateMany` claim in the swing job remains the sole writer exception, per user directive):

| Route / Service | Breaker-open behaviour |
|----------------|----------------------|
| `app/api/recommendations/route.ts` | Calls `sqlite.getLatestRecommendations()` directly (`servedFrom: "sqlite_mirror"`); falls back to the in-memory `recommendationsCache` on SQLite miss |
| `lib/services/swingRecommendationService.ts` | Gates the DB job fast-path + persist-job block on `!breakerOpen`; breaker-open branch returns an honest screener-only "pending" feed with no Prisma writes |
| `app/api/screener/chartink/route.ts` | SQLite-first gate serving `sqlite.getChartinkScreeners()` rows without calling `getChartinkScreeners()` or Prisma |
| `app/api/corporate-actions/combined/route.ts` | SQLite-first gate after the memory-cache fast path (`{ data, source: "sqlite_mirror" }`) |
| Worker-engine + `sqlite.ts syncFromPrisma` | Already breaker-gated (v3.22.0) |

The breaker check is a synchronous read of the globalThis breaker state (`lib/db-utils.ts` `isPlanLimitBreakerOpen()`) — zero overhead, no DB call.

### 2. DB-log download/export UI (`app/admin/utils/db-health`)

- GET `/api/admin/db-health` now returns `dbLogFiles` via `getDbLogFiles()` — **filesystem-only, zero Prisma**
- New **"DB Logs — Download / Export"** card in the db-health dashboard:
  - Live per-kind buttons (`?export=api_request|server_log|audit_log`)
  - Archived-files table (reverse-chronological, KB sizes, per-date Download via `?archiveFile=<date>`)
  - Pending queue counts + message area
- Admin can export the current day's log or download a specific archived date without touching Prisma

### 3. Worker/task/cron logs downloadable

- NEW `readAllLogs(limit=200)` in `lib/services/worker/worker-logger.ts` — bulk-concatenates all `worker_logs/*.log` files newest-first, traversal-guarded, zero DB
- `app/api/admin/monitoring` `worker-logs` case gains `?action=download` (`Content-Type: text/plain` + `Content-Disposition: attachment`)
- Monitoring **Workers** tab gains a **"Download all"** button next to Refresh

### 4. Chartink cache TTL bump

- `CHARTINK_SCREENERS_CACHE_TTL` increased 5m → 15m in `lib/services/chartinkScreenerService.ts`
- DB-read gate; freshness-sensitive NSE hotCache/market TTLs left unchanged

### 5. Cache & read-tier telemetry on db-health (`readTier`)

**Why the existing cache utilisation card always showed 0**: NodeCache `getStats()` is per-process and resets on every deploy / `flushAll()`. Hot reads (recommendations, screener, corp-actions, SQLite mirror) short-circuit *before* they reach the generic NodeCaches — so `getStats()` never sees them.

**Fix**: NEW zero-Prisma `lib/services/readTier.ts` — a single-writer globalThis `__readTier` registry (mirrors the `lib/prisma.ts` singleton pattern):

```
ReadSource = "sqlite" | "memory" | "prisma" | "nse" | "filesystem" | "other"

recordRead(name, { source?, latencyMs?, rows?, hit? })
getReadMetrics() → { totalCalls, byReader[], bySource{}, longQueries[], sqlite{} }
resetReadMetrics()
LONG_QUERY_MS = 100
```

Tracks per-reader (hits/misses/calls/latency min/max/avg/rows), per-source aggregation (calls/hits/misses/totalMs/rows), bounded long-query ring (`MAX_LONG = 15`, sorted desc), and SQLite-specific performance (calls/avg/min/max/totalMs).

**Instrumented call sites:**

| File | Reader name | Source |
|------|------------|--------|
| `lib/sqlite.ts` mirror helpers | `sqlite.mirror.*` | `sqlite` |
| `app/api/recommendations/route.ts` | `recommendations.prisma` | `prisma` |
| `lib/services/swingRecommendationService.ts` breaker-open | `swing.breaker-open-feed` | `sqlite` |
| `app/api/screener/chartink/route.ts` | `screener.chartink.prisma` | `prisma` |
| `app/api/corporate-actions/combined/route.ts` fast-path | `corp-actions.memory` | `memory` |
| `app/api/corporate-actions/combined/route.ts` Prisma path | `corp-actions.prisma` | `prisma` |

**db-health GET** (still zero-Prisma) now returns:
- `readTier: getReadMetrics()` — full telemetry
- `cache: { metrics: getCacheMetrics() }` — from `lib/cache.ts`

**New db-health UI card — "Cache & Read-Tier Utilisation"** (rendered before Recent DB Errors):
- NodeCache hit-rate summary cards (main / hot / static / recommendations / historical)
- HIGH-frequency readers summary (sqlite + memory) + per-reader table
- LOW-frequency readers summary (direct Prisma) with amber warning
- Long/large-queries table (>100ms)
- SQLite performance latency grid

### 6. Tests

NEW `lib/__tests__/readTier.test.ts` — 11 tests:
1. Record a read → byReader + bySource aggregated correctly
2. Min/max/avg latency computed across repeated reads
3. Misses counted separately from hits
4. Default source = `"other"` when omitted; default miss = `false`
5. Different readers tracked separately
6. Long queries (>100ms) captured in `longQueries[]`
7. Sub-threshold queries NOT captured in longQueries
8. Long query ring bounded at 15 entries (oldest evicted)
9. SQLite perf aggregation (calls/avg/min/max/totalMs)
10. `resetReadMetrics()` clears everything
11. All ReadSource keys present in `bySource`

---

## Verification

- **Suite**: 986 pass / 4 skip / 0 fail (70 suites) — was 975/4/69 in v3.22.0, +11 readTier tests; sqlite + worker-engine breaker-gate tests carried from v3.22.0
- **tsc**: `npx tsc --noEmit` = 46 errors — exact baseline (0 new production errors)
- **Schema**: no change → no migration
- **No push/merge/deploy** — commit pending user
