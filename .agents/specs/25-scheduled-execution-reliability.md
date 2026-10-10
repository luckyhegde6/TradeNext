# Spec Document — Scheduled Execution Reliability (cron · worker/outbox · daily-rec · swing)

> Copy this template for every new feature. Fill in ALL sections. Delete N/A sections only with justification.
> Save to `.agents/specs/NN-feature-name.md` (NN = sequential number per branch/epic).

## 1. Overview

**What**: Fix the scheduled-execution layer so cron jobs actually fire, missed ticks are recovered, and
work still runs when Prisma is unavailable (plan-limit hold). Concretely: (A) reconcile the cron timezone
so node-cron fires on the same clock as `nextRun`; (B) change missed-tick catch-up from *"skip if >15 min
late"* to *"run any overdue job, dedup-guarded"*; (C) let catch-up enqueue due jobs to the durable SQLite
degraded queue when Prisma is held; (D) drain the `_sync_outbox` on the existing 5-min cron resync tick;
(E) delete the dead `startScheduler`/`checkScheduledJobs` poll; (F) verify the daily-recommendations and
swing paths run end-to-end.

**Why**: Production evidence (2026-10-09):
- No daily recommendation runs since September; most recent run `failed` 2026-09-04. Cron rows stale:
  Daily Recommendations `lastRun` 2026-09-03 / `runCount` 4; Recommendation Performance `lastRun`
  2026-08-13 / `runCount` 1; Daily Market Sync `lastRun` 2026-09-02 / `runCount` 2. Only the
  30-minute-cadence AI Connection Test fires (`runCount` 28).
- Worker task `Manual: Daily Recommendations` **reaped** after 132m ("ran past 45 min"); the
  `Scheduled: Daily Market Sync` task **failed** with `"a is not iterable"`.
- `_sync_outbox` has ~13k stuck rows untouched since 2026-09-16 (the 6h recovery probe never survives
  Netlify's ~2h idle suspension).
- Root causes confirmed by code read:
  1. **Timezone split-brain** — cron expressions are UTC-authored ("Times are UTC: IST = UTC + 5:30",
     `recommendationCronService.ts:30`; `cron-parser.ts` v3.10.1 evaluates in UTC), and `nextRun` is UTC.
     But `ensureRecommendationCrons` stores `config: { systemManaged: true, timezone: "Asia/Kolkata" }`
     (`recommendationCronService.ts:208,227`) and `cron-daemon.ts:240-241` registers node-cron with that
     timezone. node-cron therefore fires `30 4 * * 1-5` at **04:30 IST = 23:00 UTC**, 5.5h off the
     `nextRun` of 04:30 UTC.
  2. **Catch-up skip window** — `catchUpMissedCronJobs` (`worker-engine.ts:856`) SKIPS any job more than
     `CRON_CATCHUP_WINDOW_MS` (15 min) overdue and advances `nextRun`. A once-daily job whose single tick
     lands while the Netlify instance is suspended (>15 min) is dropped for the day.
  3. **Degraded no-op** — `catchUpMissedCronJobs:866` and `checkScheduledJobs:812` hard-return under
     degraded mode / open breaker, so no recovery path enqueues work during a hold.
  4. **Dead poll** — `startScheduler()` (`worker-engine.ts:179`) is never called; the only caller of
     `checkScheduledJobs()` is that dead function.

**Scope**:
- **IN**: `cron-daemon.ts` timezone; `recommendationCronService.ts` stored config timezone (+ self-heal);
  `catchUpMissedCronJobs` policy (run any overdue) + degraded-mirror enqueue path; outbox drain on the
  5-min resync tick; deletion of `startScheduler` + `checkScheduledJobs` (+ their tests); verification of
  the daily-recommendations and swing drains.
- **OUT**: the Prisma plan-limit itself; the degraded-mode *state machine* (spec 21, unchanged); new
  Prisma models/migrations; any UI change (GS label fix is spec 26); changing `pushSqliteToPrisma`
  internals; the `_sync_outbox` retention policy; per-job timezone support for manually-created crons
  (kept as-is, documented caveat).

**Depends on**: Spec 21 (`degradedMode.ts`, `degradedQueue.ts`, `degradedLeader.ts`, `degradedTaskRegistry.ts`),
Spec 24 (`catchUpMissedCronJobs`, cron-daemon catch-up wiring), Plan 09 Phase 4/6 (`pushSqliteToPrisma`,
SQLite mirror writes), v3.37.0 (`busy heartbeat`, `TASK_TIMEOUT_MS`).

---

## 2. Routes

> No API route request/response shapes change. The admin Cron/daemon routes are read-only consumers of the
> daemon status and are unaffected.

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| None | — | — | No new routes |

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| None | — | — |

*(N/A justified: this is a background-execution fix; all effects are through the in-process daemon/worker.)*

---

## 3. Database Schema

*(N/A justified: no Prisma model or migration changes. The only persistence change is advancing the
existing SQLite mirror `cron_job.next_run` locally during a hold — a column that already exists.)*

---

## 4. Functions to Implement

### A. `lib/services/worker/cron-daemon.ts`

#### `DEFAULT_TIMEZONE` (constant)

- Change value from `"Asia/Kolkata"` → `"UTC"`.
- Reason: the canonical clock for expressions, `nextRun`, and `calculateNextRun` is UTC.

#### `syncCronJobs()`

- Registration timezone resolution stays `job.config.timezone || DEFAULT_TIMEZONE` (per-job manual override
  preserved), so with A1+C below the system jobs register as UTC.
- Add an info log when a job's effective timezone differs from UTC for a `systemManaged` job (defensive
  observability; must not change scheduling).

#### resync interval (`setInterval` in `startCronDaemon`)

- Add an outbox drain: `void pushSqliteToPrisma().catch(...)` (leader + breaker gated internally; safe on the
  5-min tick). Keeps the existing 6h `startRecoveryProbe` as belt-and-suspenders.

### B. `lib/services/recommendationCronService.ts`

#### `ensureRecommendationCrons()`

- Store `config: { systemManaged: true, timezone: "UTC" }` (both the update path `:208` and the create path `:227`).
- Include config drift in the self-heal `changed` detection: `existing.config?.timezone !== "UTC"`
  (or `existing.config?.systemManaged !== true`) forces a rewrite so existing prod rows self-correct on the
  next boot.
- Update the file's header comment ("timezone Asia/Kolkata" → "timezone UTC") at `:22`.

### C. `lib/services/worker/worker-engine.ts`

#### `catchUpMissedCronJobs(options?)`

- **Run-any-overdue policy**: remove the `maxLatenessMs` "skip + advance" branch. For every active job with
  `nextRun <= now`, call `spawnDueCronJob(job)` (whose 90-min pending/running dedup prevents doubles).
- **Degraded path**: replace the `if (isDegradedModeActive() || isPlanLimitBreakerOpen()) return {0,0}` early
  return. When degraded/breaker is active, read `getSqliteFallback().getCronJobs()`, select rows with
  `is_active` truthy and `next_run <= now`, and for each:
  1. `enqueueDegradedTask({ id, name, taskType, cronExpression, config })` (idempotent within 90 min), and
  2. advance the **mirror** row's `next_run` via `sqlite.upsertCronJob({ ...row, next_run: calculateNextRun(expr, getCronFrom()) })`
     so the job is not re-enqueued on the next 5-min tick. This is a zero-Prisma local write; the 6h
     `reconcileControlToPrisma` pushes it back when the hold lifts.
- Return type: `{ recovered: number; skipped: number; enqueued: number }` (`skipped` retained for
  compatibility, now always `0`; `enqueued` counts degraded-path enqueues).
- Remove `CRON_CATCHUP_WINDOW_MS` (no longer used) — or keep as a documented no-op constant only if a
  downstream import needs it (grep shows only tests/`cron-daemon` — remove it and update imports).
- Keep `now` injectable for tests (`options.now` defaults to `getCorrectedNow()`).

#### `startScheduler()` + `checkScheduledJobs()` — DELETE

- Remove both exported functions (`startScheduler` `:179`, `checkScheduledJobs` `:803`) and the now-unused
  `schedulerInterval` module variable (`:16`) if nothing else references it.
- `catchUpMissedCronJobs` (called on daemon boot + 5-min tick) is the sole scheduler scanner.
- Update `lib/__tests__/worker-engine.test.ts`: drop the `checkScheduledJobs` describe blocks
  (`:322-375`, `:865-954`) and the `checkScheduledJobs` import (`:143`); rewrite the catch-up tests for the
  run-any-overdue + degraded-enqueue behavior; update/remove the `CRON_CATCHUP_WINDOW_MS` assertion (`:502`).

### D. (No change — verify only) Daily Recommendations + Swing

- `runDailyRecommendations()` already writes SQLite-mirror-first (Prisma only via 6h sinks) and tolerates the
  tracker backfill failing (`dailyRecommendationService.ts:247-261`). After the cron fix it must run on
  schedule; a manual `runNow` MUST complete and land rows in the mirror.
- `maybeProcessSwingAnalysis()` is already drained on the 5-min resync tick (throttled 15 min,
  `cron-daemon.ts:154-161`). Verify a swing job runs; only fix if verification shows a concrete gap.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/worker/cron-daemon.ts` | Modified | `DEFAULT_TIMEZONE` → UTC; outbox drain on resync tick; systemManaged tz observability log |
| `lib/services/recommendationCronService.ts` | Modified | Store `config.timezone: "UTC"`; config-drift self-heal; header comment |
| `lib/services/worker/worker-engine.ts` | Modified | Run-any-overdue catch-up; degraded-mirror enqueue + mirror `next_run` advance; delete `startScheduler`/`checkScheduledJobs`/`CRON_CATCHUP_WINDOW_MS` |
| `lib/__tests__/worker-engine.test.ts` | Modified | Remove dead-poll tests; rewrite catch-up tests; timezone asserts |
| `lib/__tests__/cron-daemon.test.ts` | Modified | Default timezone assertion → UTC; new outbox-drain wiring test |
| `lib/__tests__/recommendationCronService.test.ts` | Modified | `config.timezone` assertion → UTC; drift self-heal test |
| `lib/__tests__/daemon-sqlite-first.test.ts` | Modified | Registration timezone assertion → UTC |
| `lib/__tests__/sqlite.test.ts` | Unchanged | Existing `pushSqliteToPrisma` coverage reused |

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/services/degradedMode` | `isDegradedModeActive` | Gate the degraded catch-up path |
| `@/lib/db-utils` | `isPlanLimitBreakerOpen` | Gate the degraded catch-up path |
| `./degradedQueue` | `enqueueDegradedTask` | Durable hand-off during a hold |
| `@/lib/sqlite` | `getSqliteFallback().getCronJobs/upsertCronJob` | Mirror read + local `next_run` advance |
| `@/lib/sqlite` | `pushSqliteToPrisma` | Outbox drain on the resync tick |
| `@/lib/cron-parser` | `calculateNextRun` | Recompute mirror `next_run` |
| `@/lib/services/timeCorrection` | `getCorrectedNow`, `getCronFrom` | Corrected clock |

---

## 7. API Contract

*(N/A justified: no route changes — see §2.)*

---

## 8. UI/UX Requirements

*(N/A justified: backend scheduling. The Google Sheets label fix — the only UI change in this workstream —
is covered by spec 26.)*

---

## 9. Rules & Guardrails

- [ ] No Prisma writes on the degraded catch-up path (mirror + `enqueueDegradedTask` only) — Lesson 156.
- [ ] Every new call is best-effort and NEVER throws into the daemon loop / node-cron scheduler.
- [ ] `pushSqliteToPrisma` is called with its defaults (leaderGate true, breaker-gated) — no override.
- [ ] Dedup is preserved: catch-up spawns rely on `spawnDueCronJob`'s 90-min window; degraded enqueue relies
      on `enqueueDegradedTask`'s 90-min window.
- [ ] No behaviour change when no correction is persisted and no job is due (identity/no-op).
- [ ] Comments explain *why* (the timezone split-brain, the suspension model), not *what*.
- [ ] Delete only code proven dead (grep evidence in §4C).

---

## 10. Expected Behavior

1. `DEFAULT_TIMEZONE === "UTC"`; a system job with no per-job override registers on node-cron with
   `{ timezone: "UTC" }`.
2. `ensureRecommendationCrons()` writes `config.timezone === "UTC"` on both create and update; an existing
   row with `timezone: "Asia/Kolkata"` is rewritten to `"UTC"` on the next call.
3. Daily Recommendations (`30 4 * * 1-5`) fires at **04:30 UTC (10:00 IST)** — matching `nextRun`.
4. A once-daily job whose tick was missed >15 min ago RUNS on the next `catchUpMissedCronJobs` (boot or
   5-min tick) and is spawned exactly once (dedup).
5. With degraded mode active / breaker open, `catchUpMissedCronJobs` enqueues each due mirror job
   (`enqueued > 0`), the leader drains + runs degraded-safe types, and the mirror `next_run` is advanced so
   the same job is not re-enqueued on the next tick.
6. The `_sync_outbox` is drained on the 5-min resync tick when Prisma is up and this instance is the
   `sqlite-sync` leader; during a hold the call is a no-op.
7. A manual "Run Now" of Daily Recommendations completes and persists rows in the SQLite mirror.
8. `catchUpMissedCronJobs` returns `{ recovered, skipped: 0, enqueued }` and never throws.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Prisma read fails during catch-up | Falls into the degraded path (mirror) or returns zero-counts; never throws | `warn`/`error` |
| SQLite mirror unavailable | Degraded enqueue skipped (`enqueueDegradedTask` returns null); returns counts 0 | `debug` |
| One job spawn throws | Caught per-job; loop continues | `error` |
| `pushSqliteToPrisma` rejects | Caught by the resync `.catch`; resync continues | `warn` (db-unavailable) / `error` |
| Invalid cron expression in mirror | `enqueueDegradedTask` still enqueues; drain refuses via registry gate | `warn` |

---

## 12. Test Strategy

### Unit Tests (`lib/__tests__/worker-engine.test.ts`)

- [ ] `catchUpMissedCronJobs` spawns a job 3h overdue (run-any-overdue; was skipped before)
- [ ] `catchUpMissedCronJobs` returns `skipped: 0`, `enqueued: 0` on the Prisma path
- [ ] `catchUpMissedCronJobs` on degraded mode enqueues due mirror jobs and returns `enqueued > 0`
- [ ] degraded catch-up advances the mirror `next_run` (no re-enqueue on a second call)
- [ ] degraded catch-up performs NO Prisma cron read
- [ ] a non-due job is never spawned/enqueued
- [ ] `checkScheduledJobs`/`startScheduler` are no longer exported

### Unit Tests (`lib/__tests__/cron-daemon.test.ts`)

- [ ] default registration timezone is `"UTC"`
- [ ] per-job `config.timezone` override is still honoured for a manual job
- [ ] the resync tick calls `pushSqliteToPrisma`

### Unit Tests (`lib/__tests__/recommendationCronService.test.ts`)

- [ ] create/update stores `config.timezone === "UTC"`
- [ ] an existing `timezone: "Asia/Kolkata"` row is rewritten to `"UTC"`

### Unit Tests (`lib/__tests__/daemon-sqlite-first.test.ts`)

- [ ] SQLite-first registration path carries `timezone: "UTC"`

### Verification (live / admin)

- [ ] `npx tsc --noEmit` — 0 new errors (baseline 46)
- [ ] `npm run test` — all pass
- [ ] `npm run lint` — 0 errors
- [ ] Local: admin "Run Now" Daily Recommendations completes; rows in the mirror
- [ ] Local: a simulated overdue mirror job is enqueued under forced degraded mode

---

## 13. Performance Considerations

- Catch-up runs on boot + every 5 min; the active-job count is small (~4 system + a few manual). The Prisma
  path is one `findMany` + N `spawnDueCronJob` (each ≤2 Prisma reads/writes). The degraded path is
  mirror-only (zero Prisma).
- `pushSqliteToPrisma` has a re-entrancy guard (`sqlitePushInFlight`) and short-circuits when the outbox is
  empty, so the 5-min tick is cheap when idle (one `sync_history` row).
- No new timers; no change to the 5-min / 15-min cadences.

---

## 14. Security Considerations

- No new routes, no new auth surface, no secrets.
- Degraded catch-up stays within the existing leader-gated drain (exactly-once cross-instance), preserving
  the F5 guarantee (no duplicate Telegram / Sheets appends / NSE load).

---

## 15. Definition of Done

- [ ] All functions implemented per §4
- [ ] All files changed per §5
- [ ] No route/schema changes (as specified §2/§3)
- [ ] `DEFAULT_TIMEZONE === "UTC"`; system-job `config.timezone === "UTC"`
- [ ] Catch-up runs any overdue job (dedup-guarded); degraded path enqueues + advances mirror `next_run`
- [ ] Outbox drains on the 5-min resync tick
- [ ] `startScheduler`/`checkScheduledJobs`/`CRON_CATCHUP_WINDOW_MS` deleted; tests updated
- [ ] Unit tests written and passing (`npm run test`)
- [ ] `npx tsc --noEmit` passes (0 new errors beyond baseline)
- [ ] `npm run lint` passes
- [ ] Local admin "Run Now" Daily Recommendations completes
- [ ] Documentation updated (AGENTS.md, CHANGELOG, TODO, Primer, agent-memory, Lessons)
- [ ] Session memory created (`decisions.md` + `flow.md`)
