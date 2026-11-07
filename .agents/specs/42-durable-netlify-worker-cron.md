# Spec 42 — Durable Netlify Scheduled Worker and Cron Execution

> Status: Revised after PR #154 merge; implementation pending on this clean feature branch.
> Branch: feature/spec-42-durable-worker-cron-v2
> Base: main at 10337d956cafc943c3e97f73121e1038330d86af (verified 2026-11-07).
> Related merged work: PR #154, merge commit a5daee935f4ef7740d4f8d4d10f6131414d7449e.
> Authorization: implement on feature branch; do not merge, deploy, configure production credentials, or modify DB schema without approval.

## 1. Executive summary

Replace reliance on in-process cron and worker timers as the production wake-up mechanism on Netlify with a platform-scheduled, authenticated, bounded execution path. Preserve TradeNext's existing PostgreSQL/Prisma task queue, CronJob.nextRun schedule ledger, task executor registry, TaskEvent timeline, SQLite mirror/degraded queue and admin controls.

The Netlify Scheduled Function is a short dispatcher only. It invokes an authenticated Background Function using Netlify's supported standalone Functions format (not deprecated Next.js Advanced API scheduled/background routes) that obtains a fail-closed distributed lease, recovers due cron jobs, and processes only work that is safe to execute inside the remaining function budget. The platform timer wakes the runner; database rows remain the durable schedule and task truth.

Daily Recommendations currently has an observed 25–35 minute monolithic path, beyond the 15-minute Netlify Background Function ceiling. It must be made resumable with durable idempotent batches and a finalizer before that job can be enabled in the serverless worker. All other task types require a measured/declared runtime audit. Wrapping the old pollAndExecute() unchanged in a Background Function is explicitly forbidden.

## 2. Production findings and problem statement

Evidence supplied by the user in the Nov 7 worker log/dashboard investigation and repository inspection:
- Multiple Netlify instance identifiers and process startups; in-process timers are tied to request-serving Node process lifecycle and are not a durable schedule.
- Repeated leader acquisition/loss/reclaim; current leader election deliberately returns local leadership when DB unavailable. That behavior can permit multiple serverless instances to consider themselves leader.
- Worker engine uses a process-local setTimeout polling loop; task execution can run for much longer than a serverless invocation.
- Current worker TASK_TIMEOUT_MS is 240 minutes, while Background Functions have a 15-minute limit. The application timeout therefore does not protect a serverless process from platform termination.
- Daily Recommendations code includes a screener stage, persistence, AI preflight and multiple AI batches; observed production duration was approximately 25–35 minutes.
- Stale-task reaper and task heartbeats assume an owner process that can continue refreshing its heartbeat.
- PR #154 merged the SQLite recurring recovery-probe correction, DB Health runtime endpoint/active instance/timestamp views, and Sheets publish diagnostics/outcome events. These are now current-main capabilities and must be reused.
- Earlier logs showed Prisma Accelerate connectivity/timeouts, Netlify Blobs expired-token snapshot upload errors, and Google OAuth invalid_grant. These require separate operational/config remediation and must not be falsely represented as fixed by the scheduler implementation.
- Earlier log evidence showed large repeated SQLite mirror restores/uploads and sync durations. PR #154 removed recurring full Prisma→SQLite pulls from the recovery probe; preserve that invariant. Do not infer SQL table-level bottlenecks without query telemetry.

User value:
1. Schedules wake independently of request-serving process lifetime.
2. Duplicate schedule deliveries are harmless.
3. Work is claimed once across instances using a shared DB lease and the existing atomic WorkerTask claim.
4. Long jobs resume from durable progress rather than being killed by a platform limit.
5. Operators can trace scheduled tick → runner → lease → task → publish outcome with timestamps and reason codes.
6. Local persistent Node development and the existing SQLite degraded mode retain supported behavior.

## 3. Verified repository baseline and reuse map

PR #154 is merged into main:
- Merge commit: a5daee935f4ef7740d4f8d4d10f6131414d7449e.
- main at branch creation: 10337d956cafc943c3e97f73121e1038330d86af.
- New feature branch is created directly from that main SHA.

| Module | Current responsibility | Required treatment |
|---|---|---|
| lib/services/worker/worker-engine.ts | pollAndExecute(), atomic pending→running updateMany claim, stale reaper, spawnDueCronJob(), catchUpMissedCronJobs(), ensureDailyRecommendationRan() | Extract one bounded claim/execute operation; preserve atomic claim, TaskEvent, cron ledger and catch-up guards. Never call an unbounded poll loop. |
| lib/services/worker/cron-daemon.ts | UTC node-cron registrations, 5-minute resync/catch-up, system cron ensure, daemon heartbeat | Reuse ensure/catch-up primitives from serverless tick; keep in-process daemon for local persistent Node. |
| lib/services/worker/task-orchestrator.ts | spawnCronTask, spawnRegularTask, task creation, event log and dedup | Continue using as the only task creation path. |
| lib/services/worker/worker-service.ts | Existing 31+ task-type executor switch, task outcomes and external side effects | Remain business executor registry; add conservative serverless runtime eligibility metadata adjacent to task dispatch. |
| lib/services/leader.ts | worker_status lease acquire/renew/release; default fail-open local degraded behavior | Add explicit failOpen:false to acquisition and renewal (and heartbeat wrapper if reused) for serverless only; preserve existing default for current persistent Node callers. This option was present on the earlier pre-merge branch but was NOT included in PR #154; reapply on this branch and test. |
| lib/services/recommendationCronService.ts | System cron definitions, UTC expressions, task-type/job-name map and ensure logic | Keep schedule definitions and config payload source of truth; no extra daily/swing cron unless separately proven necessary. |
| lib/services/worker/degradedQueue.ts, degradedExecutor.ts, degradedTaskRegistry.ts | SQLite durable degraded queue and conservative degradedSafe registry | Preserve safety gates. Serverless fail-closed DB leadership does not authorize bypassing degraded-mode rules. |
| lib/sqlite.ts | Per-instance mirror, boot hydration, Blobs snapshots, outbox and recovery probe | Preserve PR #154's no-recurring-full-Prisma-pull behavior; keep boot hydration and SQLite→Prisma outbox semantics distinct. |
| instrumentation.ts | Starts in-process cron and worker loops, cache/SQLite/price/ops helpers | On Netlify skip only the in-process scheduler/worker loops; preserve local persistent Node and non-scheduler setup. Validate Netlify detection using lib/netlify.ts. |
| lib/netlify.ts | Multi-signal Netlify runtime detection | Reuse, do not add duplicate detection. |
| app/api/admin/db-health/runtime/route.ts and app/admin/utils/db-health/page.tsx | PR #154 bounded runtime data and activity views | Extend for scheduler tick, background invocation, lease and deferred-task fields without increasing core DB Health GET query footprint. |
| Existing /api/admin/workers and /api/admin/cron routes | Session/admin-protected controls | Preserve auth contracts; machine secret is not an admin session credential. |
| Google Sheets exporter/ledger/status | Producer publish, retry ledger and status | Keep Sheets publish result distinct from worker task result; never replay delivered ledger rows. |

Relevant tests to extend:
- leader.test.ts, leaderWatch.test.ts, degradedLeader.test.ts
- worker-engine.test.ts, worker-service.test.ts, task-orchestrator tests
- cron-daemon.test.ts, recommendationCronService.test.ts
- netlify.test.ts
- dbHealthRuntimeRoute and DB Health page tests
- new focused handler/auth, serverless runner, task budget and checkpoint/resume tests.

## 4. Netlify execution constraints

Confirm current Netlify docs before implementation and in documentation:
- Scheduled Functions hard limit: 30 seconds.
- Background Functions hard limit: 15 minutes.
- Scheduled handler performs one authenticated HTTP handoff only: no Prisma reads, queue claims or business logic.
- Background runner stops claiming new work by 13 minutes (leave at least 2 minutes for persistence and shutdown).
- Never rely on JavaScript finally, process shutdown hooks or timers running at the hard platform deadline.
- One runner lease should process one task at a time initially. It may exit with pending queue work; the next minute tick continues.
- If a task's conservative duration budget cannot fit in remaining time, do not claim it.

## 5. Target architecture

```mermaid
flowchart TD
  A[Netlify Scheduled Function<br/>every minute UTC] -->|POST fixed envelope<br/>Bearer WORKER_DISPATCH_SECRET| B[Netlify Background Function]
  B --> C{Secret and schema valid?}
  C -->|no| X[Reject 401/400/503<br/>no task work]
  C -->|yes| D[Acquire shared worker lease<br/>fail closed]
  D -->|held or DB unavailable| N[No-op / retry next tick]
  D -->|acquired| E[Ensure system cron definitions]
  E --> F[Catch up due CronJob.nextRun]
  F --> G[Existing guarded Daily Recommendations catch-up]
  G --> H[Select eligible task within time budget]
  H --> I[Atomic WorkerTask pending → running]
  I --> J[Bounded executor / resumable batch step]
  J --> K[Persist task, events and cron outcome]
  K --> L[Release lease / report runner summary]
  L --> M[DB Health runtime timeline]
  J -. external publish outcome .-> P[Google Sheets delivery ledger]
```

### 5.1 Scheduled function
- Implement as a standalone file under netlify/functions with inline config.schedule = "* * * * *" (UTC), using the currently supported Netlify Functions Request/Response contract. Do not implement it as a Next.js API route.
- Schedule: * * * * * UTC, one-minute wake-up.
- No DB reads, task execution, imports of the heavy application service graph or business logic.
- Create fixed envelope: source=scheduled, scheduledAt ISO timestamp, nextRun informational only.
- POST to internal Background Function with Authorization: Bearer WORKER_DISPATCH_SECRET.
- Bounded HTTP timeout below 30 seconds; sanitized logging only.
- No inbound/user-supplied task IDs, cron IDs, task types, schedule expressions or arbitrary payloads.

### 5.2 Background function
- Use the supported -background function filename suffix (for example worker-runner-background.mts) and supported standalone Netlify handler contract. Netlify responds 202 to asynchronous invocations; handler result is not returned to the scheduled caller.
- POST only; validate content type, strict Zod envelope and small body-size cap.
- Missing WORKER_DISPATCH_SECRET => fail closed; never fall back to public unauthenticated execution.
- Constant-time bearer comparison (fixed-length digest comparison); never log authorization header or secret.
- No task selector accepted from request.
- Acquire shared worker lease; call acquire and renew with failOpen:false.
- No process-local leader fallback.
- Lease renewal loss stops new claims immediately.
- Release on ordinary completion; lease expiry and task state recovery handle hard termination.
- Return sanitized invocation outcome; do not leak database errors, secrets, task payloads or provider credentials.

### 5.3 Durable cron dispatch
- Existing CronJob rows and nextRun remain authoritative; platform schedule is only a wake-up.
- Reuse ensureRecommendationCrons(), catchUpMissedCronJobs() and ensureDailyRecommendationRan() where their contracts fit, extracting a shared durable tick if needed.
- Preserve UTC/time correction, per-job timezone, system-managed config payload, runCount/nextRun, job-level dedup and catch-up semantics.
- Duplicate tick delivery must neither advance nextRun twice nor create duplicate WorkerTasks.
- Record source=scheduled distinctly from system/manual/admin/API/catchup origins.
- Do not introduce separate Swing performance cron if the existing performance task already executes Swing companion work.

### 5.4 Bounded worker execution and task capability registry
- Extract the existing atomic claim/updateMany and single-task execution flow into an explicit callable bounded operation.
- Keep existing worker service executor switch; introduce a conservative metadata map (taskType, maxRuntimeMs, resumable, serverlessEligible, reason). Unknown/unsafe tasks are deferred, not claimed.
- Initial concurrency = 1 per acquired lease.
- A task may be claimed only if its measured/conservative runtime + safety margin fits in remaining runner budget.
- Do not change persistent Node worker's 240-minute task timeout as a workaround; its runtime contract is distinct from Netlify's 15-minute ceiling.
- Maintain TaskEvent and CronJob outcome accounting exactly once even on retry, worker crash or late completion.
- Preserve SQLite degraded registry. If DB is unavailable serverless runner fails closed and does not independently create local degraded leadership.

### 5.5 Daily Recommendations resumability (mandatory gate)
Current runDailyRecommendations() is monolithic and takes 25–35 minutes. The serverless worker must not claim this task until it is safely resumable.

Proposed durable phases:
1. **Coordinator**: create or reuse a run ID for the business date and scheduled fire idempotency key; run screeners and persist a stable selected-symbol/input snapshot plus source observation timestamps.
2. **Batch tasks**: partition AI analysis into deterministic bounded batches (e.g. fixed batch index and stable stock list). Persist each batch's status, attempts, outputs/errors and completion marker. Retrying the same batch must not duplicate rows or AI spend after a committed output.
3. **Finalizer**: only run once all batches are terminal and required successes are known. Persist recommendations using existing ranking rules; perform cache invalidation; publish Sheets/Telegram under existing idempotency/dedup safeguards.
4. **Recovery**: runner reclaims only expired batch leases; completed batch results are reused; incomplete batches are retried within configured cap. Finalizer is idempotent.

Schema decision gate:
- First determine whether existing WorkerTask + task payload + TaskEvent records can represent all durable checkpoint state with correct atomic constraints.
- If a new unique batch/checkpoint table or idempotency key is required, author migration spec and STOP for explicit user approval before modifying Prisma schema or migrations. Do not pretend non-unique JSON payload is a concurrency-safe unique key.
- Do not generate recommendations from synthetic AI defaults or fabricate targets. Preserve AI evidence/failure semantics from existing service.

### 5.6 Other task runtime audit
Measure/derive conservative max execution time for:
- recommendation_performance and Swing companion,
- swing_performance when run independently,
- historical_price_sync,
- market_data/stock_sync,
- corp_actions and announcements/events,
- CSV processing,
- deploy_prep,
- Google Sheets rescan/publish,
- F-score batches and cleanup.
Tasks requiring >13 minutes or unknown bounds are excluded until chunked/resumable. Do not rely on average duration only; use p95 and worst safe bound, plus cancellation/partial-write analysis.

### 5.7 Instrumentation
- On Netlify runtime, do not start in-process worker and cron loops. Scheduled + Background functions own execution.
- Keep local persistent Node development's existing instrumentation startup, worker and cron loops.
- Preserve cache restore, SQLite initialization, ops counter persistence and other non-scheduler startup only after auditing per-request/serverless lifecycle.
- Use isNetlifyRuntime() from lib/netlify.ts, not a new environment heuristic.

### 5.8 Observability and operator UX
Extend PR #154 DB Health runtime endpoint/UI with:
- last scheduled tick and schedule timestamp;
- background invocation ID/start/end/duration/outcome;
- current lease holder, acquired/renewed/expiry timestamps and fail-closed reason;
- queue depth and eligible/deferred count by task type/reason;
- task claim/start/heartbeat/progress/completed/failed timestamps;
- declared runtime budget and actual duration;
- cron scheduledAt, enqueuedAt and taskId correlation;
- external publish state kept distinct (Sheets queued/published/failed, Telegram delivery outcome if existing provider path supports it).
Keep data bounded and admin-only. Do not add Prisma reads to the core low-cost DB Health route; use the existing separate runtime endpoint.

## 6. Functional requirements

- FR-01 Scheduled handler is a one-minute UTC wake-up and performs only authenticated dispatch.
- FR-02 Background runner rejects missing configuration, invalid token, invalid method, oversized/malformed body.
- FR-03 Secret comparison is constant-time and never logged.
- FR-04 Request cannot choose arbitrary work, task ID or cron.
- FR-05 Concurrent runners yield one shared DB lease owner.
- FR-06 DB outage fails closed for lease acquisition and renewal; no local leader.
- FR-07 Lease loss stops further claims; current task is only recoverable under explicit task checkpoint/idempotency rules.
- FR-08 CronJob.nextRun and existing task dedup are the schedule source of truth.
- FR-09 Atomic WorkerTask updateMany pending→running remains the execution gate.
- FR-10 Runner stops claiming by 13 minutes and task claim requires adequate remaining budget.
- FR-11 Daily Recommendations is disabled for serverless execution until durable batch/finalizer support and tests pass.
- FR-12 Unsafe/unknown task types remain pending and get an observable deferred reason; never mark them successful merely because skipped.
- FR-13 Existing persistent Node development mode and admin manual execution remain supported.
- FR-14 SQLite boot hydration/outbox/degraded contracts and PR #154 no-recurring-full-pull invariant remain intact.
- FR-15 Runtime UI shows trigger-to-outcome timestamps and distinguishes Sheets publish from worker completion.
- FR-16 No DB schema/migration or package installation without separate approval.
- FR-17 No PR merge, deploy or production credential changes during this work.

## 7. API / function contracts

### Scheduled function
- Netlify schedule: * * * * * (UTC).
- Internal POST to background function.
- Envelope: { source: "scheduled", scheduledAt: ISO-8601, nextRun: ISO-8601 | null }.
- No secrets in function response or logs.
- Execution budget: 30 seconds max.

### Background function
- POST only.
- Header: Authorization: Bearer <WORKER_DISPATCH_SECRET>.
- Fixed envelope above; strict Zod validation and body cap.
- Missing secret configuration => 503 fail closed; invalid token => 401; invalid envelope => 400; lease held => 202/204 no-op; successful bounded run => 200; sanitized operational error => 5xx.
- Target runtime <=13 minutes; one task concurrently.
- No public Next.js API route needed unless repository's Netlify function routing requires it. If a route is added, must use existing admin/machine-auth standards and update API route table/OpenAPI.

## 8. Security and privacy
- WORKER_DISPATCH_SECRET: high entropy, functions-scoped server-side Netlify env; value never committed or output.
- Constant-time comparison; avoid length timing by comparing fixed-length HMAC/digest bytes.
- Strict schema, body size, content type, method and fixed source.
- No user-controlled code/task payload; no arbitrary forwarding.
- Existing admin auth remains session-based.
- Logs include invocationId, trigger, instance, taskId and sanitized error code only; never secrets/tokens/private payloads.

## 9. Failure behavior

| Failure | Required response |
|---|---|
| Missing secret config | 503, fail closed, no task/DB mutation |
| Invalid token | 401, no DB mutation |
| Invalid request schema | 400, no DB mutation |
| Duplicate runner / lease held | 202/204 no-op |
| PostgreSQL unavailable | no lease, no claims, retry next scheduled tick |
| Lease renewal lost | stop claiming immediately; record lease-lost where possible |
| Task cannot fit remaining budget | do not claim; record deferred capability reason |
| Hard timeout risk | stop new claims early; persist progress before 13 minutes |
| Duplicate cron delivery | CronJob.nextRun + existing dedup + lease make it harmless |
| SQLite degraded mode active | preserve existing degraded registry and queue semantics; serverless lease cannot claim leadership without DB |
| Google Sheets invalid_grant | keep publish failure in exporter ledger; worker outcome remains independently accurate |
| Blobs expired token | surface snapshot persistence failure independently; do not trigger full mirror pull as a workaround |

## 10. Out of scope
- Replace Prisma/PostgreSQL, SQLite, task queue, degraded queue or add Redis/BullMQ.
- Introduce an external always-on compute provider.
- Change stock universe, recommendation scoring, AI models or market schedules.
- Rework Google Sheets schema/history or replay already delivered rows.
- Repair/rotate production Netlify Blobs or Google OAuth credentials (separate operator remediation; diagnose and document).
- Modify Prisma schema/migration without approval.
- Merge or deploy.

## 11. Acceptance criteria
- [ ] Netlify scheduled handler one-minute UTC, no Prisma access and only protected dispatch.
- [ ] Background handler enforces method/content/body/secret and constant-time comparison; no secret leakage.
- [ ] Concurrent runner tests prove only one lease holder and duplicate tick no-ops.
- [ ] Both leader acquisition and renewal fail closed on DB outage for runner, while existing persistent Node default behavior stays covered.
- [ ] Due CronJob rows enqueue once from persisted nextRun; catch-up and manual origins remain separate.
- [ ] Existing atomic WorkerTask claim remains single execution gate.
- [ ] Runtime budget prevents claiming a task that cannot finish safely; one-task concurrency and early stop covered by tests.
- [ ] Daily Recommendations batch coordinator, deterministic child batches and finalizer are durable/idempotent; only then add to serverless eligible list.
- [ ] Every other task type has measured/defensible budget or explicit deferred reason.
- [ ] Netlify instrumentation skips in-process cron/worker timers; local Node mode remains unchanged.
- [ ] DB Health displays scheduled tick→runner→lease→task→external publish outcomes.
- [ ] PR #154 SQLite/Sheets/DB Health behavior remains regression-tested.
- [ ] No schema migration/package added without approval; no secret value committed.
- [ ] Full Jest, TypeScript, lint, quickbuild and relevant E2E pass.
- [ ] Docs and handoff updated; branch diff reviewed.

## 12. Risks and explicit gates
1. **Task checkpoint schema:** existing Prisma schema must be assessed; if durable batch uniqueness cannot be enforced using existing models, stop and request schema/migration approval.
2. **Lease semantics:** a worker_status heartbeat row is currently designed for long-lived owners. Ensure the serverless acquisition/renewal period and expiry are safe against runtime restarts and cannot steal a live lease. If existing row lacks a safe token/fencing field, propose an additive schema migration and stop for approval.
3. **Cancellation:** platform termination may skip finally. Only start resumable/idempotent tasks and stop early.
4. **DB outage:** do not reinterpret local degraded-mode behavior as a distributed lease.
5. **Production auth errors:** invalid_grant and expired Blobs token are external config issues; code may improve diagnostics, but only the user/operator rotates secrets.


## 13. Official Netlify function contract verified 2026-11-08

- Scheduled Functions use a standalone Netlify Function and UTC cron configuration; the request body contains next_run, and scheduled handlers cannot be invoked directly by URL.
- Scheduled Functions run on published deploys only; branch/deploy-preview verification must use the Functions UI Run now action or netlify functions:invoke.
- Scheduled Function execution limit is 30 seconds.
- Background Functions use the -background filename suffix (or supported background config), are asynchronously invoked and return an initial 202; their maximum execution is 15 minutes and payload limit is 256 KB.
- Netlify Next.js Runtime v5 guidance deprecates Scheduled/Background Next.js Advanced API routes in favor of standalone Netlify Functions. This spec uses standalone functions under netlify/functions.
- Implementation must verify the current Netlify Functions package/types already available; do not install a package without approval. Use native platform types/handlers only if the installed Netlify bundler accepts them.
