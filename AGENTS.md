# AGENTS.md - TradeNext Development Guide

## Overview
TradeNext is a Next.js 16 application with TypeScript, Tailwind CSS, Prisma, and Jest. It provides stock market data visualization, portfolio management, capital gains tax reporting, F&O analytics, dividend tracking, and portfolio rebalancing for NSE (India).

## Version History
- **v3.2.0** — Phase 4: Intelligence & Reporting — PRD & Roadmap Created (July 18, 2026). Defined next 5 features with detailed implementation plans:
  - **Bug Fix**: Corporate Actions Price/Yield columns now correctly fetch live prices from `daily_prices` and compute yield using `(dividendPerShare / currentPrice) * 100`
  - **PRD Created**: `.agents/PRD.md` — Comprehensive product requirements doc covering all Phase 4 features
  - **TODO.md Updated**: Full roadmap with PRD reference and UI/UX testing checklists
  - **Planned Features**: Real-time WebSocket (SSE), Tax Reports (ST/LT capital gains), Options/F&O Analytics, Dividend Calendar, Portfolio Rebalancer
- **v3.1.0** - Phase 3 Complete — Risk Metrics + Benchmark + Compare Chart (July 18, 2026). All Phase 3 portfolio enhancement features delivered:
  - **Risk Metrics Service**: `lib/services/portfolioRiskMetricsService.ts` — Computes Sharpe Ratio (annualized), Max Drawdown, Annualized Volatility, CAGR, Beta vs NIFTY 50, Win Rate from portfolio value history and IndexClose data.
  - **Risk Metrics API**: `app/api/portfolio/risk-metrics/route.ts` — Serves risk metrics with auth guard, error handling.
  - **RiskMetricsCards UI**: `app/components/RiskMetricsCards.tsx` — 6-card grid with color-coded Sharpe (Excellent/Good/Fair/Poor), Drawdown severity labels, auto-refresh button.
  - **NIFTY 50 Benchmark Overlay**: `app/components/PnLChart.tsx` — Timeline mode now shows NIFTY 50 as amber dashed line, normalized to portfolio baseline. Stats section expanded with benchmark comparison card (Benchmark Return %, Alpha, Data Points).
  - **Compare Chart Overlay**: `app/compare/page.tsx` — Chart.js line chart showing 1-month normalized performance (base 100) for all compared stocks, with color-coded legend and tooltip.
  - **Benchmark in History API**: `lib/services/portfolioHistoryService.ts` — Now returns `benchmark` field with NIFTY 50 close prices and total return for the portfolio date range.
  - **Sector Allocation Chart**: Already implemented (Doughnut chart with % labels and legends). Wired in PortfolioClient.
  - **Tests**: 190 tests pass, zero regressions.
  - **Files Created**: `lib/services/portfolioRiskMetricsService.ts`, `app/api/portfolio/risk-metrics/route.ts`, `app/components/RiskMetricsCards.tsx`
  - **Files Modified**: `app/components/PnLChart.tsx` (NIFTY 50 overlay + stats), `app/compare/page.tsx` (chart section), `app/portfolio/PortfolioClient.tsx` (wired RiskMetricsCards), `lib/services/portfolioHistoryService.ts` (benchmark data), `TODO.md` (mark Phase 3 complete)
- **v3.0.0** - Phase 3 Portfolio Quick Wins (July 18, 2026). CSV export + P&L over time chart:
  - **CSV Export API**: `app/api/portfolio/export/route.ts` — Generates FY Report (holdings + transactions summary) and Detailed P&L (per-holding breakdown) as downloadable CSV files. Supports financial year filtering.
  - **Portfolio Value History Service**: `lib/services/portfolioHistoryService.ts` — Reconstructs daily portfolio value from transaction history + DailyPrice data. Processes transactions chronologically, tracks cost basis, forward-fills prices.
  - **Historical Value API**: `app/api/portfolio/history/route.ts` — Serves portfolio value time series for the P&L Over Time chart. Configurable max data points (10-500).
  - **Enhanced PnLChart**: `app/components/PnLChart.tsx` — Two view modes: Overview (original invested vs current) and Timeline (historical portfolio value with invested overlay). Chart.js line chart with dual datasets, dash line for invested baseline.
  - **Wired Buttons**: `app/portfolio/PortfolioClient.tsx` — Download FY Report and Detailed P&L (CSV) buttons now trigger actual API calls with blob download.
  - **Tests**: 190 tests pass, zero regressions. No new TypeScript errors in production code.
  - **Files Created**: `app/api/portfolio/export/route.ts`, `app/api/portfolio/history/route.ts`, `lib/services/portfolioHistoryService.ts`
  - **Files Modified**: `app/components/PnLChart.tsx` (Overview/Timeline toggle), `app/portfolio/PortfolioClient.tsx` (CSV download handlers), `TODO.md` (roadmap update)
- **v2.2.0** — Admin Alert Config Management + Screener Template Expansion (July 18, 2026). Complete admin infrastructure for alert delivery management and expanded Chartink-inspired screener templates:
  - **Prisma Schema Updates**: Added `Secret` model (AES-256-GCM encrypted storage for credentials), `DeliveryLog` model (delivery tracking). Enhanced `AlertEvent` with `acknowledgedAt`, `channelId`. Enhanced `AlertChannel` with `lastTestedAt`, `lastUsedAt`, `failureCount`. Enhanced `Notification` with `deliveryStatus`, `acknowledgedAt`, `channelId`.
  - **Telegram Delivery Module**: `lib/alerts/delivery/telegram.ts` — fetch-based Bot API integration with HTML/Markdown formatting, config validation, error handling for common Telegram API errors.
  - **Delivery Manager Updates**: `lib/alerts/delivery/index.ts` — enhanced with Telegram support, system-wide channels (userId: 0), `getDeliveryStats()` with success/failure rates by channel, DeliveryLog recording per attempt.
  - **Encrypted Secrets Service**: `app/api/admin/alerts/secrets/route.ts` — AES-256-GCM encryption/decryption for SMTP passwords, API keys, bot tokens, webhook secrets. Hints/masked values for safe display. CRUD with name uniqueness validation, `safeInt()` NaN guard.
  - **Admin Channels API**: `app/api/admin/alerts/channels/route.ts` — full CRUD for system-wide delivery channels. Stats by type/active/system. Include `includeSecrets` mode to show resolved secret references.
  - **Admin Events API**: `app/api/admin/alerts/events/route.ts` — filtered/paginated delivery event view with user enrichment. Stats by status and channel type. Time window selection (1h-7d).
  - **Admin Alerts UI**: Tabbed management page (`/admin/alerts`) with four tabs: User Alerts (existing), Delivery Channels (table + create form with Email/Webhook/Telegram/In-App options + test/delete/toggle), Secrets (encrypted storage with show/hide toggle), Delivery Logs (filters + time window + acknowledge).
  - **Schema Fix**: Renamed `@@index([ruleId, triggeredAt])` → `@@index([ruleId, attemptedAt])` in AlertEvent model. Fixed `triggeredAt`→`attemptedAt` in alert event API routes.
  - **Screener Templates Expanded**: `lib/screener/screener-templates.ts` grew from 25 presets to **98 templates** across 9 categories:
    - Fundamental (15): Large/Mid/Small Cap, Low P/E, High EPS, Below Book Value, High Dividend, High ROE, Low Debt, Profit Jump 200%, Sales Jump 200%, Penny Stocks, Top Lowest PE, High Volume, Position Buy
    - Technical (16): RSI Oversold/Overbought/Bounce, 200 EMA, SMA50/SMA200, High Relative Volume, ATR Breakout, Strong ADX, High Volume Breakout, Top Gainers/Losers, Most Active, 52W High, Bollinger Squeeze, NR7
    - Candlestick (16): Doji, Bullish/Bearish Engulfing, Morning Star, Hammer, Shooting Star, Hanging Man, Marubozu, Dragonfly Doji, Tweezer Top/Bottom, Dark Cloud Cover, Piercing, Bullish/Bearish Harami, Spinning Top
    - Range Breakout (7): Short Term Breakouts, Potential Breakouts, NR7 Current Day, NR7 Inside Bar, 52W Low Bounce, Bollinger Outside, First 15min Breakout
    - Crossover (10): Bullish EMA (5,13,26), MACD Crossover, 4 MA Crossover, FNO ADX+MACD, SuperTrend, Weekly MACD, Monthly RSI, MA Crossover, 200 SMA, Ichimoku Cloud
    - Bullish (10): Bullish Momentum, Pure Bullish Trend, Engulfing Strong, RSI+Stochastic, BTST Engulfing, F&O Uptrend, Harami, RSI Divergence, NKS Best Buy, BOSS Scanner
    - Bearish (8): Perfect Bearish, Engulfing Strong, RSI+Stochastic, Volume Spike 5min, Downtrend, Perfect Sell, 3:15 PM Engulfing, Chanakya Scanner
    - Intraday Bullish (8): Open=Low, Momentum Bullish, Day Low=High, Jackpot Buy, BTST, RSI Breakout, Ichimoku, Santu Baba Open=Low+1%
    - Intraday Bearish (8): Sell Open=High, Intraday Reversal, Future Sell SuperTrend, Mohan's Sure Sell, Near Support, Shot Down, Last 15min Selling, Gap Up Open=High Short
  - **Bug Fixes**: Removed hardcoded fallback encryption key (security P1), added `safeInt()` NaN validation in API routes (P2), replaced `console.error` with `logger.error` in channels/secrets routes (P2), fixed `triggeredAt`→`attemptedAt` in alert event API routes.
  - **Files Created**: `lib/alerts/delivery/telegram.ts`, `app/api/admin/alerts/channels/`, `app/api/admin/alerts/events/`, `app/api/admin/alerts/secrets/`
  - **Files Modified**: `lib/screener/screener-templates.ts` (25→98 templates), `lib/alerts/delivery/index.ts` (Telegram + system channels + stats), `app/admin/alerts/page.tsx` (4-tab UI + Telegram type), `prisma/schema.prisma` (Secret, DeliveryLog models + AlertChannel/AlertEvent enhancements), `app/admin/page.tsx`, `app/api/admin/alerts/route.ts`, `app/api/alerts/evaluate/route.ts`, `app/api/alerts/events/route.ts`
  - **Tests**: All 190 existing tests pass (no regressions). Zero new TypeScript compilation errors in production code.

- **v2.1.0** - Enterprise Alert Engine (July 17, 2026). Complete Phase 2 of Alert Engine system:
  - **Prisma Models**: Added `AlertChannel`, `AlertRule`, `AlertEvent` models. Enhanced `Notification` with `deliveryStatus`, `acknowledgedAt`, `channelId`.
  - **Email Delivery**: `lib/alerts/delivery/email.ts` — nodemailer SMTP transport with config validation, HTML template builder with price/change display.
  - **Webhook Delivery**: `lib/alerts/delivery/webhook.ts` — fetch-based HTTP POST with Slack (attachments format), Discord (embeds format), Generic JSON formats. Config validation, color mapping.
  - **Delivery Manager**: `lib/alerts/delivery/index.ts` — routes to channels, records AlertEvent, creates in-app Notification, escalation scheduling.
  - **Alert Engine**: `lib/alerts/alert-engine.ts` — FilterGroup-based condition evaluation against live quotes via `getStockQuote()`, schedule restrictions (active hours/days), cooldown enforcement, message building.
  - **API Routes (7)**: `/api/alerts/rules` (GET/POST), `/api/alerts/rules/:id` (GET/PUT/DELETE), `/api/alerts/channels` (GET/POST), `/api/alerts/channels/:id` (GET/PUT/DELETE), `/api/alerts/channels/:id/test` (POST), `/api/alerts/events` (GET/POST acknowledge), `/api/alerts/evaluate` (POST trigger/GET stats).
  - **UI Components**: Tabbed alerts page with RuleList (FilterGroup-based rule builder), ChannelConfig (email/webhook setup wizard), EventHistory (filterable/paginated log).
  - **Tests (17)**: email-delivery (7 tests), webhook-delivery (7 tests), alert-engine (10 tests). All 190 existing tests unaffected.
  - **react-is**: Fixed missing recharts peer dependency.
- **v1.16.1** - Code Hygiene & Artifact Cleanup (July 18, 2026). Documented cleanup practices for Playwright snapshots, temp files, and pre-commit review:
  - **Lessons.md**: Added "Playwright Snapshot Cleanup & Code Hygiene" lesson with cleanup checklist
  - **AGENTS.md**: Added mandatory "Code Hygiene & Artifact Cleanup" section with checklist and common junk file table
  - **checklist.md**: Added "Cleanup & Code Hygiene" section + Playwright `--filename` warning + cleanup-after-testing instructions
  - **Before Every Commit Checklist**: Added code hygiene step (git status, junk files, secrets, dead code review)

- **v1.16.0** - Advanced Screener & Chartink-Like Scanning (July 16, 2026). Complete Phase 1 of Advanced Screener system:
  - **Filter Grammar Engine**: Created `lib/screener/condition-tree.ts` — recursive `FilterGroup`/`FilterCondition` types, 40+ filter fields, Zod schemas, `getRequiredColumns()`, `createDefaultFilterGroup()`.
  - **Filter Evaluation Engine**: Created `lib/screener/filter-engine.ts` — `evaluateCondition()` (numeric/string operators), `evaluateFilterGroup()` recursive, `applyFilterGroup()`, `validateFilterGroup()`. Fixed `eq`/`neq` overload dispatch using `isNumericField()`.
  - **Technical Analysis Library**: Created `lib/screener/technical-analysis.ts` — `computeSMA()`, `computeEMA()`, `computeRSI()`, `computeMACD()`, `computeBollinger()`, `detectCandlestickPatterns()` (Doji, Hammer, Shooting Star, Marubozu, Spinning Top, Bullish/Bearish Engulfing).
  - **Backtest Engine**: Created `lib/screener/backtest-engine.ts` — OHLCV-based trade simulator with entry via FilterGroup, exit via profit target/stop-loss/trailing stop/max bars, position sizing, performance metrics (win rate, avg win/loss, max drawdown, Sharpe ratio).
  - **TradingView Service Enhanced**: `lib/services/tradingview-service.ts` — `advancedScan()` with dynamic column list, `DEFAULT_COLUMNS` (14), `TECHNICAL_COLUMNS` (32).
  - **Prisma Models**: Added `ScanConfig`, `ScanResult`, `ScanResultItem`, `BacktestRun`, `BacktestTrade` models. Deprecated `ScreenerConfig`, `ScreenerResult`, `SavedScreen`.
  - **Backend APIs**: 10 API routes (`/api/screener/advanced`, `/api/screener/configs`, `/api/screener/configs/:id`, `/api/screener/configs/:id/run`, `/api/screener/export`, `/api/backtest/run`, `/api/backtest/runs`, `/api/backtest/runs/:id`, `/api/screener/templates`, `/api/screener/templates/:id`).
  - **UI Components**: FilterBuilder (recursive condition tree), ScannedResultsTable (sortable/paginated), TemplatesPanel (98 presets, v2.2.0), ScanConfigsManager (inline edit/delete/share), BacktestDialog (metrics + equity curve SVG + trade table).
  - **Chartink Analysis**: Reverse-engineered Chartink's DSL (`POST /screener/process`), API format, and trading pattern categories. Built native equivalent using TradingView directly.
  - **Tests**: 45 tests across 3 suites (filter-engine: 22, technical-analysis: 16, backtest-engine: 7).
  - **Files Created**: 20+ files in `lib/screener/`, `app/api/screener/`, `app/api/backtest/`, `app/components/screener/`.
- **v1.15.0** - Agent Handoff & Self-Learning System (July 16, 2026). Complete overhaul of agent collaboration infrastructure:
  - **Handoff File System**: Created `.agents/handoffs/` with standardized schema, lifecycle flows, and agent-to-agent handoff protocol. Root `HANDOFF.md` orchestrates state across sessions.
  - **Agent Definitions**: Created 6 specialized agent profiles: GH Helper (diff review, code verify, bug fix), E2E Agent (Playwright flow testing), Integrator (merge/conflict resolution), Observability Checker (logging/metrics/security audit), DevOps (Docker/Vercel/Netlify/CICD), QA (test writing and E2E execution).
  - **Self-Learning Loop**: Created `.agents/learning/` with session logs, pattern extraction, metrics tracking. Every session feeds into continuous improvement.
  - **Agent Commands**: Added `/handoff`, `/self-learn`, `/review-diff` commands for explicit orchestration.
  - **Git Hooks**: Added pre-commit (code quality, secrets detection) and post-commit (activity logging, checkpoint tracking) hooks.
  - **Documentation Update**: Expanded AGENTS.md, Primer.md, agent-memory.md, Lessons.md with handoff patterns.
  - **Files Created**: 20+ files in `.agents/` structure (handoffs, agents, learning, commands, hooks).
- **v1.14.0** - MCP API for External NSE Data (March 27, 2026). Added unified API endpoint for external NSE data queries:
  - **MCP Endpoint**: `/api/mcp` - Machine Communication Protocol for all NSE data
  - **22 Functions**: getIndexData, getStockQuote, getStockChart, getGainers, getLosers, getMostActive, getAdvanceDecline, getCorporateActions, getCorporateInfo, getMarquee, getDeals, getAnnouncements, getInsiderTrading, getEvents, getHeatmap, getSymbols, getTrends, etc.
  - **Authentication**: Optional API key via `x-api-key` header (configurable via `MCP_API_KEY`)
  - **JSON Format**: Returns standardized response with success, function, data, timestamp
  - **Caching**: All responses cached for performance (60s-3600s depending on data type)
  - **Discovery**: Built-in `listFunctions`, `describe`, `schema`, `help` for API exploration
- **v1.13.0** - Corporate Action Alerts (March 27, 2026). Added new alert types for corporate actions:
  - **New Alert Types**: dividend_alert, bonus_alert, split_alert, rights_alert, buyback_alert, meeting_alert
  - **Alert Service**: Added `checkCorporateActionAlerts()` function that scans upcoming corporate actions
  - **Check API**: Enhanced `/api/alerts/check` to handle both price alerts and corporate action alerts
  - **UI Updates**: Added corporate action alert options in `/alerts` page including minimum dividend filter
  - **Notifications**: Enhanced alert messages to include action details (ex-date, purpose, ratio)
  - **Real-time Fallback**: Alerts page triggers check on load for serverless environments
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
- **v1.11.1** - Worker Task Management Fix (March 21, 2026). Fixed worker task actions in admin panel:
  - **Run Now Button**: Added to UI for pending/failed tasks - executes task immediately via PATCH API
  - **Retry Button**: Added for failed tasks - resets and re-executes the task
  - **Cancel Button**: Fixed to use PATCH API instead of PUT, properly updates status
  - **Delete Button**: Fixed to use PATCH API with action: "delete"
  - **API Endpoints**: All task actions now use consistent PATCH endpoint with action types
- **v1.11.0** - Google Analytics & SEO Enhancement (March 21, 2026). Added comprehensive SEO and analytics integration:
  - **Google Analytics 4**: Installed `@next/third-parties`, created `app/components/analytics/GoogleAnalytics.tsx` with GA4 integration. Only loads if `NEXT_PUBLIC_GA_ID` is set and validates GA ID format.
  - **Custom Event Tracking**: Created `app/components/analytics/trackEvent.ts` with sanitized `trackEvent()`, `trackPageView()`, `trackTiming()`, and helper functions (`StockTracking`, `AdminTracking`).
  - **SEO Metadata**: Created `app/components/seo/` with Organization, WebSite, WebPage, and Stock JSON-LD schemas. Added `SEOTags` component with comprehensive metadata.
  - **Dynamic Sitemap**: Enhanced `app/sitemap.ts` with all public pages, priority levels, and change frequencies.
  - **Robots.txt**: Enhanced `app/robots.ts` with Googlebot and Bingbot specific rules.
  - **Page Metadata**: Added `metadata.ts` files to `/markets`, `/markets/screener`, `/markets/analytics`, `/portfolio`, `/news`, `/alerts` routes.
  - **Root Layout Update**: Updated `app/layout.tsx` to include `<SEOTags />` and `<Analytics />` components.
  - **Environment Variables**: Updated `.env.example` with `NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_GA_ID`.
  - **Security**: All event tracking sanitizes inputs to prevent XSS. GA only loads with valid ID format.
- **v1.10.6** - Worker Logger Security Fix (March 20, 2026). Fixed CodeQL security vulnerability in `lib/services/worker/worker-logger.ts` - uncontrolled data used in path expression. Added `sanitizeTaskIdForPath()` function to validate task IDs contain only safe filename characters (`/^[A-Za-z0-9_\-:.]+$/`), preventing path traversal attacks. Applied sanitization to `writeToBoth()`, `readLog()`, and `deleteLog()` functions.
- **v1.10.5** - Corporate Actions NSE Field Fix (March 20, 2026). Fixed corporate actions sync saving all records as "OTHER" type. Root cause: NSE API uses lowercase field names (`subject`, `comp`, `recDate`, `faceVal`) but code looked for uppercase (`PURPOSE`, `COMPANY NAME`, `RECORD DATE`, `FACE VALUE`). Also fixed dividend amount field mismatch (`dividendPerShare` vs `dividendAmount`). Updated both `app/api/admin/nse/live-sync/route.ts` and `app/api/corporate-actions/combined/route.ts`. Added Subject, Face Value, and Price columns to Upcoming Actions table for uniform formatting with Historical table.
- **v1.10.4** - Serverless Logging Fix (March 20, 2026). Added `ServerLog` model to database for persistent logging on serverless platforms (Netlify, Vercel). Created `lib/services/db-logger.ts` for DB-backed logging with helpers (`dbInfo`, `dbWarn`, `dbError`, `dbDebug`). Updated `lib/services/worker/worker-logger.ts` with DB fallback when file logging fails. Added `/api/admin/logs` API route for viewing and managing server logs with filtering (level, source, taskId). Schema synced via `prisma db push --accept-data-loss` since using Prisma Accelerate.
- **v1.10.3** - Price Alert Current Price Display (March 20, 2026). Added current stock price display when creating price alerts and viewing existing alerts. Now shows "Current Price: ₹XXX" when selecting a stock symbol in the alert form. Also updated admin stats to properly show worker/cron status instead of "disabled".
- **v1.10.2** - Worker Cache Key Type Fix (March 20, 2026). Fixed `stock_sync` worker task failing with "TypeError: indexName.replace is not a function". Root cause: `generateCacheKey` in `market-cache.ts` checked `if (indexName)` but didn't verify the type was string. Fixed by using `typeof indexName === 'string'` check.
- **v1.10.1** - Corporate Actions Deduplication Fix (March 20, 2026). Fixed duplicate corporate actions being created during NSE sync. Root cause: deduplication logic only checked `symbol + exDate` but schema unique constraint is `symbol + actionType + exDate`. Also fixed timezone inconsistency in date parsing. All sync functions now use `upsert` with correct unique constraint and UTC noon dates.
- **v1.10.0** - Stock Screener Enhancement (March 20, 2026). Fixed screener API to fetch live data directly from TradingView when database is empty. Added comprehensive filters: Quick Filters (High Volume, Top Gainers, Top Losers, Value Stocks, Growth Stocks, High Dividend), Basic Filters (Market Cap, Sector, Price, P/E, Volume, Relative Volume), and Advanced Filters (P/B Ratio, Dividend Yield, ROE, Debt/Equity). Enhanced table with color-coded metrics. Fixed `stocks.sort()` error when no data available.
- **v1.9.3** - Build Fixes (March 19, 2026). Fixed Next.js 15+ async params in dynamic route handlers (`Promise<{ id: string }>`). Fixed Zod v4 error property (`issues` instead of `errors`). Regenerated Prisma client.
- **v1.9.2** - Secure Join Request Flow (March 19, 2026). Replaced direct user signup with an admin-approved join request system. Implemented RBAC for `/users/*` and `/admin/*` routes. Added a tabbed management interface for admins and cleaned up legacy insecure routes.
- **v1.9.1** - Notifications & UX Enhancements (March 18, 2026). Implemented a comprehensive Notifications Page at `/notifications`. Integrated triggered alerts into the notification feed. Added persistent logging via Netlify Blobs for serverless environments. Fixed NSE DB logging and centered the login modal.
- **v1.9.0** - Worker Engine & NSE Sync (March 18, 2026). Implemented a persistent background worker and cron scheduler. Added automated NSE data synchronization for corporate actions, events, news, and market data. Introduced a dynamic logging system in `.next/server_logs` with elevated permissions.
- **v1.8.3** - Corp Actions Seeding & Auth Stability (March 18, 2026). Fixed broken database seeding logic for corporate actions, eliminating Prisma Accelerate connection timeouts by batching inserts. Resolved a stubborn NextAuth "ghost session" bug that prevented proper logout.
- **v1.8.2** - Netlify 502 Fix (March 16, 2026). Fixed 502 Bad Gateway error on Netlify. Root cause: Middleware with NextAuth was causing edge function crashes despite `runtime = 'nodejs'`. Solution: Created minimal middleware without NextAuth imports. Authentication now handled at API route level. Prisma Accelerate configuration fixed with `accelerateUrl` option.
- **v1.8.1** - Build Fixes (March 16, 2026). Fixed Prisma 7 adapter configuration. Moved type packages to dependencies for Netlify. Fixed logger to output in production. Fixed netlify.toml syntax. Added startup logging for debugging 502 errors.

---

## New Features (v1.16.0)

### Advanced Screener System

The Advanced Screener (`/markets/screener/advanced`) is a new Chartink-like scanning system with multi-condition filtering, technical analysis, and backtesting.

#### Filter Condition Tree
- **Recursive AND/OR groups**: Filters organized as nested trees with any depth
- **40+ filter fields**: Price (close, open, high, low, change, 52W high/low), Volume, Fundamentals (market cap, P/E, P/B, dividend yield, ROE, debt/equity, EPS), Technical (RSI, MACD, SMA, EMA, Bollinger, ADX, ATR), Performance (1W-1Y), Ratings
- **Numeric operators**: >, ≥, <, ≤, =, ≠, Between
- **String operators**: =, ≠, In list, Not in list
- **Zod validation**: Full runtime schema validation of filter configurations

#### FilterBuilder UI Component
The FilterBuilder (`app/components/screener/FilterBuilder.tsx`) provides a recursive visual editor:

- **Category-organized field dropdown**: Price, Volume, Fundamental, Technical, Performance, Rating
- **Smart operator selection**: Shows appropriate operators based on field type
- **Validation hints**: Red error messages below invalid conditions (empty values, range violations)
- **Field-specific hints**: Contextual help like "Range: 0-100" for RSI, "1x = average" for Relative Volume
- **Multi-value input**: Comma-separated input for `in`/`not_in` operators
- **Nested groups**: Add sub-groups with AND/OR toggle for complex logic
- **Condition count warning**: Shows warning at 80% of max conditions
- **Max condition enforcement**: Buttons disabled at limit
- **Condition validation**: `getFilterGroupErrors()` function returns all errors in tree

#### ScannedResultsTable Component
Interactive results display (`app/components/screener/ScannedResultsTable.tsx`):

- **12 sortable columns**: Symbol, Price, Change, % Change, Volume, Market Cap, P/E, P/B, Dividend Yield, RSI, SMA50, SMA200
- **Color-coded values**: Green for gains/good metrics, red for losses/bad metrics
- **Smart formatting**: Market cap in Cr, volume in Cr/L, percentages with sign
- **Pagination**: Slide window showing pages around current position
- **Export CSV**: Download results as CSV file
- **States**: Loading spinner, empty state, error display

#### Screener Templates (25 Presets)
Chartink-inspired pre-built scans:

- **Fundamental**: Large Cap, Mid Cap, Small Cap, Low P/E, High EPS, Below Book Value, High Dividend, High ROE, Low Debt, Penny Stocks
- **Technical**: RSI Oversold, RSI Overbought, RSI Oversold Bounce, High Volume Breakout, Top Gainers, Top Losers, Most Active, 52W High Breakout, Bollinger Squeeze, Strong ADX Trend
- **Intraday**: Momentum Bullish, Intraday Reversal

#### ScanConfigsManager Component
Config management (`app/components/screener/ScanConfigsManager.tsx`):

- **Inline editing**: Click "Edit" to rename/change description inline
- **Run saved scan**: Execute a saved config directly from the list
- **Share**: Copy shareable link to clipboard
- **Public/Private toggle**: Make scans publicly accessible
- **Delete**: Two-step confirmation delete
- **Search**: Filter saved configs by name
- **Sidebar layout**: Slides in from right side

#### BacktestDialog Component
Historical simulation UI (`app/components/screener/BacktestDialog.tsx`):

- **Configurable parameters**: Profit target %, Stop loss %, Trailing stop %, Max holding bars, Initial capital, Position size %
- **Equity curve**: SVG chart showing equity progression across trades
- **Performance metrics cards**: Total Return, Win Rate, Total Trades, Avg Win, Avg Loss, Max Drawdown, Sharpe Ratio, Net P&L
- **Trade table**: Entry/Exit dates, prices, quantity, P&L, exit reason with color-coded badges
- **Exit reason breakdown**: Summary of profit_target/stop_loss/trailing_stop/max_bars distribution
- **Re-run support**: Change parameters and re-run without leaving dialog

#### TemplatesPanel Component
Template browser (`app/components/screener/TemplatesPanel.tsx`):

- **Category filter pills**: Fundamental, Technical, Candlestick, Bullish, Bearish, etc.
- **Search**: Filter templates by name/description
- **Star rating**: Popularity indicator (1-5 stars)
- **One-click apply**: Click to load filter conditions and auto-run scan

#### Backend API Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/screener/advanced` | POST | Execute multi-condition scan against TradingView |
| `/api/screener/configs` | GET/POST | List/create scan configs |
| `/api/screener/configs/:id` | PUT/DELETE | Update/delete config |
| `/api/screener/configs/:id/run` | POST | Execute saved config |
| `/api/screener/export` | POST | Export scan results as CSV |
| `/api/backtest/run` | POST | Run historical backtest |
| `/api/backtest/runs` | GET | List user's backtest runs |
| `/api/backtest/runs/:id` | GET | Get backtest detail with trades |
| `/api/screener/templates` | GET | List preset templates |
| `/api/screener/templates/:id` | GET | Get template filter group |

#### Chartink Reverse-Engineering

Chartink (`https://chartink.com/screener`) was analyzed as a reference:

| Aspect | Chartink | TradeNext |
|--------|----------|-----------|
| **API** | `POST /screener/process` (custom DSL) | `POST /api/screener/advanced` (FilterGroup JSON) |
| **DSL** | `( {cash} ( market cap > 10000 ) )` | `{ logic: "AND", conditions: [{ field: "market_cap_basic", condition: { operator: "gt", value: 10000 } }] }` |
| **Data source** | TradingView (via proxy) | TradingView (direct) |
| **Response** | DataTables format `{ draw, recordsTotal, data }` | `{ stocks, pagination, executionMs }` |
| **Backtest** | `POST /backtest/process` | `POST /api/backtest/run` |
| **Auth** | XSRF token + session cookie | NextAuth JWT |
| **Templates** | 150,000+ community screeners | 25 built-in presets |

Key insight: Chartink is a TradingView wrapper. Our native TradingView integration is architecturally superior — no middleman, no session management, no ToS concerns.

#### Files Created

| File | Purpose |
|------|---------|
| `lib/screener/condition-tree.ts` | Filter types, Zod schemas, 40+ field definitions |
| `lib/screener/filter-engine.ts` | Condition evaluation, batch filtering, validation |
| `lib/screener/technical-analysis.ts` | SMA, EMA, RSI, MACD, Bollinger, candlestick patterns |
| `lib/screener/backtest-engine.ts` | OHLCV trade simulator with positional sizing |
| `lib/screener/screener-templates.ts` | 25 preset templates |
| `lib/services/tradingview-service.ts` | Enhanced with advancedScan(), column constants |
| `app/api/screener/advanced/route.ts` | Multi-condition scan endpoint |
| `app/api/screener/configs/route.ts` | Config list/create |
| `app/api/screener/configs/[id]/route.ts` | Config update/delete |
| `app/api/screener/configs/[id]/run/route.ts` | Config execution |
| `app/api/screener/export/route.ts` | CSV export |
| `app/api/screener/templates/route.ts` | Templates list |
| `app/api/screener/templates/[id]/route.ts` | Template details |
| `app/api/backtest/run/route.ts` | Backtest execution |
| `app/api/backtest/runs/route.ts` | Backtest runs list |
| `app/api/backtest/runs/[id]/route.ts` | Backtest run detail |
| `app/components/screener/FilterBuilder.tsx` | Recursive condition tree UI |
| `app/components/screener/ScannedResultsTable.tsx` | Sortable/paginated results |
| `app/components/screener/ScanConfigsManager.tsx` | Config management |
| `app/components/screener/TemplatesPanel.tsx` | Templates browser |
| `app/components/screener/BacktestDialog.tsx` | Backtest UI with charts |
| `app/markets/screener/advanced/page.tsx` | Advanced screener page |
| `lib/screener/__tests__/filter-engine.test.ts` | 22 filter engine tests |
| `lib/screener/__tests__/technical-analysis.test.ts` | 16 technical analysis tests |
| `lib/screener/__tests__/backtest-engine.test.ts` | 7 backtest engine tests |

## New Features (v1.10.0)

### Stock Screener Enhancement

The Stock Screener (`/markets/screener`) has been significantly enhanced with live TradingView data:

#### Quick Filters (Presets)
- **All Stocks**: Show all NSE stocks
- **High Volume (1.5x+)**: Stocks with relative volume ≥ 1.5x
- **Top Gainers (3%+)**: Stocks with % change ≥ 3%
- **Top Losers (3%-)**: Stocks with % change ≤ -3%
- **Value Stocks**: Low P/E (≤25) and P/B (≤3)
- **Growth Stocks**: P/E between 15-60
- **High Dividend (3%+)**: Stocks with dividend yield ≥ 3%

#### Basic Filters
- Market Cap: Large Cap (>20,000 Cr), Mid Cap (500-20,000 Cr), Small Cap (<500 Cr)
- Sector: 19 NSE sectors
- Price Range (₹)
- P/E Ratio
- % Change
- Volume (absolute)
- Relative Volume

#### Advanced Filters (collapsible)
- P/B Ratio
- Dividend Yield (%)
- ROE (%)
- Debt/Equity Max
- Weekly Performance (%)
- Monthly Performance (%)

#### Enhanced Table Columns
- Symbol, Market Cap, Price, Change, P/E, P/B, Dividend Yield, Volume
- Color-coded values (green for good metrics)
- Sort by any column

#### TradingView Integration
- Fetches live data directly from TradingView when database is empty
- Falls back to database cache if available
- Supports 2000+ NSE stocks

---

## Corporate Actions Deduplication Fix (v1.10.1)

### Problem
Corporate Actions table showed duplicate entries for the same symbol and ex-date:
```
VESUVIUS   30-APR-2026
VESUVIUS   30-APR-2026  (duplicate)
SCHAEFFLER 23-APR-2026
SCHAEFFLER 23-APR-2026  (duplicate)
```

### Root Cause
1. **Deduplication mismatch**: Code checked `symbol + exDate` but schema unique constraint is `symbol + actionType + exDate`
2. **Timezone inconsistency**: Date parsing created dates at midnight local time, causing timezone mismatches
3. **Multiple sync paths**: Different sync functions had inconsistent deduplication logic

### Solution
1. **Fixed date parsing**: All `parseNseDate` functions now create dates at noon UTC:
   ```typescript
   new Date(Date.UTC(parseInt(yr), month, parseInt(dd), 12, 0, 0, 0))
   ```

2. **Fixed deduplication**: All sync functions now use Prisma `upsert` with correct unique constraint:
   ```typescript
   await prisma.corporateAction.upsert({
     where: {
       symbol_actionType_exDate: { symbol, actionType, exDate }
     },
     update: { ... },
     create: { ... }
   });
   ```

### Files Changed
- `app/api/corporate-actions/combined/route.ts` - Fixed date parsing and upsert
- `app/api/admin/nse/live-sync/route.ts` - Fixed date parsing and upsert
- `app/api/admin/corporate-actions/route.ts` - Fixed date parsing and upsert
- `app/api/admin/nse/historical/route.ts` - Fixed date parsing (already had upsert)
- `lib/services/sync-service.ts` - Fixed to use upsert

### Cleanup SQL (for existing duplicates)
```sql
-- View duplicate counts
SELECT symbol, "actionType", "exDate", COUNT(*) as cnt
FROM corporate_actions
GROUP BY symbol, "actionType", "exDate"
HAVING COUNT(*) > 1;

-- Delete duplicates (keep the newest record)
DELETE FROM corporate_actions a
USING corporate_actions b
WHERE a.id < b.id
  AND a.symbol = b.symbol
  AND a."actionType" = b."actionType"
  AND a."exDate" = b."exDate";
```

---

## Corporate Actions NSE Field Fix (v1.10.5)

### Problem
- Corporate actions sync saved all records with `actionType = "OTHER"`
- Company names were empty, record dates missing
- Dividend amounts showing "-"

### Root Cause
NSE API returns lowercase field names but code looked for uppercase:
- `subject` vs `PURPOSE` / `purpose`
- `comp` vs `COMPANY NAME`
- `recDate` vs `RECORD DATE`
- `faceVal` vs `FACE VALUE`

### Solution
Fixed field mappings in both routes:

```typescript
// Before (WRONG)
const purpose = item.PURPOSE || item.purpose || '';
const companyName = item['COMPANY NAME'] || item.companyName || "";

// After (CORRECT)
const purpose = item.PURPOSE || item.purpose || item.subject || '';
const companyName = item['COMPANY NAME'] || item.companyName || item.comp || "";
```

Also fixed dividend amount field name mismatch:
```typescript
// Before (WRONG)
dividendPerShare: action.dividendAmount,

// After (CORRECT)
dividendPerShare: action.dividendPerShare ?? action.dividendAmount ?? null,
```

### Files Changed
- `app/api/admin/nse/live-sync/route.ts` - Added lowercase field mappings
- `app/api/corporate-actions/combined/route.ts` - Added lowercase field mappings
- `app/components/analytics/CorporateActionsTable.tsx` - Added Subject, FV, Price columns to Upcoming Actions

### NSE API Field Names
| Field | NSE API | Code Was Looking For |
|-------|---------|---------------------|
| Purpose | `subject` | `PURPOSE`, `purpose` |
| Company | `comp` | `COMPANY NAME`, `companyName` |
| Record Date | `recDate` | `RECORD DATE`, `recordDate` |
| Face Value | `faceVal` | `FACE VALUE`, `faceValue`, `FV`, `fv` |

---

## Serverless Logging Fix (v1.10.4)

### Problem
- Worker logs and server logs were not working on serverless platforms (Netlify/Vercel)
- `.next/server_logs` directory doesn't exist or isn't writable in serverless environments
- No persistent storage for logs across deployments

### Solution
Added database-backed logging system that works everywhere:

#### ServerLog Model
```prisma
model ServerLog {
  id          String    @id @default(uuid())
  level       String    // "info" | "warn" | "error" | "debug"
  message     String
  source      String?   // "worker" | "api" | "sync" | "system" | "nse"
  taskId      String?   // Associated task ID (for worker logs)
  metadata    Json?     // Additional structured data
  ipAddress   String?
  userAgent   String?
  requestId   String?
  createdAt   DateTime  @default(now())
  
  @@index([level])
  @@index([source])
  @@index([taskId])
  @@index([createdAt])
}
```

#### db-logger.ts Service
Provides helper functions for logging:
- `logToDb(entry)` - Core logging function
- `dbInfo(message, metadata?, source?)` - Quick info log
- `dbWarn(message, metadata?, source?)` - Quick warning log
- `dbError(message, metadata?, source?)` - Quick error log
- `dbDebug(message, metadata?, source?)` - Quick debug log
- `getDbLogs(options)` - Retrieve logs with filtering
- `cleanupOldLogs(retentionDays)` - Automatic cleanup (default 7 days)
- `getLogStats()` - Get statistics

#### worker-logger.ts Updates
Updated to use fallback chain:
1. File logging (local only)
2. Netlify Blobs (if on Netlify)
3. Database fallback (always works)

#### API Route
`GET/DELETE /api/admin/logs` for managing server logs:
- Query params: `type` (db|worker|files|stats), `level`, `source`, `taskId`, `limit`, `offset`
- DELETE with `retentionDays` param for cleanup

---

## New Features (v1.9.2)

### Secure Join Request Flow
- **Admin Approval System**: Direct user creation is now restricted. Prospective users must submit a "Join Request" (Name, Email, Mobile, Message).
- **Admin Interface**: A new tabbed interface in User Management allows admins to review, approve, or reject pending requests.
- **Auto-Account Creation**: Upon approval, the system automatically creates a user account and generates a temporary password (stored securely).
- **RBAC Enforcement**: Middleware now strictly protects `/users/*` and `/admin/*` routes, redirecting unauthorized attempts.
- **Security Cleanup**: Removed legacy `/users/new` route and direct signup APIs to close security loopholes.

---

## New Features (v1.9.1)

### Notifications Page (/notifications)
- **Aggregated Updates Feed**: A unified view for all system activities, task completions, and alerts.
- **Role-Based Tabs**: 
    - **All**: Combined feed of system updates, alerts, and tasks.
    - **Alerts**: Focused view of price targets and market anomalies.
    - **Tasks**: (Admin Only) Real-time worker task statuses and success/failure logs.
    - **System**: Audit logs for sensitive actions (Login failures, Rate limits, NSE API calls).
- **Global Announcements**: Important admin announcements are now visible to all logged-in users.
- **Access Control**: Secure page requiring authentication, with modern "Access Denied" state.

### Persistent Serverless Logging (Netlify Blobs)
- **Problem**: Next.js file system logging is ephemeral on Netlify/Vercel.
- **Solution**: Integrated `@netlify/blobs` for persistent log storage.
- **Implementation**: Worker logs and server logs are now written to Netlify Blob storage, allowing the Admin Monitoring panel to display logs across deployments.
- **Async Logging**: Converted logging utilities to be asynchronous to support cloud storage writes.

### UX & Bug Fixes
- **Login Modal**: Centered and mobile-responsive modal implementation for seamless authentication.
- **NSE DB Logging**: Fixed a bug where NSE API calls weren't appearing in the Monitoring DB logs; integrated `logAPIRequest` into `nse-client.ts`.
- **Dependency Optimization**: Removed `date-fns` for notification time formatting in favor of a native, lightweight `formatTimeAgo` helper.
- **Prisma v7 Stability**: Resolved casing issues in the Prisma client (`aPIRequestLog`, `workerTask`) using type-safe workarounds.

---

## Netlify 502 Fix Details (v1.8.2)

### Problem
- Site returning 502 Bad Gateway on Netlify
- Build succeeded but runtime failed
- Even static pages returned 502

### Root Cause
- Middleware with NextAuth (`import NextAuth from "next-auth"`) caused crashes
- Despite `export const runtime = 'nodejs'`, middleware deployed as Edge Function
- Edge functions have 10s timeout and limited Node.js support

### Solution
1. **Minimal Middleware**: Created middleware without NextAuth imports
   - Handles CORS, basic rate limiting, security headers only
   - Authentication now handled at API route level via `auth()` from `@/lib/auth`

2. **Prisma Accelerate**: Fixed to properly detect and use accelerateUrl
   ```typescript
   const useAccelerate = databaseUrl.startsWith('prisma+postgres://') || databaseUrl.startsWith('prisma://');
   if (useAccelerate) {
     prismaClient = new PrismaClient({ accelerateUrl: databaseUrl });
   }
   ```

### Files Changed
- `middleware.ts` - Minimal middleware without NextAuth
- `lib/prisma.ts` - Accelerate URL detection and connection
- `next.config.ts` - Added skipMiddlewareUrlNormalize

### Testing
- Disabled middleware temporarily to isolate issue
- Site loaded successfully without middleware
- Re-enabled with minimal config - works!

---
- **v1.8.0** - Security Enhancements (March 14, 2026). Fixed localStorage exposure - user data no longer stored in localStorage. Added httpOnly, secure, sameSite:strict cookies for session management. Added CSRF token validation. Added database-backed session tracking with admin session management page at /admin/sessions. Admin can view active user sessions, invalidate specific sessions, or invalidate all sessions for a user.
- **v1.7.0** - Cron Jobs, Workers & Calendar (March 13, 2026). Added Cron Config management for scheduled tasks. Added Background Workers system with task queue. Added Corporate Actions Calendar view at /markets/calendar. Added TradingView integration links. Added file-based worker logging system.
- **v1.6.1** - Bug Fixes & Financial Results UI (March 13, 2026). Fixed Corporate Actions Dividend/Yield columns showing "-". Added Financial Results tab with NSE-format table (quarters as columns, metrics as rows). Fixed audit logs to show Method, Path, Status, Speed columns. Added Stock List Sync to admin panel.
- **v1.6.0** - Historical Data Sync (March 13, 2026). Added admin panel for syncing historical NSE data with custom date ranges. New endpoints for corporate actions, announcements, events, results, and insider trading.
- **v1.5.0** - Live site tested (March 13, 2026). All core features working: Authentication, Portfolio, Markets, Analytics (13 tabs), Corporate Actions, Alerts, Watchlist, Screener, News, Community, Admin Panel. Bug: Corporate Actions Price/Yield columns show "-" instead of values.
- **v1.4.0** - Enhanced Corporate Actions with dividend yield, filtering, pagination, search, improved UX, and date formatting fixes. Added DataTable sorting for all market analytics tables.
- **v1.3.0** - Added Corporate Actions Management (Dividends, Splits, Bonus, Rights, Buybacks) with admin upload, NSE live integration, and combined view
- **v1.2.0** - Added Analytics Service, Alert Service, Demo User Seeding, Portfolio Analytics API
- **v1.1.0** - Added Stock Recommendations, User Alerts, Audit Logging, Rate Limiting, Admin Holdings Management
- **v1.0.0** - Initial release

---

## New Features (v1.8.0)

### Security Enhancements

#### Fixed localStorage Exposure
- User data (name, email, role, id, mobile) is no longer stored in localStorage
- Session data is now handled entirely via httpOnly cookies
- Prevents XSS attacks from accessing sensitive user data

#### Cookie Security
- All session cookies now use `httpOnly: true`, `secure: true`, `sameSite: "strict"`
- CSRF token protection enabled via NextAuth's built-in mechanism
- JWT-based session with configurable max age (30 days)

#### Database Session Tracking
- Added `UserSession` model to Prisma schema for tracking active user sessions
- Sessions stored with: userId, ipAddress, userAgent, deviceInfo, location, expiresAt
- Automatic session creation on login, invalidation on logout

#### Admin Session Management
- New admin page at `/admin/sessions`
- View all active sessions across the platform
- Filter sessions by user ID
- Invalidate individual sessions or all sessions for a user
- Session statistics: total, active, expired, users with sessions

#### API Endpoints
- `GET /api/admin/sessions` - Get all active sessions (admin only)
  - Query params: `userId`, `includeUser`
- `POST /api/admin/sessions` - Manage sessions (admin only)
  - Actions: `invalidate`, `invalidateAll`

#### Files Changed
- `lib/auth.config.ts` - Enhanced cookie security settings
- `lib/auth.ts` - Added session creation/invalidation on login/logout
- `lib/services/sessionService.ts` - New service for session management
- `prisma/schema.prisma` - Added UserSession model
- `app/api/admin/sessions/route.ts` - New API route
- `app/admin/sessions/page.tsx` - Admin session management UI
- `app/Header.tsx` - Removed localStorage usage
- `app/auth/signin/page.tsx` - Removed localStorage after login

---

## New Features (v1.7.0)

### Cron Config Management
Admin can manage scheduled tasks at `/admin/utils/cron`:
- **Create Cron Jobs**: Define name, description, task type, cron expression
- **Task Types**: Stock Sync, Corporate Actions, Alert Check, Screener, Recommendations, Market Data
- **Quick Presets**: Every 5/15 minutes, hourly, daily (6/9 AM, 6 PM), weekly, monthly
- **Status Tracking**: Total jobs, active jobs, total runs, failures

### Background Workers System
Async task queue at `/admin/utils/workers`:
- **Task Types**: stock_sync, corp_actions, alert_check, screener, recommendations, market_data, cleanup
- **Priority Support**: Tasks can have priority (1-10)
- **Retry Logic**: Configurable max retries
- **Status Tracking**: Pending, Running, Completed, Failed counts

### Worker Logging
File-based logging system:
- Logs stored in `worker_logs/` directory
- Each worker run creates a timestamped log file
- Added to `.gitignore` - not committed to repository

### Calendar View
Corporate actions calendar at `/markets/calendar`:
- Month view with corporate actions mapped to dates
- Filter by type: Dividend, Bonus, Split, Rights, Buyback, Events
- Navigation: Previous/Next month, Today button

### TradingView Integration
- Dashboard chart now shows "Open in TradingView" link
- Direct link to TradingView charts: `https://in.tradingview.com/chart/?symbol=NSE:{SYMBOL}`

### Financial Results Tab (v1.6.1 - Fixed)
URL: `/markets/analytics?tab=financial-results`
- NSE-format table with quarters as columns
- Metrics as rows: Revenue, Other Income, Total Income, Expenses, PBT, Tax, Net Profit, EPS, Depreciation, Finance Costs
- Search with autocomplete for stock symbols

---

## New Features (v1.6.1)

### Bug Fixes
- **Corporate Actions Dividend/Yield**: Fixed columns showing "-" instead of actual values. Dividend amounts and yield percentages now display correctly (e.g., ₹6 with 600.00% yield for RSYSTEMS, ₹2 with 20.00% yield for IOC)
- **Audit Logs**: Added Method, Path, Status, Speed columns to show detailed request information

### Financial Results Tab
Added new "Financial Results" tab in Analytics with NSE-format table:
- **Quarters as Columns**: Shows up to 5 quarters horizontally (like NSE website)
- **Metrics as Rows**: Revenue from Operations, Other Income, Total Income, Total Expenses, PBT, Tax, Net Profit, EPS, Depreciation, Finance Costs
- **Search with Autocomplete**: Enter stock symbol (e.g., ITC, RELIANCE, TCS) to view financial comparison
- **Period Information**: Shows Quarterly/Annual, Audited/Unaudited labels

### Stock List Sync
Added Stock List Sync feature to admin panel:
- Sync stocks from NIFTY TOTAL MARKET index
- TOTAL tile for one-click complete market sync
- Auto-fetch from NSE when autocomplete is empty

---

## New Features (v1.6.0)

### Historical Data Sync from NSE

The admin panel now supports fetching and syncing historical data from NSE India with custom date ranges:

**NSE API Endpoints:**
| Data Type | Daily URL | Historical URL |
|-----------|-----------|----------------|
| Corporate Actions | `api/corporates-corporateActions?index=equities` | `api/corporates-corporateActions?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY` |
| Corporate Announcements | `api/corporate-announcements?index=equities` | `api/corporate-announcements?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY` |
| Event Calendar | `api/event-calendar?` | `api/event-calendar?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY` |
| Financial Results | `api/corporates-financial-results?index=equities&period=Quarterly` | N/A |
| Insider Trading | `api/cmsNote?url=corporate-filings-insider-trading` | `api/corporates-pit?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY` |

**Admin Panel Features:**
- Date range selector (DD-MM-YYYY format)
- Multi-select data types to sync
- Optional symbol filter for announcements
- Batch sync for multiple data types at once
- Records saved to database for offline access

**API Routes:**
- `GET /api/admin/nse/historical` - Fetch historical data
- `POST /api/admin/nse/historical` - Batch sync with multiple data types

**CSV Import:**
The ingest CSV page now supports additional data types:
- Block Deals
- Bulk Deals
- Short Selling
- Corporate Actions (with CSV format: SYMBOL, COMPANY NAME, SERIES, PURPOSE, FACE VALUE, EX-DATE, RECORD DATE, etc.)
- Corporate Announcements

---

## Tested Features (v1.5.0)

### Live Site: https://tradenext6.netlify.app/

| Feature | Status | Details |
|---------|--------|---------|
| Authentication | ✅ | Demo: demo@tradenext6.app / demo123 |
| Portfolio | ✅ | Holdings: RELIANCE (200 qty), TCS (100 qty), Total: ₹5,22,780 |
| Markets | ✅ | NIFTY 50, BANK, IT, MIDCAP, SMALLCAP, AUTO, PHARMA |
| Analytics | ✅ | 13 tabs: Advances/Declines, Corporate Info, Announcements, Corp Events, Dividends/Splits/Bonus, Insider Trading, Block Deals, Bulk Deals, Short Selling, Bulk/Large Deals, Most Active, Top Gainers, Top Losers |
| Corporate Actions | ✅ | Type filters (10 Dividend, 2 Bonus), search, pagination |
| News | ✅ | 28 articles, India/Global filters |
| Stock Screener | ✅ | 17 stocks, filters: sector, price range, P/E, volume, % change |
| Admin Panel | ✅ | Overview, Users (7), Alerts, Recommendations, Holdings, Audit Logs |
| Watchlist | ✅ UI | Empty state (expected) |
| Alerts | ✅ UI | Empty state (expected) |

### Known Bugs
- **Corporate Actions - Price Column**: Shows "-" instead of actual stock prices
- **Corporate Actions - Yield Column**: Shows "-" instead of computed dividend yield percentages

---

## New Features (v1.4.0)

### Enhanced Corporate Actions

The Corporate Actions table (`/markets/analytics?tab=corporate-actions`) has been greatly enhanced:

- **Dividend Yield Display**: Shows dividend per share (₹) and computed yield percentage (%) directly in the table
- **API Enrichment**: The combined corporate actions API now fetches latest close prices and calculates dividend yield: `dividendYield = (dividendPerShare / currentPrice) * 100`
- **DataTable Sorting**: All column headers are clickable for sorting (symbol, company, type, dividend, yield, ex date, etc.)
  - Supports numeric, string, and date sorting
  - Visual sort indicators (▲/▼)
- **Type Filtering**: Click on summary stat tiles to filter by action type (Dividend, Split, Bonus, Rights, Buyback, etc.)
- **Search**: Full-text search across symbol and company name with live results count
- **Pagination**: Client-side pagination with smart page navigation (shows ellipsis for large page counts)
- **Upcoming Table Improvements**:
  - Expandable view: Click "View all" to show all upcoming actions inline (toggle between 5 and all)
  - Date formatting with day of week: `01-APR-2026 (Thursday)`
  - Handles both ISO (from NSE) and DD-MMM-YYYY formats robustly via `lib/utils/date-utils.ts`
  - Type badges with icons: 💰 Dividend, ✂️ Split, 🎁 Bonus, 📈 Rights, 🔄 Buyback
  - Urgency-based row highlighting: Red (0-2 days), Yellow (3-7 days), Blue (8-30 days)
  - Dividend info prominently displayed in green with larger font
- **UX Polish**: Clean filters bar, results count, clear all filters button, responsive design

API Reference: `/api/corporate-actions/combined` (with optional pagination: `?page=1&limit=50`)

### DataTable Component Enhancement

The `DataTable` component (used by `PaginatedDataTable`) has been upgraded with:

- Proper multi-type sorting (numbers, strings, dates)
- Null-safe sorting (nulls sorted to bottom)
- Clickable column headers with visual indicators
- Configurable alignment (left/right)
- Flexible for any data shape

This improvement benefits:
- Most Active (`/markets/analytics?tab=most-active`)
- Top Gainers (`/markets/analytics?tab=gainers`)
- Top Losers (`/markets/analytics?tab=losers`)
- Advance/Declines (`/markets/analytics?tab=advance`)
- Corporate Actions (as above)

### Advance/Decline Fix

The Advance/Decline tab now correctly displays the market breadth counts (Advances, Unchange, Declines, Total) as clickable cards. The previous implementation expected individual stock data which was not available from the API.

---

## New Features (v1.3.0)

### Corporate Actions Management

- Admin can upload corporate actions via CSV or manual form at `/admin/corporate-actions`
- CSV format follows NSE: SYMBOL, COMPANY NAME, SERIES, PURPOSE, FACE VALUE, EX-DATE, RECORD DATE, BOOK CLOSURE START DATE, BOOK CLOSURE END DATE
- System parses purpose to determine action type: DIVIDEND, BONUS, RIGHTS, SPLIT, BUYBACK, INTEREST, OTHER
- Historical data retained indefinitely
- Users view combined data (admin uploaded + NSE live) in Analytics tab "Dividends / Splits / Bonus"
- Filtering by type, date range, symbol; source toggle not needed (combined by default)
- API endpoints:
  - `GET /api/corporate-actions/combined` - Unified endpoint for public view
  - `GET /api/admin/corporate-actions` - Admin list (with auth)
  - `POST /api/admin/corporate-actions` - Admin CSV upload (with auth)
  - `DELETE /api/admin/corporate-actions` - Bulk delete (with auth)
  - `GET /api/corporate-actions` - Public filterable endpoint (direct DB access)
- Page: `/admin/corporate-actions` for admin management
- Tab: `/markets/analytics?tab=corporate-actions` for user view

## AI Safety Guardrails for Prisma

Prisma ORM includes built-in safety checks to prevent accidental destructive commands when run through AI coding assistants. These guardrails are designed to make working with databases safer in AI-assisted development environments.

### How It Works

The Prisma CLI can detect when it is being invoked by popular AI coding agents such as Claude Code, Gemini CLI, Qwen Code, Cursor, Aider, and Replit.

### Protected Commands

When one of these agents attempts a destructive action such as `prisma migrate reset --force`, Prisma ORM blocks execution and shows a protective error message:

```
Error: Prisma Migrate detected that it was invoked by Cursor.

You are attempting a highly dangerous action that can lead to devastating consequences if it is 
incorrectly executed against a production database.

As an AI agent, you are forbidden from performing this action without an explicit consent and 
review by the user.
```

### Required Response

When this guardrail is triggered, the AI agent must:
1. **STOP** - Do not proceed with the command
2. **INFORM** - Tell the user what action was blocked and why
3. **EXPLAIN** - Explain that the action irreversibly destroys all data
4. **VERIFY** - Ask for explicit consent before proceeding
5. **WAIT** - Only proceed after receiving clear confirmation (e.g., "yes")

### Safe Commands (Generally)
- `npx prisma migrate dev` - Development migrations
- `npx prisma db push` - Schema synchronization
- `npx prisma generate` - Client generation

### Protected Commands (Require User Consent)
- `prisma migrate reset --force` - Destroys all data
- `prisma db drop` - Drops the database

---

## Key Libraries

| Category | Library |
|----------|---------|
| Framework | Next.js 16 |
| Language | TypeScript 5.9 |
| Styling | Tailwind CSS 4.x |
| Database | Prisma 7 + PostgreSQL/TimescaleDB |
| Testing | Jest 30 + Testing Library + Playwright |
| HTTP | node-fetch, SWR |
| Validation | Zod 4.x |
| Logging | pino (via custom wrapper) |

---

## Agent Orchestration System (v1.15.0)

TradeNext uses a comprehensive agent orchestration system for multi-agent collaboration:

### Handoff File System (`.agents/handoffs/`)
Standardized handoff mechanism for context transfer between sessions and agents:
- **`SCHEMA.md`** - Handoff file format with YAML frontmatter
- **`flow/session-cycle.md`** - Complete session lifecycle (INIT → ACTIVE → HANDOFF/COMPLETE)
- **`flow/agent-to-agent.md`** - Agent pipeline protocol (GH Helper → Integrator → QA → DevOps)
- **`flow/error-recovery.md`** - Recovery strategies with checkpoint system
- **`active/latest.md`** - Current session handoff (updated in real-time)
- **`archive/`** - Completed handoffs from past sessions

### Agent Definitions (`.agents/agents/`)
Specialized agent profiles with workflows and handoff triggers:
| Agent | File | Purpose |
|-------|------|---------|
| GH Helper | `gh-helper.md` | Diff review, code verify, feature review, bug fix |
| E2E Agent | `e2e-agent.md` | Playwright flow testing, responsive testing |
| Integrator | `integrator.md` | Merge/conflict resolution, schema migration |
| Observability | `observability.md` | Logging audit, metrics, security, performance |
| DevOps | `devops.md` | Docker, Vercel, Netlify, CI/CD, environments |
| QA | `qa.md` | Jest/Playwright testing, regression detection |
| Code Reviewer | `code-reviewer.md` | Senior-level code quality review |
| TDD Guide | `tdd-guide.md` | Test-driven development workflow |

### Self-Learning Loop (`.agents/learning/`)
Continuous improvement through systematic reflection:
- **`README.md`** - Learning loop process and maturity model
- **`session-log.md`** - Session outcome tracking with metrics
- **`patterns/`** - Reusable patterns extracted from work

### Agent Commands (`.agents/commands/`)
| Command | File | Purpose |
|---------|------|---------|
| `/handoff` | `handoff.md` | Create handoff to another agent or archive session |
| `/self-learn` | `self-learn.md` | Trigger self-learning loop and pattern extraction |
| `/review-diff` | `review-diff.md` | Full diff review with security/quality checks |

### Git Hooks (`.git/hooks/`)
| Hook | Purpose |
|------|---------|
| `pre-commit` | Code quality checks, secrets detection |
| `post-commit` | Activity logging, handoff checkpoint tracking |

### Root Orchestration
- **`HANDOFF.md`** - Central orchestration state (MUST read at session start)
- Reads: `HANDOFF.md` → `latest.md` → `Primer.md` → `Lessons.md`

## Agent Documentation Files

This project uses additional documentation for agent sessions:

| File | Purpose |
|------|---------|
| `Primer.md` | Session tracking - read at start of every session |
| `agent-memory.md` | Activity log - tracks all agent work |
| `Lessons.md` | Rules & corrections - read before every commit |
| `HANDOFF.md` | Root orchestration state - read at start of every session |
| `.agents/handoffs/active/latest.md` | Current session handoff state |

### ⚠️ MANDATORY: Code Hygiene & Artifact Cleanup

**ALWAYS clean up artifacts before committing.** Playwright CLI, build tools, and tests generate temp files that must not enter git history.

**Checklist before every commit:**
```markdown
- [ ] Run `git status` — review ALL untracked and modified files
- [ ] Delete junk artifacts: Playwright snapshots (`*.yaml`), screenshots, temp logs (`dev-server.log`, etc.)
- [ ] Verify `.gitignore` covers new artifact patterns (add if missing)
- [ ] Check no secrets/tokens/passwords in the diff
- [ ] Ensure no dead code, commented-out code, or debug `console.log` statements
- [ ] Review diff size — if unexpectedly large, investigate each file
```

**Common junk files to watch for:**
| File | Source | Action |
|------|--------|--------|
| `*.yaml` (root) | `npx playwright-cli snapshot` without `--filename` | Delete or use `--filename=.playwright-cli/snapshots/` |
| `dev-server.log`, `next-dev.log` | `npm run dev` redirected to file | Delete |
| `screenshot-*.png` | Playwright CLI `screenshot` command | Delete or move to `e2e-screenshots/` |
| `worker_logs/` | Worker engine logging | Already in `.gitignore` |

### ⚠️ MANDATORY: Documentation Update Rule

**Documentation MUST be updated IMMEDIATELY after completing any implementation. This is NOT optional.**

After every change (bug fix, feature, refactoring), update these files:

1. **AGENTS.md**:
   - Add entry to "Version History" (top of file)
   - Add detailed section under "New Features" or "Bug Fixes"
   - List all files changed
   - Explain root cause (for bugs) or feature (for new features)

2. **Primer.md**:
   - Add to "Current Project Status" with issue/fix/status
   - Add entry to "Session History"

3. **agent-memory.md**:
   - Add detailed activity log entry with files and root cause

4. **Lessons.md**:
   - Add new lesson if new pattern or bug discovered
   - Update "Last Updated" and "Update Log"

**If documentation is not updated, the task is NOT complete.**

### Usage

1. **Start of session**: Read `HANDOFF.md` to understand orchestration state
2. **During work**: Log activities in `agent-memory.md`, update `latest.md` handoff
3. **Before commit**: Read `Lessons.md` to apply rules
4. **End of session**: Update `Primer.md` with progress, archive handoff

---

## Common Patterns

### Caching
Use the centralized cache system in `@/lib/enhanced-cache`:

```typescript
const cacheConfig = nseCache.stockQuote(symbol);
const data = await enhancedCache.getWithCache(cacheConfig, fetchFn, pollingConfig);
```

### API Fetching
Use `nseFetch` for NSE API calls, which handles cookies and caching:

```typescript
const data = await nseFetch("/api/endpoint", "?param=value");
```

### Background Sync
Fire-and-forget with `.catch()` to avoid blocking responses:

```typescript
syncService.syncFinancials(symbol, data).catch(err =>
  logger.error({ msg: "Financial sync failed", symbol, error: err })
);
```

---

## Agent Lessons Learned (v1.8.0)

### Next.js 16 Runtime Guidelines

1. **Always specify runtime for API routes and auth**
   - Use `export const runtime = 'nodejs'` for routes using Prisma, Node.js APIs, or crypto
   - Auth routes (`app/api/auth/[...nextauth]`) MUST use Node.js runtime
   - Middleware should use `nodejs` runtime (not `edge`) when using Prisma

2. **Fixing Edge Runtime Crypto Errors**
   - Error: "The edge runtime does not support Node.js 'crypto' module"
   - Solution: Add `export const runtime = 'nodejs'` to the affected route file
   - Files that MUST use Node.js: `app/api/auth/[...nextauth]/route.ts`, `lib/auth.ts`

3. **Build Cache Issues**
   - When errors persist after fixes, delete `.next` folder and restart dev server
   - Command: `Remove-Item -Recurse -Force .next` (PowerShell)

### Prisma Best Practices

1. **Always regenerate client after schema changes**
   ```bash
   npx prisma generate
   ```

2. **Run migrations for schema changes**
   ```bash
   npx prisma migrate dev --name migration_name
   ```

3. **Database Sync Issues**
   - If tables don't exist despite migration showing "in sync", try:
   ```bash
   npx prisma db push --force-reset
   ```
   - This resets the database and syncs all tables
   - Note: This deletes all data - use carefully on production

4. **Prisma Guardrails**
   - AI agents CANNOT run destructive commands without explicit user consent
   - Protected: `migrate reset --force`, `db drop`
   - Safe: `migrate dev`, `db push`, `generate`

### Session Management

1. **Secure Session Implementation**
   - Use httpOnly, secure, sameSite:strict cookies
   - NEVER store user data in localStorage (XSS vulnerability)
   - Use NextAuth's built-in session handling

2. **Database Session Tracking**
   - Create a UserSession model with: userId, ipAddress, userAgent, deviceInfo, expiresAt
   - Use Web Crypto API (`crypto.getRandomValues()`) instead of Node.js crypto for compatibility

3. **Request Info in Server Actions**
   - Use `cookies()` from `next/headers` to get request details
   - Wrap in try-catch as request info may not always be available

### Testing with Playwright

1. **Always clean up after testing**
   - Kill dev server processes after testing
   - Check ports: 3000, 3001
   - Don't kill port 4096 (OpenCode web UI)

2. **Common credentials for testing**
   - Demo: demo@tradenext6.app / demo123
   - Admin: admin@tradenext6.app / admin123

3. **Playwright CLI Testing Workflow** (Required for UI Changes)
   - Start dev server if needed: `npm run dev`
   - Open browser: `playwright-cli open http://localhost:3000`
   - Test login flow: Fill credentials → Submit → Verify redirect
   - Test navigation: Click menu items → Verify page loads
   - Test forms: Fill fields → Submit → Verify success/error state
   - Test responsive: Resize to mobile (375x667), tablet (768x1024), desktop (1920x1080)
   - Check console errors: `playwright-cli console error`
   - Cleanup: `playwright-cli close`

4. **Required Checklist Items** (Must pass before finalizing UI changes)
   - [ ] Start dev server if needed
   - [ ] Test login page loads
   - [ ] Test login with demo credentials
   - [ ] Test UI changes render correctly
   - [ ] Check responsive behavior
   - [ ] Verify dark/light mode if applicable
   - [ ] Test form submissions and interactions
   - [ ] Check console errors
   - [ ] Cleanup dev server processes

5. **Documentation**
   - See `.agents/skills/playwright-cli/AGENT-TESTING-GUIDE.md` for complete testing guide
   - See `.agents/skills/playwright-cli/SKILL.md` for CLI command reference
   - Run `npx playwright-cli --help` for available commands

### Switch Case Best Practices

Always use block scope `{}` for switch cases to avoid variable hoisting:

```typescript
// ✅ Correct - each case has its own scope
switch (type) {
  case "alerts": {
    const alerts = await getAnomalyAlerts(50, false);
    return NextResponse.json(alerts);
  }
  default: {
    const data = await getData();
    return NextResponse.json(data);
  }
}

// ❌ Wrong - variables leak between cases
switch (type) {
  case "alerts":
    const alerts = await getAnomalyAlerts(50, false); // Error if another case uses 'alerts'
    return NextResponse.json(alerts);
}

---

## MCP API (Machine Communication Protocol)

TradeNext provides a unified MCP API endpoint for external systems to query NSE data programmatically.

### Endpoint

```
POST /api/mcp
GET  /api/mcp?function=xxx&symbol=yyy
```

### Authentication

Optional API key authentication via `x-api-key` header:

```bash
curl -X POST https://tradenext6.netlify.app/api/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{"function": "getStockQuote", "parameters": {"symbol": "RELIANCE"}}'
```

Configure `MCP_API_KEY` in your environment to enable authentication.

### Request Format

**POST (JSON)**:
```json
{
  "function": "getStockQuote",
  "parameters": {
    "symbol": "RELIANCE"
  }
}
```

**GET**:
```
GET /api/mcp?function=getStockQuote&symbol=RELIANCE
```

### Response Format

```json
{
  "success": true,
  "function": "getStockQuote",
  "data": { ... },
  "timestamp": "2026-03-27T12:00:00.000Z"
}
```

### Available Functions (22 Total)

| Function | Description | Parameters |
|----------|-------------|------------|
| `listFunctions` | List all available functions | - |
| `help` | Get usage help and examples | - |
| `describe` | Get function description | `functionName` |
| `schema` | Get JSON schema for function | `functionName` |
| `getIndexData` | All market indices | - |
| `getMarketIndices` | Specific index data | `indexName` |
| `getStockQuote` | Real-time quote | `symbol` (required) |
| `getStockChart` | Historical chart | `symbol`, `period`, `interval` |
| `getGainers` | Top gainers | `indexName` |
| `getLosers` | Top losers | `indexName` |
| `getMostActive` | Most active stocks | `indexName` |
| `getAdvanceDecline` | Market breadth | `indexName` |
| `getCorporateActions` | Corporate actions | `indexName` |
| `getCorporateInfo` | Company info | `symbol` |
| `getMarquee` | Scrolling data | - |
| `getDeals` | Block/Bulk deals | `mode` |
| `getAnnouncements` | Corporate announcements | `symbol`, `indexName` |
| `getInsiderTrading` | Insider trading | - |
| `getEvents` | Events calendar | - |
| `getHeatmap` | Sector heatmap | `indexName` |
| `getSymbols` | Index constituents | `indexName` |
| `getTrends` | Stock trends | `symbol` |

### Examples

**Get stock quote:**
```bash
curl -X POST https://tradenext6.netlify.app/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"function": "getStockQuote", "parameters": {"symbol": "TCS"}}'
```

**Get market indices:**
```bash
curl -X POST https://tradenext6.netlify.app/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"function": "getIndexData"}'
```

**Get top gainers:**
```bash
curl -X POST https://tradenext6.netlify.app/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"function": "getGainers", "parameters": {"indexName": "NIFTY 50"}}'
```

**Discover available functions:**
```bash
curl -X POST https://tradenext6.netlify.app/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"function": "listFunctions"}'
```

### Caching

All responses are cached for performance:
- Stock quotes: 60 seconds
- Market data: 2 minutes
- Corporate actions: 5 minutes
- Company info: 1 hour
- Index constituents: 1 hour

### Error Handling

```json
{
  "error": "Bad Request",
  "message": "Missing required parameter: symbol",
  "function": "getStockQuote"
}
```

### Integration

The MCP API can be used by:
- External trading systems
- Mobile apps
- Third-party dashboards
- AI agents and chatbots
- Custom analysis tools
```
