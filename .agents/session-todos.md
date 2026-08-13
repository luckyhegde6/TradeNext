# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-14) — v3.9.1: Swing `analysisStatus` honesty fix (live-verified prod bug) + live verification of v3.9.0 on tradenext6.netlify.app

**Working tree**: branch `main` (v3.9.0 merged via PR #90 `264dd6c`, deploy green/published). Fix: `analysisStatusAfterBatch` + 3 regression tests uncommitted (see `git status`). Full suite **638 pass / 11 skipped** (was 634); `npx tsc --noEmit` 0 errors on touched files (71 = exact baseline). Live verification of v3.9.0 PASSED on tradenext6.netlify.app (Swing tab + chart buttons, 0 console errors desktop + mobile 375px). **Commit pending user; NO deploy.**

### Completed
- [x] Live-verify v3.9.0 on tradenext6.netlify.app: Swing tab "20 picks · 200 flagged · 34 screeners" + family chips + "TV fallback" badges + "+30 more" expand; chart buttons AXISBANK-EQ / NIFTY%20BANK (outer Link never fired); **0 console errors/warnings desktop + mobile 375px**
- [x] Diagnose prod findings: (a) analysisStatus bug — header "AI targets ready" over all-failed AI batch ("Unusable AI response (p)" ×2 attempts; agent swallows per-stock failures, no throw → catch unreachable → unconditional "done"); (b) indicators all "—" on prod — `daily_prices` 0–1 rows per swing pick (data gap, SQL validated locally); (c) `backtest_history` table missing on prod → MCP getHistoricalData 500s (separate pre-existing gap)
- [x] Fix: NEW pure `analysisStatusAfterBatch(stocks)` — "done" only when ≥1 stock carries `analysis`, else "failed"; `analyze=false` keeps "skipped"
- [x] Tests: +3 in `lib/__tests__/swingRecommendationService.test.ts` (partial→done, all-failed→failed regression, empty→failed); suite **638 pass**; tsc exact 71 baseline
- [x] Docs: AGENTS.md v3.9.1 row, CHANGELOG index + versions-v3.md, TODO.md row, Primer.md, agent-memory.md, Lessons.md #68, session-todos.md

### Pending (this session)
- [ ] Commit (feat + docs `[skip ci]`) — pre-commit tsc clean, never `--no-verify`; branch or direct-to-main per user preference; then PR/merge + optional deploy
- [ ] Report live verification + prod data gaps to user (historical-price sync job into prod `daily_prices`; `backtest_history` creation) — user decides scope

### Pending (carried forward — other branches / later sessions)
- [ ] Commit + push v3.7.2 on `fix/netlify-secrets-scan` (commit message WITHOUT credential literals — hook blocks them), open PR
- [ ] Commit + push v3.7.1 on `fix/ai-config-cron-ledger` (PR #88 open; pre-commit tsc must pass — never `--no-verify`), live-verify analytics side-nav
- [ ] **Deploy to Netlify (user-approved) → rerun recommendations → verify BUY/SELL picks + fresh public date; verify cron ledger populates after next scheduled run**
- [ ] Re-seed demo holdings on prod
- [ ] Prod: AI Connection Test cron first runs (verify audit entries + AI Monitoring `connection_test` rows after deploy)
