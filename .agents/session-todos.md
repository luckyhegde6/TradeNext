# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-07) — ph20: Recommendation Performance Tracking & Archival (v3.5.0)

**Design doc**: `docs/designDoc/ph20-recommendation-performance-design.md` (12 phases)
**Branch**: `ph20` (code + tests + docs complete; commit + PR pending)

### In Progress
- [x] Phase 1 — Schema: `RecommendationArchive` model + `DailyRecommendationStock.trackerId` nullable/SetNull; migration `20260807103000_add_recommendation_archive`; `prisma generate` done
- [x] Phase 1 — `scripts/backfill-recommendation-categories.ts` **run on local dev DB**: 683 tracking (short=554, swing=129), archived=0
- [x] Phase 2 — `calculateNextRun` weekday support (`lib/cron-parser.ts` shared by worker-engine + admin cron route); dow-only `v<=6` cap bug fixed
- [x] Phase 2 — `spawnCronTask()` `triggeredBy` override; `ensureRecommendationCrons()`; audit actions added
- [x] Phase 3 — `lib/services/recommendationPerformanceService.ts` (getPerformanceList, archiveRecommendations, getPerformanceColumns, invalidateRecommendationsCache)
- [x] Phase 3 — `checkRecommendationPerformance()` reworked (tracking→target/SL, triggerSource system, fold archive, invalidate cache, no EXPIRY_DAYS)
- [x] Phase 4 — API: `/api/recommendations/performance` (public, Zod, 10-key sort enum), `/api/admin/recommendations/archive` (admin), `/api/admin/recommendations` POST spawns worker tasks
- [x] Phase 5 — UI: `PerformanceTab.tsx` wired into `/recommendations` as 5th tab
- [x] Phase 6 — Tests: `cronParser.test.ts` + `recommendationPerformanceService.test.ts` — 24/24 pass; full suite 310 passed / 11 skipped; `npx tsc --noEmit` clean (production files)
- [x] Phase 6 — Local functional verify: dev server + Playwright (Performance tab renders, sort=entryPrice 200, pagination Page 2/28, mobile 375 no overflow, zero console errors)
- [x] Phase 6 — Docs: AGENTS.md (v3.5.0 row + Skills section + matrix), `.agents/CHANGELOG.md` + `versions-v3.md`, CHANGELOG.md, TODO.md, Primer.md, agent-memory.md, Lessons.md (48-49), README.md, swagger
- [ ] Commit ph20 on branch `ph20` + push + PR (never auto-merge)

### Carried Forward (from ph19/ph20-backtest)
- [ ] Deploy to Netlify + verify prod (recommendations stale-data fix, Telegram updates, history prices, DB logs tab, ph20 perf tracking)
- [ ] Verify prod daily crons (10 AM + 4 PM IST) after deploy
- [ ] Re-seed demo holdings on prod
- [ ] Wire live-price SSE hooks into Portfolio/Watchlist tables
- [ ] Persist default `HOLD` label when AI analysis falls back (bare "🟡 %" history cards)
- [ ] F&O Analytics UI (services + API done, UI pending)
- [ ] Fix prod issues #68 (monitoring logs) + #69 (sessions) — still open
