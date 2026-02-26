# TODO: Analytics & Portfolio Management Enhancements

## Priority 1: Technical Indicators on Charts

### Tasks
- [x] Research and select charting library with indicator support (TradingView Lightweight Charts or Chart.js with plugins)
- [x] Create technical indicators utility functions:
  - [x] RSI (Relative Strength Index) calculation
  - [x] MACD (Moving Average Convergence Divergence)
  - [x] Bollinger Bands
  - [x] Simple Moving Average (SMA)
  - [x] Exponential Moving Average (EMA)
- [x] Update stock detail page to include indicator selector
- [x] Add timeframe options for indicators (1W, 1M, 3M, 6M, 1Y)
- [x] Fetch historical price data for calculations
- [x] Add unit tests for indicator calculations
- [x] Update UI with indicator panel below main chart

---

## Priority 2: Stock Screener

### Tasks
- [x] Design stock screener UI component
- [x] Create filter criteria:
  - [x] Market Cap (Large, Mid, Small)
  - [x] P/E Ratio range
  - [x] Sector/Industry
  - [x] Price range
  - [x] Volume range
  - [x] 52-week high/low
  - [x] Dividend yield
  - [x] ROE/ROCE
- [x] Create API endpoint for filtering stocks
- [x] Add pagination for results
- [x] Implement sort by any column
- [x] Add "Add to Watchlist" functionality
- [x] Create saved screen feature (user-specific)

---

## Priority 3: Transaction Import (CSV/Excel)

### Tasks
- [x] Design import wizard UI (multi-step)
- [x] Create CSV parser utility
- [x] Support Excel format (.xlsx)
- [x] Map columns to transaction fields:
  - [x] Date, Ticker, Type (BUY/SELL), Quantity, Price, Fees
- [x] Validate data before import
- [x] Show preview of transactions to be imported
- [x] Handle duplicates gracefully
- [x] Support different broker formats (Zerodha, Upstox, Angel One templates)
- [x] Create import history log
- [x] Add error reporting with row-level details

---

## Priority 4: Price Alerts System

### Tasks
- [x] Design alerts data model in Prisma schema
- [x] Create alerts API:
  - [x] POST /api/alerts - Create alert
  - [x] GET /api/alerts - List user alerts
  - [x] DELETE /api/alerts/:id - Delete alert
  - [x] PUT /api/alerts/:id - Update alert
- [x] Implement alert types:
  - [x] Price above target
  - [x] Price below target
  - [x] Percent change threshold
  - [x] Volume spike
- [x] Create background worker to check alerts
- [ ] Integrate email notification service (Resend/SendGrid)
- [ ] Add SMS notifications (optional - Twilio)
- [x] Create alerts management UI in portfolio page
- [x] Show alert history/notification log

---

## Priority 5: Piotroski F-Score

### Tasks
- [x] Research Piotroski F-Score criteria (9-point scoring)
- [x] Gather required financial data:
  - [x] Net Income
  - [x] Operating Cash Flow
  - [x] Return on Assets (ROA)
  - [x] Operating Cash Flow / Total Assets
  - [x] Change in ROA
  - [x] Accruals
  - [x] Change in Leverage
  - [x] Change in Current Ratio
  - [x] Change in Shares Outstanding
  - [x] Gross Margin
  - [x] Asset Turnover
- [x] Fetch financial data from existing database or external API
- [x] Create F-Score calculation function
- [x] Build UI to display F-Score on company page
- [x] Add historical F-Score tracking
- [x] Create interpretation guide (0-2 Poor, 3-4 Low, 5-6 Med, 7-8 Good, 9 Excellent)
- [ ] Add to stock screener as filter option

---

## Technical Notes

### Database Changes
```prisma
model PriceAlert {
  id          Int      @id @default(autoincrement())
  userId      Int
  symbol      String
  alertType   String   // PRICE_ABOVE, PRICE_BELOW, PERCENT_CHANGE
  targetValue Decimal
  isActive    Boolean  @default(true)
  triggeredAt DateTime?
  createdAt   DateTime @default(now())
}

model SavedScreen {
  id          Int      @id @default(autoincrement())
  userId      Int
  name        String
  filters     Json
  createdAt   DateTime @default(now())
}

model FinancialScore {
  id          Int      @id @default(autoincrement())
  symbol      String
  fScore      Int
  roa         Decimal
  cfo         Decimal
  accruals    Decimal
  leverage    Decimal
  currentRatio Decimal
  grossMargin Decimal
  assetTurnover Decimal
  analyzedAt  DateTime @default(now())
}
```

### API Endpoints to Add
```
GET  /api/screener          - Filter stocks
POST /api/screener/save     - Save screen
GET  /api/alerts            - List alerts
POST /api/alerts            - Create alert
DELETE /api/alerts/:id      - Delete alert
GET  /api/company/:ticker/indicators - Technical indicators
GET  /api/company/:ticker/fscore    - Piotroski F-Score
POST /api/portfolio/import - Import transactions
```

### External Services Needed
- [ ] Email service (Resend/SendGrid) for alerts
- [ ] Historical price data provider (or use existing NSE data)
- [ ] Financial data provider (or scrape from NSE/bloomberg)

---

## Quick Wins (Low Effort)
1. Add more chart timeframes (5M, 15M, 1H for intraday)
2. Add comparison mode (compare 2 stocks)
3. Export portfolio to PDF report
4. Add dividend calendar view
5. Quick add transaction modal
