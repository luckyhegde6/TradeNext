# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-14 → 08-15) — v3.11.0 (node-cron daemon, committed `6c4ef41` unpushed) + v3.11.1 (no-fake-HOLD AI-failure fix) + v3.11.2 (recs-cache module-graph singleton) + v3.11.3 (full serverless purge)

**Working tree**: branch `fix/cron-tz-swing-perf` — v3.11.0 follow-up committed `6c4ef41` (unpushed); v3.11.1 AI-failure fix committed `b2d9423` (unpushed; hook passed — tsc clean); v3.11.2 cache-singleton fix + docs NOT yet committed (pending user); v3.11.3 serverless purge code + docs NOT yet committed (pending user). Full suite **709 pass / 4 skipped** (DataFetcher.test.tsx un-skipped + rewritten — 9/9 pass; 4 skips = intentional client-cache IndexedDB); `npx tsc --noEmit` **46 errors — DOWN from the 71 baseline, 0 new**. **NO push/deploy** (⚠️ Netlify must NOT set `CRON_DAEMON_DISABLED=1` anymore — the daemon should self-start; `netlify.toml` ships no functions dir; remove Netlify cron UI entries after deploy).

### Completed
- [x] v3.11.0 follow-up commit `6c4ef41` (20 files, +440/−28; pre-commit hook passed, tsc clean, suite 694 pass/11 skip) — no push
- [x] v3.11.1 fix in `dailyRecommendationService.ts`: partition on `success` — only `success:true` verdicts persisted; zero successes → run `failed` with NO entries (`uniqueStocks:0`, `aiUnavailable:true` metadata, `run_failed` event, `SCREENER_RUN_FAILED` audit, cache invalidate) + early return `stocks: []` (no broadcast); partial failure → `deleteMany` failed/capped entries (`symbol notIn analyzed`)
- [x] `getLatestRecommendations` returns NEW lightweight `latestRun` (second findFirst, `select id/runDate/status`) + `/api/recommendations` exposes it; `page.tsx` passes `aiUnavailable`/`aiUnavailableDate`; `DailyPicksTab` amber banner `data-testid="ai-unavailable-notice"` — genuine all-HOLD days unchanged
- [x] Tests: pre-flight-FAILED + all-AI-fail rewritten (deleteMany, failed run, `stocks: []`), NEW partial-failure + newest-run-surfacing tests, single-query → two-query shape; **suite 696 pass**; tsc 71 exact baseline
- [x] Live-verified :3000 (Playwright): API `latestRun` same-id → no banner; intercepted newer failed `latestRun` → banner renders; normal state clean, 0 console errors
- [x] Docs: AGENTS.md v3.11.1 row, CHANGELOG index + versions-v3.md v3.11.1 entry, TODO.md row, Lessons #74 (update-log) + #75 (fallback-data-never-persisted), Primer (Last Updated + status), agent-memory entry, session-todos
- [x] Commit v3.11.1 code + docs → `b2d9423` (user-approved; pre-commit hook passed, tsc clean; no push)
- [x] **v3.11.2 cache fix**: `lib/cache.ts` `recommendationsCache` → `globalThis` singleton (`__recommendationsCache`, mirrors `lib/prisma.ts`) — Next.js dev loads `instrumentation.ts` + API routes as SEPARATE module graphs so the worker's flush never reached the route's copy; other caches unchanged. NEW `lib/__tests__/cacheSingleton.test.ts` (4 tests — `jest.resetModules()` identity + cross-instance visibility + worker→route `flushAll` invalidation + shared `keys()`). **Suite 700 pass**; tsc 71 exact baseline (0 new); no UI change → no Playwright re-run
- [x] Docs v3.11.2: AGENTS.md row, CHANGELOG index + versions-v3.md entry, TODO.md row, Lessons #76 (per-module-instance caches), Primer, agent-memory, HANDOFF, session flow/decisions
- [x] **v3.11.3 serverless purge (code)**: `CRON_DAEMON_DISABLED` opt-out removed from `instrumentation.ts` + `cron-daemon.ts`; `lib/netlify-logger.ts` DELETED (`git rm`) + `@netlify/blobs` dropped from `package.json`/lock (npm install removed 41 packages); `lib/logger.ts` + `worker-logger.ts` stripped all Blob/serverless branches; `app/api/admin/monitoring/route.ts` dropped `isServerless` + `serverless:` fields; monitoring page dropped `serverlessLogs` fetch + amber banner; ai-monitoring copy + `app/llms.txt` updated; ~25-file comment sweep (incl. docs/architecture.html ×6, prisma/schema.prisma)
- [x] **v3.11.3 verification**: `git grep` 0 functional serverless/blob references in code; **suite 709 pass / 4 skip** (was 700/11); `npx tsc --noEmit` **46 errors — DOWN from the 71 baseline, 0 new**
- [x] **DataFetcher.test.tsx un-skip + rewrite**: describe.skip (removed `children`/`apiCall` API, undefined globals) → rewritten for current `apiUrl`+`render` render-prop API with `useApi`/`usePaginatedApi`/`usePollingApi` mocked — **9/9 pass** (was 0 skipped); fixed render-prop arg mismatch caught by the tests
- [x] Docs v3.11.3: AGENTS.md row + header, CHANGELOG index + versions-v3.md entry, TODO.md row, Primer, agent-memory, HANDOFF, session-todos

### Pending (this session)
- [ ] Commit v3.11.3 (serverless purge code + docs) pending user approval; then push all (v3.11.3 + unpushed v3.11.0/v3.11.1) + PR; NO deploy
- [ ] Restart dev server (PID predates current run) → smoke-test instrumentation auto-start + `/api/admin/cron/daemon` liveness + admin Cron tab chip (Playwright per checklist)

### Pending (carried forward — other branches / later sessions)
- [ ] Post-deploy (v3.10.0): verify swing indicators render + MCP `getHistoricalData` 200 (prod backfill manual trigger + market-sync step 4 auto-backfill)
- [ ] Commit + push v3.7.2 on `fix/netlify-secrets-scan` (commit message WITHOUT credential literals — hook blocks them), open PR
- [ ] Commit + push v3.7.1 on `fix/ai-config-cron-ledger` (PR #88 open; pre-commit tsc must pass — never `--no-verify`), live-verify analytics side-nav
- [ ] Re-seed demo holdings on prod
- [ ] Prod: AI Connection Test cron first runs (verify audit entries + AI Monitoring `connection_test` rows after deploy) + Netlify cron UI entries removal
