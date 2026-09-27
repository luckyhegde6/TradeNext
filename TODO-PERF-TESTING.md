# TODO: Performance Testing (Load & Latency Audit)

> **Scope:** TradeNext — Next.js 16 (App Router, serverless on Netlify), Prisma 7 + PostgreSQL/TimescaleDB,
> NSE live-data integration with layered caching (memory → DB → NSE), background cron/workers, SSE live prices.
> Baseline the hot paths below, then optimize. See `AGENTS.md` caching patterns and
> `.agents/docs/tasks-cron-workers.md` for infra context.
>
> **Status legend:** `[ ]` pending · `[x]` done · `[~]` in progress

## 0. Baseline Rules

- [ ] Test against prod-equivalent build (`npm run build` + Netlify), NOT dev server (dev is single-threaded, unwarmed)
- [ ] Warm the cache per page before timing (NodeCache 300s/3600s TTLs skew cold numbers)
- [ ] Record metric: P95 response (ms), error rate, serverless cold-start vs warm, DB query count per request
- [ ] Document concurrency model: Netlify concurrent invocations share nothing in-memory (NodeCache is per-instance)

## 1. Hot API Routes (end-to-end latency)

| Route | Cache TTL | Notes |
|-------|-----------|-------|
| `GET /api/stock/[symbol]` (quote) | quote 60s | memory → DB → NSE chain |
| `GET /api/market/overview` (indices) | 2m | index quotes, 1h DB cache |
| `GET /api/screener/search` | ? | 2000+ stock list, live TV fallback |
| `GET /api/corporate-actions/combined` | 5m | dividends + price enrichment |
| `GET /api/recommendations/*` | varies | performance 15m, top-stocks, latest |
| `GET /api/prices/stream` (SSE) | n/a | long-lived; measure per-message latency |
| `GET /api/mcp` | varies | 23 functions shared cache |

- [ ] Baseline all above warm (median, P95) and cold (first hit after cache expiry)
- [ ] Identify any route that queries the DB in a loop (N+1) or fires >5 DB queries per request
- [ ] Flag routes where NSE fetch blocks the HTTP response (must be fire-and-forget or cached)

## 2. Database Performance (TimescaleDB)

- [ ] Index audit: confirm hot columns covered (`daily_prices (ticker, tradeDate)`, `corporate_action`, `corporate_announcement (broadcastDateTime)`, tracker queries)
- [ ] `EXPLAIN ANALYZE` on: performance list (trackers + bridge query), dividend calendar, screener list, corp-actions combined
- [ ] Batch writes: confirm `createMany`/`runInChunks` used over loop `create` (recommendation storage, sync ingestion)
- [ ] Civic queries: portfolio P&L, tax calc (FIFO), rebalancer — per-user bound, no full-table scans
- [ ] Timescale hypertable usage: verify price history/pnl history use TS chunks (no unbounded row growth on hot path)
- [ ] Vacuum/Analyze cadence on high-write tables (daily_prices, logs)

## 3. Recommendation Pipeline (cron / background)

- [ ] `runDailyRecommendations`: total wall time, screener phase vs AI phase (bounded concurrency, 5-stock batches)
- [ ] `checkRecommendationPerformance` (4PM IST): check 1000+ trackers within serverless function limits (timeout, mem)
- [ ] `runChartinkUnifiedScreeners`: DB capture + 72h TTL prune timing
- [ ] Market-sync cron (system job `Daily Market Sync`, 06:31 AM IST weekdays via in-process node-cron daemon): stock list + corp actions + screener capture duration
- [ ] Memory ceiling: any cron pulling `take: 5000` trackers/symbols must stream/chunk
- [ ] Confirm each cron job idempotent + ledgered (`recordCronRun`) so overlaps can't double-apply

## 4. Frontend Performance (Core Web Vitals)

- [ ] LCP on `/` (index chart, marquee) — target < 2.5s warm
- [ ] INP on screener (live TV filtering) and portfolio tables — target < 200ms
- [ ] CLS — charts/tables reserve height (no layout shift on live-price overlay)
- [ ] JS bundle audit: route-level code splitting, no heavy libs leaking into pages (TradingView/lightweight-charts chunked)
- [ ] SSE: reconnect storms guarded (useLivePrices loop fix, `symbolsRef`), message batching sane
- [ ] Mobile (375px) TTI on home + recommendations + screener
- [ ] Image/font: static assets cached, no render-blocking third-party scripts on critical path
- [ ] Lighthouse pass (desktop + mobile) — record scores before/after optimizations

## 5. Scalability & Serverless Throttles

- [ ] Netlify function time limits: identify routes that can exceed 10s (NSE sync, heavy recompute) → move to background task/cron
- [ ] DB connection pool: Prisma under concurrent serverless — max connections, pool size tuning, Accelerate (useAccelerate=false currently)
- [ ] OpenRouter AI: rate limits on daily recommendation batches (backoff + circuit breaker); token budget per run
- [ ] NSE rate limits: outbound request shaping (one flight per endpoint, cache-first)
- [ ] Load test: 50 concurrent users on hot routes (quote, overview, recommendations) — error rate + P95
- [ ] Cache miss stampede: per-key single-flight / request coalescing for NSE + heavy DB aggregations

## 6. Findings Log

| # | Severity | Finding | Status | Notes |
|---|----------|---------|--------|-------|
| 1 | Low | `getPerformanceList` returnPercent path fetches up to 5000 trackers then JS-sorts (bounded, cached 15m) | [ ] | Fine for now; re-check at >10k trackers |
| 2 | | | | |

### 6a. Production log review (2026-09-26) — prioritized, unassigned

> Source: production log inspection during v3.43.0 (Spec 20 Google Sheets admin console). **None of these is caused or fixed by v3.43.0** — the spec is UNCOMMITTED and touches none of these subsystems. They are recorded here so the findings are not lost. **Owners are unassigned — they need a human to pick them up.** Nothing in this table has been worked on.

| # | Pri | Finding | Owner | Action | Status |
|---|-----|---------|-------|--------|--------|
| 1 | **P0** | Repeated **`P6003 unhandledRejection`** in production logs | *unassigned* | Root-cause the unhandled rejection that surfaces P6003 during the plan-limit hold; it should be a caught, logged degradation, never an unhandled rejection (Lesson 138: never let a hold masquerade as a failure). Blocks honest error reporting for every other finding below. | [ ] |
| 2 | **P0** | **Zero registered cron jobs** observed at runtime | *unassigned* | Confirm whether the in-process node-cron daemon actually registered the jobs on the running instance (see the leadership finding below — a standby/fail-open leader never starts the scheduler). Cross-check the cron admin view before assuming a scheduler bug. | [ ] |
| 3 | **P0** | **Local-leadership fallback** taken in production | *unassigned* | `lib/services/leader.ts` fails open to local leader when the DB is unavailable. Under P6003 that can elect *every* instance as leader, so N schedulers/writers run concurrently. Decide the fail-open policy explicitly for the hold window (Lesson: elected-single-writer) instead of inheriting it silently. | [ ] |
| 4 | **P1** | Retry / error **storms** in production logs | *unassigned* | Quantify retry volume per upstream (NSE, Chartink, OpenRouter) and confirm backoff + jitter are actually applied; a storm can itself be what trips a plan limit. Relates to #7. | [ ] |
| 5 | **P1** | **25-second TTFB** observed on a production request | *unassigned* | Capture a slow-request trace and attribute the time (Prisma queueing vs cold start vs NSE fetch). 25 s is far past the 10 s Netlify function ceiling, so also confirm which route and whether it is cached. | [ ] |
| 6 | **P1** | **20.5-second cold starts** | *unassigned* | Attribute cold-start cost (import graph, `googleapis`/onnxruntime-style heavy dynamic imports, WASM init). Confirm heavy SDKs stay behind **dynamic `import()`** so the flag-off path never loads them (Lesson 141). | [ ] |
| 7 | **P1** | **Chartink HTTP 419** fallback being used | *unassigned* | 419 is the anti-bot/session response. Determine whether the fallback is masking a broken Chartink session (cookies/UA) and how often it fires — a silent fallback can make a screener look healthy while returning degraded data. | [ ] |
| 8 | **P2** | Missing **`market_cache`** entries in production | *unassigned* | `lib/market-cache.ts` is meant to be a memory front → DB `market_cache` → NSE. Missing DB rows mean every lookup misses to NSE; check whether the write path is being skipped (mirror hold / write-budget rejection) or the table was never seeded. | [ ] |
| 9 | **P2** | **194–527 MB** resident memory | *unassigned* | Correlate the range with which subsystems are resident (the Laya 503 MB ONNX chain is the obvious upper bound, so the low end may be healthy). Confirm the high end is a cold-start peak and not a leak across requests. | [ ] |
| 10 | **P2** | Repeated **14,716,928-byte snapshot restores/uploads** | *unassigned* | That is exactly 14 MB per snapshot. Establish why the SQLite mirror snapshot is restored/uploaded so often (retry storm? leader re-election thrash? a failed push looping?) and cut the churn — it is pure network + disk for no benefit. Pairs with #3 and #4. | [ ] |
| 11 | **P3** | Unsupported **`metadata.themeColor`** warning | *unassigned* | Metadata warning only, not user-visible. Remove or correct the field to silence the noise **only while touching that file** — do not spend a change on it alone. | [ ] |
| 12 | **P3** | Suspicious **third-party `.env` logger line** in production logs | *unassigned* | **Security-relevant: do this one first of the P3s.** Establish which dependency logs a line resembling a `.env` read, and whether any value is actually interpolated into the log. If a secret can reach the log sink, escalate immediately and rotate the credential. | [ ] |
