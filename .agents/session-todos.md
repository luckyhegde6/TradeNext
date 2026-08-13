# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-13) — v3.9.0: Swing Trading Signals tab (34 swing screeners, family segregation, AI LONG/SHORT/OBSERVE) + scope-aware cache-key fixes + NSE candlestick chart buttons

**Working tree**: branch `fix/cron-reaper-ai-pipeline` (carries committed v3.8.0 `5b7c5da` feat + `ccf87ee` docs; v3.5.4→v3.7.3 holds remain on other branches). Swing feature + chart buttons + tests uncommitted (see `git status`). Full suite **634 pass / 11 skipped** (was 597); `npx tsc --noEmit` 0 swing errors (total 71 = exact pre-existing baseline). Playwright verified desktop + mobile 375px — 0 console errors; chart-button click tests opened TITAN-EQ / SARDAEN-EQ / NIFTY%2050 correctly (outer Link never fired). **Commit APPROVED by user; NO deploy (deploy on hold per user).**

### Completed
- [x] Swing API `GET /api/recommendations/swing` (`force=1`/`analyze=0`) — 34 swing-category Chartink templates (`lib/services/chartink-scans/swing.json` + `swing` category) via unified runner (Chartink 419 → TV fallback by design)
- [x] `lib/services/swingRecommendationService.ts` — family segregation (momentum/breakout/trend/mean-reversion/crossover/bearish), composite rank, top-20 cap, 25-bar indicator enrichment (RSI/SMA/EMA/vol trend; "—" locally = data gap)
- [x] `lib/services/ai/swing-agent.ts` — batch-5 retry×2 concurrency-3, `trackAiCall("swing_analysis_batch")`, LONG→BUY/SHORT→SELL/OBSERVE→HOLD via `evaluateRecommendationLevels`, fallback OBSERVE conf-40
- [x] UI: `SwingTab.tsx` + `SwingCard.tsx` wired into `/recommendations` sidebar "🌊 Swing"; daily run `excludeCategoryIds:["swing"]` — Today's Picks unchanged
- [x] Scope-aware cache keys: `unifiedCacheKey(options)` (templateIds/categoryId/exclusions) + swing `${key}:ai|noai` — regression-tested with REAL registry ids
- [x] NSE candlestick chart buttons: SwingCard + RecommendationCard (dark-theme ChartBarIcon, `aria-label`+`title`) + Markets index cards ("Chart" icon button, `stopPropagation`) via `openNSEChart` — click-verified, 0 console errors
- [x] Tests: `swing-agent.test.ts` (30) + `swingRecommendationService.test.ts` (7) + cache-key regression; suite 634 pass
- [x] Docs: AGENTS.md v3.9.0 row, CHANGELOG index + versions-v3.md, TODO.md rows, Primer.md, agent-memory.md, Lessons.md #67, session-todos.md
- [x] Playwright verify (desktop + mobile 375px, 0 console errors, chart URL click tests, Swing tab family chips/refresh/expand)

### Pending (this session)
- [x] Commit 1 (feat): `cd2b4c4` — swing tab + cache-key fixes + NSE chart buttons + tests (pre-commit tsc clean, never `--no-verify`)
- [x] Commit 2 (docs): `0692b50` `[skip ci]` — changelog + session docs; session archive `dc2b572` `[skip ci]` — `.agents/sessions/2026-08-13-cd2b4c4/{decisions,flow}.md`
- [x] Push + PR: branch pushed with upstream; **PR #90** raised → https://github.com/luckyhegde6/TradeNext/pull/90 (base main, 5 commits, +3788/−170)
- [ ] Review PR #90 feedback (if any) → merge (never auto-merge)
- [x] Reset Playwright viewport from mobile 375px back to desktop (done — 1440×900)

### Pending (carried forward — other branches / later sessions)
- [ ] Commit + push v3.7.2 on `fix/netlify-secrets-scan` (commit message WITHOUT credential literals — hook blocks them), open PR
- [ ] Commit + push v3.7.1 on `fix/ai-config-cron-ledger` (PR #88 open; pre-commit tsc must pass — never `--no-verify`), live-verify analytics side-nav
- [ ] **Deploy to Netlify (user-approved) → rerun recommendations → verify BUY/SELL picks + fresh public date; verify cron ledger populates after next scheduled run**
- [ ] Re-seed demo holdings on prod
- [ ] Prod: AI Connection Test cron first runs (verify audit entries + AI Monitoring `connection_test` rows after deploy)
