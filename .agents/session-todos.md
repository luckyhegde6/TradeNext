# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-11) — v3.5.4: AI config plumbing + cron ledger (branch `fix/ai-config-cron-ledger`)

**Branch**: `fix/ai-config-cron-ledger` (base: main @ `c995a10`). Code + tests + docs done. Commit pending. **No deploy this session** (user explicit).

### Completed
- [x] Prod root-cause #1: `dailyRecommendationService` L322 called `analyzeStocks(aiInput)` with NO AI config → env-only default → DB `ai_config` Secret never reached pipeline → prod all-HOLD → BUY/SELL-filtered public page stale since Jul 19 (prod run after API-side config fix still all-HOLD = code-side confirmed)
- [x] Prod root-cause #2: `DEFAULT_MODEL`/`AVAILABLE_MODELS` stale — `tencent/hy3:free`, `qwen/qwen3-next-80b-a3b-instruct:free`, `inclusionai/ling-3.0-flash:free` don't exist (404 verified vs live 399-model catalog); new default `nvidia/nemotron-3-ultra-550b-a55b:free` + refreshed list
- [x] Fix: shared async `loadConfig()` (DB Secret > env, lazy prisma import) in `lib/services/ai/config.ts`; pipeline passes config to `analyzeStocks`; admin AI test route deduped onto `loadConfig()`
- [x] Prod root-cause #3: `CronJob` ledger (`lastRun`/`runCount`/`successCount`/`failureCount`/`nextRun`) only written by `spawnCronTask`/resident scheduler (never on serverless); `successCount`/`failureCount` had NO writer; `run-cron-background.ts` bypassed ledger
- [x] Fix: `recordCronRun(jobName, success)` (name lookup, counters, `nextRun` via `calculateNextRun`, safe no-op) wired into `netlify/functions/run-cron-background.ts` (success+failure) + admin PATCH runNow/retry via `recordManualRunLedger` (skips cronJobId-linked tasks)
- [x] Tests: `lib/__tests__/recommendationCronService.test.ts` (5). Full suite: **340 passed / 11 skipped / 0 failures** (28 suites); tsc clean on touched production files
- [x] Memory infra: `.agents/rules/session-decisions-flow.md` (MANDATORY decisions.md + flow.md) + `sessions/2026-08-11-c995a10/` (D1–D8)
- [x] Docs: AGENTS.md v3.5.4 row, `.agents/CHANGELOG.md` + `versions-v3.md`, Primer.md (status + Session 15), agent-memory.md, Lessons.md (56–57), BUGS.md (#3 + #2a), session-todos.md, handoff latest.md v1.1
- [x] Branch created `fix/ai-config-cron-ledger` from main; full suite + tsc verified

### Pending (this session)
- [ ] Commit `fix/ai-config-cron-ledger` (11 modified + 3 untracked) — pre-commit hygiene first (git status, junk artifacts, secrets grep)
- [ ] Push (SSH) + open PR; never auto-merge

### Pending (carried forward — other branches / later sessions)
- [ ] **Deploy v3.5.4 to Netlify (user-approved) → rerun recommendations → verify BUY/SELL picks + fresh public date; verify cron ledger populates after next scheduled run**
- [ ] Get user approval → push `fix/prod-issues-68-69` (SSH) → create PR for #69 fix; NEVER auto-merge
- [ ] Verify prod daily crons (10 AM + 4 PM IST) after deploy — next cron window
- [ ] Re-seed demo holdings on prod
- [ ] F&O Analytics UI (services + API done, UI pending)
- [ ] #68 remaining: Server Log Files tab serverless-aware notice ("FS-based logging unavailable on serverless — use DB Logs tab")