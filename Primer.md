# Primer.md - Session Tracking

> Agent reads this at the start of every session to understand current state and progress
> ⚠️ IMPORTANT: After completing ANY task, you MUST update documentation (AGENTS.md, Primer.md, agent-memory.md, Lessons.md). See Lessons.md Lesson 20 for details.

## Last Updated
2026-03-21

---

## Current Project Status

### Worker Task Management Fix (v1.11.1)
**Issue**: Worker tasks stuck in "pending" status with no way to execute them from admin UI.
**Fix Applied**:
- Added `handleRunNow` function to execute pending/failed tasks immediately
- Added `handleRetry` function to retry failed tasks
- Fixed `handleCancel` to use PATCH API instead of PUT
- Fixed `handleDelete` to use PATCH API with action: "delete"
- Added UI buttons: ▶ Run Now, ↻ Retry, ✕ Cancel, 🗑 Delete
- All actions now use consistent PATCH `/api/admin/workers` endpoint
**Files Changed**: app/admin/utils/workers/page.tsx (action handlers)
**Status**: RESOLVED in v1.11.1.

### Google Analytics & SEO Enhancement (v1.11.0)
**Issue**: No Google Analytics integration and limited SEO metadata.
**Fix Applied**:
- Installed `@next/third-parties` for GA4 integration
- Created `app/components/analytics/GoogleAnalytics.tsx` with format validation
- Created `app/components/analytics/trackEvent.ts` with sanitized tracking functions
- Created `app/components/seo/SEOTags.tsx` with Organization, WebSite, WebPage JSON-LD schemas
- Created `app/components/seo/OrganizationSchema.tsx`, `WebSiteSchema.tsx`, `WebPageSchema.tsx`, `StockSchema.tsx`
- Updated `app/layout.tsx` to include `<SEOTags />` and `<Analytics />` components
- Enhanced `app/sitemap.ts` with all public pages, priority levels, change frequencies
- Enhanced `app/robots.ts` with Googlebot and Bingbot specific rules
- Added `metadata.ts` files to key routes: /markets, /markets/screener, /markets/analytics, /portfolio, /news, /alerts
- Updated `.env.example` with `NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_GA_ID`
**Files Changed**: 
- app/components/analytics/GoogleAnalytics.tsx (new)
- app/components/analytics/trackEvent.ts (new)
- app/components/analytics/index.ts (new)
- app/components/seo/SEOTags.tsx (new)
- app/components/seo/OrganizationSchema.tsx (new)
- app/components/seo/WebSiteSchema.tsx (new)
- app/components/seo/WebPageSchema.tsx (new)
- app/components/seo/StockSchema.tsx (new)
- app/components/seo/index.ts (new)
- app/layout.tsx (updated)
- app/sitemap.ts (updated)
- app/robots.ts (updated)
- app/markets/metadata.ts (new)
- app/markets/screener/metadata.ts (new)
- app/markets/analytics/metadata.ts (new)
- app/portfolio/metadata.ts (new)
- app/news/metadata.ts (new)
- app/alerts/metadata.ts (new)
- .env.example (updated)
**Status**: RESOLVED in v1.11.0.

### Worker Logger Security Fix (v1.10.6)
**Issue**: CodeQL security vulnerability - uncontrolled data used in path expression in `worker-logger.ts`.
**Fix Applied**:
- Added `sanitizeTaskIdForPath()` function to validate task IDs
- Only allows safe filename characters: `/^[A-Za-z0-9_\-:.]+$/`
- Rejects taskIds with path separators, traversal (`..`), or longer than 128 chars
- Applied to `writeToBoth()`, `readLog()`, and `deleteLog()` functions
**Files Changed**: lib/services/worker/worker-logger.ts
**Status**: RESOLVED in v1.10.6.

### Corporate Actions NSE Field Fix (v1.10.5)
**Issue**: Corporate actions sync saved all records as "OTHER" type with missing company names, record dates, and dividends.
**Root Cause**: NSE API uses lowercase field names (`subject`, `comp`, `recDate`, `faceVal`) but code looked for uppercase (`PURPOSE`, `COMPANY NAME`, etc.). Also dividend field mismatch (`dividendPerShare` vs `dividendAmount`).
**Fix Applied**:
- Added lowercase field mappings to `parseCorporateActionFromNse` in both routes
- Fixed dividend field name: `action.dividendPerShare ?? action.dividendAmount ?? null`
- Added Subject, Face Value, and Price columns to Upcoming Actions table
- Created `scripts/fix-corp-actions.ts` for cleanup of incorrect records
**Files Changed**: app/api/admin/nse/live-sync/route.ts, app/api/corporate-actions/combined/route.ts, app/components/analytics/CorporateActionsTable.tsx, scripts/fix-corp-actions.ts (new)
**Status**: RESOLVED in v1.10.5.

### Serverless Logging Fix (v1.10.4)
**Issue**: Worker logs and server logs not working on serverless platforms (Netlify/Vercel).
**Fix Applied**:
- Added `ServerLog` model to Prisma schema for persistent DB-backed logging.
- Created `lib/services/db-logger.ts` with helper functions: `logToDb`, `dbInfo`, `dbWarn`, `dbError`, `dbDebug`, `getDbLogs`, `cleanupOldLogs`, `getLogStats`.
- Updated `lib/services/worker/worker-logger.ts` with fallback chain: file logging → Netlify Blobs → Database.
- Created `/api/admin/logs` route for viewing and managing server logs with filtering.
- Schema synced via `prisma db push --accept-data-loss` (using Prisma Accelerate).
**Files Changed**: prisma/schema.prisma, lib/services/db-logger.ts (new), lib/services/worker/worker-logger.ts, app/api/admin/logs/route.ts (new)
**Status**: RESOLVED in v1.10.4.

### Price Alert Current Price Display (v1.10.3)
**Issue**: Alerts didn't show current stock price during creation or in the list.
**Fix Applied**:
- Added `fetchCurrentPrice` function to fetch live price when symbol is selected.
- Added `fetchAlertPrices` to get prices for all existing alerts.
- Display: "Current Price: ₹XXX" below symbol input in alert form.
- Alert list now shows current price next to each symbol.
- Also fixed admin stats to show actual worker/cron status instead of hardcoded "disabled".
- Status: RESOLVED in v1.10.3.

### Worker Cache Key Type Fix (v1.10.2)
**Issue**: `stock_sync` worker task failing with "TypeError: indexName.replace is not a function".
**Root Cause**: `generateCacheKey` in `market-cache.ts` checked `if (indexName)` but didn't verify the type was string.
**Fix Applied**:
- Changed check from `if (indexName)` to `typeof indexName === 'string' && indexName.length > 0`
- Status: RESOLVED in v1.10.2.

### Corporate Actions Duplicates Fix (v1.10.1)
**Issue**: Corporate Actions table showed duplicate entries for the same symbol and ex-date.
**Root Cause**: 
- Deduplication logic only checked `symbol + exDate` but schema unique constraint is `symbol + actionType + exDate`
- Date parsing created dates without timezone awareness (midnight vs noon)
- Multiple sync paths had inconsistent deduplication logic
**Fix Applied**:
- Fixed all `parseNseDate` functions to use UTC noon dates: `new Date(Date.UTC(yr, month, dd, 12, 0, 0, 0))`
- Updated all sync functions to use Prisma `upsert` with correct unique constraint: `symbol_actionType_exDate`
- Fixed: combined route, admin live-sync route, admin corporate-actions route, historical route, sync-service
**Files Changed**: app/api/corporate-actions/combined/route.ts, app/api/admin/nse/live-sync/route.ts, app/api/admin/corporate-actions/route.ts, app/api/admin/nse/historical/route.ts, lib/services/sync-service.ts
**Status**: RESOLVED in v1.10.1. Existing duplicates need manual cleanup via SQL.

### Stock Screener Enhancement (v1.10.0)
**Issue**: Screener was not showing any data because it relied on pre-synced database data.
**Fix Applied**: 
- Modified API to fetch directly from TradingView when database is empty.
- Added comprehensive filters: Quick Filters, Basic Filters, Advanced Filters.
- Fixed `stocks.sort()` error when data is empty.
- Fixed TradingView column names to match API (removed invalid fields like `perf.W`, `beta_1_year`).
- Status: RESOLVED in v1.10.0.

### Build Fixes (v1.9.3)
**Issue**: Build failing with async params and Zod error handling type errors.
**Fix Applied**:
- Updated dynamic route handlers to use `Promise<{ id: string }>` for params.
- Changed `error.errors` to `error.issues` for Zod v4 compatibility.
- Regenerated Prisma client.
- Status: RESOLVED in v1.9.3.

---

## Current Project Status

### Secure Join Request Flow (v1.9.2)
**Issue**: Insecure direct signup via `/users/new`.
**Fix Applied**: 
- Implemented `JoinRequest` system for admin-approved onboarding.
- Reinforced RBAC in middleware for `/users/*` and `/admin/*`.
- Refactored Admin Users page with tabbed requests/users management.
- Redirected Login Modal to the new join flow.
- Status: RESOLVED in v1.9.2.

### Notifications & Persistent Logging (v1.9.1)
**Issue**: Missing unified updates feed and ephemeral serverless logs.
**Fix Applied**: 
- Implemented `/notifications` page with role-based filtering.
- Implemented `@netlify/blobs` for persistent worker logging.
- Fixed NSE DB logs and centered login modal.
- Status: RESOLVED in v1.9.1.
- Note: Build fixed and tests passing (13/13 suites).
- Note: Requires `DATABASE_URL` and Netlify Blobs environment.

---

## Session History

### Session 8 (March 20, 2026)
- **Price Alert Enhancement**: Added current stock price display in alerts.
- **Admin Stats Fix**: Updated stats API to show actual worker/cron status.
- **Documentation**: Updated to v1.10.3.

### Session 7 (March 20, 2026)
- **Worker Cache Fix**: Fixed `stock_sync` task failing with "TypeError: indexName.replace is not a function".
- **Root Cause**: `generateCacheKey` checked `if (indexName)` but didn't verify it's a string.
- **Fix**: Changed to `typeof indexName === 'string' && indexName.length > 0`.
- **Documentation**: Updated to v1.10.2.

### Session 6 (March 20, 2026)
- **Corp Actions Fix**: Fixed duplicate corporate actions being created during NSE sync.
- **Root Cause**: Deduplication only checked `symbol + exDate` but schema requires `symbol + actionType + exDate`.
- **Fix**: Updated all sync functions to use Prisma `upsert` with correct unique constraint and UTC noon dates.
- **Files**: combined route, admin live-sync, admin corporate-actions route, historical route, sync-service.
- **Documentation**: Updated `AGENTS.md`, `agent-memory.md`, `Lessons.md`, and `Primer.md` to version 1.10.1.

### Session 5 (March 19, 2026)
- **Join Flow**: Implemented `JoinRequest` model and `/auth/join` request page.
- **Admin UI**: Added tabbed "Join Requests" management to `/admin/users`.
- **RBAC**: Secured all user management routes via middleware.
- **Cleanup**: Deleted `/users/new` and updated `LoginModal`.
- **Documentation**: Updated `AGENTS.md`, `agent-memory.md`, `Lessons.md`, and `Primer.md` to version 1.9.2.

### Session 4 (March 18, 2026)
- **Notifications**: Built `/notifications` page and aggregated API route. Combined worker tasks, audit logs, and alerts.
- **Logging**: Integrated Netlify Blobs for persistent storage. Converted logger to async.
- **UX Fixes**: Centered and polished login modal. Fixed NSE DB logging in `nse-client.ts`.
- **Documentation**: Updated `AGENTS.md`, `agent-memory.md`, `Lessons.md`, and `Primer.md` to version 1.9.1.

### Session 3 (March 18, 2026)
**Issue**: 
1. `seed.ts` failed to insert corporate actions due to incorrect CSV parsing.
2. NextAuth had a "ghost session" bug where users appeared logged in after signing out.
3. Seeding scripts threw `ECONNREFUSED` timeouts against remote Prisma Accelerate.

**Fix Applied**:
- Rewrote `seed.ts` CSV parsing to correctly parse strings with embedded commas and quotes.
- Refactored data seeding loops into `createMany({ skipDuplicates: true })` batching.
- Fixed NextAuth ghost sessions by deleting conflicting manual endpoints and renaming the session cookie.
- Status: RESOLVED in v1.8.3. 

---

## Session History

### Session 6 (March 20, 2026)
- **Worker Logger Security Fix (v1.10.6)**: Fixed CodeQL path traversal vulnerability.
- Added `sanitizeTaskIdForPath()` function allowing only safe filename chars.
- Applied sanitization to write, read, and delete operations.

### Session 5 (March 20, 2026)
- **Corporate Actions NSE Field Fix (v1.10.5)**: Fixed sync saving all records as "OTHER" type.
- **Root Cause**: NSE API uses lowercase fields (`subject`, `comp`, `recDate`, `faceVal`) not uppercase.
- **Files Modified**: app/api/admin/nse/live-sync/route.ts, app/api/corporate-actions/combined/route.ts, app/components/analytics/CorporateActionsTable.tsx
- **New File**: scripts/fix-corp-actions.ts for cleanup
- **Updated Upcoming Actions UI**: Added Subject, FV, Price columns to match Historical table format.

### Session 4 (March 20, 2026)
- **Serverless Logging Fix (v1.10.4)**: Added `ServerLog` model for DB-backed logging on serverless platforms.
- **Files Created**: `lib/services/db-logger.ts`, `app/api/admin/logs/route.ts`
- **Files Modified**: `prisma/schema.prisma`, `lib/services/worker/worker-logger.ts`
- **Corporate Actions Duplicates (v1.10.1)**: Fixed deduplication - schema uses `symbol + actionType + exDate`, not just `symbol + exDate`. Fixed date parsing to use UTC noon.
- **Worker Cache Fix (v1.10.2)**: Fixed `typeof indexName === 'string'` check in `market-cache.ts`.
- **Price Alert Enhancement (v1.10.3)**: Added current price display when creating/viewing alerts.

### Session 3 (March 18, 2026)
- **Worker Engine**: Built persistent loops for task polling and cron scheduling. Linkage with `CronJob` and `WorkerTask` models.
- **NSE Sync**: Implemented fetchers for events, news, announcements, and market data. Integrated TradingView screener sync.
- **Logging**: Switched to `.next/server_logs` with dynamic directory creation and `0o777` permissions for cross-process visibility.
- **Build Fix**: Wrapped `/admin/utils/tasks` in `Suspense` to resolve `useSearchParams` pre-rendering crash.
- **Documentation**: Updated `ARCHITECTURE.md`, `Lessons.md`, and `AGENTS.md` to version 1.9.0.

### Session 2 (March 18, 2026)
- **Corporate Actions**: Fixed missing CSV data parsing resulting in correct dividend and ratio values.
- **Prisma Rate limits**: Changed `upsert` and looped `create` calls into `.createMany()` arrays. Prevented `P2002` schema errors and `ECONNREFUSED` connection drops.
- **Auth bug**: Traced "Ghost Session" issue to cookie mismatch/stale active sessions and a custom `/api/auth/session` endpoint overriding NextAuth. Naming the cookie `tradenext-session-token` immediately resolved it.

### Session 1 (March 16, 2026)
- Started with 502 error on Netlify
- Fixed logger to output to console + file in production
- Fixed Prisma 7 adapter issue (needed driver adapter, not accelerateUrl)
- Moved type packages to dependencies for Netlify build
- Added startup logs to middleware and auth routes

---

## Pending Actions

1. [ ] Deploy and check Netlify Function logs
2. [ ] Set DATABASE_URL in Netlify environment variables
3. [ ] Verify site works after database connection fix
4. [ ] Check logs show ">>> FATAL: No valid DATABASE_URL" error

---

## CRITICAL - Database Setup Required

The app CANNOT work without a valid PostgreSQL database URL.

**Option 1: Set in Netlify Dashboard**
- Go to: Site Settings → Environment Variables
- Add: DATABASE_URL=postgresql://user:password@host:port/database

**Option 2: Use Prisma Postgres**
- Install Prisma Postgres extension in Netlify
- It will automatically set DATABASE_URL

**Option 3: Use a free PostgreSQL service**
- Neon, Supabase, Railway, etc.

---

## Notes

- Logger now exports named functions (info, warn, error, debug)
- Build command: `npx prisma generate && npm run quickbuild`
- Prisma 7 requires driver adapter or accelerateUrl
- Early logging added: check Netlify Function logs for `>>>` prefix

