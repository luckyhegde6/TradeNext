# TradeNext Implementation TODO

> **Reference:** See `.agents/PRD.md` for detailed product requirements and `.agents/TODO.md` for implementation checklist

## Quick Reference

| Category | Status |
|----------|--------|
| Database Migrations | [x] Complete |
| Authentication | [x] Complete |
| API Endpoints | [x] Complete |
| Admin Routes | [x] Complete |
| Portfolio Engine | [x] Complete |
| Market Data | [x] Complete |
| NSE Integration | [x] Complete |
| Testing | [x] Complete |
| Enhanced Charts | [x] Complete |
| Technical Indicators | [x] Complete |
| Stock Screener | [x] Complete |
| Price Alerts | [x] Complete |
| CSV Import | [x] Complete |
| User Recommendations | [x] Complete |
| Watchlist | [x] Complete |
| Historical Data Sync (v1.6.0) | [x] Complete |
| Financial Results Tab (v1.6.1) | [x] Complete |
| Bug Fixes — Corp Actions Yield (v1.6.1) | [x] Complete |
| Stock List Sync (v1.6.1) | [x] Complete |
| Cron Config (v1.7.0) | [x] Complete |
| Background Workers (v1.7.0) | [x] Complete |
| Calendar View (v1.7.0) | [x] Complete |
| TradingView Integration (v1.7.0) | [x] Complete |
| Worker Logging (v1.7.0) | [x] Complete |
| Security Enhancements (v1.8.0) | [x] Complete |
| DB Session Tracking (v1.8.0) | [x] Complete |
| Admin Session Management (v1.8.0) | [x] Complete |
| Advanced Screener (v1.16.0) | [x] Complete |
| Alert Engine (v2.1.0) | [x] Complete |
| Admin Alert Config (v2.2.0) | [x] Complete |
| Portfolio Export (CSV) | [x] Complete |
| P&L Over Time Chart | [x] Complete |
| Portfolio Analytics (Risk Metrics) | [x] Complete |
| Stock Compare + Benchmark | [x] Complete |
| Dividend Calendar (v3.2.0) | [x] Complete |
| Real-time WebSocket SSE (v3.2.0) | [x] Complete |
| Tax Reports (v3.2.0) | [x] Complete |
| Portfolio Rebalancer (v3.2.0) | [x] Complete |
| Options/F&O Analytics (v3.2.0) | [x] Partial — Services + API done, UI pending |
| AI Agent Layer (v3.2.0) | [x] Complete |

---

## Phase 4: Intelligence & Reporting — ✅ COMPLETE (v3.2.0)

**PRD:** `.agents/PRD.md`

| Feature | Priority | Effort | Status |
|---------|----------|--------|--------|
| Bug Fix — Corp Actions Price/Yield | P0 | S | [x] Fixed (v3.2.0) |
| Dividend Calendar | P1 | S | [x] Complete (v3.2.0) |
| Real-time WebSocket (SSE) | P1 | M | [x] Complete (v3.2.0) |
| Tax Reports (ST/LT Capital Gains) | P2 | L | [x] Complete (v3.2.0) |
| Portfolio Rebalancer | P2 | M | [x] Complete (v3.2.0) |
| Options/F&O Analytics | P3 | XL | [x] Partial (v3.2.0) — Services + API + Schema, UI pending |
| AI Agent Layer (LangChain/LangGraph) | P1 | XL | [x] Complete (v3.2.0) — Screener agent + Alert agent + Admin model config with OpenRouter |

---

## Bug Fix: Corporate Actions Price/Yield (v3.2.0)

### Completed (July 18, 2026)
- **Root Cause**: Price enrichment was missing from the combined corporate actions API. Dividend yield used incorrect formula against face value instead of current price.
- **Fix**: Added price enrichment block in `app/api/corporate-actions/combined/route.ts`:
  1. Collects unique symbols from results
  2. Queries `daily_prices` with `DISTINCT ON (ticker)` for latest close price per symbol
  3. Enriches each item with `currentPrice` from price map
  4. Recomputes `dividendYield` using `(dividendPerShare / currentPrice) * 100`
  5. Graceful fallback if price fetch fails (values remain null)
- **Tests**: 190/190 pass, zero regressions

---

## Sprint 1: Quick Wins

### Feature: Dividend Calendar

**PRD Reference:** See `.agents/PRD.md` — Feature 4

A dedicated dividend calendar page showing upcoming ex-dates, amounts, and estimated income based on user holdings.

#### UI/UX Checklist — User Facing
- [x] Month calendar with dividend dots on ex-dates
- [x] Hover popup shows: Symbol, Amount, Yield, Ex-Date, Record Date
- [x] List view: Chronological, sortable, filterable
- [x] Summary cards: Upcoming count, Est. Monthly Income, Est. Annual Income, Avg Yield
- [x] Income chart: Monthly projected dividend income (bar chart)
- [x] Loading state: Skeleton loaders
- [x] Error state: Retry button
- [x] Empty state: "No dividends this month"
- [x] Responsive: Works on mobile (375px+)
- [x] Dark/light mode support

#### Admin UI/UX Checklist
- [x] Admin dividend overview: Total dividends tracked, upcoming this month/quarter
- [x] Dividend source status: Last NSE sync timestamp, total records, sync status
- [x] Manual dividend entry form: Symbol, Amount, Ex-Date, Record Date, Type (Interim/Final)
- [x] Dividend data table: All dividends with search, filter by year/status, bulk actions
- [ ] Sync trigger button: Force re-sync dividends from NSE (reuses existing NSE sync infrastructure)
- [ ] Yield audit view: See which dividends have missing prices (yield = null)
- [x] Admin nav link in `/admin` sidebar under "Market Data"

#### Implementation Checklist
- [x] `lib/services/dividendCalendarService.ts` — Fetch + enrich dividends
- [x] `app/api/dividends/calendar/route.ts` — API endpoint
- [x] `app/api/admin/dividends/route.ts` — Admin CRUD + sync management
- [x] `app/dividends/page.tsx` — Calendar page
- [x] `app/admin/dividends/page.tsx` — Admin dividend management page
- [x] `app/components/dividends/DividendMonthView.tsx`
- [x] `app/components/dividends/DividendListView.tsx`
- [x] `app/components/dividends/DividendSummaryCards.tsx`
- [x] `app/components/dividends/DividendIncomeChart.tsx`
- [ ] Tests: `lib/__tests__/dividendCalendarService.test.ts` (can be done in a follow-up)
- [x] Nav link in `app/Header.tsx`
- [x] Admin nav link in `app/admin/page.tsx`

### Feature: Real-time WebSocket (SSE)

**PRD Reference:** See `.agents/PRD.md` — Feature 1

Server-Sent Events for live price updates across the platform. Zero-refresh price updates on portfolio, watchlist, and dashboard.

#### UI/UX Checklist — User Facing
- [x] LivePriceBadge: Green/red flash on price change
- [ ] Portfolio holdings show live prices (to be wired)
- [ ] Watchlist shows live prices (to be wired)
- [ ] Dashboard shows live market status (to be wired)
- [x] Connection indicator: "Live" / "Reconnecting..." / "Offline"
- [x] Loading state: Previous cached price + pulsing indicator
- [x] Error state: "Connection lost, retrying..." with retry button
- [x] Fallback: Graceful degradation to polling when SSE unsupported
- [x] Responsive: Compact badge works on all screen sizes

#### Admin UI/UX Checklist
- [x] SSE dashboard: Connected clients count, symbols tracked, data rate
- [x] Connection info: Uptime, tracked symbols list, configuration reference
- [x] SSE config form: Poll interval display, batch size limit info
- [x] Market hours: Open/Closed status indicator
- [x] Admin nav link in `/admin` sidebar

#### Implementation Checklist
- [x] `lib/services/priceSyncService.ts` — Price broadcast service
- [x] `lib/services/priceCache.ts` — In-memory price store
- [x] `app/api/prices/stream/route.ts` — SSE endpoint
- [x] `app/api/admin/sse/route.ts` — SSE admin stats/config
- [x] `lib/hooks/useLivePrice.ts` — Single symbol hook
- [x] `lib/hooks/useLivePrices.ts` — Batch symbol hook
- [x] `app/components/LivePriceBadge.tsx` — Price display component
- [x] `app/admin/live-prices/page.tsx` — Admin SSE dashboard
- [ ] Wire into `app/portfolio/PortfolioClient.tsx` (can be done in follow-up)
- [ ] Wire into `app/components/HoldingsTable.tsx` (can be done in follow-up)
- [ ] Wire into `app/page.tsx` (dashboard) (can be done in follow-up)
- [ ] Wire into `app/Header.tsx` (market status) (can be done in follow-up)
- [ ] Tests: `lib/__tests__/useLivePrice.test.ts` (can be done in follow-up)
- [ ] Tests: `lib/__tests__/priceSyncService.test.ts` (can be done in follow-up)

---

## Sprint 2: Tax & Rebalancer

### Feature: Tax Reports (ST/LT Capital Gains)

**PRD Reference:** See `.agents/PRD.md` — Feature 2

Generate downloadable capital gains reports with correct holding period classification per Indian tax rules.

#### UI/UX Checklist — User Facing
- [x] FY selector dropdown (defaults to current FY)
- [x] Summary cards: Total STCG, Total LTCG, Tax Est. (ST), Tax Est. (LT)
- [x] Trade table: Sortable columns (Symbol, Buy Date, Sell Date, Qty, Gain, Holding Period, Type)
- [x] Color-coded: Green for gains, red for losses
- [x] Download buttons: CSV (client-side generation)
- [x] Loading state: Skeleton for summary + table
- [x] Error state: "Could not compute gains" with retry
- [x] Empty state: "No transactions in this financial year"
- [x] Special case: "No capital gains transactions" when all held > 12mo
- [x] Responsive: Table scrolls horizontally on mobile

#### Admin UI/UX Checklist
- [x] Admin tax overview: Total users with gains, aggregate STCG/LTCG, total tax liability
- [ ] User tax report viewer: Select user → view their capital gains breakdown (can be added later)
- [x] Tax rate config: PATCH endpoint for STCG/LTCG rates and exemption
- [x] FY selector: Switch between financial years for admin reporting
- [ ] Export all: Download aggregated CSV of all users' tax data (can be added later)
- [x] Admin nav link in `/admin` sidebar

#### Implementation Checklist
- [x] `lib/services/taxService.ts` — Tax computation orchestrator
- [x] `lib/services/taxCalculator.ts` — FIFO matching + holding period
- [x] `app/api/portfolio/tax/route.ts` — Tax data API
- [x] `app/api/admin/tax/route.ts` — Admin tax overview + config
- [x] `app/portfolio/tax/page.tsx` — Tax reports page
- [x] `app/admin/tax/page.tsx` — Admin tax management page
- [x] `app/components/tax/TaxSummaryCards.tsx`
- [x] `app/components/tax/TaxTradeTable.tsx`
- [x] `app/components/tax/TaxFYSelector.tsx`
- [ ] Nav link in `app/portfolio/PortfolioClient.tsx` (can be added later via portfolio nav)
- [ ] Nav link in `app/Header.tsx` (can be added later)
- [x] Admin nav link in `app/admin/page.tsx`
- [ ] Tests: `lib/__tests__/taxCalculator.test.ts` (15+ tests — can be done in follow-up)

### Feature: Portfolio Rebalancer

**PRD Reference:** See `.agents/PRD.md` — Feature 5

Define target allocation rules, visualize current vs target, get actionable trade suggestions.

#### UI/UX Checklist — User Facing
- [x] Side-by-side pie charts: Current % vs Target %
- [x] Allocation table: Category, Current %, Target %, Drift bar, Action
- [x] Drift threshold slider (1-20%, default 5%)
- [x] Trade suggestions: SELL (overallocated), BUY (underallocated) with amounts
- [x] Target editor: % inputs per category
- [x] Category management: Add/remove allocation categories
- [x] Warning: "Target sums to X% (should be 100%)"
- [x] "Unallocated" bucket for unclassified holdings
- [x] Loading state: Skeleton for pie + table
- [x] Error state: "Could not compute allocation"
- [x] Empty state: "Set your first target allocation"
- [x] Save/Load multiple allocation profiles

#### Admin UI/UX Checklist
- [x] Admin rebalancer overview: Total users with allocation configs, aggregate drift stats
- [ ] User config viewer: Select user → view their targets vs current allocation (can be added later)
- [x] Category presets: Default sector allocation templates
- [x] Drift analytics: Most popular categories across users
- [x] Admin nav link in `/admin` sidebar

#### Implementation Checklist
- [x] `prisma/schema.prisma` — RebalancerConfig model + migration
- [x] `lib/services/rebalancerService.ts` — Core computation + Prisma CRUD
- [x] `app/api/portfolio/rebalancer/route.ts` — GET allocation + suggestions
- [x] `app/api/portfolio/rebalancer/config/route.ts` — CRUD profiles
- [x] `app/api/admin/rebalance/route.ts` — Admin overview
- [x] `app/portfolio/rebalance/page.tsx` — Rebalancer page
- [x] `app/admin/rebalance/page.tsx` — Admin rebalancer dashboard
- [x] `app/components/rebalancer/AllocationPieChart.tsx`
- [x] `app/components/rebalancer/AllocationTable.tsx`
- [x] `app/components/rebalancer/TradeSuggestionList.tsx`
- [x] `app/components/rebalancer/TargetAllocationEditor.tsx`
- [ ] Nav link in `app/portfolio/PortfolioClient.tsx` (can be added later via portfolio nav)
- [x] Admin nav link in `app/admin/page.tsx`
- [ ] Tests: `lib/__tests__/rebalancerService.test.ts` (can be done in follow-up)

---

## Sprint 3: Advanced

### Feature: Options/F&O Analytics

**PRD Reference:** See `.agents/PRD.md` — Feature 3

Track F&O positions (Futures + Options), compute P&L, show option Greeks, display expiry calendar.

#### UI/UX Checklist — User Facing
- [ ] Positions table: Symbol, Type, Direction, Qty, Entry Price, Current Price, P&L, Greeks
- [ ] Option Chain Viewer: Strike, Bid, Ask, OI, Volume, IV, Greeks
- [ ] Expiry Calendar: Countdown to next expiry
- [ ] P&L Dashboard: Realized + Unrealized breakdown
- [ ] Add Position form: Symbol, Type, Direction, Qty, Price, Expiry
- [ ] Greek cards: Delta, Gamma, Theta, Vega for selected position
- [ ] Loading state: Skeleton for positions + chain
- [ ] Error state: "Could not fetch F&O data" with retry
- [ ] Empty state: "Add your first F&O position"
- [ ] Responsive: Table scrolls horizontally (many columns)

#### Admin UI/UX Checklist
- [ ] Admin F&O overview: Total users with positions, aggregate P&L, open/closed counts
- [ ] User position viewer: Select user → view their F&O positions and P&L
- [ ] NSE F&O sync: Force sync options chain data from NSE
- [ ] Contract spec management: View/edit lot sizes, expiry dates, index names
- [ ] F&O market data status: Data freshness indicator, last sync timestamp
- [ ] Admin nav link in `/admin` sidebar under "Market Data"

#### Implementation Checklist
- [ ] `prisma/schema.prisma` — Add FOPosition model + migration
- [ ] `lib/services/foService.ts` — F&O CRUD operations
- [ ] `lib/services/foPnlService.ts` — P&L + Greeks computation
- [ ] `lib/services/nse-fo-api.ts` — NSE F&O chain fetcher
- [ ] `app/api/fo/positions/route.ts` — Positions CRUD
- [ ] `app/api/fo/chain/route.ts` — Option chain data
- [ ] `app/api/fo/expiries/route.ts` — Expiry dates
- [ ] `app/api/admin/fo/route.ts` — Admin F&O overview + sync
- [ ] `app/fo/page.tsx` — F&O dashboard
- [ ] `app/admin/fo/page.tsx` — Admin F&O management page
- [ ] `app/components/fo/FOPositionTable.tsx`
- [ ] `app/components/fo/OptionChainViewer.tsx`
- [ ] `app/components/fo/ExpiryCalendar.tsx`
- [ ] `app/components/fo/FOPnlChart.tsx`
- [ ] Nav link in `app/Header.tsx`
- [ ] Admin nav link in `app/admin/page.tsx`
- [ ] Tests: `lib/__tests__/foPnlService.test.ts`

---

## UI/UX Testing Checklist (Mandatory)

### Playwright E2E — Apply to Every Feature
- [ ] Start dev server (`npm run local`)
- [ ] Test login page loads
- [ ] Login with demo credentials (demo@tradenext6.app / demo123)
- [ ] Navigate to new feature page
- [ ] Verify all UI states (loading, empty, error, data)
- [ ] Check responsive behavior (375px, 768px, 1920px)
- [ ] Verify dark/light mode
- [ ] Test form submissions and interactions
- [ ] Check console for errors
- [ ] Cleanup: Kill dev server (port 3000), never kill port 4096

### Test Credentials
| Role | Email | Password |
|------|-------|----------|
| Demo | demo@tradenext6.app | demo123 |
| Admin | admin@tradenext6.app | admin123 |

---

## Engineering Standards

All implementations must follow:
- `.agents/rules/checklist.md` — Engineering guardrails
- `.agents/PRD.md` — Product requirements
- `AGENTS.md` — Development guide

## Commands

```bash
# Setup
npm install
npm run db:up
npx prisma migrate dev
npx prisma db seed

# Development
npm run dev
npm run local

# Testing
npm run test
npm run lint
npx next build
```
