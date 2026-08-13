# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-14) — v3.10.0: Historical-price sync into `daily_prices` (Swing indicators "—" fix) + `backtest_history` prod-gap FIX (lazy DDL)

**Working tree**: branch `feat/historical-price-sync` — committed `b312de7` (feat) + `4d49e13` (docs [skip ci]), **pushed, PR #91 open**. Local `--apply` EXECUTED (user-approved): 266 symbols, 17,198 bars, 0 errors, 658s → DB 17,411 rows / 286 symbols. Backtest fix committed (uncommitted now: +7 guard tests). Full suite **660 pass / 11 skipped** (was 653); `npx tsc --noEmit` 71 = exact baseline. **No deploy** (user-managed); prod `--apply` NOT needed (market-sync step 4 auto-backfills).

### Completed
- [x] NEW `lib/services/historicalPriceSyncService.ts` + tests (15) + CLI `scripts/backfill-daily-prices.ts` — committed `b312de7`
- [x] Wiring: worker `historical_price_sync` case + `run-cron-background` action + market-sync step 4 — committed `b312de7`
- [x] Local dry-run verified (TCS 5d → 4 EQ bars, 0 written)
- [x] **Local `--apply` backfill executed (user-approved)**: 300-symbol scope, 266 fetched, 17,198 bars, 0 errors, 658s; DB verified 17,411 rows / 286 symbols
- [x] `backtest_history` prod-gap FIX (user override): `ensureBacktestHistoryTable` lazy CREATE TABLE IF NOT EXISTS + 3 indexes, memoized, failure-retried, chain degrades to daily_prices/NSE; `resetBacktestHistoryGuard`; +7 tests; suite **660 pass**; tsc 71 baseline
- [x] Docs for the fix: plan doc flipped RESOLVED, BUGS.md #11 → fix built, AGENTS.md/CHANGELOG/versions-v3/TODO/Primer/agent-memory updated, Lessons #71 pending

### Pending (this session)
- [ ] Commit the backtest fix + docs on `feat/historical-price-sync` (PR #91 auto-updates) — pre-commit tsc clean, never `--no-verify`
- [ ] Report to user + ask: merge PR #91 → main, then deploy?

### Pending (carried forward — other branches / later sessions)
- [ ] Post-deploy verification: first market-sync run backfills daily_prices → Swing indicators render; MCP `getHistoricalData` no longer 500 (temp table self-heals)
- [ ] Commit + push v3.7.2 on `fix/netlify-secrets-scan` (commit message WITHOUT credential literals — hook blocks them), open PR
- [ ] Commit + push v3.7.1 on `fix/ai-config-cron-ledger` (PR #88 open; pre-commit tsc must pass — never `--no-verify`), live-verify analytics side-nav
- [ ] **Deploy to Netlify (user-approved) → market-sync run backfills daily_prices → verify Swing indicators render on prod**
- [ ] Re-seed demo holdings on prod
- [ ] Prod: AI Connection Test cron first runs (verify audit entries + AI Monitoring `connection_test` rows after deploy)
