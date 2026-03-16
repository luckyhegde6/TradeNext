# AGENTS.md - TradeNext Development Guide

## Overview
TradeNext is a Next.js 16 application with TypeScript, Tailwind CSS, Prisma, and Jest. It provides stock market data visualization and portfolio management for NSE (India).

## Version History
- **v1.8.2** - Netlify 502 Fix (March 16, 2026). Fixed 502 Bad Gateway error on Netlify. Root cause: Middleware with NextAuth was causing edge function crashes despite `runtime = 'nodejs'`. Solution: Created minimal middleware without NextAuth imports. Authentication now handled at API route level. Prisma Accelerate configuration fixed with `accelerateUrl` option.
- **v1.8.1** - Build Fixes (March 16, 2026). Fixed Prisma 7 adapter configuration. Moved type packages to dependencies for Netlify. Fixed logger to output in production. Fixed netlify.toml syntax. Added startup logging for debugging 502 errors.

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
```
