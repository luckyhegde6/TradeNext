# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-14) — v3.10.0: Historical-price sync into `daily_prices` (Swing indicators "—" fix) + `backtest_history` prod-gap plan (docs only)

**Working tree**: branch `main` → switching to `feat/historical-price-sync`. New service + worker wiring + CLI script + 15 tests uncommitted (see `git status`). Full suite **653 pass / 11 skipped** (was 638); `npx tsc --noEmit` 0 errors on touched files (71 = exact baseline). Local dry-run verified (TCS 5d → 4 EQ bars, 0 written, 0 errors, 0.8s). **`--apply` (local or prod) NOT run — needs explicit user permission. No deploy.**

### Completed
- [x] Investigate sync infrastructure: `fetchSecurityWiseHistoricalData` (lib/nse-api.ts) + nse-client retry/session; worker-service task switch; run-cron-background knownActions + market-sync steps; DailyPrice model + ingest upsert idiom; RecommendationTracker/ChartinkScreenerResult scope sources; `runInChunks` private copies
- [x] NEW `lib/services/historicalPriceSyncService.ts` — scope resolution (explicit OR NIFTY 50 ∪ 30d trackers ∪ live screener captures, capped 300), `buildDateRange` (DD-MM-YYYY validated), EQ fetch via existing fetcher, 200ms inter-symbol delay, `maxDurationMs` cap, multi-row `$executeRawUnsafe` ON CONFLICT upserts (chunk 200, `$n` params, BigInt volume), per-symbol error tolerance, dry-run, `db` override
- [x] Wire `historical_price_sync` case + `executeHistoricalPriceSync` (dry-run default) in worker-service.ts
- [x] Wire `historical-price-sync` background action (payload passthrough, no ledger) + **step 4 of market-sync** (`dryRun:false`, 6-min budget, non-fatal) in run-cron-background.ts
- [x] NEW `scripts/backfill-daily-prices.ts` CLI (dry-run default; `--apply`/`--symbols`/`--days`/`--from`/`--to`/`--max-symbols`)
- [x] Tests: NEW `lib/__tests__/historicalPriceSyncService.test.ts` (15); suite **653 pass**; tsc exact 71 baseline
- [x] Local dry-run verified (TCS 5d → 4 EQ bars fetched, 0 written, 0 errors, 0.8s)
- [x] Plan (docs only): `.agents/docs/plan-backtest-history-prod-gap.md` (options A migration deploy / B lazy CREATE TABLE / C daily_prices-first chain) + BUGS.md rows #11 (backtest_history) + #12 (daily_prices gap — fix built)
- [x] Docs: AGENTS.md v3.10.0 row, CHANGELOG index + versions-v3.md, TODO.md rows, Primer.md, agent-memory.md, Lessons.md #69/#70, session-todos.md

### Pending (this session)
- [ ] Commit on `feat/historical-price-sync` (feat + docs `[skip ci]`) — pre-commit tsc clean, never `--no-verify`
- [ ] Report to user + ask permission for `--apply` backfill (local first, then prod) and deploy

### Pending (carried forward — other branches / later sessions)
- [ ] Apply missing migration / lazy CREATE TABLE for prod `backtest_history` (per `.agents/docs/plan-backtest-history-prod-gap.md`, user decision)
- [ ] Commit + push v3.7.2 on `fix/netlify-secrets-scan` (commit message WITHOUT credential literals — hook blocks them), open PR
- [ ] Commit + push v3.7.1 on `fix/ai-config-cron-ledger` (PR #88 open; pre-commit tsc must pass — never `--no-verify`), live-verify analytics side-nav
- [ ] **Deploy to Netlify (user-approved) → market-sync run backfills daily_prices → verify Swing indicators render on prod**
- [ ] Re-seed demo holdings on prod
- [ ] Prod: AI Connection Test cron first runs (verify audit entries + AI Monitoring `connection_test` rows after deploy)
