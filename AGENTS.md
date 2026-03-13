# AGENTS.md - TradeNext Development Guide

## Overview
TradeNext is a Next.js 16 application with TypeScript, Tailwind CSS, Prisma, and Jest. It provides stock market data visualization and portfolio management for NSE (India).

## Version History
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
