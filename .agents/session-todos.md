# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-10) — v3.5.4: Fix #69 session persistence (branch `fix/prod-issues-68-69`)

**Branch**: `fix/prod-issues-68-69` (base: main @ PR #85 merged). NOT yet merged — user approves PR.

### Completed
- [x] Prod UI audit (live tradenext6.netlify.app, demo + admin): Screener v3.5.2 fix verified deployed (2,000 stocks, "Last synced from TradingView: 8/10/2026 2:19:30 PM", change = value + %); Recommendations still stale "Last updated: 19/7/2026"; DB Logs tab now populated (624 entries Aug 7-10 — #68 largely fixed by v3.5.0 trackAiCall deploy); Server Log Files tab still "No log files found" (serverless FS limitation); Rate Limits tab transient 500 (cold-start, direct fetch 200)
- [x] #69 root-cause confirmed: `createUserSession()` never called anywhere; `lib/auth.ts` events only wrote audit logs
- [x] **#69 fix implemented**: `lib/auth.ts` `jwt` callback now calls `createUserSession()` at login (IP via `x-forwarded-for`/`x-real-ip`, UA, derived deviceInfo from UA), stores returned token in JWT claim `dbSessionToken`; `events.signOut` invalidates via `invalidateSession()`; `invalidateSession` in `lib/services/sessionService.ts` now matches by record id (admin UI) OR sessionToken (signOut)
- [x] Tests: `lib/__tests__/sessionService.test.ts` (18 tests) — create/invalidate-by-id-or-token/invalidateAll/activity/stats/tokenVersion. Full suite: **335 passed, 0 failures** (27 suites)
- [x] Verified locally with Playwright + DB probes: login → row created with IP/UA/device ("Chrome on Windows"), 30d expiry; server-side signOut POST → `isActive: false` + LOGOUT audit; `/api/admin/sessions` now returns `{total:2, active:1, expired:1, usersWithSessions:1}` + full session rows (was all-zero)
- [x] BUGS.md updated: #68 DB logs populated (serverless FS note), #69 in-progress row, stale recs ~22d, rate-limits transient 500, screener verified

### Pending (carried forward)
- [ ] Get user approval → push `fix/prod-issues-68-69` (SSH) → create PR for #69 fix; NEVER auto-merge
- [ ] Verify prod daily crons (10 AM + 4 PM IST) after deploy — next cron window (still 0 successful runs since Jul 19)
- [ ] Re-seed demo holdings on prod
- [ ] F&O Analytics UI (services + API done, UI pending)
- [ ] #68 remaining: Server Log Files tab serverless-aware notice ("FS-based logging unavailable on serverless — use DB Logs tab")