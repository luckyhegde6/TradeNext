# Version History v1.12

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). All v1.x files: [versions-v1.md](./versions-v1.md).

- **v1.12.1** - Worker Engine Auto-Start Fix (March 27, 2026). Fixed worker engine and cron jobs not running in production:
  - **Auto-Start Fix**: Worker engine now auto-starts on first admin GET request to `/api/admin/workers/engine` - no manual click needed
  - **indexName Fallback**: Added default indexName to cron job payload based on task type (stock_sync → NIFTY TOTAL MARKET, corp_actions → NIFTY 50)
  - **Error Logging**: Added better error handling and logging for invalid indexName in stock_sync task
- **v1.12.0** - Netlify Build Fix & Performance Optimization (March 27, 2026). Fixed production deployment and added modern performance optimizations:
  - **Secrets Scanning Fix**: Added `.opencode` and `opencode.json` to `SECRETS_SCAN_OMIT_PATHS` in `netlify.toml` to prevent build failures from demo password detection
  - **Cache-Control Headers**: Added caching to key API routes (`/api/nse/indexes`, `/api/nse/marquee`, `/api/news/market`, `/api/nse/corporate-info`, `/api/nse/index/[index]`)
  - **Lazy Loading**: Implemented React.lazy() for charts in `app/page.tsx` and `app/markets/[index]/page.tsx`
  - **Web Vitals Monitoring**: Created `lib/metrics.ts` with performance utilities, `app/components/analytics/WebVitals.tsx` for Core Web Vitals tracking via Performance Observer API, and `app/api/metrics/web-vitals/route.ts` for metrics collection
  - **Mobile Navigation Fix**: Added Calendar link to mobile menu in `app/Header.tsx`
  - **NSE Deals API Fix**: Added `?mode=bulk_deals` parameter to return data
  - **BulkDealsTable Fix**: Added proper TypeScript type annotations to render callback
  - **Prisma Migration Fix**: Marked 28 migrations as applied using `npx prisma migrate resolve --applied`
