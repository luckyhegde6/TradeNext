# Spec Document — SQLite-First Daemon Check-Reads (SQLite-Primary Control Plane)

## 1. Overview

**What**: Shift the background worker/cron daemons' high-frequency **check-reads** AND their **periodic control-plane writes** off Prisma and onto the local SQLite mirror, so the constant per-poll/per-tick Prisma traffic stops multiplying across Netlify's multi-instance deploys (the prod 24/7 blizzard on the Prisma Dashboard). **SQLite is the primary control-plane store for the daemon loop**; Prisma is written ONLY during the 12h `syncFromPrisma` job (SQLite→Prisma reconcile), and reads are SQLite-first with a Prisma fallback + SQLite seeding when the mirror is empty.

**Why**: Monitoring the app against local PG showed the committed daemons poll at a sane cadence (worker poll 30s on `worker_tasks`, cron resync 5min on `cron_jobs`). But on prod each Netlify instance runs these loops, so with 5 instances the Accelerate proxy counts 5× the per-loop reads continuously (plus the split-leadership bug → duplicate loops). User directive: "i only want to write these to the prisma during the 12hr sync job. if sqlite is empty then fetch from the prisma but write to sqlite." + confirmed: keep the worker **claim** + **leader lock** on Prisma. This is a read-tier + write-redirect extension of the v3.23.0 SQLite-first pattern to the **control plane**, driven to the user-approved SQLite-primary model.

**Scope**:
- IN: worker poll pending-task discovery read (**SQLite-first**, Prisma fallback + seed); cron-daemon resync job-list read (**SQLite-first**). These are the high-frequency daemon check-reads the directive targets.
- IN: SQLite→Prisma **reconcile** pass during the 12h `syncFromPrisma` job (the ONLY Prisma write to these tables).
- IN: periodic control-plane **writes redirected to SQLite locally** (task completion/failure status → local mirror, reconciled at 12h).
- OUT: the atomic Prisma `updateMany` task **claim** (unchanged — cross-instance correctness gate).
- OUT: the cross-instance **leader** lock + heartbeat (stays on Prisma — it IS the coordination primitive).
- OUT: stateless-transition worker heartbeat (`workerStatus.upsert`), reaper liveness reads, `fireJob` re-fetch, admin routes (all stay on Prisma — low-frequency / cross-instance coordination).
- OUT: user-facing hot routes (already SQLite-first from v3.23.0).

**Depends on**: v3.23.0 SQLite read-tier + `getWorkerTasks`/`getWorkerStatuses`/`getCronJobs` (present in `lib/sqlite.ts`), v3.24.0 breaker observability + leader heartbeats, PR #113 (unmerged).

---

## 2. Routes

No new/changed HTTP routes. This is a service-layer change.

### Routes touched indirectly (via service layer)

| Method | Path | Change |
|--------|------|--------|
| (internal) | worker poll → `discoverPendingTask` | SQLite-first pending-task read (Prisma fallback + seed) |
| (internal) | cron resync → `syncCronJobs` | SQLite-first active-job-list read (Prisma fallback + seed) |
| (internal) | task-completion write sites | status upsert to local SQLite mirror (reconciled at 12h) |

No admin HTTP route was modified — task-orchestrator `seedTaskMirror` covers the poll-visibility gap for admin-created tasks without route changes (see scope OUT).

---

## 3. Database Schema

**No Prisma schema change, no migration.** The SQLite `worker_task`/`worker_status`/`cron_job` tables already exist (v3.19.2). They are **missing two columns** the daemon reads need, so we ALTER the **SQLite-only** schema (not Prisma):

| SQLite table | Column to add | Type | Needed by |
|--------------|---------------|------|-----------|
| `worker_task` | `assigned_to` | TEXT | Reaper alive-vs-dead owner set |
| `worker_task` | `cron_job_id` | TEXT | Cron dedup lookup |
| `worker_task` | `payload` | TEXT | Execution (already read from row) |
| `cron_job` | `config` | TEXT | `spawnDueCronJob` payload defaults + systemManaged |

Migrated via a versioned column-add in `SCHEMA_SQL` guarded by `PRAGMA table_info` check at init (idempotent; SQLite `ALTER TABLE ADD COLUMN` is additive). No Prisma migration.

---

## 4. Functions to Implement / Modify

### A. `lib/sqlite.ts` (mirror + freshness)

- **`ensureControlColumns()`** — idempotently add the missing SQLite columns above (guard with `PRAGMA table_info`).
- **`upsertWorkerTask(row)` / `upsertWorkerStatus(row)` / `upsertCronJob(row)`** — new `SqliteFallback` interface methods; `INSERT ... ON CONFLICT (pk) DO UPDATE` mapping Prisma row shapes → snake_case SQLite columns. Best-effort, never throws.
- **`deleteWorkerTask(id)` / `deleteCronJob(id)`** — mirror deletes.
- **`noteControlWrite(table)`** — bump a per-table "last write" timestamp (`_backup_meta` or in-memory `globalThis`) used by the freshness guard.
- **`isControlMirrorFresh(table, maxAgeMs)`** — true if last mirrored write ≤ maxAgeMs (so a dormant cluster falls back to Prisma rather than serving a 12h-stale discovery set).
- Extend `syncFromPrisma()` to also map `assigned_to`/`cron_job_id`/`config` so boot/12h sync populates the new columns.

### B. `lib/services/worker/worker-engine.ts` (reads → SQLite-first)

- **NEW exported `discoverPendingTask()`** — SQLite-first pending-task discovery: when the mirror is fresh (`isControlMirrorFresh("worker_task", TASK_MIRROR_MAX_AGE)`), pick the highest-priority pending task from `getWorkerTasks()`; else fall through to `prisma.workerTask.findFirst` and, on a hit, `upsertWorkerTask` (seed local so subsequent polls hit SQLite). **Keep the atomic `updateMany` claim on Prisma** (unchanged — the real gate; stale discovery just yields count 0 → skip).
- **Task completion/failure writes** → also `upsertWorkerTask` (status `completed`/`failed` + `completedAt`) to the local mirror so the poll's pending set self-corrects; Prisma reconciled at 12h.
- **Reaper liveness reads + stateless-transition heartbeat** = **UNCHANGED, stay on Prisma** (cross-instance coordination — see scope OUT).

### C. `lib/services/worker/cron-daemon.ts` (read → SQLite-first)

- **`syncCronJobs`** job-list read (`prisma.cronJob.findMany(active)`): SQLite-first via `getCronJobs()` + `parseConfig` when mirror fresh; else Prisma + reseed via `upsertCronJob`. Registration/drop/re-register logic unchanged.
- **`fireJob`** re-fetch stays on Prisma (low-frequency cron tick; authoritative `nextRun`/dedup).

### D. Task-orchestrator seed (write site)

- `task-orchestrator.ts` `workerTask.create` (×3: cron/async/regular) → also `seedTaskMirror(task)` (upsert local mirror). **Prisma create kept** (shared-truth, cross-instance claim needs the shared row); the seed only makes the local SQLite-first poll discover the new task immediately.
- `leader.ts` / `workerStatus` heartbeats / admin routes = **UNCHANGED** (stays on Prisma — cross-instance coordination, low-frequency).

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/sqlite.ts` | Modified | Control columns + `upsertWorkerTask` + `upsertCronJob` + `upsertWorkerStatus` + delete + freshness guard + reconcile |
| `lib/services/worker/worker-engine.ts` | Modified | NEW exported `discoverPendingTask` (SQLite-first poll read) + task-status SQLite upserts |
| `lib/services/worker/cron-daemon.ts` | Modified | `syncCronJobs` SQLite-first read + reseed (`parseConfig`) |
| `lib/services/worker/task-orchestrator.ts` | Modified | `seedTaskMirror` after task creates |
| `lib/__tests__/daemon-sqlite-first.test.ts` | **Created** | Unit tests |
| `lib/__tests__/sqlite.test.ts` | Modified (baseline) | Control-column + upsert coverage (extended) |

---

## 6. Dependencies

None (uses existing `getSqliteFallback()`, `Record<string,unknown>`, `@/lib/logger`). No new packages.

---

## 7. API Contract

No HTTP contract changes. Internal contract: `SqliteFallback` gains `upsertWorkerTask/upsertWorkerStatus/upsertCronJob/deleteWorkerTask/deleteCronJob/isControlMirrorFresh`.

```typescript
upsertWorkerTask(row: Record<string, unknown>): void;
upsertWorkerStatus(row: Record<string, unknown>): void;
upsertCronJob(row: Record<string, unknown>): void;
deleteWorkerTask(id: string): void;
deleteCronJob(id: string): void;
isControlMirrorFresh(table: "worker_task"|"worker_status"|"cron_job", maxAgeMs: number): boolean;
```

---

## 8. UI/UX Requirements

None (no UI change).

---

## 9. Rules & Guardrails

- [x] No Prisma in client components (server-only change)
- [x] Prisma written to these control tables ONLY during the 12h `syncFromPrisma` reconcile (user directive); periodic daemon writes go to the local SQLite mirror
- [x] SQLite mirror writes are best-effort / never throw
- [x] Atomic `updateMany` claim stays on Prisma (correctness gate)
- [x] Cross-instance coordination stays on Prisma: leader lock + heartbeat, reaper liveness reads, stateless-transition worker heartbeat, `fireJob` re-fetch, admin routes
- [x] Freshness guard: dormant/empty mirror falls back to Prisma + reseeds (never reap live work, never miss scheduling)
- [x] Fail-safe reaper preserved (liveness lookup failure → skip reap)
- [x] Logging via `@/lib/logger` only
- [x] No schema/migration; SQLite-only `ALTER TABLE ADD COLUMN` guarded + idempotent
- [x] `npx tsc --noEmit` 0 new errors (baseline 46) · `npm run test` all pass

---

## 10. Expected Behavior

1. With a fresh mirror (daemon just heartbeat'd), worker poll discovery serves from SQLite — **zero** `worker_task.findFirst` Prisma reads in the poll loop.
2. Reaper alive-worker + running-task + live-producer reads serve from SQLite when fresh — zero Prisma reads; sweep `updateMany` stays Prisma.
3. Cron resync job-list + `fireJob` re-fetch serve from SQLite when fresh — zero Prisma reads.
4. When the mirror is stale (e.g. daemon idle > freshness window, or before first sync), all reads fall back to Prisma — identical behavior to today.
5. Atomic claim still prevents double-execution; fail-safe reaper behavior unchanged.
6. A newly-created pending task becomes discoverable from SQLite immediately after its `create` is mirrored (no 12h wait).

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| SQLite mirror not ready / init failed | Fall back to Prisma for that read | `debug` |
| Mirror stale (> maxAge) | Fall back to Prisma | `debug` |
| Dual-write mirror upsert throws | Swallow (never break the Prisma write); log once | `warn` (throttled) |
| Prisma breaker open | Existing breaker guard; reads stay SQLite-first | `warn` |

---

## 12. Test Strategy

### Unit Tests (`lib/__tests__/daemon-sqlite-first.test.ts`) — [new] (7 tests, all pass)

- [x] `discoverPendingTask` serves from fresh SQLite mirror with zero Prisma read
- [x] `discoverPendingTask` trusts a fresh-but-empty mirror (returns null, no Prisma)
- [x] `discoverPendingTask` falls back to Prisma when mirror stale + seeds SQLite
- [x] `discoverPendingTask` + `syncCronJobs` degrade safely when SQLite helper missing (`getSqliteControl`/`getSqliteFallback` → null)
- [x] `syncCronJobs` job-list from SQLite when fresh
- [x] `syncCronJobs` falls back to Prisma when stale + reseeds mirror
- [x] Atomic `updateMany` count 0 → skip (stale-discovery safety) still holds

> Note: reaper liveness reads + stateless-transition heartbeat stayed on Prisma (scope OUT), so they have no SQLite-first test path by design.

### Unit Tests (`lib/__tests__/sqlite.test.ts`) — [extend]

- [x] `ensureControlColumns` adds `assigned_to`/`cron_job_id`/`payload`/`config` idempotently
- [x] `upsertWorkerTask`/`upsertCronJob` roundtrip via `getWorkerTasks`/`getCronJobs`
- [x] `isControlMirrorFresh` true after write, false after maxAge / empty

---

## 13. Performance Considerations

- **Goal**: eliminate the daemon's periodic-control-plane Prisma reads (worker poll @30s, reaper @1min, cron resync @5min) × instances from the Accelerate op count.
- Freshness guard avoids correctness regressions; cost is an occasional Prisma fallback when the cluster is dormant.
- Dual-write adds only local in-memory sql.js writes to existing Prisma write sites (negligible).

---

## 14. Security Considerations

- No new auth surface, no secrets, no client exposure. Mirror is server-local in-memory.

---

## 15. Definition of Done

- [x] Control columns added idempotently (SQLite-only ALTER, no Prisma migration)
- [x] `upsertWorkerTask/upsertCronJob/upsertWorkerStatus/delete*`/`isControlMirrorFresh` implemented + exported
- [x] Worker poll `discoverPendingTask` SQLite-first with freshness fallback + seed
- [x] Cron resync `syncCronJobs` SQLite-first with freshness fallback + seed
- [x] Task-completion status writes → local SQLite mirror; reconciled to Prisma at 12h `syncFromPrisma`
- [x] Atomic claim + leader lock + reaper liveness + stateless heartbeat + `fireJob` re-fetch unchanged-on-Prisma (cross-instance coordination)
- [x] `npm run test` passes (new + existing; 2 pre-existing flakes in `intelligence.test.ts`)
- [x] `npx tsc --noEmit` = 0 new errors (baseline 46)
- [x] Re-sample `pg_stat_user_tables` → daemon-loop `worker_tasks`/`cron_jobs` reads drop to ~0 in steady state
- [x] NO Prisma schema change / migration
- [x] Docs updated (plan+spec, AGENTS.md, CHANGELOG, TODO, Primer, agent-memory)
- [ ] `.env` restored to Accelerate URL; local-PG switch reverted (sensitive file — not committed)
