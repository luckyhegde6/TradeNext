# Plan 42 — Durable Netlify Scheduled Worker and Cron Execution

> Spec: .agents/specs/42-durable-netlify-worker-cron.md
> Branch: feature/spec-42-durable-worker-cron-v2
> Base: main 10337d956cafc943c3e97f73121e1038330d86af
> Tier: B — sequential changes to the coupled worker/lease/cron core; separate tests/docs in parallel only where no shared files.
> Safety: no package installs, schema/migration edits, production env, deploy or merge without separate approval.

## Phase 0 — Baseline and evidence lock
1. Capture current-main SHA and PR #154 merge commit in handoff.
2. Read current-main HANDOFF, latest handoff, Primer, Lessons, session-todos, RULES, worker/cron docs, Specs/Plans 24, 30, 40 and 41, package scripts, Netlify config and Prisma schema.
3. Inspect Git status/branch ancestry and current implementations for all mapped services.
4. Record baseline failures separately; run targeted existing tests before edits.
5. Verify official Netlify Scheduled/Background function runtime limits and handler contract for current CLI/runtime version.

Exit: baseline is documented; no assumptions inherited from pre-merge branch as if merged.

## Phase 1 — Lease and lifecycle contract
1. Reapply optional failOpen behavior to acquireLeaderLock and renewLeaderLock; persistent Node default remains current behavior, serverless path explicitly passes false.
2. Audit atomicity: stale updateMany + create unique conflict is an acceptable acquisition pattern only if WorkerStatus uniqueness and row semantics guarantee exclusivity. Inspect whether same identity field is sufficient to prevent stale owner continuation; add fencing token only with schema approval if required.
3. Add bounded lease renewal helper using explicit runner owner ID and fail-closed renewal. No renewal success on DB error.
4. Add release-if-owner semantics and tests for fresh foreign owner, stale reclaim, DB down at acquire, DB down at renew, lost lease, release and concurrent contenders.
5. Keep existing watchLeaderRole semantics for local persistent Node; don't alter unrelated callers.
6. Add Netlify runtime gate in instrumentation so worker/cron loops do not start on Netlify, but local Node start remains unchanged. Preserve SQLite/cache/ops initialization after auditing its lifecycle; avoid starting unbounded timers on request-serving serverless runtime.

Exit: serverless path cannot acquire/renew leadership without shared DB; local path behavior regression-tested.

## Phase 2 — Durable cron tick
1. Identify exported functions and exact contracts for catchUpMissedCronJobs, spawnDueCronJob, ensureDailyRecommendationRan and ensureRecommendationCrons.
2. Extract a small serverlessCronTick service that performs ensure + catch-up + daily guarded catch-up once per runner lease.
3. Keep nextRun advancement and task creation idempotent under duplicate scheduled ticks; do not create second cron schedule or duplicate Swing performance execution.
4. Explicitly pass trigger source scheduled to the task spawn/event metadata; preserve manual/admin/API/system/catchup source labels.
5. Use the shared DB lease to ensure only one scheduler tick is processing at a time.
6. Tests: due, not due, missed tick, duplicate tick, nextRun update, existing pending/running dedup, weekend/weekday catch-up, DB unavailable.

Exit: repeated tick is safe, and DB CronJob remains authoritative.

## Phase 3 — Task capability and bounded execution
1. Extract current claim code from pollAndExecute into a one-task method. Preserve SQLite-first discovery, but rely on atomic Prisma updateMany pending→running to arbitrate across processes.
2. Create task runtime policy with safe default: eligible only after measured bound + tests. Unknown task types remain pending with explicit deferred reason.
3. Record recent duration by type from existing task started/completed timestamps; define p95 and conservative maximum. Do not use averages as hard bounds.
4. Runner has 13-minute budget, 90-second minimum headroom and concurrency 1. Check budget before task claim; check lease before every next claim.
5. Do not wrap long executor in Promise.race and mark it failed while underlying side effects continue. Hard timeout cannot reliably cancel Node promises.
6. Audit each task type: recommendation_performance, swing_performance, historical_price_sync, stock_sync/market_data, corp actions, announcements/events, CSV, deploy_prep, Sheets rescan, F-score and cleanup.
7. Test no-claim with insufficient remaining budget; task claim once with duplicate runners; lease loss after task completion; task timeout recovery and late completion ledger single-count.

Exit: serverless runner executes only tasks proven to fit or supported by a checkpoint contract.

## Phase 4 — Daily Recommendations checkpointing (critical path)
1. Trace full runDailyRecommendations lifecycle and all side effects: screener fetch, stable result snapshot, tracker/run persistence, AI preflight and batches, ranking, final status, Sheets append, Telegram broadcast, cache invalidation and audit.
2. Design run idempotency key by business/scheduled date and trigger; avoid relying on an unconstrained JSON payload for uniqueness.
3. Determine whether existing DailyRecommendationRun/WorkerTask/TaskEvent schema can durably encode each batch's state with atomic unique ownership. If not, produce a separate schema/migration proposal and stop for explicit approval.
4. Coordinator creates/reuses run, captures stable symbols/input and observation/retrieval times.
5. Deterministic batch task writes batch results exactly once; retries re-use completed results and do not repeat already-committed external effects.
6. Finalizer waits for all batch states, assembles existing ranking/business rules, records counts/outcome, publishes sheets and Telegram idempotently.
7. Recovery reclaims expired incomplete batch leases without discarding completed batches.
8. Only after acceptance tests pass, add recommendations to serverless runtime allowlist.
9. Tests: partial failure/retry, duplicate batch delivery, duplicate coordinator, finalizer wait, finalizer replay, zero successful AI batch, external notification dedup, stable result recovery.

Exit: full 25–35-minute path is distributed across bounded invocations without duplicate side effects.

## Phase 5 — Netlify function handlers and secret boundary
1. Implement standalone Scheduled Function in netlify/functions (not a Next.js Advanced API route) using current Netlify supported Request/Response + inline schedule config. Schedule every minute UTC; handler only sends a bounded POST. Confirm request body next_run and UTC schedule.
2. Implement standalone Background Function with -background suffix (not a Next.js Advanced API route), asynchronous 202 invocation contract and fixed event envelope, strict method/content-type/body size/schema checks and WORKER_DISPATCH_SECRET requirement.
3. Use constant-time fixed-length digest comparison. Missing env means fail closed; never expose token in errors.
4. Build background invocation URL from a documented trusted Netlify base URL / deploy context; do not accept URL from request.
5. Timeout/retry policy: scheduler's HTTP request should be bounded; repeated schedule invocation is safe due to lease and DB idempotency.
6. Add unit tests for handler auth, malformed body, body too large, unsupported method, missing env, wrong token, accepted dispatch, function invoke failure and no secret logging.
7. Document branch testing via Netlify UI Run now or netlify functions:invoke; scheduled functions do not auto-fire on branch deploys. Add local test instructions using generated ephemeral secret, never a committed value.

Exit: handler authentication tests pass; no public route or arbitrary job execution.

## Phase 6 — Runtime observability / DB Health
1. Extend existing admin runtime endpoint and UI from PR #154; do not add duplicate endpoint/dashboard.
2. Decide where invocation/lease fields live. Prefer existing WorkerStatus/CronJob/WorkerTask/TaskEvent where they faithfully model it; if a durable invocation ledger or fencing field is required, request schema approval before migration.
3. Show scheduler tick, background invocation, lease status/expiry, queued/due counts, deferred task type/reason, task runtime budget/actual duration and terminal outcome.
4. Correlate invocationId → CronJob → WorkerTask → TaskEvent → Sheets publish ledger.
5. Keep external Sheets publish outcome separate from task success; preserve OAuth invalid_grant diagnostics and retry ledger.
6. Add bounded query and admin-only tests; core GET stays low-query.

Exit: operators can identify exactly which stage stopped and when.

## Phase 7 — Regression and quality gates
Targeted suites first:
- npx jest lib/__tests__/leader.test.ts --runInBand
- npx jest lib/__tests__/leaderWatch.test.ts --runInBand
- npx jest lib/__tests__/worker-engine.test.ts --runInBand
- npx jest lib/__tests__/cron-daemon.test.ts --runInBand
- npx jest lib/__tests__/recommendationCronService.test.ts --runInBand
- New netlify handler/runner/checkpoint tests.

Then run individually (repository RULES):
1. npm run test (alone; no chained commands)
2. npx tsc --noEmit
3. npm run lint
4. npm run quickbuild
5. Targeted Playwright for any DB Health/Workers UI edits.

Report existing baseline failures separately; do not claim unrun/passing checks. Do not commit until local production build and all required checks pass per RULES unless a blocker is explicitly documented and user approves.

## Phase 8 — Documentation
1. Update .agents/docs/tasks-cron-workers.md and add Netlify-specific scheduler/runner section; fix stale "Netlify replaced scheduled functions" wording.
2. Update TODO.md and .agents/TODO.md quick reference; one in_progress item only in .agents/session-todos.md.
3. Update Lessons.md only for reusable runtime/lease/checkpoint lessons.
4. Update Primer.md, agent-memory.md, HANDOFF.md and .agents/handoffs/active/latest.md.
5. Add version history entry in .agents/changelog/versions-index.md and full changelog in correct v3 file (check current version index before selecting).
6. Update AGENTS.md only if the repository version-history policy explicitly requires it; do not bloat its index.
7. Record exact test results, changed files, config requirement and unresolved external auth issues.

## Phase 9 — Review, commit, push and PR
1. Inspect git diff, git status, branch ancestry and secret scan.
2. Ensure only the new branch is changed; no main/PR #154 branch modifications.
3. Commit using repo convention after all gates pass.
4. Push feature/spec-42-durable-worker-cron-v2.
5. Create PR targeting main, describe the Netlify scheduling constraints, checkpoint gates, test results and WORKER_DISPATCH_SECRET setup.
6. Do not merge or deploy.
7. After the new branch is pushed and PR is created, delete old stale branches only if their refs are confirmed and branch contents are preserved in the new branch. Never delete main or merged PR branch. Use safe branch delete API, not force updates.

## Files likely to change

New:
- .agents/specs/42-durable-netlify-worker-cron.md
- .agents/plans/42-durable-netlify-worker-cron.md
- netlify/functions/worker-dispatch.(mjs|ts) and worker-runner background function (exact suffix per Netlify conventions)
- lib/services/worker/netlify-runner.ts
- focused tests.

Modify:
- lib/services/leader.ts and leader tests
- lib/services/worker/worker-engine.ts and tests
- lib/services/worker/cron-daemon.ts only for extracted reusable tick helpers/tests
- lib/services/worker/worker-service.ts and dailyRecommendationService.ts for runtime metadata/checkpoint orchestration
- instrumentation.ts, lib/netlify.ts only if needed
- netlify.toml only if required
- existing DB Health runtime route/page and tests
- .agents/docs/tasks-cron-workers.md
- TODO/handoff/Primer/Lessons/session memory/version history.

## Rollback

Revert feature branch commits. Keep existing local persistent Node daemon behavior. Serverless scheduled/background execution is not activated until user-controlled deployment. Do not configure production WORKER_DISPATCH_SECRET until explicitly authorized and branch approved. No schema or dependency changes without separate approval.

## Hard gates / unresolved decisions
- Schema uniqueness/fencing requirement may require a migration; stop and request approval.
- Daily Recommendations batch checkpoints may require durable model changes; stop and request approval if existing task/event models cannot represent this safely.
- Netlify function handler conventions and background invocation URL must be validated against current deploy context.
- OAuth invalid_grant and Blobs expired token require operator credential refresh; no secret is modified by code.


## Netlify compatibility references checked 2026-11-08
- Scheduled Functions: https://docs.netlify.com/build/functions/scheduled-functions/ — 30s limit, UTC schedule, next_run, published deploys only, Run now / CLI invoke for previews.
- Background Functions: https://docs.netlify.com/build/functions/background-functions/ — async invocation, 202 response, up to 15 min.
- Function configuration: https://docs.netlify.com/build/functions/configuration/ — current limits and payload caps.
- Netlify Next.js migration note: https://github.com/netlify/next-scheduled-bg-function-migration — use standalone Netlify Functions rather than deprecated Next.js Advanced API scheduled/background routes.


## Branch lineage and cleanup
- Verified PR #154 merge commit a5daee935f4ef7740d4f8d4d10f6131414d7449e and main at branch creation 10337d956cafc943c3e97f73121e1038330d86af.
- feature/spec-42-durable-worker-cron was a premature empty branch based on the merge commit; feature/spec-42-durable-worker-cron-pr154 was based on the pre-merge PR head and contains the earlier draft. Both are superseded by feature/spec-42-durable-worker-cron-v2.
- Preserve old refs until the v2 branch's content is verified and pushed. Then delete both stale branches using GitHub's branch deletion API (not force-update). The GitHub connector currently exposes no branch-delete action; use repository's GitHub UI/API when available. Never delete main.
