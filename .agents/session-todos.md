# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-13) — v3.7.1: BUY/SELL-only Telegram broadcast + AI connection-test cron (fallback probing + audit + status) + CI e2e fix

**Working tree**: full suite **582 pass / 11 skipped** (was 560, +22: 9 broadcast + 9 connection-test + 4 cron-ensure); `npx tsc --noEmit` clean on all touched files (remaining repo errors are pre-existing test-only noise). Docs pass done (AGENTS.md v3.7.1 row, CHANGELOG index + versions-v3.md, TODO rows, Primer, agent-memory, Lessons #61–62, session flow/decisions). Branch `fix/ai-config-cron-ledger` (PR #88 open). **Commit pending user approval; no deploy.**

### Completed
- [x] Broadcast = BUY/SELL only: NEW pure `lib/services/recommendationBroadcast.ts` (`MAX_BROADCAST_PICKS = 8`, `buildRecommendationBroadcast(stocks, dateLabel?)` — all-HOLD notice, footer `🟢 N BUY · 🔴 N SELL · ⚪ N HOLD not shown`, 4000-char truncation w/ marker-length fix) wired into `dailyRecommendationService.ts` broadcast block; HOLDs still stored + tracked
- [x] AI connection-test cron: NEW `lib/services/ai/connectionTestService.ts` — `testOpenRouterModel` (raw fetch, never throws, 20s `AbortSignal.timeout`), `runAiConnectionTest` (configured → fallbacks `openrouter/free` → `openrouter/auto`; short-circuit `!hasValidConfig`), `getLastAiConnectionTests`
- [x] Audit capture (user-required): NEW `AI_CONNECTION_TEST` / `AI_CONNECTION_TEST_FAILED` tags in `lib/audit.ts`; every attempt `trackAiCall` (action `connection_test`) + overall outcome `createAuditLog` w/ full status metadata; failure → `notifyAdmins` + AI-monitoring link
- [x] Cron wiring: 4th system job `AI_CONNECTION_TEST_CRON_EXPR = "*/30 3-10 * * 1-5"` in `ensureRecommendationCrons`; worker `executeAiConnectionTest` (exported) + case; `run-cron-background.ts` whitelist + branch + recordRun; NEW `netlify/functions/cron-ai-connection-test.ts`; NEW admin `app/api/admin/ai/connection-tests/route.ts` (GET last N / POST run-now)
- [x] CI e2e fix: `e2e/advanced-screener.spec.ts` clicks `TradingView · 98` toggle (U+00B7) in template-search tests (Chartink default names "Short term breakouts"); Chartink stays jest-covered; `/markets` nested `<a>` → `<span role="link">` (hydration warning)
- [x] Tests: NEW `recommendationBroadcast.test.ts` (9), NEW `aiConnectionTestService.test.ts` (9), `recommendationCronService.test.ts` +4 (create mock + ensureRecommendationCrons); suite **582 pass**; tsc clean on touched files
- [x] Docs: AGENTS.md v3.7.1 row, CHANGELOG index + versions-v3.md entry, TODO.md 3 rows, Primer.md, agent-memory.md, Lessons.md #61–62 (`*/` in block comments; TDZ closures), session flow.md/decisions.md
- [x] Parked from earlier: analytics side-nav (`app/components/MarketAnalyticsTabs.tsx` — `?tab=` sync + emoji icons) — included in this session's commit, live-verify pending

### Pending (this session)
- [ ] Commit + push v3.7.1 on `fix/ai-config-cron-ledger` (pre-commit tsc must pass — never `--no-verify`), PR #88 updated
- [ ] Live-verify /markets/analytics side-nav + breadcrumbs via Playwright (:3000 desktop + mobile, 0 console errors)
- [ ] v3.6.3 backfill script `scripts/backfill-recommendation-levels.ts` still awaits user consent (separate item — fixes persisted trackers incl. ITC)

### Pending (carried forward — other branches / later sessions)
- [ ] **Deploy to Netlify (user-approved) → rerun recommendations → verify BUY/SELL picks + fresh public date; verify cron ledger populates after next scheduled run**
- [ ] Re-seed demo holdings on prod
- [ ] Prod: AI Connection Test cron first runs (verify audit entries + AI Monitoring `connection_test` rows after deploy)
