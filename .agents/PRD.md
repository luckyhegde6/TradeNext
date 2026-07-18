# TradeNext Product Roadmap — Feature PRDs

> **Version:** 1.0 — July 18, 2026
> **Status:** Planned
> **Previous:** Phase 3 Portfolio Enhancements (v3.1.0) ✅ Complete

---

## Overview — Phase 4: Intelligence & Reporting

After completing core portfolio management (Phase 3), Phase 4 focuses on:
- **Real-time data** — Live price updates across the platform
- **Tax intelligence** — Capital gains reports for compliance
- **Derivatives tracking** — F&O analytics for advanced traders
- **Income planning** — Dividend calendar with projected income
- **Portfolio optimization** — Rebalancer for target allocation

| Feature | Priority | Effort | Dependencies | Value |
|---------|----------|--------|--------------|-------|
| Dividend Calendar | P1 | S | Corp Actions data (existing) | High — quick win |
| Real-time WebSocket | P1 | M | SSE infrastructure | High — UX improvement |
| Tax Reports (ST/LT) | P2 | L | Transaction history (existing) | High — compliance |
| Portfolio Rebalancer | P2 | M | Holdings data (existing) | Medium — actionable |
| Options/F&O Analytics | P3 | XL | NSE F&O data + new models | Medium — niche |

---

## Feature 1: Real-time WebSocket — Live Price Updates

### Problem
Users must manually refresh pages to see current prices. Portfolio, watchlist, and dashboard display stale data until page reload.

### Goal
Push live price updates to connected clients without polling, using Server-Sent Events (SSE) for simplicity and broad compatibility.

### Architecture

```
[NSE API / TradingView] → [Price Sync Service] → [SSE Endpoint] → [React Hooks] → [UI Components]
                              ↕
                    [Redis Cache (current prices)]
```

### Components

#### Backend
| File | Purpose |
|------|---------|
| `lib/services/priceSyncService.ts` | Polls NSE/TradingView for selected symbols at configurable intervals, broadcasts via EventEmitter |
| `app/api/prices/stream/route.ts` | SSE endpoint (`GET /api/prices/stream?symbols=RELIANCE,TCS`). Keeps connection open, sends `text/event-stream` with price updates |
| `lib/services/priceCache.ts` | In-memory/Redis store for latest prices. TTL 30s. |

#### Frontend
| File | Purpose |
|------|---------|
| `lib/hooks/useLivePrice.ts` | React hook: opens SSE connection, returns `{ price, change, changePercent, isLoading, error }`. Auto-reconnects on disconnect. |
| `lib/hooks/useLivePrices.ts` | Batch variant: accepts `string[]` symbols, returns `Map<string, PriceData>`. Single SSE connection for all. |
| `app/components/LivePriceBadge.tsx` | Small inline component showing live price with green/red flash animation on change. |

### Data Flow
1. Client connects: `EventSource('/api/prices/stream?symbols=RELIANCE,TCS')`
2. Server accepts, registers symbols in watch set
3. PriceSyncService fetches quotes every 5-30s (depends on market hours)
4. On new data, server writes `event: price\ndata: {...}\n\n` to all listening clients
5. Client `useLivePrice` hook parses event, updates React state
6. UI re-renders with new price (green flash if up, red if down)

### SSE Event Format
```
event: price
data: {"symbol":"RELIANCE","price":3256.80,"change":12.50,"changePercent":0.39,"timestamp":"2026-07-18T14:30:00.000Z"}

event: heartbeat
data: {"timestamp":"2026-07-18T14:30:05.000Z"}
```

### Edge Cases
- **Disconnect**: `useLivePrice` auto-reconnects with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- **Market closed**: Server sends `event: status\ndata: {"market":"closed"}` once, then sends heartbeat only
- **Too many symbols**: Batch limit of 50 symbols per connection. Server returns 400 if exceeded
- **SSE not supported**: Graceful fallback to polling via `usePollingPrice` hook

### Files to Create
- `lib/services/priceSyncService.ts`
- `app/api/prices/stream/route.ts`
- `lib/services/priceCache.ts`
- `lib/hooks/useLivePrice.ts`
- `lib/hooks/useLivePrices.ts`
- `app/components/LivePriceBadge.tsx`
- `lib/__tests__/useLivePrice.test.ts`
- `lib/__tests__/priceSyncService.test.ts`

### Files to Modify
- `app/portfolio/PortfolioClient.tsx` — useLivePrices for holdings
- `app/components/HoldingsTable.tsx` — LivePriceBadge in price column
- `app/page.tsx` — LivePriceBadge on dashboard
- `app/Header.tsx` — Market status indicator

### Testing
- Unit: PriceSyncService emits correct events (5 tests)
- Unit: SSE endpoint handles connect/disconnect (3 tests)
- Unit: useLivePrice hook state transitions (4 tests)
- E2E: Page shows live price updates

---

## Feature 2: Tax Reports — Capital Gains (ST/LT)

### Problem
Users have no way to compute capital gains for tax filing. They manually track buy/sell transactions and calculate holding periods.

### Goal
Generate downloadable capital gains reports (Short Term + Long Term) with correct holding period classification per Indian tax rules.

### Indian Tax Rules
| Asset Type | Short Term | Long Term | STCG Rate | LTCG Rate |
|------------|------------|-----------|-----------|-----------|
| Listed Equity (STT paid) | ≤ 12 months | > 12 months | 15% | 10% over ₹1L |
| Equity Mutual Funds | ≤ 12 months | > 12 months | 15% | 10% over ₹1L |
| Debt/Money Market | ≤ 36 months | > 36 months | Slab rate | 20% with indexation |

### Architecture

```
[Transaction History] → [Tax Computation Service] → [Report Builder] → [PDF/CSV Export]
                              ↕
                     [Holding Period Calculator]
```

### Components

#### Service Layer
| File | Purpose |
|------|---------|
| `lib/services/taxService.ts` | Core tax computation: `computeCapitalGains(transactions, financialYear)` → `{ shortTerm: Trade[], longTerm: Trade[], summary: TaxSummary }` |
| `lib/services/taxCalculator.ts` | `TaxCalculator` class: FIFO-based match of sells to buys, holding period calc, gain/loss per trade |

#### API
| File | Purpose |
|------|---------|
| `app/api/portfolio/tax/route.ts` | `GET /api/portfolio/tax?fy=2025-26&format=json|csv` — Returns capital gains data |
| `app/api/portfolio/tax/export/route.ts` | `GET /api/portfolio/tax/export?fy=2025-26&type=tax-report` — Downloads CSV/PDF |

#### UI
| File | Purpose |
|------|---------|
| `app/portfolio/tax/page.tsx` | Tax reports page with FY selector, summary cards, trade table |
| `app/components/tax/TaxSummaryCards.tsx` | 4 cards: Total STCG, Total LTCG, Tax Est. (ST), Tax Est. (LT) |
| `app/components/tax/TaxTradeTable.tsx` | Sortable table with Symbol, Buy Date, Sell Date, Qty, Buy Price, Sell Price, Gain/Loss, Holding Period, Type (ST/LT), Tax Rate |
| `app/components/tax/TaxFYSelector.tsx` | Dropdown for financial year selection |

### Data Flow
1. User navigates to `/portfolio/tax`
2. Selects financial year (e.g., "2025-26")
3. API fetches all transactions for that FY
4. `TaxCalculator` processes: sort buys FIFO, match to sells, compute holding period
5. Returns `{ shortTerm: [...], longTerm: [...], summary: {...} }`
6. UI renders summary cards + trade table
7. User can download CSV/PDF report

### Types
```typescript
interface TaxTrade {
  symbol: string;
  buyDate: string;
  sellDate: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  gain: number;
  gainPercent: number;
  holdingDays: number;
  type: 'STCG' | 'LTCG';
  taxRate: number;
  taxEstimate: number;
}

interface TaxSummary {
  totalSTCG: number;
  totalLTCG: number;
  taxableLTCG: number; // after ₹1L exemption
  estSTTax: number;
  estLTTax: number;
  totalTaxEstimate: number;
  totalGain: number;
  totalLoss: number;
  netGain: number;
}
```

### Edge Cases
- **No transactions**: Empty state with message "No transactions in this financial year"
- **Holding straddles FY**: Prorate or split across years
- **Multiple buys, partial sells**: FIFO matching
- **Corporate actions (bonus/split)**: Adjust cost basis
- **Loss harvesting**: Track carry-forward losses

### Files to Create
- `lib/services/taxService.ts`
- `lib/services/taxCalculator.ts`
- `app/api/portfolio/tax/route.ts`
- `app/api/portfolio/tax/export/route.ts`
- `app/portfolio/tax/page.tsx`
- `app/components/tax/TaxSummaryCards.tsx`
- `app/components/tax/TaxTradeTable.tsx`
- `app/components/tax/TaxFYSelector.tsx`
- `lib/__tests__/taxCalculator.test.ts`

### Files to Modify
- `app/portfolio/PortfolioClient.tsx` — Add "Tax Reports" link
- `app/Header.tsx` — Add nav link

### Testing
- Unit: FIFO buy/sell matching (5 tests)
- Unit: Holding period classification (3 tests)
- Unit: Tax rate application (3 tests)
- Unit: Edge cases (bonus, split, partial sells) (4 tests)
- E2E: Report page loads with data

---

## Feature 3: Options/F&O Analytics — Futures & Options Tracking

### Problem
Advanced traders trade F&O but TradeNext has no support for tracking futures and options positions, P&L, or expiry.

### Goal
Track F&O positions (Futures + Options), compute unrealized/realized P&L, show option Greeks, and display expiry calendar.

### Architecture

```
[NSE F&O API] → [FO Data Sync] → [Position Tracker] → [P&L Calculator] → [UI Dashboard]
                    ↕
            [Prisma FO Models]
```

### Prisma Models (New)

```prisma
model FOPosition {
  id              String   @id @default(uuid())
  userId          String
  symbol          String   // Futures: "RELIANCE", Options: "RELIANCE 25JUL3000CE"
  type            String   // "FUTURE" | "OPTION_CALL" | "OPTION_PUT"
  direction       String   // "LONG" | "SHORT"
  quantity        Int
  entryPrice      Float
  currentPrice    Float?
  premium         Float?   // For options
  strike          Float?   // For options
  expiry          DateTime?
  contractSize    Int      // Default 75 for Nifty, varies for stocks
  realizedPnl     Float    @default(0)
  unrealizedPnl   Float?
  status          String   // "OPEN" | "CLOSED" | "EXPIRED"
  openedAt        DateTime @default(now())
  closedAt        DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId, status])
}
```

### Components

#### Service Layer
| File | Purpose |
|------|---------|
| `lib/services/foService.ts` | CRUD for F&O positions, sync from NSE F&O API |
| `lib/services/foPnlService.ts` | P&L computation: `computeFOPnl(position, currentPrice)` |
| `lib/services/nse-fo-api.ts` | Fetch F&O chain data, OI, volume from NSE |

#### API
| File | Purpose |
|------|---------|
| `app/api/fo/positions/route.ts` | CRUD for F&O positions |
| `app/api/fo/chain/route.ts` | `GET /api/fo/chain?symbol=NIFTY&expiry=25JUL2026` — Option chain data |
| `app/api/fo/expiries/route.ts` | `GET /api/fo/expiries` — Upcoming expiry dates |

#### UI
| File | Purpose |
|------|---------|
| `/app/fo/page.tsx` | F&O Dashboard |
| `app/components/fo/FOPositionTable.tsx` | Positions table with P&L, Greeks |
| `app/components/fo/OptionChainViewer.tsx` | Option chain with bid/ask/OI/IV |
| `app/components/fo/ExpiryCalendar.tsx` | Upcoming expiry countdown |
| `app/components/fo/FOPnlChart.tsx` | P&L visualization |

### Key Features
- **Position Tracking**: Add futures/options positions manually or via CSV
- **Option Greeks**: Delta, Gamma, Theta, Vega (computed using Black-Scholes)
- **Option Chain Viewer**: Real-time chain from NSE with OI, volume, IV
- **Expiry Calendar**: Countdown to next expiry, historical expiries
- **P&L Dashboard**: Realized + unrealized P&L with breakdown by symbol

### Edge Cases
- **Expired options**: Auto-mark as EXPIRED with realized P&L = premium * qty
- **Square-off**: On close, move unrealized → realized
- **NSE F&O symbols**: Different naming: NIFTY, BANKNIFTY, RELIANCE, etc.
- **Contract size changes**: NSE changes lot sizes occasionally

### Files to Create
- `lib/services/foService.ts`
- `lib/services/foPnlService.ts`
- `lib/services/nse-fo-api.ts`
- `app/api/fo/positions/route.ts`
- `app/api/fo/chain/route.ts`
- `app/api/fo/expiries/route.ts`
- `app/fo/page.tsx`
- `app/components/fo/FOPositionTable.tsx`
- `app/components/fo/OptionChainViewer.tsx`
- `app/components/fo/ExpiryCalendar.tsx`
- `app/components/fo/FOPnlChart.tsx`
- `lib/__tests__/foPnlService.test.ts`

### Files to Modify
- `prisma/schema.prisma` — Add FOPosition model
- `app/Header.tsx` — Add F&O nav link

---

## Feature 4: Dividend Calendar — Upcoming Dividends

### Problem
Corporate Actions shows all actions but there's no dedicated dividend calendar view. Users can't see "what dividends are coming up" or "how much I'll earn."

### Goal
A dividend-focused calendar showing upcoming ex-dates, record dates, amounts, and estimated income based on user holdings.

### Architecture

```
[Corporate Actions DB] → [Dividend Filter] → [Calendar Builder] → [Dividend View]
                              ↕
                     [Holdings (for estimation)]
```

### Components

#### Service Layer
| File | Purpose |
|------|---------|
| `lib/services/dividendCalendarService.ts` | Fetches dividend-only corp actions, enriches with holdings data for income estimation |

#### API
| File | Purpose |
|------|---------|
| `app/api/dividends/calendar/route.ts` | `GET /api/dividends/calendar?month=7&year=2026&view=calendar|list` |

#### UI
| File | Purpose |
|------|---------|
| `app/dividends/page.tsx` | Dividend Calendar page |
| `app/components/dividends/DividendMonthView.tsx` | Month calendar with dividend dots, popup on hover with amount |
| `app/components/dividends/DividendListView.tsx` | List view: Ex-Date, Symbol, Amount, Yield, Record Date, Your Holding, Est. Income |
| `app/components/dividends/DividendSummaryCards.tsx` | Cards: Upcoming (count), Est. Monthly Income, Est. Annual Income, Avg Yield |
| `app/components/dividends/DividendIncomeChart.tsx` | Bar chart: monthly projected dividend income |

### Data Flow
1. Fetch corporate actions filtered to `actionType = "DIVIDEND"`
2. For each, fetch latest price to compute yield
3. If user is logged in, match against holdings (quantity held)
4. Compute estimated income = dividendPerShare × quantity held
5. Render month view with dividend indicators
6. Click on date → popup with dividend details

### View Modes
| Mode | Description |
|------|-------------|
| **Calendar** | Month grid with dots on ex-dates. Hover shows dividend details. |
| **List** | Chronological list sorted by ex-date. Shows all upcoming dividends. |
| **Income** | Monthly bar chart of projected dividend income. |

### Edge Cases
- **No dividends in month**: Empty state with "No dividends this month"
- **Not holding any stock**: Show all upcoming dividends but "Est. Income" as "—"
- **Multiple dividends same stock**: Show all (interim + final)
- **Past dividends**: Grey out or separate section "Recent Dividends"

### Files to Create
- `lib/services/dividendCalendarService.ts`
- `app/api/dividends/calendar/route.ts`
- `app/dividends/page.tsx`
- `app/components/dividends/DividendMonthView.tsx`
- `app/components/dividends/DividendListView.tsx`
- `app/components/dividends/DividendSummaryCards.tsx`
- `app/components/dividends/DividendIncomeChart.tsx`
- `lib/__tests__/dividendCalendarService.test.ts`

### Files to Modify
- `app/Header.tsx` — Add Dividends nav link

---

## Feature 5: Portfolio Rebalancer — Target Allocation

### Problem
Users set target allocation percentages (e.g., 40% Large Cap, 30% Mid Cap, 20% Small Cap, 10% Cash) but have no tool to track drift or get rebalancing suggestions.

### Goal
Allow users to define target allocation rules, visualize current vs target, and get actionable trade suggestions to rebalance.

### Architecture

```
[Holdings Data] → [Allocation Calculator] → [Drift Analyzer] → [Rebalance Suggestions] → [UI Dashboard]
                      ↕
            [Target Allocation Config]
```

### Components

#### Service Layer
| File | Purpose |
|------|---------|
| `lib/services/rebalancerService.ts` | Core rebalancer: `computeAllocation(holdings, targets)` → `{ current, target, drift, suggestions }` |

#### API
| File | Purpose |
|------|---------|
| `app/api/portfolio/rebalancer/route.ts` | `GET /api/portfolio/rebalancer` — Current vs target allocation |
| `app/api/portfolio/rebalancer/config/route.ts` | `PUT /api/portfolio/rebalancer/config` — Save target allocations |

#### UI
| File | Purpose |
|------|---------|
| `app/portfolio/rebalance/page.tsx` | Rebalancer page |
| `app/components/rebalancer/AllocationPieChart.tsx` | Side-by-side: Current vs Target pie charts |
| `app/components/rebalancer/AllocationTable.tsx` | Category, Current %, Target %, Drift, Suggested Action |
| `app/components/rebalancer/TradeSuggestionList.tsx` | Buy/Sell suggestions with quantities |
| `app/components/rebalancer/TargetAllocationEditor.tsx` | Drag sliders to set target % |

### Allocation Categories
Users can define allocations by:
- **Sector**: Banking, IT, Pharma, Auto, etc.
- **Market Cap**: Large Cap, Mid Cap, Small Cap
- **Asset Type**: Equity, Debt, Cash
- **Custom Tags**: User-defined labels

### Data Flow
1. User defines target allocations (e.g., Large Cap: 50%, Mid Cap: 30%, Small Cap: 20%)
2. System computes current allocation from holdings × current prices
3. Drift = Current% - Target% (positive = overallocate, negative = underallocate)
4. If drift > threshold (default 5%), generate trade suggestion
5. Trade suggestion: `{ category: "Large Cap", action: "SELL", symbol: "RELIANCE", amount: 50000, reason: "Overallocated by 8%" }`

### Types
```typescript
interface TargetAllocation {
  id: string;
  category: string;      // e.g., "Large Cap", "Banking"
  targetPercent: number;
  tolerance: number;     // drift threshold %, default 5
}

interface AllocationDrift {
  category: string;
  currentPercent: number;
  targetPercent: number;
  drift: number;         // positive = over, negative = under
  currentValue: number;
  targetValue: number;
  rebalanceAmount: number;
}

interface TradeSuggestion {
  symbol: string;
  action: 'BUY' | 'SELL';
  quantity: number;
  estimatedAmount: number;
  reason: string;
}
```

### Edge Cases
- **Total ≠ 100%**: Show warning "Target allocations sum to 95% (should be 100%)"
- **Missing category**: Stocks not in any category → "Unallocated" bucket
- **Cash allocation**: If cash target > 0, show "Maintain ₹X in cash/money market"
- **Small drift**: Only suggest trades if drift > tolerance threshold

### Files to Create
- `lib/services/rebalancerService.ts`
- `app/api/portfolio/rebalancer/route.ts`
- `app/api/portfolio/rebalancer/config/route.ts`
- `app/portfolio/rebalance/page.tsx`
- `app/components/rebalancer/AllocationPieChart.tsx`
- `app/components/rebalancer/AllocationTable.tsx`
- `app/components/rebalancer/TradeSuggestionList.tsx`
- `app/components/rebalancer/TargetAllocationEditor.tsx`
- `lib/__tests__/rebalancerService.test.ts`

### Files to Modify
- `app/portfolio/PortfolioClient.tsx` — Add "Rebalance" link

---

## Implementation Order

### Sprint 1 — Bug Fix + Quick Wins (2-3 days)
1. ✅ Corporate Actions Price/Yield fix
2. **Dividend Calendar** (smallest scope, leverages existing data)
3. **Real-time WebSocket — SSE** (foundational for all pages)

### Sprint 2 — Tax & Rebalancer (3-4 days)
4. **Tax Reports** (highest user value, tax season utility)
5. **Portfolio Rebalancer** (actionable, moderate scope)

### Sprint 3 — Advanced (4-5 days)
6. **Options/F&O Analytics** (largest scope, needs new models & NSE API)

---

## Dependencies & Risks

| Feature | Dependency | Risk | Mitigation |
|---------|-----------|------|------------|
| Dividend Calendar | Corp Actions data | Low — data exists | Minor enrichment needed |
| Real-time WebSocket | SSE support in Next.js | Low — well-documented | Fallback to polling |
| Tax Reports | Transaction history | Medium — FIFO complexity | Start with simple, iterate |
| Rebalancer | Holdings data | Low — pure computation | Start with sector-only |
| F&O Analytics | NSE F&O API access, New Prisma models | High — NSE API rate limits | Cache aggressively, manual entry fallback |

---

## Key Metrics

| Feature | Success Metric | Target |
|---------|---------------|--------|
| Dividend Calendar | DAU on dividends page | >10% of active users |
| Live Prices | Pages with live prices feel "instant" | <1s price update latency |
| Tax Reports | Downloads per user in Apr-Jul | >50% of users |
| Rebalancer | % of users with allocation set | >20% of portfolio users |
| F&O Analytics | F&O positions added | >5% of active users |
