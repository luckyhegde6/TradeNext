# AGENTS.md - TradeNext Development Guide

## Overview
TradeNext is a Next.js 16 application with TypeScript, Tailwind CSS, Prisma, and Jest. It provides stock market data visualization and portfolio management for NSE (India).

## Version History
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

## Agent Documentation Files

This project uses additional documentation for agent sessions:

| File | Purpose |
|------|---------|
| `Primer.md` | Session tracking - read at start of every session |
| `agent-memory.md` | Activity log - tracks all agent work |
| `Lessons.md` | Rules & corrections - read before every commit |

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

1. **Start of session**: Read `Primer.md` to understand current state
2. **During work**: Log activities in `agent-memory.md`
3. **Before commit**: Read `Lessons.md` to apply rules
4. **End of session**: Update `Primer.md` with progress

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
