# Screener & Backtest (v1.16.0 Advanced Screener + v1.10.0 Enhancement)

> Legacy feature deep-dive. Index: [../CHANGELOG.md](../CHANGELOG.md).

## Fix (v3.5.2): `change` = % semantics for NSE — 0 → 250 template matches

### Root Cause
TradingView's `change` field **is** the percent change for NSE (RELIANCE 1334.8 vs prev 1325 = +0.74%; EEPL +20.0%, SBCL +19.99% — matches Chartink). `change_percent` is null/unsupported as an NSE column, TV-side filter, AND sort key (probe `change_percent > 1` → 0 rows). Consequence: ~60 screener templates using `change_percent` silently matched 0 stocks, and `getTopMovers("gainers")` returned `[]`.

### Fixes Applied
| Area | Change |
|------|--------|
| **Short Term Breakouts template** | `change_percent > 0, volume > 100000, close > 0` → `change > 0, relative_volume_10d_calc > 1, Perf.5D > 3` (L503–511). Live: 2000 rows, 627ms, **250 matched** (was 0), 18/20 Chartink overlap. |
| **Mass-fix** | All 57 remaining `change_percent` template args → `change` (0 remain; grep-verified). |
| **`Perf.5D` field** | Added to `FILTER_FIELDS` (`condition-tree.ts`) + `FilterBuilder` FIELD_OPTIONS — was missing, so `validateFilterGroup` would have 400'd the template. |
| **`getTopMovers`** | `gainers: change > 3`, `losers: change < -3`, `active: volume > 1,000,000` (`tradingview-service.ts`). |
| **Advanced route** | `percentChange ?? change` (TV `change` is already %); removed `(change/(close-change))*100` formula. |
| **UI semantics** | `change` labeled "Change (%)" (was ₹); ₹ derived `close*pct/(100+pct)` in results; % Change column sortable. |

### Why Not Server-Side Lookback Enrichment
`daily_prices` has only 12 rows; NSE history fetch 4.4s/symbol → 882-candidate universe ≈ 65 min; TV has no lookback columns (~50 probed). TV pre-filter `change>0 & vol>50k` → 882 stocks in ~1s — the native proxy is the right approach.

### Verification
45 screener tests pass; tsc clean on all 6 touched files; Playwright: template loads 3 conditions, Run Scan → "250 stocks found · 574ms", % Change sortable with real values (SBIN +1.12%, MOTHERSON +8.71%, TATATECH +8.89%, NEULANDLAB +6.09%, AVALON +10.75%), zero console errors.

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
