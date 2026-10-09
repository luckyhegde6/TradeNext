# Spec 24: Cron missed-tick catch-up (Netlify suspension recovery)

## Problem statement

Netlify **suspends** the persistent process between requests and **recycles** it
roughly every 2 h. A node-cron tick that lands while the instance is
suspended/recycled is simply **missed** (`WARN [NODE-CRON] missed execution`),
and nothing re-scans `nextRun` afterwards — the 60 s `checkScheduledJobs` poll
(`worker-engine.ts`) is **never started in production** (`instrumentation.ts`
starts only the cron daemon + the 30 s worker poll). Result: once-daily jobs
(Daily Recommendations `30 4 * * 1-5`, Rec Performance `30 10 * * 1-5`, Daily
Market Sync `1 1 * * 1-5`) were **dropped for the whole day** whenever the tick
landed inside a suspension/recycle window. The `*/30` AI Connection Test
survives because it fires 48×/day.

## Goal

Recover jobs whose tick was missed while the process was suspended/recycled,
with a bounded, operator-approved cadence: a 5-min catch-up pass piggybacked on
the cron daemon's existing resync tick, recovering jobs missed within **15
minutes** and **skipping (+ re-arming) jobs missed beyond 15 minutes** so a long
downtime cannot pile up stale runs.

## Scope

- **worker-engine.ts**: export `catchUpMissedCronJobs(options?: { now?, maxLatenessMs? })`
  → `{ recovered, skipped }` — single `cronJob.findMany({ isActive, nextRun ≤ now })`,
  partition in memory (within window → `spawnDueCronJob`; stale → advance
  `nextRun` via `calculateNextRun` **without running**). Same guards as
  `checkScheduledJobs`: no-op when `isDegradedModeActive()` or
  `isPlanLimitBreakerOpen()`. Export `CRON_CATCHUP_WINDOW_MS = 15 * 60_000`.
- **cron-daemon.ts**: import + call catch-up on **boot** (a fresh Netlify
  instance picks up jobs that ticked moments before the recycle) and on the
  **5-min resync tick** after `syncCronJobs()`. Graceful error handling via
  `isDbUnavailableError` (warn, keep daemon alive).
- Resiliency: the `workerTask` dedup guard in `spawnDueCronJob` prevents double
  firing with node-cron when the job fires normally shortly after being caught
  up.

## Acceptance criteria

1. A job whose tick was missed ≤ 15 min ago is spawned on the next resync tick
   (and on boot) — `{ recovered: 1, skipped: 0 }`.
2. A job missed > 15 min ago is re-armed (nextRun advanced) **without** being
   run — `{ recovered: 0, skipped: 1 }`.
3. Mixed due lists partition correctly; dedup (already pending/running task)
   counts the job as recovered without a duplicate spawn.
4. Degraded mode engaged or plan-limit breaker open → `{ 0, 0 }`, **zero Prisma
   reads**.
5. Nothing regresses: existing daemon + worker-engine suites stay green (boot
   catch-up runs inside every `startCronDaemon` call).
6. tsc 46 exact (0 new, prod 0), lint 0 errors in new code.

## Verification

- New Jest suites in `worker-engine.test.ts` (7 tests) + `cron-daemon.test.ts`
  (3 tests: boot recover, boot skip-beyond-window, 5-min-tick recover with fake
  timers).
- `npx tsc --noEmit`, targeted Jest runs, then full `npm run test`.

## Out of scope

- Fixing the Netlify suspension itself (platform behaviour), `TZ`/`UTC` host
  clock hardening, and switching the process to a government-style job scheduler.
  Recorded in `.agents/session-todos.md` as follow-up findings.