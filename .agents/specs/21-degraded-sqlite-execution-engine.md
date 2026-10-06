# Spec Document — Degraded SQLite Execution Engine & Preemptive Plan-Limit Switch

> Status: **APPROVED — user approved 2026-10-05; implementation in progress**
> Date: 2026-10-05 · Branch: `feature/google-sheets-tracking` (PR #133, unmerged)
> Numbering: spec 21 (follows 20-google-sheets-admin-console)
>
> ### Implementation notes added during build (authoritative where they differ from §4)
>
> - **Netlify Blobs DOES offer a real compare-and-swap.** The original design assumed no CAS
>   primitive existed and settled for a best-effort write + re-read. That was wrong:
>   `@netlify/blobs@11.0.3` exposes `onlyIfNew` / `onlyIfMatch` on `setJSON` plus the current
>   `etag` from `getWithMetadata` (verified against its `SetOptions` / `GetWithMetadataOptions`),
>   which is a genuine atomic lease. `consistency: "strong"` on the read side prevents a stale
>   "nobody holds it" read from authorising a second claimant. Implemented as an ETag CAS.
> - **Leader is split by DB availability, not always-Blobs.** While the breaker is CLOSED
>   (Prisma healthy) the existing, battle-tested Prisma election is authoritative — a
>   THRESHOLD-triggered degraded mode fires on a healthy DB and needs no new lock. Only when the
>   breaker is OPEN (Prisma unusable, `leader.ts` fail-open) does the independent fail-closed
>   Blobs lease take over. Both paths admit at most one leader; the Blobs path is the hard one.
> - **Renew cadence is 60s, lease 10min** (`lib/services/degradedLeader.ts`), not the §13 "5min"
>   figure. The 60s renew is deliberate: it shrinks the residual fencing window (a taken-over
>   instance can execute for at most one renew interval before noticing) well below the 10min
>   lease, and one small conditional write/minute by the single leader is negligible.
> - **Degraded lock object key is `degraded-leader`** in store `degraded-leader-lock` (§3 said
>   the key was `lock`; the store name is unchanged, a snapshot upload cannot touch it).

## 1. Overview

**What**: Add a reversible **Degraded Mode** in which cron jobs are discovered, claimed, executed and
recorded against the local SQLite mirror instead of Prisma, elected by exactly one instance via a
Netlify Blobs lock — plus a **preemptive** trigger that flips the site into Degraded Mode when monthly
Prisma operations reach 90% of the plan limit (180,000 of the 200,000 default), rather than waiting for
a P6003 hold to actually throw.

**Why** (user request, 2026-10-05): Netlify Blobs must work, SQLite must be able to trigger jobs when
Prisma is unavailable, `/recommendations` must serve while Prisma is down or on hold, SWING/PERFORMANCE
must keep working, Today's Picks is currently not working, and history/recommendations written during a
hold must be stored in SQLite and synced to Prisma on the 6-hour sync.

> ### ⚠️ Diagnosis correction (added after live probe, 2026-10-05)
>
> The live probe (F11–F13) splits the user's report into **two distinct problems** that must not be
> conflated:
>
> 1. **Today's Picks is stale *today*** — proximate cause is a **failed run** (F12) whose fix
>    (`runInChunks`, F13) is already written and sitting **unmerged in PR #133**. This spec is **not**
>    the fix for that symptom. Merging/deploying PR #133 is the higher-value, lower-risk action, and it
>    is blocked on user authorization — not on this spec.
> 2. **The structural gap this spec closes** — a *future* hold/outage would again freeze the feed for
>    days, because cron execution is Prisma-only (F2) with fail-open leadership (F4). Degraded Mode is
>    the durability/recovery layer that makes the next occurrence a non-event.
>
> **Read paths need no work.** All three pages the user named already degrade correctly: PERFORMANCE
> (v3.41.2 SQLite fallback + archive writes), SWING (already **SQLite-primary**, job rows in the mirror
> + sync outbox, breaker-open cached feed), Today's Picks (SQLite mirror fallback). The gap is entirely on
> the **cron/write** side, which is what this spec builds.

**Root cause established by investigation** (not assumed — every line below was read in-repo):

| # | Finding | Evidence |
|---|---------|----------|
| F1 | **Read paths already degrade.** `/api/recommendations` serves the SQLite mirror when the breaker is open and on error. History/Performance/Ideas have the same fallback (v3.41.2). | `app/api/recommendations/route.ts:42-64`, `:171-182` |
| F2 | **The entire cron/write path is Prisma-only and deliberately inert during a hold.** Breaker hard-returns at `checkScheduledJobs` and `pollAndExecute`; the node-cron `fireJob` throws on `prisma.cronJob.findUnique`; the dedup guard, task creation and `nextRun` advance are all Prisma. Net effect: **zero jobs execute during a hold.** | `worker-engine.ts:693`, `:330`, `:621`, `:636`, `:669`; `cron-daemon.ts:245-250`; `task-orchestrator.ts:99` |
| F3 | **Schedule *registration* is already SQLite-first** — only firing is Prisma-bound. | `cron-daemon.ts:176` (`sqlite.getCronJobs()`), test `daemon-sqlite-first.test.ts` |
| F4 | **`leader.ts` fails OPEN when the DB is unreachable** ("we DEGRADE to running locally so cron/work continue"). During a hold **every instance becomes leader for `worker` and `cron-daemon`**. | `lib/services/leader.ts:91-95` |
| F5 | Therefore removing the F2 breaker gates alone would cause **N-instance duplicate execution** (duplicate Telegram broadcasts, duplicate Google-Sheets appends, N× NSE load). F4 is the reason a degraded engine needs its own election. | `leader.ts:91-95` + `instrumentation.ts:40-67` |
| F6 | **The 6h push engine already exists and works** — `pushSqliteToPrisma()` on a probe cadence, leader+breaker gated internally, with test coverage. The gap is that nothing new is *queued* during a hold, so there is nothing to deliver. | `lib/sqlite.ts:2252-2253`, `:4709`; `lib/__tests__/sqlite.test.ts:1579+` |
| F7 | **The 90% threshold is available but unused.** Monthly plan limit comes from `DB_PLAN_LIMIT_OPS_MONTHLY` **default 200_000**; 90% = 180k, matching the user's figure. Persisted to SQLite every 60s. | `opsMonthly.ts:41-44`, `:132-156`; `sqlite.ts:7276-7277` |
| F8 | The breaker is **purely reactive** — it opens only after a real P6003/timeout error is thrown and classified, with a 5-min cooldown half-open. No proactive mode exists. | `db-utils.ts:212`, `:240-261` |
| F9 | **29 task types** dispatch through the worker. | `worker-service.ts:29-116` |
| F10 | **Two different plan-limit notions coexist**: `DB_PLAN_LIMIT_OPS_MONTHLY`=200_000 (`opsMonthly.ts`) vs `DB_PLAN_LIMIT_OPS`=10_000 (`sqlite.ts:7234`, `getDbHealthState`). Only the monthly one is the real Prisma plan limit. | as cited |
| F11 | **LIVE prod evidence — Today's Picks is stale, not broken.** `GET /api/recommendations` → **HTTP 200**, 163 KB, 100 symbols, `servedFrom: "memory_cache"`. All 100 rows share `createdAt = 2026-09-04T09:21:25.469Z` — **31 days stale** as of 2026-10-05. No 500, no empty list. | live probe 2026-10-05 |
| F12 | **The proximate cause is a FAILED run, not the breaker.** `latestRun = { id: 347d6887…, runDate: 2026-09-04T09:20:52Z, status: "failed" }` with `aiProcessed: 0` and `executionTimeMs: null` — the screener stage produced 100 symbols, then the run died before/inside the AI+persist stage and never finished timing. | live probe payload |
| F13 | **The fix for F12 already exists in-repo but is NOT deployed.** `runInChunks()` replaces the interactive `$transaction()` whose timeout exceeds the 5 s serverless cap; it is present at `dailyRecommendationService.ts:1614-1633` with exactly that rationale in its doc comment, and TODO.md records it as "fixed locally … needs deploy". PR #133 (`f0c73c7`) is **open and unmerged**. | `dailyRecommendationService.ts:1614`; `TODO.md`; `git log` |

**Scope**

*IN scope*
1. Degraded Mode flag with a preemptive threshold (F7/F8) and hysteresis.
2. Blobs-based **single-leader** election for degraded execution (fixes F4/F5 for the degraded path).
3. SQLite-backed cron firing + task queue + claim for `degradedSafe` job types (fixes F2).
4. History/recommendations produced during degraded mode persisted in SQLite and delivered by the existing 6h outbox push (F6) — **reuse, not rebuild**.
5. Per-task-type `degradedSafe` registry so unverified jobs are skipped loudly, never half-executed.
6. Admin visibility: degraded state, elected holder, skipped jobs, outbox depth + kill switch.
7. Netlify Blobs health surfaced explicitly (it becomes a **hard prerequisite**, see R3).

*OUT of scope (explicit)*
- Rewriting the 29 executors. Degraded routing happens at the queue/write boundary, not inside job bodies.
- New Prisma models or migrations (**zero DB migration risk** — SQLite + Blobs only).
- Changing the existing `leader.ts` fail-open semantics for the *normal* (non-degraded) path.
- Changing `DB_PLAN_LIMIT_OPS` (the 10k figure, F10) — recorded as a pre-existing inconsistency.
- Any production deploy, Blobs provisioning, or remote mutation.

**Depends on**: v3.11.0 cron daemon, v3.19–v3.22 leader election, v3.23.x breaker gates, v3.25 SQLite-primary
task discovery, v3.28.4 route caches, v3.30 Plan 09 mirror/outbox, v3.40.3 predeploy preserve, v3.41.2
recommendations fallbacks, v3.44 strict `applySchema`.

---

## 2. Routes

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/db-health` (extend) | admin | **Modified** — add `degradedMode` block (active, reason, since, leaderHolder, skippedJobs, outboxDepth) to the existing response; keep all existing fields byte-compatible |
| POST | `/api/admin/degraded-mode` | admin | Set mode `auto`/`force`/`off` at runtime (persisted in SQLite `_backup_meta`, survives redeploy) + `forceRunSync` to trigger the outbox push on demand |

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/recommendations` | No behavioural change expected; add `degradedMode` to the existing `servedFrom` vocabulary for observability |
| GET | `/api/admin/db-health` | Response gains `degradedMode` (additive only) |
| GET | `/api/admin/workers/engine` | Report degraded engine state alongside leader rows |

No change to public route contracts beyond additive observability fields.

---

## 3. Database Schema

**No Prisma schema change. No migration.** This is deliberate: prod Prisma has been fragile (P6003
holds), so this feature must be shippable without touching the held database.

### SQLite additions (local mirror, `lib/sqlite.ts`)

```sql
-- Degraded-mode control plane (mirrors the control-marker pattern already used
-- for isControlMirrorFresh / touchControlMirror)
CREATE TABLE IF NOT EXISTS _degraded_state (
  key        TEXT PRIMARY KEY,          -- 'mode' | 'leader' | 'entered_at' | 'reason'
  value      TEXT,
  updatedAt  INTEGER NOT NULL
);

-- Task queue used while Degraded Mode is active. Mirrors the worker_task
-- columns the executors already read, so executeTask() is unchanged.
CREATE TABLE IF NOT EXISTS _degraded_task (
  id            TEXT PRIMARY KEY,
  cronJobId     TEXT,
  name          TEXT NOT NULL,
  taskType      TEXT NOT NULL,
  payload       TEXT,                   -- JSON
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|running|done|failed|skipped
  claimedBy     TEXT,                   -- degraded leader LEADER_SELF
  claimedAt     INTEGER,
  createdAt     INTEGER NOT NULL,
  finishedAt    INTEGER,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_degraded_task_status ON _degraded_task(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_degraded_task_cron   ON _degraded_task(cronJobId, createdAt);

-- Outbox rows for later Prisma delivery. REUSES the existing _sync_outbox
-- drained by pushSqliteToPrisma() — no new drain path.
```

### Netlify Blobs (coordination, not data)

New store `degraded-leader-lock` (separate from `MIRROR_SNAPSHOT_BLOBS_STORE` so a snapshot upload can
never clobber the lock). One key `lock` holding:

```json
{ "holder": "<LEADER_SELF>", "acquiredAt": 0, "expiresAt": 0, "renewals": 0 }
```

---

## 4. Functions to Implement

### A. `lib/services/degradedMode.ts` (NEW)

#### `getDegradedModeState(): DegradedState`

```typescript
export type DegradedReason = "breaker" | "threshold" | "forced" | "off";
export interface DegradedState {
  active: boolean;
  reason: DegradedReason;
  since: number | null;
  planLimit: number;
  enterAtOps: number;   // 0.90 * planLimit  (180_000 at default)
  exitAtOps: number;    // 0.80 * planLimit  (hysteresis)
  currentOps: number;
}
```

Precedence: `off` (env/runtime kill switch) > `forced` (runtime) > `breaker` (F8, reactive) >
`threshold` (F7, preemptive). Never throws — a failure to read ops state degrades to `breaker`-only
behaviour, never to "active".

#### `isDegradedModeActive(): boolean`
Hot-path boolean for the worker/daemon. Cached with a short TTL (5s) so a 30s poll loop does not
re-read SQLite per tick.

#### Threshold evaluation
Uses `getOpsMonthlyState()` + `buildQueryConsumption()` (F7). **Enter** at `currentOps >= enterAtOps`;
**exit** only when `currentOps <= exitAtOps` **and** the breaker is closed. Hysteresis is mandatory —
without it a site oscillating around 180k would flap between Prisma and SQLite and could interleave
half-written state.

### B. `lib/services/degradedLeader.ts` (NEW)

#### `acquireDegradedLeaderLock(): Promise<boolean>`
Blobs conditional-write lock. Acquire when absent/expired; renew while held; stand down if the object
changed underneath. Mirrors `leader.ts` staleness constants (`LEADER_HEARTBEAT_MS` 5min,
`LEADER_STALENESS_MS` 10min).

**Fail-closed, deliberately**: if Blobs is unreachable/misconfigured, return `false` and log
`degraded_leader_unavailable`. We cannot guarantee single execution without coordination, and
double-sending Telegram alerts / double-appending the Sheets ledger is worse than skipping a cron tick.
This is the one place where availability deliberately yields to correctness, and it is what makes
Netlify Blobs a hard prerequisite (R3).

#### `watchDegradedLeader(handlers): () => void`
Same adaptive probe shape as `watchLeaderRole` (fast 60s probe when absent/stale, slow 300s when a
foreign holder is fresh). `onAcquired` starts the degraded poll loop; `onLost` stops it.

### C. `lib/services/worker/degradedQueue.ts` (NEW)

> **IMPLEMENTATION DEVIATION (deliberate, accepted v3.45.0).** The signatures below were
> drafted as `Promise`-returning, but the `SqliteFallback` accessors they wrap are **synchronous** —
> `lib/sqlite.ts` is sql.js, whose `run`/`exec` are sync APIs, and every existing accessor
> (`getCronJobs`, `enqueueWriteBehind`, `getOutboxPending`, …) already is. The shipped
> `degradedQueue`/`sqlite` queue surface is therefore **synchronous**; `drainDegradedQueue()`
> (the only `async` entry point) awaits the *injected* executor, not the SQL. Wrapping sync sql.js
> in artificial `Promise`s would add a microtask hop and a second failure mode (an unawaited
> rejection) for zero benefit. `acquireDegradedLeaderLock()` and `watchDegradedLeader()` **remain
> genuinely async** — they do network I/O.

#### `enqueueDegradedTask(job: DueCronJob): string | null`
Creates a `_degraded_task` row. Caller is the single elected leader.

#### `claimNextDegradedTask(leaderId: string): DegradedTask | null`
SQLite-local claim, leader-gated. The cross-instance guarantee now comes from
`acquireDegradedLeaderLock()` (B) instead of the Prisma atomic `updateMany`, because during a hold that
`updateMany` cannot run at all (F2/F5).

#### `completeDegradedTask(id, outcome): void`
Writes `done`/`failed` + error. Any rows the executor produced are handed to the existing `_sync_outbox`
so the 6h push delivers them (F6) — the executor itself is not modified.

#### `requeueStaleDegradedTasks(staleMs: number): number` (v3.45.0 addition)
Returns claims whose `claimed_at` is older than the bound to `pending`, clearing `claimed_by`/`claimed_at`,
and returns the real changed-row count. **Without this a row claimed by a leader that then died
mid-executor is stranded in `running` FOREVER** — the claim is status-guarded, so a `running` row is
invisible to every later claim and the job is silently lost. The bound stays above the 10-minute
leader lease (30 minutes) so a live leader's in-flight row is never stolen.

### D. `lib/services/worker/degradedTaskRegistry.ts` (NEW)

```typescript
export interface DegradedTaskSpec {
  taskType: string;
  degradedSafe: boolean;      // false ⇒ SKIPPED loudly in degraded mode
  reason?: string;            // required when degradedSafe === false
  mirrorWriter?: "recommendations" | "dividends" | "alerts" | "corp_actions" | "none";
}
```

Covers all 29 dispatch cases from `worker-service.ts:29-116`. Seeded from the job types that already
have a verified mirror path (`recommendationsPlanLimitFallbacks`, `dividendCalendarMirror`,
`alertsMirrorFallback`, `syncedDataService.mirrorWriteThrough`); everything else is
`degradedSafe: false` with a reason, and is **skipped with an audit event + admin counter** rather than
executed partially. Growing the registry is then incremental and safe, which is how "all system crons"
stays honest instead of aspirational.

### E. `lib/services/worker/worker-engine.ts` (MODIFIED — additive)

#### `pollAndExecute()` — add a degraded branch **before** the existing breaker return

```
if (isDegradedModeActive()) return pollAndExecuteDegraded();   // leader-gated
if (isPlanLimitBreakerOpen()) return;                          // unchanged
```

The existing breaker `return` at line 330 is **not removed** — degraded mode is an explicit,
separately-gated path above it, so flipping the flag off restores today's exact behaviour.

#### `checkScheduledJobs()` — same shape

```
if (isDegradedModeActive()) return checkScheduledJobsDegraded();
if (isPlanLimitBreakerOpen()) return;                          // unchanged (line 693)
```

#### `cron-daemon.ts` `fireJob()` — SQLite row re-fetch fallback

Replace the hard Prisma dependency with: try Prisma → on `isDbUnavailableError`/breaker, re-read the
CronJob row from the SQLite mirror (`sqlite.getCronJobs()`) and call `enqueueDegradedTask`. This is the
F2 line that currently turns every tick into `Cron job fire failed`.

### F. `instrumentation.ts` (MODIFIED)

Register `watchDegradedLeader` alongside the existing three `watchLeaderRole` blocks. No new top-level
imports (EDGE-SAFETY rule at the top of the file); dynamic import inside `register()` only.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/degradedMode.ts` | **Created** | Mode state, threshold, hysteresis, kill switch |
| `lib/services/degradedLeader.ts` | **Created** | Blobs single-leader election (fail-closed) |
| `lib/services/worker/degradedQueue.ts` | **Created** | SQLite queue: enqueue/claim/complete |
| `lib/services/worker/degradedTaskRegistry.ts` | **Created** | Per-task-type `degradedSafe` capability map (29 types) |
| `lib/sqlite.ts` | Modified | `_degraded_state` + `_degraded_task` tables; outbox enqueue helper |
| `lib/services/worker/worker-engine.ts` | Modified | Degraded branches above both breaker gates; `checkScheduledJobsDegraded`, `pollAndExecuteDegraded` |
| `lib/services/worker/cron-daemon.ts` | Modified | `fireJob` SQLite row fallback + degraded enqueue |
| `instrumentation.ts` | Modified | `watchDegradedLeader` registration |
| `app/api/admin/db-health/route.ts` | Modified | Additive `degradedMode` block |
| `app/api/admin/degraded-mode/route.ts` | **Created** | Mode control + on-demand sync |
| `lib/audit.ts` | Modified | `DEGRADED_MODE_ENTERED` / `EXITED` / `JOB_SKIPPED` / `LEADER_UNAVAILABLE` |
| `app/admin/db/page.tsx` (or nearest DB-health panel) | Modified | Degraded banner + kill switch |
| `lib/__tests__/degradedMode.test.ts` | **Created** | Threshold/hysteresis/precedence tests |
| `lib/__tests__/degradedLeader.test.ts` | **Created** | Blobs lock acquire/renew/steal/fail-closed |
| `lib/__tests__/degradedQueue.test.ts` | **Created** | Queue + registry skip behaviour |
| `lib/__tests__/degradedExecution.test.ts` | **Created** | End-to-end degraded cron → SQLite → outbox → push |

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | `@netlify/blobs` is already a dependency (mirror snapshots). No new runtime deps. |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/db-utils` | `isPlanLimitBreakerOpen`, `isDbUnavailableError`, `classifyDbError` | Reactive hold signal |
| `@/lib/services/opsMonthly` | `getOpsMonthlyState`, `buildQueryConsumption` | Monthly ops + plan limit (F7) |
| `@/lib/sqlite` | mirror API, `_sync_outbox`, `pushSqliteToPrisma` | Durable store + 6h delivery (F6) |
| `@netlify/blobs` | `getStore` | Degraded leader lock + existing snapshots |
| `@/lib/services/leader` | `LEADER_SELF`, staleness constants | Identity + cadence reuse |
| `@/lib/audit` | `audit()` | Mode transitions + skipped jobs |

---

## 7. API Contract

### POST `/api/admin/degraded-mode`

**Request:**
```typescript
{ mode?: "auto" | "force" | "off", forceRunSync?: boolean }
```

**Response (200):**
```json
{
  "success": true,
  "degradedMode": {
    "active": true, "reason": "threshold", "since": 1759612800000,
    "planLimit": 200000, "enterAtOps": 180000, "exitAtOps": 160000,
    "currentOps": 180412, "leaderHolder": "ip-10-0-1-7-1234-5678", "blobsHealthy": true
  },
  "sync": { "pushed": false, "reason": "breaker_open" }
}
```

**Errors:** `401` non-admin · `503` plan-limit breaker open · `400` invalid `mode`.

### GET `/api/admin/db-health` (additive)

```json
{ "…existing fields unchanged…": "",
  "degradedMode": { "active": false, "reason": "off", "currentOps": 682,
                    "planLimit": 200000, "enterAtOps": 180000,
                    "outboxDepth": 0, "skippedJobs": [], "blobsHealthy": true } }
```

Additive only — existing `queryConsumption.planLimit` / `planOperationsRemaining` are untouched, so the
existing 14 db-health tests and the admin UI keep working.

---

## 8. UI/UX Requirements

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Degraded banner | existing DB-health admin panel | "Degraded mode ACTIVE — reason, since, ops 180,412/200,000" + skipped-job count |
| Mode control | same panel | `auto` / `force` / `off` segmented control + "Sync to Prisma now" |
| Blobs health chip | same panel | `blobsHealthy` — red when the leader lock is unavailable |

### States
- **Off (normal)**: chip hidden, no banner.
- **Threshold**: amber banner, ops meter at 90%+, no user-facing site change.
- **Breaker/forced**: red banner; public pages show `servedFrom: "sqlite_mirror"`.
- **Blobs unhealthy**: red "degraded execution paused" chip — jobs are skipped, loudly.
- **Loading / Error / Empty**: standard skeleton / retry / "no skipped jobs".

### Responsive
Desktop 1440px banner; mobile 375px stacks and wraps the segmented control. Dark/light via existing tokens.

---

## 9. Rules & Guardrails

- [x] No Prisma in client components
- [x] `instrumentation.ts` keeps ZERO top-level imports (EDGE-SAFETY)
- [x] No new Prisma models/migrations — nothing that can fail on a held DB
- [x] Errors return safe defaults; no internals in responses
- [x] `logger` only, no `console.log`
- [x] Every mode transition + skipped job audited
- [x] Kill switch (`off`) restores today's exact code path — the existing breaker `return`s stay
- [x] Degraded leader **fails closed**; never run degraded execution uncoordinated
- [x] Never silently skip: an unrunnable job must emit `DEGRADED_JOB_SKIPPED` + increment an admin counter
- [x] Outbox depth capped and surfaced; a long hold must not grow unbounded

---

## 10. Expected Behavior

1. At 682 ops (today), `isDegradedModeActive()` = `false`; behaviour byte-identical to today.
2. As ops cross 180,000 with the breaker closed, mode flips to `reason: "threshold"` and the audit event fires.
3. With mode active, the single Blobs-elected leader discovers due crons from the SQLite mirror and enqueues `_degraded_task` rows; non-leader instances do nothing.
4. A `degradedSafe: false` job type is skipped with an audit event + counter increment; **no partial execution**.
5. `recommendations` / `dividends` / `alerts` run degraded, persist to SQLite, and enqueue outbox rows.
6. The existing 6h `pushSqliteToPrisma()` delivers those rows to Prisma after the breaker closes; `sync_history` records the drain.
7. `/api/recommendations` serves `servedFrom: "sqlite_mirror"` with HTTP 200 during a hold — never a masked 500.
8. If Blobs is unavailable, no instance claims the lock → **no** degraded execution, red chip, `DEGRADED_LEADER_UNAVAILABLE` audited.
9. Ops falling back below 160,000 with the breaker closed returns mode to `off` (hysteresis; no flapping).
10. Setting mode `off` at runtime restores the pre-existing breaker-gated behaviour with no redeploy.

---

## 11. Error Handling

| Scenario | Behaviour | Log |
|----------|-----------|-----|
| Blobs unreachable/misconfigured | Fail closed — no degraded execution | `error` `degraded_leader_unavailable` |
| SQLite mirror not ready | No degraded execution; public pages fall back to memory cache | `warn` |
| Ops state unreadable | Threshold disabled, breaker-only behaviour | `warn` |
| Prisma returns P6003 mid-degraded-execution | Task marked `failed`, retried after breaker closes | `warn` |
| Outbox at cap | Stop enqueueing, surface in admin, audit once | `error` |
| Duplicate `_degraded_task` for same cron+window | Deduped (dedup guard mirrors `DEDUP_WINDOW_MS`) | `debug` |
| Netlify prewarm/cold start during hold | Restore mirror from Blobs, re-elect leader, resume | `info` |

---

## 12. Test Strategy

### Unit
- [ ] `degradedMode`: precedence (`off` > `forced` > `breaker` > `threshold`); enter at 180k; **no exit until ≤160k**; unreadable ops → not active; never throws
- [ ] `degradedLeader`: acquire when absent; refuse when foreign+fresh; steal when expired; renew; **fail-closed** on Blobs error; two-instance race → exactly one winner
- [ ] `degradedQueue`: enqueue → claim → complete lifecycle; claim is leader-only; dedup window; outbox rows enqueued on completion
- [ ] Registry: all 29 `worker-service` task types covered; `degradedSafe: false` ⇒ skipped + audited, executor never invoked
- [ ] `fireJob`: Prisma throw → SQLite row → enqueue; no Prisma write attempted in degraded mode

### Integration
- [ ] Breaker-open + degraded → job executes from SQLite, result in outbox
- [ ] 6h push drains degraded-produced rows into Prisma (mocked Prisma) and `sync_history` records it
- [ ] `/api/recommendations` 200 + `servedFrom:"sqlite_mirror"` with Prisma throwing P6003
- [ ] `/api/admin/db-health` response is additive-compatible (existing assertions still pass)

### Regression guards (must not regress)
- [ ] `worker-engine` breaker returns still short-circuit when mode is `off`
- [ ] `sqlite.test.ts` (92) + `sqliteMirror.test.ts` (12) + `leader.test.ts` + `cron-daemon.test.ts` + `instrumentation.test.ts` + `daemon-sqlite-first.test.ts`
- [ ] `recommendationsPlanLimitFallbacks.test.ts` (21) + `alertsMirrorFallback` + `dividendCalendarMirror`

### E2E (`e2e/`)
- [ ] Admin DB-health page shows the mode chip and kill switch
- [ ] Kill switch round-trips (off → auto)
- [ ] Public `/recommendations` renders in a simulated degraded window (routes mocked, per repo convention)

---

## 13. Performance Considerations

- `isDegradedModeActive()` cached 5s → no per-tick SQLite read on the 30s/60s loops.
- Threshold math is pure arithmetic over state already persisted every 60s — **0 extra Prisma ops**.
- Degraded leader renew = 1 Blobs op / 5 min per instance (standby probes 1 / 300s, fast probe 1 / 60s).
- Degraded mode **reduces** Prisma ops (writes route to outbox); the 6h push is op-budgeted like the
  existing one.
- Outbox depth capped (proposed 50k rows) with pruning on drain, mirroring the 14-day write-behind TTL pattern.

---

## 14. Security Considerations

- **Auth**: `/api/admin/degraded-mode` requires the existing admin middleware (`securityAdmin`).
- **Blobs lock is unauthenticated-by-instance**: any process with the site token could contend. Acceptable
  — it grants no data access and fails safe. The lock must never store secrets.
- **Kill switch** is admin-only and audited; `off` cannot be set by a client component.
- No secrets in `_degraded_state`, the Blobs lock object, or audit metadata.
- Degraded mode must **not** weaken the RBAC checks inside executors — auth still runs, only persistence moves.

---

## 15. Risks

| ID | Risk | Mitigation |
|----|------|-----------|
| R1 | Threshold flip on a **healthy** DB serves staler data (user's explicit choice) | Hysteresis; additive `servedFrom` observability; admin banner; `off` kill switch; reads keep the existing 60s route cache |
| R2 | Duplicate side effects (Telegram/Sheets) if leadership is wrong | Fail-closed Blobs election; `degradedSafe:false` skip; no degraded execution without a lock |
| R3 | **Blobs broken ⇒ degraded execution impossible** | This is why "make Netlify Blobs work" is in scope: it is load-bearing, not cosmetic. Add an explicit health chip + startup log |
| R4 | Long hold ⇒ unbounded outbox | Row cap + admin surfacing + audit once; drain on recovery |
| R5 | Two plan-limit notions (200k monthly vs 10k in `getDbHealthState`) | Use **monthly** only; record the 10k inconsistency, do not silently change it |
| R6 | 29 job types is a large surface | Capability registry + incremental growth; unverified jobs are skipped, never guessed |

---

## 16. Definition of Done

- [ ] All functions in §4 implemented
- [ ] All files in §5 created/modified
- [ ] No Prisma migration (verified: schema untouched)
- [ ] `degradedTaskRegistry` covers all 29 `worker-service` task types
- [ ] Unit + integration + regression tests written and passing (`npm run test`)
- [ ] `npx tsc --noEmit` — 0 new errors beyond the 46 baseline (prod 0)
- [ ] `npm run lint` — 0 errors in new/changed files
- [ ] `npm run quickbuild` green (Netlify runs the same command)
- [ ] Kill switch verified to restore pre-existing behaviour exactly
- [ ] Fail-closed leader verified (Blobs error ⇒ no execution)
- [ ] Docs updated (`.agents/CHANGELOG.md`, `TODO.md`, `Primer.md`, `agent-memory.md`, `Lessons.md`) —
      **`AGENTS.md` NOT edited (32 KB cap, Lesson 142)**
- [ ] Live verification on `:3000` for the admin panel change

---

## 17. Resolved Questions (closed by investigation)

| Q | Answer | Evidence |
|---|--------|----------|
| ~~SWING/PERFORMANCE read-path audit in scope?~~ | **No — not needed.** Both already degrade correctly; SWING is already SQLite-*primary*. Read work removed from the plan. | `recommendationPerformanceService.ts:226/436/535`; `swingRecommendationService.ts:1237/1303-1311` |
| ~~Is Today's Picks a 500, empty, or stale?~~ | **Stale** — HTTP 200, 100 symbols, `servedFrom: "memory_cache"`, all rows `2026-09-04`. Not a mirror/Blobs failure; the mirror restored fine. | live probe F11 |
| ~~Does the 90% switch cover reads too?~~ | **Both reads and writes.** The user's stated choice was a *hard preemptive switch*, which by definition routes both; re-asking was unnecessary. | user directive |
| ~~SWING in the registry?~~ | Yes — add `mirrorWriter: "swing"`; SWING is a **strong** degraded candidate (already outbox-backed), not one of the four originally listed. | `swingRecommendationService.ts:1237` |

## 18. Blocking Decision for the User

**PR #133 is unmerged, and it contains the fix for the symptom you reported (F12/F13).**

- Today's Picks has been frozen for **31 days** because run `347d6887` failed at the AI/persist stage.
- `runInChunks()` — the documented remedy — is committed locally and has **never been deployed**.
- This spec (degraded execution) would have *prevented* the freeze, but it is a much larger build than
  the change that restores service now.

Three options, requiring an explicit decision:

| Option | Action | Effect |
|--------|--------|--------|
| **A (recommended)** | Merge + deploy PR #133 (`f0c73c7`, 11/11 checks green) | Likely restores fresh runs *today*; no new code. Requires your merge/deploy authorization. |
| **B** | Merge PR #133 **and** proceed with this spec on top | Restores service now **and** hardens against recurrence. Largest scope. |
| **C** | Build the spec first, deploy once | Single deploy, but Today's Picks stays stale for the whole build. |

No merge, deploy, or production change will be performed without explicit instruction.

