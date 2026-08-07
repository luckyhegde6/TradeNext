# TradeNext - UX Analysis & Bugs

> **Bug tracking convention**: every open bug gets a GitHub issue on [luckyhegde6/TradeNext/issues](https://github.com/luckyhegde6/TradeNext/issues). This file is the human-readable tracker — fix bugs one by one, close the issue, then mark the row ✅ here.

---

## 🐞 Open Bugs (Priority Order)

| # | Issue | Severity | GitHub | Status |
|---|-------|----------|--------|--------|
| 1 | **Prod: server/DB logs empty** on `/admin/utils/monitoring` (works locally) — FS-based log tab can't work on serverless; DB logger not wired to all sinks | High | [#68](https://github.com/luckyhegde6/TradeNext/issues/68) | Open |
| 2 | **Prod: admin sessions page empty** — `createUserSession`/`updateSessionActivity` are never called, so `user_sessions` table stays empty | High | [#69](https://github.com/luckyhegde6/TradeNext/issues/69) | Open |
| 3 | **Recommendations data stale (17 days)** — daily rec cron not producing successful runs since Jul 19; txn-timeout likely (fixed locally, awaiting deploy) | High | — | Open |
| 4 | **History cards render bare "🟡" + "%"** for ~600/643 stocks — `recommendation`/`confidence` null in DB (AI fell back to HOLD without persisting) | Medium | — | Open |
| 5 | **643 recommendations too many** — cap to top 50 (`rankAndCapRecommendations` implemented locally, needs deploy) | Medium | — | Open |
| 6 | ~~NSE Large Deals API returns empty data~~ (`/api/nse/deals`) — **RESOLVED** via `mode` param | High | [#70](https://github.com/luckyhegde6/TradeNext/issues/70) | Resolved |
| 7 | INDIA VIX shows "0 +0%" on markets page | Medium | — | Open |
| 8 | No user profile management page reachable from header | Medium | — | Open |
| 9 | Demo user shows 2 portfolios in admin panel (seed upsert duplicates) | Low | — | Open |
| 10 | Portfolio page brief "Loading..." flash (UX polish) | Low | — | Open |

---

## Navigation Analysis

### Pages Tested
| Page | URL | Status |
|------|-----|--------|
| Home/Dashboard | / | ✅ Working |
| Markets | /markets | ✅ Working |
| Analytics | /markets/analytics | ✅ Working |
| Portfolio | /portfolio | ✅ Working |
| Community | /posts | ✅ Working |
| Contact | /contact | ✅ Working |
| Admin Overview | /admin/utils | ✅ Working |
| User Management | /admin/users | ✅ Working |
| Screener | /markets/screener | ✅ Working (NEW) |
| Alerts | /alerts | ✅ Working (NEW) |
| Admin Alerts | /admin/alerts | ✅ Working (NEW) |
| Stock Detail | /company/{ticker} | ✅ Working (NEW) |

### Role-Based Navigation
| Role | Admin Links Visible | Protected Routes |
|------|---------------------|------------------|
| Admin | ✅ Yes | ✅ Protected |
| Demo User | ❌ No | ✅ Protected |
| Unauthenticated | ❌ No | ✅ Redirects to login |

---

## ✅ Resolved Bugs

| # | Issue | Root Cause | Fix | GitHub |
|---|-------|-----------|-----|--------|
| R1 | Demo portfolio not showing on /portfolio | Stale server cache | Restarted dev server; demo portfolio shows 5 holdings (seed restored in Ph9 #34) | [#74](https://github.com/luckyhegde6/TradeNext/issues/74) |
| R2 | Company page 52W high/low, volume, change showing "-" / "NaN" | Missing DB calculations | Now calculated from database | [#75](https://github.com/luckyhegde6/TradeNext/issues/75) |
| R3 | NIFTY 50 change showing long decimals | Unrounded float math | Rounded to 2 decimals | [#76](https://github.com/luckyhegde6/TradeNext/issues/76) |
| R4 | User APIs returned 500 errors (watchlist/notifications/subscriptions) | `parseInt(session.user.id)` failed with NextAuth string IDs | Switched to `Number(session.user.id)` | [#77](https://github.com/luckyhegde6/TradeNext/issues/77) |
| R5 | Non-admin access to `/admin/utils/ingest-csv` | Missing auth check | Added NextAuth session redirect | [#78](https://github.com/luckyhegde6/TradeNext/issues/78) |
| R6 | Public API exposed admin endpoint | `BulkDealsTable` called `/api/admin/ingest/deals` | Created public `/api/deals` + updated table | [#73](https://github.com/luckyhegde6/TradeNext/issues/73) |
| R7 | Admin CSV upload page access control | — | ✅ FIXED (admin role gate) | [#79](https://github.com/luckyhegde6/TradeNext/issues/79) |
| R8 | NSE charting multi-timeframe | — | ✅ FULLY INTEGRATED (native 1D/1M/3M/6M/1Y charts) | [#80](https://github.com/luckyhegde6/TradeNext/issues/80) |

---

## 🔧 New Features Added

### Technical Indicators
- RSI (14), MACD (12,26,9), Bollinger Bands (20,2), SMA Crossover (20 & 50)
- Optional overlay on price chart with multi-select indicator selector

### Stock Screener
- Filter by sector, price range, P/E ratio, volume, % change
- Sort by symbol, price, change, volume, market cap
- Saved screens feature (user-specific)
- 52 Nifty 50 stocks with historical data

### Price Alerts
- Create/manage price alerts from /alerts page
- Admin can view all user alerts at /admin/alerts
- Alert types: Price Above, Price Below

### CSV Import
- Import transactions from CSV/Excel
- Supports multiple broker formats

### Market News
- India tab (NSE corporate announcements)
- Global tab (TradingView news)
- 8-hour cache based on market timing
- Accessible at /news/market

### Analytics Page
- Corporate Announcements tab (NSE: /api/corporate-announcements)
- Corp Events tab (NSE: /api/event-calendar) - Shows table format
- Dividends/Splits/Bonus tab (NSE: /api/corporates-corporateActions)
- Insider Trading tab (NSE: /api/corporates-pit) - Insider Trading PIT

---

## UX Observations

1. Clean, professional UI with consistent styling and dark mode support
2. Real-time market data integration working well
3. Portfolio P&L calculations appear accurate
4. Role-Based Access Control properly implemented
5. Admin dashboard provides useful overview metrics
6. Full responsiveness across mobile, tablet, and desktop

### Areas for Improvement
1. Add loading skeletons instead of spinners
2. Implement toast notifications for user actions
3. Add empty states with better CTAs
4. Mobile responsiveness testing needed
5. Add search/filter on Markets page
6. Portfolio could benefit from more chart types

---

## Archived Bugs — March 2026

> ✅ All archived bugs below are now tracked as closed GitHub issues (see links).

### NSE Large Deals API Returns Empty Data (Resolved — High Priority) → [#70](https://github.com/luckyhegde6/TradeNext/issues/70)
- **Date**: 2026-03-09
- **Issue**: `/api/nse/deals` returns 0 records from NSE API
- **Root Cause**: NSE API format may have changed or requires different parameters (missing `mode` param)
- **Steps to Reproduce**:
  1. Go to `/markets/analytics`
  2. Click "Bulk Deals" or "Block Deals"
  3. Click "NSE Live" toggle
  4. Observe empty table with 0 records
- **Expected**: Data should display from NSE API
- **Actual**: Empty table
- **Fix**: Added `mode` parameter (commit `d1ea270`, PR #49 `ph16`)
- **Note**: Previously tracked as open bug #6 in the top table — now resolved.

### BulkDealsTable TypeScript Errors (Resolved — code moved on) → [#71](https://github.com/luckyhegde6/TradeNext/issues/71)
- **Date**: 2026-03-09
- **Issue**: Type errors in `app/components/analytics/BulkDealsTable.tsx` (implicit any, keyof mismatch)
- **Fix**: Event handler + row key types corrected (commit `d1ea270`, PR #49 `ph16`)
- **Status**: Superseded by later screener/analytics refactors; typecheck clean.

### Admin CSV Upload Page Access Control (FIXED) → [#72](https://github.com/luckyhegde6/TradeNext/issues/72)
- **Date**: 2026-03-09
- **Fix**: Added NextAuth session check - redirects non-admin users (commit `5f22a03`, PR #60 `Ph17`)

### Public API Exposing Admin Endpoint (FIXED) → [#73](https://github.com/luckyhegde6/TradeNext/issues/73)
- **Date**: 2026-03-09
- **Fix**: Created public `/api/deals` endpoint; updated BulkDealsTable (commit `1bbbbf8`, PR #36 `ph11`)

---

## Recommended Analytics & Portfolio Features

See PRD.md for detailed feature recommendations.
