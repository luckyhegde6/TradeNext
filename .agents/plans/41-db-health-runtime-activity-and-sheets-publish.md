# Plan 41 — DB Health runtime activity and Sheets publish recovery

> Spec: .agents/specs/41-db-health-runtime-activity-and-sheets-publish.md
> Branch: fix/sqlite-sync-startup-amplification
> Tier: B — sequential focused implementation; runtime visibility first, Sheets second.

## Phase 1 — Runtime endpoint + DB Health UI
1. Add admin-only /api/admin/db-health/runtime route using bounded Prisma reads for recent WorkerStatus, CronJob, and WorkerTask rows.
2. Derive active/stale state from a documented heartbeat threshold; expose createdAt as first-seen (not guaranteed process boot time) and exact ISO timestamps.
3. Extend DB Health UI with Active Instances and Scheduled/Worker Activity sections; exclude idle/stale workers from the live list while retaining their stored records; keep existing GET zero-Prisma.
4. Add route/UI tests for auth, filters, timestamps, stale states, errors and loading/empty states.

## Phase 2 — Scheduled job visibility / performance trace
5. Verify cron names/types and worker task contracts. Display system daily recommendations, recommendation performance, historical sync and the swing companion's task event/log.
6. Add/adjust task event logging only where current execution path lacks a durable trace; no duplicate execution or new cron row.
7. Add regression tests for task event names/metadata and outcome timestamps.

## Phase 3 — Google Sheets status and publish
8. Trace readHeaderState, OAuth client acquisition and exporter failure status. Return sanitized diagnostic codes/messages in status.
9. Separate UI actions and copy: producer publish/export versus ledger Sync now. Keep queue drain semantics unchanged.
10. Repair the supported publish path (metrics snapshot append is already an explicit operation); ensure status refresh and accurate success/error feedback.
11. Add focused route/service/UI tests for header diagnostics, queue-empty, missing config, auth/API errors, append outcomes, no duplicates.

## Phase 4 — Documentation and verification
12. Update session TODO, Primer, Lessons if reusable, changelog/version index, HANDOFF and active latest handoff per rules.
13. Run targeted Jest suites; then npm run test, npx tsc --noEmit, npm run lint, npm run quickbuild individually.
14. Inspect branch diff/status. No commit/push/PR/merge/deploy absent explicit authorization.

## Rollback
Revert focused route/UI/service changes. No schema or environment changes. Preserve Google Sheets ledger and existing sheet rows.
