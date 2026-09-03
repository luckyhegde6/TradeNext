# v3.25.0 — SQLite-Primary Daemon Control Plane

- **Date**: Sep 03 2026
- **Branch**: `fix/cron-breaker-leader` (on top of v3.24.0)
- **Status**: Code complete; commit/push pending user

## Summary

High-frequency worker/cron **check-reads** AND periodic **task-status writes** move off Prisma to the
**local SQLite mirror**; Prisma is written ONLY during the 12h `syncFromPrisma` reconcile. User directive:
> "i only want to write these to the prisma during the 12hr sync job. if sqlite is empty then fetch from the prisma but write to sqlite."

The 30s worker poll and 5-min cron resync are the high-frequency check-reads eliminated ×instances from
the Accelerate op count.

## Files Changed

| File | Change |
|------|--------|
| `lib/sqlite.ts` | SQLite-primary control-plane primitives (below) |
| `lib/services/worker/worker-engine.ts` | NEW `discoverPendingTask()` SQLite-first poll + task-status mirror upserts |
| `lib/services/worker/cron-daemon.ts` | `syncCronJobs` SQLite-first read + reseed (`parseConfig`) |
| `lib/services/worker/task-orchestrator.ts` | `seedTaskMirror()` after task creates |
| `lib/__tests__/daemon-sqlite-first.test.ts` | NEW (7 tests) |

## Implementation Detail

### 1. `lib/sqlite.ts` — SQLite-primary control plane

- **`ensureControlColumns()`** — idempotent `PRAGMA table_info`-guarded `ALTER TABLE ADD COLUMN`:
  `worker_task.assigned_to/cron_job_id/payload` + `cron_job.config`. SQLite-only — NO Prisma schema change / NO migration.
- **NEW `SqliteFallback` methods** (all best-effort, never throw):
  - `upsertWorkerTask(row)` / `upsertWorkerStatus(row)` / `upsertCronJob(row)` — `INSERT ... ON CONFLICT(pk) DO UPDATE` mapping Prisma row shapes → snake_case SQLite columns (JSON-string for `payload`/`config`). Each also bumps `control_write_at:<table>` in `_backup_meta`.
  - `deleteWorkerTask(id)` / `deleteCronJob(id)` — best-effort mirror deletes.
  - `isControlMirrorFresh(table, maxAgeMs)` — **true** only when the table is non-empty AND a `control_write_at:<table>` write happened within `maxAgeMs`; else `false` → caller falls back to Prisma. Prevents a per-instance fresh-but-empty/idle mirror from being mistaken for a real empty shared queue / empty cron schedule.
- **`syncFromPrisma` backfill** — maps the new columns (`worker_task.assigned_to/cron_job_id/payload`, `cron_job.config`) so boot/12h sync populates the mirror.
- **NEW `reconcileControlToPrisma(db)`** — called at the top of the 12h `syncFromPrisma` (leader-gated):
  - `worker_status` → Prisma `workerStatus.upsert` per row;
  - `cron_job` → Prisma `cronJob.updateMany` for `nextRun/lastRun/runCount/successCount/failureCount` diffs;
  - `worker_task` completed/failed rows → Prisma `workerTask.updateMany` (`status/completedAt/error/assignedTo`).
  This is the **ONLY Prisma write** to these tables, per the directive. Non-fatal — a failure never fails the sync.

### 2. `lib/services/worker/worker-engine.ts`

- **NEW exported `discoverPendingTask()`** — SQLite-primary pending-task read:
  - fresh mirror → highest-priority pending from `getWorkerTasks()` (sorted priority desc, created_at asc);
  - fresh-but-empty mirror → **trusted** (returns `null`, no Prisma);
  - else → `prisma.workerTask.findFirst` + `upsertWorkerTask` seed (so subsequent polls hit SQLite).
- Poll loop uses it; task **completion/failure** also `upsertWorkerTask` to the local mirror (pending set self-corrects).
- **Stays on Prisma by design** (cross-instance coordination): the reaper liveness reads, the stateless-transition heartbeat (`workerStatus.upsert`, fires only at task start/complete), and the atomic `updateMany` CLAIM (claim count 0 → skip guards stale discovery).

### 3. `lib/services/worker/cron-daemon.ts`

- **`syncCronJobs`** SQLite-first: fresh mirror → `getCronJobs()` + `parseConfig()` (active-filtered → `{id,name,cronExpression,isActive,config}`); else Prisma `findMany({where:{isActive:true}})` + reseed via `upsertCronJob`.
- **`fireJob`** re-fetch stays Prisma (low-frequency authoritative tick).

### 4. `lib/services/worker/task-orchestrator.ts`

- **`seedTaskMirror(task)`** (lazy `@/lib/sqlite`, non-fatal) after each `workerTask.create` so a brand-new admin/cron task is discoverable via the SQLite-first poll immediately. Prisma create kept (shared-truth / cross-instance claim).

## Cross-Instance Exclusions Stay on Prisma (user-confirmed)

| Primitive | Why it stays on Prisma |
|-----------|------------------------|
| Worker task **claim** (`updateMany` pending→running) | Cross-instance atomic correctness gate — a per-instance mirror would allow duplicate/parallel execution across Netlify's instances |
| **Leader lock + heartbeat** (`lib/services/leader.ts`) | The leader lock/heartbeat IS the cross-instance coordination primitive (PR #113 split-leadership bug) |
| **Reaper liveness reads** | A local per-instance mirror only holds this process's data — serving liveness from it would blind the reaper to other instances (v3.12.0 bug) |
| **Stateless-transition worker heartbeat** (`workerStatus.upsert`) | Fires only at task start/complete (~2/task) so the reaper + admin keep a correct cross-instance view |
| **`fireJob` re-fetch** | Low-frequency cron tick; authoritative `nextRun`/dedup |
| **Admin routes** | Low-frequency user actions with immediate cross-instance relevance |

## Tests

NEW `lib/__tests__/daemon-sqlite-first.test.ts` (7, all pass):
1. `discoverPendingTask` serves from fresh SQLite mirror with zero Prisma read
2. `discoverPendingTask` trusts a fresh-but-empty mirror (null, no Prisma)
3. `discoverPendingTask` stale → Prisma + seed
4. no-sqlite degrade for `discoverPendingTask`
5. no-sqlite degrade for `syncCronJobs`
6. `syncCronJobs` fresh (from SQLite) / stale + reseed
7. atomic-claim-count-0 → skip

## Verification

- **Full run**: suite **994 pass / 4 skip / 2 fail**. The 2 failures are the PRE-EXISTING async
  `intelligence.test.ts` cache flake (fails 1-3 tests run-to-run with AND without these changes).
- **Excluding that flaky suite**: 71 suites / **983 pass / 4 skip / 0 fail** (+7 from the 989 baseline).
- `npx tsc --noEmit` = **46 = exact baseline** (0 new production errors).
- No schema change → no migration.

> ⚠️ Pre-existing flake note: `lib/__tests__/intelligence.test.ts` has an async-cache timing race on the
> shared `"RELIANCE"` ticker (tests pre-populate cache at lines 162-196; doc tests at 238-282 expect fresh
> `directPrompt` calls). Unrelated to this feature; left untouched per surgical-changes discipline. A minimal
> fix (unique tickers per test) is a candidate follow-up if the gate must be deterministically green.

## Docs

- `.agents/plans/02-daemon-check-reads-sqlite-first.md` — rewritten to the corrected SQLite-primary model +
  a "Final decision divergences" section (reaper liveness, stateless heartbeat, leader lock+heartbeat, `fireJob`
  re-fetch stay Prisma).
- `.agents/specs/02-daemon-check-reads-sqlite-first.md` — consistency pass (title/overview/scope/functions/
  guardrails/tests/DoD aligned to the SQLite-primary model; dual-write references removed).
- AGENTS.md, CHANGELOG, TODO, Primer, agent-memory updated.

## ⚠️ Before finish

- `.env` must be restored to the **Accelerate URL** — currently switched to **local PG** for testing
  (backup: `C:\Users\lucky\AppData\Local\Temp\opencode\tradenext.env.accelerate.bak`).
