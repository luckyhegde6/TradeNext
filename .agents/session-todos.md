## Current (2026-11-08 — Spec 42: Durable Netlify worker / cron, post-PR #154 baseline — IMPLEMENTATION COMPLETE)

Branch: feature/spec-42-durable-worker-cron-v2
Base: main 10337d956cafc943c3e97f73121e1038330d86af
Merged dependency: PR #154, merge commit a5daee935f4ef7740d4f8d4d10f6131414d7449e.

- [x] Verify PR #154 is merged and latest main head at branch creation.
- [x] Create clean feature/spec-42-durable-worker-cron-v2 directly from latest main.
- [x] Re-read current main HANDOFF, active handoff, Primer, Lessons, session TODOs, RULES, worker docs, Spec/Plan 40/41 and relevant source/tests.
- [x] Add revised .agents/specs/42-durable-netlify-worker-cron.md and .agents/plans/42-durable-netlify-worker-cron.md.
- [x] Document production symptoms/findings: ephemeral serverless lifecycle vs in-process timers, DB fail-open leader election, 240m task timeout vs 15m Background Function cap, 25–35m Daily Recommendations, stale task/heartbeat assumptions, SQLite boot hydration/outbox invariant from PR #154, Sheets publish and external auth issues.
- [x] Verify current Netlify docs: scheduled 30s, Background 15m, scheduled functions only run on published deploys, use standalone Netlify Functions rather than deprecated Next.js Advanced API routes; branch verification is manual/CLI.
- [x] Identify schema constraints: WorkerStatus has no fencing token or lease expiry; WorkerTask has no unique idempotency/checkpoint identity; CronJob.name is not unique. Record schema/migration approval gate.
- [x] Obtain explicit approval for no-schema-change approach (user approved): worker lease fencing/expiry/owner token NOT added — reuse `worker_status` row with lease staleness for fencing; durable task checkpoint/batch uniqueness/idempotency encoded in `WorkerTask.parentTaskId` + `triggeredBy` + `payload`; scheduler dispatch idempotency via `CronJob.nextRun` + existing dedup + lease.
- [x] Implement standalone Netlify Scheduled Function + -background handler using WORKER_DISPATCH_SECRET; strict envelope validation, constant-time auth and safe URL/dispatch.
- [x] Implement serverless runner only after lease/fencing design; bounded cron dispatch and worker claim/execute with per-task budget allowlist.
- [x] Implement Daily Recommendations coordinator/batches/finalizer before enabling recommendations on serverless path.
- [x] Audit each other worker task runtime and side-effects; defer any task that cannot fit 13m (swing_performance, csv_processing, data_sync, historical_sync, news_fetch, screener_sync deferred).
- [x] Modify instrumentation so Netlify does not start the in-process cron/worker timers; preserve local persistent Node and unrelated initialization.
- [x] Extend PR #154 DB Health runtime endpoint/page with scheduled tick→runner→lease→task→publish timeline.
- [x] Add targeted tests and run required checks individually: npm run test; npx tsc --noEmit; npm run lint; npm run quickbuild. Results: test **2144 pass / 4 skip / 0 fail**, tsc **0 production errors**, lint **0 errors**, quickbuild **202/202 pages**.
- [x] Update docs, changelog/version history, TODO, handoff and run final diff/status and secret scan.
- [ ] Commit/push and create PR only after implementation + checks pass. (user-controlled)
- [ ] Delete old refs feature/spec-42-durable-worker-cron and feature/spec-42-durable-worker-cron-pr154 after v2 is safely pushed. GitHub connector currently lacks branch-delete action; cleanup must use GitHub UI/API, not force-update.

All checks passed: npm run test **2144 pass / 4 skip / 0 fail**, npx tsc --noEmit **0 production errors**, npm run lint **0 errors**, npm run quickbuild **202/202 pages**. No schema change; no env change; no production secret configured (WORKER_DISPATCH_SECRET must be set in Netlify dashboard before deploy); no deploy or merge yet.

Verified old branches: unsuffixed feature/spec-42-durable-worker-cron was a preliminary branch from PR #154 merge commit; suffixed -pr154 branch was based on the pre-merge PR #154 head and contains prior draft. Both are superseded by v2. No stale ref has been deleted.
