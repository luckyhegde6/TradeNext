# Primer.md - Session Tracking

> Agent reads this at the start of every session to understand current state and progress

## Last Updated
2026-03-20

---

## Current Project Status

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

