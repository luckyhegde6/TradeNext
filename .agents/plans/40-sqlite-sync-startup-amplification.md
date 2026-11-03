# Plan 40 — Reduce SQLite / Prisma sync amplification

> Spec: `.agents/specs/40-sqlite-sync-startup-amplification.md`
> Branch: `fix/sqlite-sync-startup-amplification`
> Base: `main` / `7934335793a0773b39ecbc01ccbb59742dfdcfc5`
> Tier: B — sequential, one subsystem at a time.

## Phase 1 — Reproduce and lock contracts
1. Add tests describing current boot hydration contract: every instance pulls, `skipReconcile:true`, no outbox push at boot.
2. Add tests for `startRecoveryProbe` cadence and actions: currently declared 15 minutes; establish whether it triggers full pull and outbox push.
3. Assert sync in-flight guard and breaker-open behavior; document existing per-instance boundaries.

## Phase 2 — Correct recurring sync cadence
4. Reconcile code with Spec 09 and user intent: boot-only Prisma→SQLite pull; recurring six-hour SQLite→Prisma push.
5. Make any cadence configurable only if existing project conventions support it; avoid new env vars absent need.
6. Add unit tests for interval/timing, leader gating, skipped non-leader, breaker-open and push failure/retry.

## Phase 3 — Snapshot upload amplification
7. Map digest initialization/reset and Blobs snapshot version/ETag APIs currently available.
8. Design conditional/cross-instance upload coordination that cannot overwrite a newer snapshot with stale bytes.
9. Implement only if correctness can be established. Add concurrent uploader, same bytes, changed bytes, failure retry, cold Blobs context and deferred-restore tests.

## Phase 4 — Lifecycle / duplicate timer audit
10. Trace instrumentation invocation semantics in Netlify and inspect local in-memory accumulator ownership.
11. Do not leader-gate daily price flush until cross-instance data-loss behavior is resolved. Add tests before any change.
12. Inspect cron ensure/update and leader-election write counts; optimize only redundant writes without weakening lease expiry/recovery.

## Phase 5 — Query attribution
13. Identify provider dashboard/query stats available for production attribution.
14. Add privacy-safe structured diagnostics with instance ID, trigger, direction, table, rows, durations and sync outcome. Do not log parameters/secrets.

## Phase 6 — Verification and docs
15. Run targeted Jest suites, then `npm run test`, `npx tsc --noEmit`, `npm run lint`, `npm run quickbuild` individually as required by RULES.
16. Update TODO, Lessons (only if new reusable lesson), Primer, version history/changelog, session-todos, HANDOFF and active latest handoff.
17. Review diff and branch status. No commit/push/PR/merge/deploy absent explicit authorization.

## Rollback
Revert focused cadence/snapshot commit(s). No schema migration is planned. Preserve current mirror snapshots and outbox rows; never clear or rewrite sync state as a rollback shortcut.
