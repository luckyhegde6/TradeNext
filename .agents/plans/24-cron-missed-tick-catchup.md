# Plan 24: Cron missed-tick catch-up (Netlify suspension recovery)

## Changes

### 1) `lib/services/worker/worker-engine.ts` — new exported function
- `export const CRON_CATCHUP_WINDOW_MS = 15 * 60_000;`
- `export async function catchUpMissedCronJobs(options?: { now?: Date; maxLatenessMs?: number }): Promise<{ recovered: number; skipped: number }>`
  - `now` default `getCorrectedNow()` (corrected clock, same as
    `checkScheduledJobs`); `maxLatenessMs` default `CRON_CATCHUP_WINDOW_MS`.
  - Early-return `{ 0, 0 }` when `isDegradedModeActive() || isPlanLimitBreakerOpen()`.
  - Single read: `prisma.cronJob.findMany({ where: { isActive: true, nextRun: { lte: now } } })`;
    empty → `{ 0, 0 }`.
  - `threshold = now − maxLatenessMs`; partition in memory:
    - stale (`job.nextRun < threshold`) → `prisma.cronJob.update` advancing
      `nextRun: calculateNextRun(job.cronExpression, getCronFrom())`,
      `updatedAt: new Date()`, **no spawn**; `skipped++`, `logger.info`.
    - within window → `spawnDueCronJob(job)` (its dedup guard prevents double
      firing); errors per-job logged, not thrown; `recovered++`.
  - Placement: directly after `checkScheduledJobs`.

### 2) `lib/services/worker/cron-daemon.ts` — wiring
- Import `catchUpMissedCronJobs` alongside `spawnDueCronJob`.
- **Boot**: after the initial `syncCronJobs()` try/catch, `await
  catchUpMissedCronJobs()` in its own try/catch (`isDbUnavailableError` → warn;
  else → error), log counts when > 0.
- **5-min resync tick**: inside the existing `setInterval`, after
  `syncCronJobs().catch(...)`, add `catchUpMissedCronJobs().catch(...)` with the
  same `isDbUnavailableError` split.
- Fix stale "Re-sync every 60s" design comment → 5 min + catch-up note.

### 3) Tests
- `lib/__tests__/worker-engine.test.ts` — import `catchUpMissedCronJobs`,
  `CRON_CATCHUP_WINDOW_MS`; new describe `catchUpMissedCronJobs` (7 tests):
  recover-in-window, skip-beyond-window, mixed partition, dedup-counts-
  recovered, breaker-open no-op (no Prisma reads), degraded-mode no-op, window
  constant = 15 min. Reuses existing mocks (`mockIsPlanLimitBreakerOpen`,
  `mockIsDegradedModeActive`, prisma, task-orchestrator, cron-parser).
- `lib/__tests__/cron-daemon.test.ts` — new describe `spec 24 missed-tick
  catch-up wiring` (3 tests): boot recovers a <15-min-overdue job (spawn), boot
  re-arms only a >15-min-overdue job (no spawn), 5-min resync tick recovers a
  job after `jest.advanceTimersByTimeAsync(300_000)` (fake timers, restored in
  `finally`).

## Implementation order
1. worker-engine.ts function + constant.
2. cron-daemon.ts import + boot + tick wiring + comment fix.
3. Tests (both files).
4. `npx tsc --noEmit` (expect 46 exact, 0 new).
5. Targeted Jest: `npx jest worker-engine cron-daemon` (via `npm run test` path).
6. Docs: CHANGELOG bullets, Primer, agent-memory, session-todos; **no AGENTS.md
   edit** (over 32,768 B cap — Lesson 142; record in changelog file).
7. Commit + push to PR #134 (user approval first) — flag netlify.toml
   production change from spec 23 in the push summary.

## Risks / mitigations
- **Double firing with node-cron**: `workerTask` dedup guard inside
  `spawnDueCronJob` (single operator, cross-instance safe).
- **Accelerate API connection failures on the findMany**: errors propagate to
  the daemon's catch → warn; next 5-min tick retries.
- **Fake-timer flakiness**: only the resync-tick test uses fake timers, restored
  in `finally`; `advanceTimersByTimeAsync` flushes microtasks.
- **Read pressure**: one extra small `cronJob.findMany` per instance per 5 min
  (~288/day — negligible vs. the 30 s worker poll).