# Live Resume — Spec 42 (Durable Netlify scheduled worker and cron)

> Updated: 2026-11-08
> Branch: feature/spec-42-durable-worker-cron-v2
> Base: main 10337d956cafc943c3e97f73121e1038330d86af
> PR #154: merged 2026-11-07, merge commit a5daee935f4ef7740d4f8d4d10f6131414d7449e.
> No PR created, no merge/deployment, no production credentials or schema changes.

## Current status

A clean branch was created directly from latest main after PR #154 merged. Revised Spec 42 and Plan 42 are authored. The existing worker/cron documentation now describes the intended Netlify architecture and current runtime constraints.

Implemented on this branch:
- Re-applied optional failOpen=false to acquireLeaderLock, renewLeaderLock and startLeaderHeartbeat so serverless callers can fail closed on DB unavailability; default behavior remains unchanged for current persistent Node callers.
- Added leader acquisition and renewal regression tests for fail-closed behavior.
- Updated active TODO to track this clean-main branch.
- Documented Netlify Scheduled/Background Function contract and branch testing.
- Updated .agents/docs/tasks-cron-workers.md with a target architecture section and approval gates.

Not implemented yet:
- Scheduled and Background Netlify function handlers using WORKER_DISPATCH_SECRET.
- Bounded serverless runner and durable cron tick.
- Safe fencing/lease expiry, task checkpoint/idempotency semantics.
- Daily Recommendations checkpoint/batch/finalizer (current executor 25–35m).
- Netlify-only instrumentation split and DB Health serverless timeline.
- Full test/build verification.

## Verified architecture constraints

Netlify Scheduled Functions: 30s limit, UTC cron, only published deploys run automatically; manually invoke branch deploy through UI Run now or CLI netlify functions:invoke.
Netlify Background Functions: 15m hard limit, async invocation with 202, -background filename suffix; request payload cap 256KB.
Netlify Next.js runtime v5 guidance prefers standalone Netlify Functions over deprecated Next.js Advanced API scheduled/background routes.
Existing worker TASK_TIMEOUT_MS is 240m and Daily Recommendations takes ~25–35m; wrapping pollAndExecute unchanged is unsafe.
Current Prisma schema: WorkerStatus has no fencing token or lease expiry; WorkerTask has no unique checkpoint/idempotency key; CronJob.name is not unique. Safe runner/batch support may require migration, which needs explicit user approval.
PR #154 capabilities (DB Health runtime, task timeline, SQLite recovery probe correction, Sheets publish tracking) are on main and must be extended, not duplicated.
The earlier production log also reported Prisma Accelerate timeouts, Netlify Blobs expired-token upload errors and Google OAuth invalid_grant; these are external operational remediation items, not fixed by Spec 42.

## Old branch lineage

- feature/spec-42-durable-worker-cron was the preliminary branch created from PR #154 merge SHA before the first branch flow was corrected; it was effectively empty.
- feature/spec-42-durable-worker-cron-pr154 was stacked on pre-merge PR #154 head 7816d229706e24e3ae20de8e9af3a844f764f710 and holds the earlier draft/experimental fail-open options.
- Both branches are superseded by this clean v2 branch. They have not been deleted; GitHub connector has no delete-branch operation. After v2 is safely pushed, delete both through GitHub UI/API.
  
## Next steps

1. Decide/approve a schema migration design for serverless lease fencing/expiry and durable recommendation batch checkpoints if existing models are insufficient. Do not edit schema/migrations until approval.
2. Implement/test fail-closed lease with safe owner/fencing semantics.
3. Implement standalone scheduled + -background Netlify functions and WORKER_DISPATCH_SECRET validation.
4. Implement bounded cron/worker runner; only claim task types with verified runtime bound.
5. Checkpoint Daily Recommendations into coordinator/batches/finalizer, then enable recommendations task type.
6. Preserve persistent Node local loops; disable worker/cron timer startup on Netlify via lib/netlify.ts.
7. Extend PR #154 DB Health runtime endpoint/UI for tick→runner→lease→task→publish visibility.
8. Add regression tests for duplicate ticks, concurrent runner, lease lost, DB outage, checkpoint retry, finalizer idempotency and runtime budget.
9. Run npm run test alone, npx tsc --noEmit, npm run lint, npm run quickbuild, and targeted Playwright where UI changed.
10. Review final diff; commit, push, create PR only when checks pass. User asked no merge/deploy.
11. Delete stale branch refs through GitHub UI/API only after new branch safely pushed.

## Verification

No Jest/TypeScript/lint/quickbuild/Playwright checks have been run in this remote-editing session. No commit/push/PR created. No schema/migration or dependency change. No env var configured. No merge or deployment.
