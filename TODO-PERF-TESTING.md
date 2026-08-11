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
- [ ] Market-sync cron (`cron-market-sync` 1:01 AM IST weekdays): stock list + corp actions + screener capture duration
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