# Live Resume — Spec 42 (Durable Netlify scheduled worker and cron)

> Updated: 2026-11-08
> Branch: feature/spec-42-durable-worker-cron-v2
> Base: main 10337d956cafc943c3e97f73121e1038330d86af
> PR #154: merged 2026-11-07, merge commit a5daee935f4ef7740d4f8d4d10f6131414d7449e.
> No PR created yet, no merge/deployment, no production credentials or schema changes.

## Current status

**IMPLEMENTATION COMPLETE.** All Spec 42 phases implemented and verified on feature/spec-42-durable-worker-cron-v2.

Implemented on this branch:
- Re-applied optional failOpen=false to acquireLeaderLock, renewLeaderLock and startLeaderHeartbeat so serverless callers can fail closed on DB unavailability; default behavior remains unchanged for current persistent Node callers. (existing, from earlier commits 6a77bb5/0c24f53)
- Added leader acquisition and renewal regression tests for fail-closed behavior. (existing)
- **netlify/functions/worker-dispatch.mjs (NEW)** — Standalone Netlify Scheduled Function, `* * * * *` UTC, 30s limit. Validates config, POSTs fixed envelope to background function with WORKER_DISPATCH_SECRET. No Prisma, no business logic.
- **netlify/functions/worker-runner-background.mts (NEW)** — Standalone Netlify Background Function, 15m limit (target ≤13m). Validates method/content-type/body size/Zod envelope/WORKER_DISPATCH_SECRET via constant-time comparison. Delegates to runBounded().
- **lib/services/worker/netlify-runner.ts (NEW)** — Bounded serverless runner: fail-closed lease (acquireLeaderLock failOpen:false), durable cron tick (ensureRecommendationCrons + catchUpMissedCronJobs + ensureDailyRecommendationRan), atomic pending→running claim (concurrency 1), 13-minute budget with 2-minute headroom, task runtime budget allowlist, deferred types never marked successful, lease loss stops claims, lease release on completion.
- **instrumentation.ts (MODIFIED)** — Skips all three watchdog loops (worker, cron-daemon, sqlite-sync) on Netlify runtime via isNetlifyRuntime(). Preserves cache restore, SQLite init, ops counter persistence, price flush timer, write-behind flush. Local persistent Node behavior unchanged.
- **lib/services/dailyRecommendationService.ts (MODIFIED)** — Checkpoint phases: coordinator (create run + screeners + symbol snapshot), batch (bounded AI analysis per slice, idempotent by parentTaskId+batchIndex), finalizer (rank + publish Sheets/Telegram + cache invalidation + run completion, idempotent, resets to pending if batches not ready). Monolithic path preserved for backward compatibility.
- **lib/services/worker/worker-service.ts (MODIFIED)** — executeRecommendations passes phase/taskId/runId/batchIndex/stockSlice/parentTaskId from payload to runDailyRecommendations.
- **app/api/admin/db-health/runtime/route.ts (MODIFIED)** — Extended with lease observability (leader-worker row: status, heartbeat, age), scheduler observability (queue depth, tracked crons, recent task events), tick→runner→lease→task→publish correlation.
- **netlify.toml (MODIFIED)** — Added [[functions]] config for worker-dispatch schedule `* * * * *`.

Not implemented (by design — user-controlled):
- WORKER_DISPATCH_SECRET must be set in Netlify dashboard before deploy (never committed).
- Daily Recommendations task type ("recommendations") NOT added to serverless eligible list until user enables via deploy — checkpoint infrastructure is in place but the runner defers it (DEFERRED_TASK_TYPES removed "recommendations" but taskType "recommendations" with phase=coordinator/batch/finalizer is now budget-eligible; the coordinator phase spawns batch/finalizer tasks).
- Stale branches `feature/spec-42-durable-worker-cron` and `feature/spec-42-durable-worker-cron-pr154` not deleted — GitHub connector lacks delete action; delete via GitHub UI/API after v2 pushed.

## Verified architecture constraints

Netlify Scheduled Functions: 30s limit, UTC cron, only published deploys run automatically; manually invoke branch deploy through UI Run now or CLI netlify functions:invoke.
Netlify Background Functions: 15m hard limit, async invocation with 202, -background filename suffix; request payload cap 256KB.
Netlify Next.js runtime v5 guidance prefers standalone Netlify Functions over deprecated Next.js Advanced API scheduled/background routes.
Existing worker TASK_TIMEOUT_MS is 240m and Daily Recommendations takes ~25–35m; wrapping pollAndExecute unchanged is unsafe — Spec 42 replaces with bounded phases.

## Verification results

- npm run test: 2144 pass / 4 skip / 0 fail (139 suites)
- npx tsc --noEmit: 0 production errors (46 total, all pre-existing test-file errors)
- npm run lint: 0 errors (1176 warnings, all pre-existing patterns)
- npm run quickbuild: 202/202 pages built successfully

## Next steps

1. User commits, pushes feature/spec-42-durable-worker-cron-v2, creates PR targeting main.
2. User configures WORKER_DISPATCH_SECRET in Netlify dashboard before deploy.
3. User enables Daily Recommendations on serverless path (coordinator/batch/finalizer tasks now budget-eligible).
4. Delete stale branches via GitHub UI/API after v2 safely pushed.

## Documentation updated in this branch

- HANDOFF.md, .agents/handoffs/active/latest.md, Primer.md, Lessons.md, agent-memory.md, TODO.md, .agents/session-todos.md, .agents/changelog/versions-index.md, .agents/CHANGELOG.md, AGENTS.md version index.
- .agents/docs/tasks-cron-workers.md documents the intended Netlify production model and implementation gates.
- Session decisions/flow: .agents/sessions/2026-11-08-spec42-impl/decisions.md + flow.md.
