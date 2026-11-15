# Session Decisions — Spec 42 Implementation (2026-11-08)

## D1. Schema approach — no migration
**Decision:** Durable Daily Recommendations checkpoints encoded entirely in existing models: `WorkerTask.parentTaskId` + `triggeredBy` + `payload` (Json) for batch identity; `DailyRecommendationRun` + `DailyRecommendationStock` for run/stock state. No Prisma schema or migration changes.

- *Context:* Spec 42 §5.5 gate says stop and request approval if existing models cannot represent batch state. User explicitly approved the no-schema-change approach.
- *Why this approach:* `WorkerTask` already has `parentTaskId`, `payload`, `triggeredBy`, `status`, `retryCount`, `maxRetries`. The atomic `updateMany` pending→running claim is the execution gate. Application-level dedup on `parentTaskId + batchIndex` before claiming is safe because the claim is atomic.
- *Impact:* Zero schema files touched. All checkpoint state lives in `WorkerTask` rows.

## D2. Lease fencing — reuse `worker_status` row, no fencing field
**Decision:** Serverless lease uses existing `leader-worker` `worker_status` row with `failOpen:false` on acquire/renew. Fencing achieved via lease staleness (`LEADER_STALENESS_MS` = 10 min) — a stalled invocation cannot renew after platform hard-kill (15 min), and a new invocation has a different `LEADER_SELF` (hostname-pid) so cannot renew a dead row.

- *Context:* Spec 42 §12 gate 2 says if existing row lacks safe token/fencing, propose additive migration. User approved reuse of existing row.
- *Why this approach:* `leader.ts` already supports `failOpen:false` (added on this branch in commits 6a77bb5/0c24f53). No new DB column needed; staleness + unique `workerId` + `workerName` match provides sufficient fencing for short-lived serverless invocations.
- *Impact:* No schema changes. `acquireLeaderLock("worker", {failOpen:false})`, `renewLeaderLock("worker", {failOpen:false})`, `releaseLeaderLock("worker")`.

## D3. Function handler design — standalone Netlify Functions
**Decision:** Two standalone functions under `netlify/functions/`:
- `worker-dispatch.mjs` — Scheduled, `* * * * *` UTC, 30s limit. Validates config, POSTs to background function with `WORKER_DISPATCH_SECRET`. No Prisma, no business logic.
- `worker-runner-background.mts` — Background, 15m limit (target ≤13m). Validates secret/envelope, acquires lease fail-closed, runs bounded serverless cron tick, claims/executes one task, releases lease.

- *Context:* Spec 42 §5.1/§5.2 and Netlify docs (verified 2026-11-08): standalone functions preferred over deprecated Next.js Advanced API scheduled/background routes.
- *Why this approach:* `netlify/functions/package.json` already exists (`{"type":"commonjs"}`). Next.js 16 runtime v5 guidance deprecates Next.js Advanced API routes. Standalone functions are the supported contract.
- *Impact:* New files under `netlify/functions/`. No package installs.

## D4. Runner concurrency — 1 task at a time, 13-minute budget
**Decision:** Runner processes exactly one task per invocation. Stops claiming new work by 13 minutes (leaves ≥2 min for persistence/shutdown). A task whose conservative runtime budget cannot fit in remaining time is deferred, not claimed.

- *Context:* Spec 42 §4 (15m Background Function limit, 13m target), §5.4 (concurrency 1), §7 (target runtime ≤13 minutes).
- *Why this approach:* Netlify hard-kills at 15 min with no reliable `finally`. One task per invocation avoids partial-write complexity. Early stop preserves headroom.
- *Impact:* New `lib/services/worker/netlify-runner.ts` with budget tracking.

## D5. Daily Recommendations resumability — coordinator/batch/finalizer
**Decision:** `runDailyRecommendations()` is split into three bounded phases dispatched as separate `WorkerTask` rows:
1. **Coordinator** (`triggeredBy: "coordinator"`): creates/reuses `DailyRecommendationRun`, runs screeners, persists stable symbol snapshot. Idempotency key = `runId`.
2. **Batch** (`triggeredBy: "batch"`, `parentTaskId` = coordinator task id, payload `{batchIndex, stockSlice}`): deterministic bounded AI batch. Retries reuse completed results; no duplicate AI spend.
3. **Finalizer** (`triggeredBy: "finalizer"`, `parentTaskId` = coordinator task id): runs only when all batches terminal; ranks, publishes Sheets/Telegram under existing dedup (Spec 30 per-day), invalidates cache.

- *Context:* Spec 42 §5.5 — current monolithic path takes 25–35 min, exceeds 15-min Background Function ceiling. Must be resumable before serverless enablement.
- *Why this approach:* No schema change (D1). Each phase is its own `WorkerTask` with atomic claim. Batch results written exactly once via `parentTaskId + batchIndex` dedup before claim. Finalizer idempotent.
- *Impact:* New orchestration logic in `dailyRecommendationService.ts` (or new file), plus `worker-service.ts` dispatch cases.

## D6. instrumentation.ts Netlify split
**Decision:** On `isNetlifyRuntime()`, skip all three `watchLeaderRole` loops (worker, cron-daemon, sqlite-sync) and the `startWorker`/`startCronDaemon` calls. Preserve cache restore, SQLite init, ops counter persistence, price flush timer, write-behind flush.

- *Context:* Spec 42 §5.7 / §7 — Netlify must not start persistent in-process cron/worker daemon loops; local persistent Node behavior unchanged.
- *Why this approach:* `lib/netlify.ts` `isNetlifyRuntime()` already exists and is multi-signal. Reuse it, no new detection heuristic.
- *Impact:* Modify `instrumentation.ts` `register()`.

## D7. WORKER_DISPATCH_SECRET — never committed
**Decision:** Secret read from `process.env.WORKER_DISPATCH_SECRET` only. Missing → 503 fail closed. Constant-time fixed-length digest comparison. Never logged, never in docs/fixtures.

- *Context:* Spec 42 §7, §8; handoff says verify whether it exists in local/Netlify env, never put value in source control.
- *Impact:* New env var documented in setup instructions (no value committed).

## Transparency
- No production DB mutations.
- No secret values in any file.
- Approval: user approved schema approach (D1) and lease reuse (D2) explicitly.

## Approvals Obtained
- Schema: no migration (user: "continue, approved the schema")
- Lease reuse: existing `worker_status` row with `failOpen:false` (user: "continue, approved the schema")
