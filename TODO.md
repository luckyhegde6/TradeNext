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

---

## Phase 4: Intelligence & Reporting — 🚧 IN PROGRESS

**PRD:** `.agents/PRD.md`

| Feature | Priority | Effort | Status |
|---------|----------|--------|--------|
| Bug Fix — Corp Actions Price/Yield | P0 | S | [x] Fixed (v3.2.0) |
| Dividend Calendar | P1 | S | [ ] Not started |
| Real-time WebSocket (SSE) | P1 | M | [ ] Not started |
| Tax Reports (ST/LT Capital Gains) | P2 | L | [ ] Not started |
| Portfolio Rebalancer | P2 | M | [ ] Not started |
| Options/F&O Analytics | P3 | XL | [ ] Not started |

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

#### UI/UX Checklist
- [ ] Month calendar with dividend dots on ex-dates
- [ ] Hover popup shows: Symbol, Amount, Yield, Ex-Date, Record Date
- [ ] List view: Chronological, sortable, filterable
- [ ] Summary cards: Upcoming count, Est. Monthly Income, Est. Annual Income, Avg Yield
- [ ] Income chart: Monthly projected dividend income (bar chart)
- [ ] Loading state: Skeleton loaders
- [ ] Error state: Retry button
- [ ] Empty state: "No dividends this month"
- [ ] Responsive: Works on mobile (375px+)
- [ ] Dark/light mode support

#### Implementation Checklist
- [ ] `lib/services/dividendCalendarService.ts` — Fetch + enrich dividends
- [ ] `app/api/dividends/calendar/route.ts` — API endpoint
- [ ] `app/dividends/page.tsx` — Calendar page
- [ ] `app/components/dividends/DividendMonthView.tsx`
- [ ] `app/components/dividends/DividendListView.tsx`
- [ ] `app/components/dividends/DividendSummaryCards.tsx`
- [ ] `app/components/dividends/DividendIncomeChart.tsx`
- [ ] Tests: `lib/__tests__/dividendCalendarService.test.ts`
- [ ] Nav link in `app/Header.tsx`

### Feature: Real-time WebSocket (SSE)

**PRD Reference:** See `.agents/PRD.md` — Feature 1

Server-Sent Events for live price updates across the platform. Zero-refresh price updates on portfolio, watchlist, and dashboard.

#### UI/UX Checklist
- [ ] LivePriceBadge: Green/red flash on price change
- [ ] Portfolio holdings show live prices
- [ ] Watchlist shows live prices
- [ ] Dashboard shows live market status
- [ ] Connection indicator: "Live" / "Reconnecting..." / "Offline"
- [ ] Loading state: Previous cached price + pulsing indicator
- [ ] Error state: "Connection lost, retrying..." with retry button
- [ ] Fallback: Graceful degradation to polling when SSE unsupported
- [ ] Responsive: Compact badge works on all screen sizes

#### Implementation Checklist
- [ ] `lib/services/priceSyncService.ts` — Price broadcast service
- [ ] `lib/services/priceCache.ts` — In-memory price store
- [ ] `app/api/prices/stream/route.ts` — SSE endpoint
- [ ] `lib/hooks/useLivePrice.ts` — Single symbol hook
- [ ] `lib/hooks/useLivePrices.ts` — Batch symbol hook
- [ ] `app/components/LivePriceBadge.tsx` — Price display component
- [ ] Wire into `app/portfolio/PortfolioClient.tsx`
- [ ] Wire into `app/components/HoldingsTable.tsx`
- [ ] Wire into `app/page.tsx` (dashboard)
- [ ] Wire into `app/Header.tsx` (market status)
- [ ] Tests: `lib/__tests__/useLivePrice.test.ts`
- [ ] Tests: `lib/__tests__/priceSyncService.test.ts`

---

## Sprint 2: Tax & Rebalancer

### Feature: Tax Reports (ST/LT Capital Gains)

**PRD Reference:** See `.agents/PRD.md` — Feature 2

Generate downloadable capital gains reports with correct holding period classification per Indian tax rules.

#### UI/UX Checklist
- [ ] FY selector dropdown (defaults to current FY)
- [ ] Summary cards: Total STCG, Total LTCG, Tax Est. (ST), Tax Est. (LT)
- [ ] Trade table: Sortable columns (Symbol, Buy Date, Sell Date, Qty, Gain, Holding Period, Type)
- [ ] Color-coded: Green for gains, red for losses
- [ ] Download buttons: CSV, PDF
- [ ] Loading state: Skeleton for summary + table
- [ ] Error state: "Could not compute gains" with retry
- [ ] Empty state: "No transactions in this financial year"
- [ ] Special case: "No capital gains transactions" when all held > 12mo
- [ ] Responsive: Table scrolls horizontally on mobile

#### Implementation Checklist
- [ ] `lib/services/taxService.ts` — Tax computation orchestrator
- [ ] `lib/services/taxCalculator.ts` — FIFO matching + holding period
- [ ] `app/api/portfolio/tax/route.ts` — Tax data API
- [ ] `app/api/portfolio/tax/export/route.ts` — CSV/PDF export
- [ ] `app/portfolio/tax/page.tsx` — Tax reports page
- [ ] `app/components/tax/TaxSummaryCards.tsx`
- [ ] `app/components/tax/TaxTradeTable.tsx`
- [ ] `app/components/tax/TaxFYSelector.tsx`
- [ ] Nav link in `app/portfolio/PortfolioClient.tsx`
- [ ] Nav link in `app/Header.tsx`
- [ ] Tests: `lib/__tests__/taxCalculator.test.ts` (15+ tests)

### Feature: Portfolio Rebalancer

**PRD Reference:** See `.agents/PRD.md` — Feature 5

Define target allocation rules, visualize current vs target, get actionable trade suggestions.

#### UI/UX Checklist
- [ ] Side-by-side pie charts: Current % vs Target %
- [ ] Allocation table: Category, Current %, Target %, Drift bar, Action
- [ ] Drift threshold slider (1-20%, default 5%)
- [ ] Trade suggestions: SELL (overallocated), BUY (underallocated) with amounts
- [ ] Target editor: Drag sliders or % inputs per category
- [ ] Category management: Add/remove allocation categories
- [ ] Warning: "Target sums to X% (should be 100%)"
- [ ] "Unallocated" bucket for unclassified holdings
- [ ] Loading state: Skeleton for pie + table
- [ ] Error state: "Could not compute allocation"
- [ ] Empty state: "Set your first target allocation"
- [ ] Save/Load multiple allocation profiles

#### Implementation Checklist
- [ ] `lib/services/rebalancerService.ts` — Core computation
- [ ] `app/api/portfolio/rebalancer/route.ts` — Allocation data
- [ ] `app/api/portfolio/rebalancer/config/route.ts` — Save targets
- [ ] `app/portfolio/rebalance/page.tsx` — Rebalancer page
- [ ] `app/components/rebalancer/AllocationPieChart.tsx`
- [ ] `app/components/rebalancer/AllocationTable.tsx`
- [ ] `app/components/rebalancer/TradeSuggestionList.tsx`
- [ ] `app/components/rebalancer/TargetAllocationEditor.tsx`
- [ ] Nav link in `app/portfolio/PortfolioClient.tsx`
- [ ] Tests: `lib/__tests__/rebalancerService.test.ts`

---

## Sprint 3: Advanced

### Feature: Options/F&O Analytics

**PRD Reference:** See `.agents/PRD.md` — Feature 3

Track F&O positions (Futures + Options), compute P&L, show option Greeks, display expiry calendar.

#### UI/UX Checklist
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

#### Implementation Checklist
- [ ] `prisma/schema.prisma` — Add FOPosition model + migration
- [ ] `lib/services/foService.ts` — F&O CRUD operations
- [ ] `lib/services/foPnlService.ts` — P&L + Greeks computation
- [ ] `lib/services/nse-fo-api.ts` — NSE F&O chain fetcher
- [ ] `app/api/fo/positions/route.ts` — Positions CRUD
- [ ] `app/api/fo/chain/route.ts` — Option chain data
- [ ] `app/api/fo/expiries/route.ts` — Expiry dates
- [ ] `app/fo/page.tsx` — F&O dashboard
- [ ] `app/components/fo/FOPositionTable.tsx`
- [ ] `app/components/fo/OptionChainViewer.tsx`
- [ ] `app/components/fo/ExpiryCalendar.tsx`
- [ ] `app/components/fo/FOPnlChart.tsx`
- [ ] Nav link in `app/Header.tsx`
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
