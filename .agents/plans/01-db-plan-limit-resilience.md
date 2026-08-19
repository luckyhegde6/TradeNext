# DB Plan Limit Resilience — TradeNext

> **Problem**: Prisma Postgres monthly plan limit (10K ops/day) exceeded. Live site returns 500 on all DB-dependent routes.
>
> **Date**: Aug 19 2026
>
> **Status**: IN PROGRESS

---

## Impact Assessment — What's Broken vs Working

### 🔴 500 (DB-dependent, currently broken)

| Route | Root Cause | DB Query |
|-------|-----------|----------|
| `GET /api/recommendations` | Fingerprint check always hits DB even when cache exists | `dailyRecommendationRun.findFirst` × 2 |
| `GET /api/recommendations/swing` | Cold-start DB lookup before cache warms | `swingAnalysisJob.findFirst` |
| `GET /api/recommendations/performance` | Tracker count + findMany + daily_prices bridge | `recommendationTracker.count/findMany` + raw SQL |
| `GET /api/screener/chartink` | **No cache at all** — every request hits DB | `chartinkScreener.findMany` |
| `GET /api/corporate-actions/combined` | Paginated query has no cache | `corporateAction.findMany` + raw SQL price enrichment |
| `GET /api/recommendations/ipos` | NSE + DB fallback both failing (NSE anti-bot) | `marketCache.findUnique` |
| `GET /api/events` | NSE anti-bot + cold DB lookup | `marketCache.findUnique` |

### 🟢 200 (Working — NSE-only or small DB queries)

| Route | Why it works |
|-------|-------------|
| `GET /api/mcp?function=getMarketIndices` | NSE-only, in-memory cache |
| `GET /api/mcp?function=getGainers/getLosers/getMostActive` | NSE-only |
| `GET /api/mcp?function=getMarquee/getHeatmap/getAnnouncements` | NSE-only |
| `GET /api/mcp?function=getCorporateActions/getCorporateInfo` | NSE-only per-symbol |
| `GET /api/dividends/calendar` | Small DB queries (corporateAction + daily_prices) |
| `GET /api/fo/expiries` | NSE-only |
| Homepage dashboard | NSE marquee + chart + announcements |

### ⚠️ 401/403 (Auth-required — can't test unauthenticated)

| Route | Expected |
|-------|----------|
| `/api/portfolio` | 401 (needs session) |
| `/api/admin/*` | 401/403 (needs admin session) |

---

## Root Cause Analysis — Why 10K Ops/Day?

### Top Consumers (weekday estimates)

| Operation | Est. Ops/Day | % of 10K | Trigger |
|-----------|-------------|----------|---------|
| **Historical price sync** (`daily_prices` bulk upserts) | 3,000–6,000 | 30–60% | Cron: 06:31 IST daily |
| **Cron daemon heartbeat** (`workerStatus.upsert` every 60s) | ~1,440 | 14% | Continuous 24/7 |
| **Worker engine heartbeat** (`workerStatus.upsert` every 60s) | ~1,440 | 14% | Continuous 24/7 |
| **Market data sync** (stock snapshots + corp actions) | 120–300 | 1–3% | Cron: 06:31 IST |
| **Recommendation pipeline** | 40–80 | <1% | Cron: 10:00 IST |
| **Performance check + archival** | 100–200 | 1–2% | Cron: 15:30 IST |
| **Audit logs** (all services, fire-and-forget) | 40–80 | <1% | Every service call |
| **MarketCache reads/writes** (user traffic) | 200–500 | 2–5% | Per user request |
| **AI connection test** | ~60 | <1% | Every 30 min 08:30–15:30 IST |
| **Chartink template listing** (NO cache) | 100–300 | 1–3% | Per user page load |
| **TOTAL** | **~6,640–10,100** | **66–100%** | |

### Why it exceeds 10K on busy days

- Historical price sync upper bound = 6K (300 symbols × 20 bars × 1 op each)
- Both heartbeats = 2,880 combined
- User traffic spikes (multiple admin triggers, screener usage, IPO lookups) push the remainder
- **No circuit breaker** — when the limit is hit, ALL queries fail, not just the heavy ones

---

## Phased Fix Plan

### Phase 1: Stop the Bleeding (Immediate — graceful degradation)

**Goal**: Site works even when DB is down. Serve stale data from cache.

#### 1a. Recommendations fingerprint bypass (`dailyRecommendationService.ts`)
- **Current**: `getLatestRecommendations()` runs 2x `findFirst` fingerprint queries on EVERY request, even when the cache is hot
- **Fix**: Add try/catch around fingerprint queries → on DB error, serve stale cache without fingerprint validation
- **Effort**: Small — ~10 lines
- **Saves**: 2 DB ops per recommendations request

#### 1b. Screener chartink templates → memory-only (`chartinkScreenerService.ts`)
- **Current**: `getChartinkScreeners()` hits `chartinkScreener.findMany` with zero caching
- **Fix**: Add `staticCache` (5-min TTL) or return the JSON registry directly (templates rarely change)
- **Effort**: Small — add NodeCache wrapper
- **Saves**: 1 DB op per screener page load

#### 1c. Corporate actions combined → cache the response (`app/api/corporate-actions/combined/route.ts`)
- **Current**: `corporateAction.findMany` + daily_prices raw SQL on every request
- **Fix**: Wrap in NodeCache (5-min TTL) — the paginated list doesn't change intra-day
- **Effort**: Small — ~15 lines
- **Saves**: 2 DB ops per page load

#### 1d. Events + IPOs → handle NSE failure gracefully
- **Current**: NSE anti-bot blocks Netlify IPs → both NSE and DB fallback fail → 500
- **Fix**: Return empty results with a "data temporarily unavailable" message instead of 500
- **Effort**: Trivial — catch the error and return `{success: true, events: [], warning: "temporarily unavailable"}`
- **Saves**: Prevents cascade failures

#### 1e. Global DB error handler (`lib/prisma.ts`)
- **Current**: Prisma errors propagate as raw 500s
- **Fix**: Add a middleware that catches Prisma "plan limit exceeded" / connection errors and returns a structured `{error: "database_unavailable", degradation: "serving_cached"}` response
- **Effort**: Medium — needs to be per-route aware
- **Impact**: Prevents any new route from breaking the site

### Phase 2: Reduce DB Operations (Core fix — get under 10K)

#### 2a. Historical price sync — reduce scope or batch (`historicalPriceSyncService.ts`)
- **Current**: 300 symbols × per-symbol upserts = 3K-6K ops/day
- **Fix A** (Quick): Reduce scope to NIFTY 50 only → ~500 ops/day (saves 2,500-5,500)
- **Fix B** (Better): Multi-symbol batch upsert — build one SQL with all bars → 15-30 ops total
- **Fix C** (Best): Use `ON CONFLICT DO NOTHING` for daily_prices (idempotent, no update needed for historical bars)
- **Effort**: Medium
- **Saves**: 2,500–5,500 ops/day

#### 2b. Merge/throttle heartbeats (`cron-daemon.ts` + `worker-engine.ts`)
- **Current**: Two independent 60s heartbeats = 2,880 ops/day
- **Fix**: Change interval from 60s → 5 min (300s) for both → 576 ops/day
- **Alternative**: Remove daemon heartbeat entirely (daemon liveness proven by resync tick)
- **Effort**: Trivial — change 1 constant
- **Saves**: 2,016–2,880 ops/day

#### 2c. Batch audit logs (`lib/audit.ts`)
- **Current**: Each `createAuditLog()` = 1 DB write, fire-and-forget. 40-80/day
- **Fix**: Buffer in memory, flush via `createMany()` every 5-10 min or on process exit
- **Effort**: Medium
- **Saves**: 40-80 ops/day

#### 2d. MarketCache TTL increase (`lib/market-cache.ts`)
- **Current**: Memory TTL 300s (open) / 3600s (closed)
- **Fix**: Increase to 600s (open) / 7200s (closed) — most data doesn't change intra-day
- **Effort**: Trivial — 2 config values
- **Saves**: 50-100 ops/day

### Phase 3: Cache Hardening (Prevent future breakage)

#### 3a. Memory-first architecture for all reads
- Every API route should check in-memory cache BEFORE touching Prisma
- Use the `IntelligenceCache` pattern (write-through dual-layer) as the standard

#### 3b. DB write budget limiter
- Add a global daily counter (`globalThis.__dbOpsToday`) that tracks writes
- When approaching 8K, start rejecting non-critical writes (audit logs, cache refreshes)
- Log warnings at 7K, 8K, 9K thresholds

#### 3c. Pre-warm all caches on startup (`instrumentation.ts`)
- Currently only `restoreIntelligenceCacheFromDB()` and `restoreRecommendationsCacheFromDB()` exist
- Add: chartink templates, corporate actions, upcoming dividends, IPO issues
- This prevents cold-start DB cascades

### Phase 4: Monitoring (Prevent recurrence)

#### 4a. DB operations counter
- Middleware in `lib/prisma.ts` that counts every query
- Expose via `GET /api/admin/monitoring` → "DB ops today: X / 10,000"
- Alert at 70% (7K), 85% (8.5K), 95% (9.5K)

#### 4b. Plan limit dashboard
- Admin page showing: ops today, ops by category (writes/reads/cron/user), projected usage
- Historical chart of daily ops over last 7 days

---

## Priority Order

| Phase | Fix | Impact | Effort |
|-------|-----|--------|--------|
| **1a** | Recommendations fingerprint bypass | Unblocks recs page | Small |
| **1b** | Chartink templates → memory cache | Unblocks screener | Small |
| **1c** | Corporate actions → response cache | Unblocks corp actions | Small |
| **1d** | Events/IPOs → graceful empty | Prevents cascade | Trivial |
| **2a** | Historical price sync scope reduction | Saves 2.5-5.5K ops | Medium |
| **2b** | Heartbeat throttle 60s→300s | Saves 2-2.9K ops | Trivial |
| **1e** | Global DB error handler | Prevents future breaks | Medium |
| **2c** | Batch audit logs | Saves 40-80 ops | Medium |
| **2d** | MarketCache TTL increase | Saves 50-100 ops | Trivial |
| **3a** | Memory-first architecture | Prevents future breaks | Large |
| **3b** | DB write budget limiter | Hard safety net | Medium |
| **3c** | Pre-warm all caches on startup | Prevents cold-start | Small |
| **4a** | DB operations counter | Visibility | Small |
| **4b** | Plan limit dashboard | Admin visibility | Medium |

---

## Expected Outcome

After Phase 1 + Phase 2a + Phase 2b:
- **Before**: ~10,100 ops/day
- **After**: ~3,500-4,500 ops/day
- **Headroom**: 5,500-6,500 ops/day for growth

The site becomes **resilient** (works with DB down) and **efficient** (well under plan limits).
