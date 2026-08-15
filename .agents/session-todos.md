# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-14 → 08-15) — v3.11.0: In-process node-cron cron daemon (replaces Netlify scheduled functions) + `daysTracked` 500 fix + carried v3.10.1 batch

**Working tree**: branch `fix/cron-tz-swing-perf` — v3.10.1 batch committed `b35eca4` (unpushed); v3.11.0 daemon code + docs COMPLETE. Full suite **686 pass / 11 skipped** (was 673+11; +12 cron-daemon +1 skipSpawnCounted); `npx tsc --noEmit` 71 = exact baseline (0 new). **Commits pending user; NO push/deploy** (serverless must keep `CRON_DAEMON_DISABLED=1`; `netlify.toml` no longer ships a functions dir; remove Netlify cron UI entries after deploy).

### Completed
- [x] NEW `lib/services/worker/cron-daemon.ts` + root `instrumentation.ts` auto-start (guarded nodejs runtime, not build, `CRON_DAEMON_DISABLED=1` opt-out): `startCronDaemon()` idempotent (self-heal ensure → syncCronJobs → 60s resync + heartbeat), `syncCronJobs()` register/drop/re-register (expr-change, invalid skip, deactivated drop, per-job timezone default Asia/Kolkata), `fireJob` re-fetches row → shared `spawnDueCronJob`, heartbeat `workerStatus` upsert `cron-daemon-<host>-<pid>`
- [x] `worker-engine.ts`: `spawnDueCronJob` extracted/exported (90-min dedup, indexName defaults, nextRun advance, triggeredBy system); `checkScheduledJobs` loops it — daemon + legacy poll share one path
- [x] Admin: zod enum gap FIX (`recommendation_performance`/`ai_connection_test`/`historical_price_sync`), NEW `GET /api/admin/cron/daemon` liveness endpoint, Cron tab TASK_TYPES +3 + daemon status chip (60s refresh), workers engine route auto-start/stop drives the daemon
- [x] **Netlify cron deleted**: 5 scheduled functions + `netlify/functions/` + `[functions]` block
- [x] Ledger outcome wiring: `recordCronRun(jobName, success, { skipSpawnCounted })` (outcome-only — no double count) + NEW `recordSystemRunOutcome` in `worker-service.ts` `executeTask` (cronJobId-linked only; manual runs stay on `recordManualRunLedger`); non-fatal
- [x] **`daysTracked` sort 500 FIX** (live-found, pre-existing v3.5.0): → `orderBy.createdAt` + regression test
- [x] Carried v3.10.1 (`b35eca4`): honest latest-run, shared `modelChain.ts` fallback chain, swing tracker persistence (`@@unique([symbol, createdAt])`), SwingCard tenure pills, PerformanceTab dark-theme fix
- [x] Tests: NEW `cron-daemon.test.ts` (12 — closure-capture node-cron mock, fireJob → real `spawnDueCronJob` via setTimeout(0) flush) + 1 skipSpawnCounted; suite **686 pass**; tsc 71 exact baseline
- [x] Docs: AGENTS.md v3.11.0 row (consolidates v3.10.1), CHANGELOG index + versions-v3.md, TODO.md row, Lessons #72/#73, Primer (Last Updated + status + Session 18), agent-memory, session flow

### Pending (this session)
- [ ] Commit v3.11.0 code + docs `[skip ci]` (user approval; never `--no-verify`)
- [ ] Restart dev server (PID 17564 predates daemon) → smoke-test instrumentation auto-start + `/api/admin/cron/daemon` liveness + admin Cron tab chip (Playwright per checklist)

### Pending (carried forward — other branches / later sessions)
- [ ] Post-deploy (v3.10.0): verify swing indicators render + MCP `getHistoricalData` 200 (prod backfill manual trigger + market-sync step 4 auto-backfill)
- [ ] Commit + push v3.7.2 on `fix/netlify-secrets-scan` (commit message WITHOUT credential literals — hook blocks them), open PR
- [ ] Commit + push v3.7.1 on `fix/ai-config-cron-ledger` (PR #88 open; pre-commit tsc must pass — never `--no-verify`), live-verify analytics side-nav
- [ ] Re-seed demo holdings on prod
- [ ] Prod: AI Connection Test cron first runs (verify audit entries + AI Monitoring `connection_test` rows after deploy) + Netlify cron UI entries removal
