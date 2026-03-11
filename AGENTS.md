# AGENTS.md - TradeNext Development Guide

## Overview
TradeNext is a Next.js 16 application with TypeScript, Tailwind CSS, Prisma, and Jest. It provides stock market data visualization and portfolio management for NSE (India).

## Version History
- **v1.4.0** - Enhanced Corporate Actions with dividend yield, filtering, pagination, search, improved UX, and date formatting fixes. Added DataTable sorting for all market analytics tables.
- **v1.3.0** - Added Corporate Actions Management (Dividends, Splits, Bonus, Rights, Buybacks) with admin upload, NSE live integration, and combined view
- **v1.2.0** - Added Analytics Service, Alert Service, Demo User Seeding, Portfolio Analytics API
- **v1.1.0** - Added Stock Recommendations, User Alerts, Audit Logging, Rate Limiting, Admin Holdings Management
- **v1.0.0** - Initial release

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
