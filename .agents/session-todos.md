# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-16) — v3.12.0 (Swing tab prod failure FIX — request-time split / async AI analysis) + prod-stability batch + prod `daily_prices` backfill — branch `fix/swing-async-analysis`

**Working tree**: v3.12.0 code + tests + docs complete, **NOT committed** (pending user approval → PR merge → Netlify rebuild = deploy). Full suite **722 pass / 4 skip** (was 711/4; 4 skips = intentional client-cache IndexedDB); `npx tsc --noEmit` **46 errors = exact baseline, 0 new**. **NO push/deploy** without user go-ahead.

### Completed
- [x] **Swing async split**: `getSwingRecommendations({analyze:true})` returns the fast screener feed instantly with `analysisStatus:"pending"`; AI analysis (4 batches × 5, 38–52s/batch — Netlify's 30s wall killed the old sync path mid-batch-3) runs in `runSwingAnalysisInBackground()` (module-guarded fire-and-forget, `swingAnalysisInFlight` dedupe, `flushSwingAnalysis()` test hook) → patches analysis, honest `analysisStatusAfterBatch`, persists trackers (non-fatal), audits START/COMPLETE|FAILED + RUN_COMPLETE, re-sets the SAME 30-min cache key (pending self-expires at 10-min `SWING_PENDING_TTL`); `SwingResponse.analysisStatus` union + `"pending"`; `SwingTab` pulsing "AI targets generating…" badge + SWR function-form `refreshInterval` (10s pending / 60s after)
- [x] **Perf-check live-price fallback**: `checkRecommendationPerformance` bridges trackers with no `daily_prices` rows (cap 50, chunked 10-batch `Promise.allSettled` via `getStockQuote`) → Current/Return % never blank (4 new tests)
- [x] **Prod `daily_prices` backfill APPLIED (user-approved)**: 3 passes (300+107+22 scoped → 246+85+7 fetched, **21,195 bars, 0 errors**) → tracking-tracker coverage **8 → 115/130 (88%)**, prod **37,387 rows / 602 tickers** (15 stragglers = NSE 200-with-empty-data, probed; covered by fallback)
- [x] **Worker reaper heartbeat-aware rewrite**: `reapStaleWorkerTasks` fail-safe `{0,0}` on liveness-lookup failure (worker-engine.test.ts 11/11)
- [x] **Prisma per-query timeout**: `lib/prisma.ts` `$extends({query:{$allOperations}})` + `Promise.race` (default 120s, `QUERY_TIMEOUT_MS`) + stage logs in `runDailyRecommendations`
- [x] **Worker-logger `resolveLogsDir()`** (`.next/server_logs` → `os.tmpdir()/tradenext-logs` → DB fallback) + **error serialization** in worker-engine/cron-daemon (`error={}` in prod logs)
- [x] `scripts/fetch-swing-prices-to-prod.ts` dangling import fixed; `DailyRecommendationStock` verdicts verified read-only at runtime
- [x] **Verification**: suite **722 pass / 4 skip**; tsc **46 = exact baseline 0 new**; live-verified :3000 (`force=1` → 6s pending → 225ms cached `done`, 20/20 AI targets, 0 console errors)
- [x] Docs: AGENTS.md v3.12.0 row (amended), CHANGELOG index + versions-v3.md entry, TODO.md rows, Primer Session 19 + status, agent-memory entry, Lessons #78–80, HANDOFF, handoff latest.md, session `decisions.md` + `flow.md` (`2026-08-16-a6d2f41`)

### Pending (this session)
- [ ] Commit v3.12.0 (code + docs) pending user approval → push `fix/swing-async-analysis` + PR (ask first); **NO deploy** — user merges PR → Netlify rebuild = deploy
- [ ] Post-deploy smoke: `/api/recommendations` `latestRun` healthy (was `failed` 08-15), Performance check shows Current/Return % for the 130 trackers, Swing tab loads instantly + targets within ~2–3 min, monitoring DB logs + ai-monitoring rows OK

### Pending (carried forward — other branches / later sessions)
- [ ] Post-deploy (v3.10.0): verify swing indicators render + MCP `getHistoricalData` 200 (prod backfill manual trigger + market-sync step 4 auto-backfill)
- [ ] Commit + push v3.7.2 on `fix/netlify-secrets-scan` (commit message WITHOUT credential literals — hook blocks them), open PR
- [ ] Commit + push v3.7.1 on `fix/ai-config-cron-ledger` (PR #88 open; pre-commit tsc must pass — never `--no-verify`), live-verify analytics side-nav
- [ ] Re-seed demo holdings on prod
- [ ] Prod: AI Connection Test cron first runs (verify audit entries + AI Monitoring `connection_test` rows after deploy) + Netlify cron UI entries removal
