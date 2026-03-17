# Primer.md - Session Tracking

> Agent reads this at the start of every session to understand current state and progress

## Last Updated
2026-03-18

---

## Current Project Status

### Netlify Deployment - 502 Error & Database Issues
**Issue**: Production site returned 502 Bad Gateway.
**Fix Applied**: 
- Removed NextAuth from Next.js middleware.
- Fixed Prisma 7 adapter configuration for Accelerate.
- Status: RESOLVED in v1.8.2.

---

### Corporate Actions DB Seeding & Auth Ghosts
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

