# Implementation Plan — SQLite-First Daemon Check-Reads (SQLite-Primary Control Plane)

> Generated from spec: `.agents/specs/02-daemon-check-reads-sqlite-first.md`

## Spec Reference

- **Spec**: `.agents/specs/02-daemon-check-reads-sqlite-first.md`
- **Branch**: `fix/cron-breaker-leader` (current)
- **Created**: 2026-09-03

## Corrected Model (user directive 2026-09-03)

> "i only want to write these to the prisma during the 12hr sync job. if sqlite is empty then fetch from the prisma but write to sqlite." + confirmed: keep the worker **claim** + **leader lock** on Prisma.

- **Reads** → SQLite-first; if SQLite is empty/none → fetch from Prisma AND write/seed into SQLite.
- **Daemon periodic writes** (heartbeat, cron advance, task-status) → **SQLite locally**; Prisma written **only during the 12h sync job** (new SQLite→Prisma reconcile pass).
- **Cross-instance atomic ops stay on Prisma** (confirmed): worker task **claim** (`updateMany`), **leader lock** claim.
- **Task creation** (admin Run Now / orchestrator) stays on Prisma (shared queue) but is ALSO seeded into SQLite so the local poll can discover it.

---

## Implementation Steps

### Phase 1: SQLite primitives (`lib/sqlite.ts`)

1. **Control columns** — `ensureControlColumns()` idempotent `ALTER TABLE ADD COLUMN`: `worker_task.assigned_to`, `worker_task.cron_job_id`, `worker_task.payload`, `cron_job.config`. Call after `SCHEMA_SQL` at init. → verify: `npx tsc --noEmit` 0 new
2. **`SqliteFallback` writes** — `upsertWorkerTask(row)`, `upsertWorkerStatus(row)`, `upsertCronJob(row)`, `deleteWorkerTask(id)`, `deleteCronJob(id)`; all bump a `globalThis.__controlWriteAt` per-table timestamp. → verify: tsc 0 new
3. **`isControlMirrorEmpty/Stale(table, maxAgeMs)`** — returns true when the table has no rows OR no recent control write → caller falls back to Prisma. → verify: tsc 0 new
4. **Backfill seeding** — extend `syncFromPrisma()` Prisma→SQLite pull to map `assigned_to`/`cron_job_id`/`payload`/`config` so the 12h sync + boot populate the new columns. → verify: tsc 0 new
5. **SQLite→Prisma reconcile** — new `reconcileControlToPrisma()` (called inside `syncFromPrisma` at the 12h sync, leader-gated): batch-push SQLite `worker_status` heartbeats + `cron_job` `next_run`/`run_count` diffs to Prisma in few `createMany`/`updateMany` ops. → verify: tsc 0 new

### Phase 2: Worker engine — SQLite-first reads + SQLite writes (`lib/services/worker/worker-engine.ts`)

6. **Poll discovery** — replace `prisma.workerTask.findFirst(pending)` with: SQLite `getWorkerTasks()` → pick highest-priority pending; if none/empty-stale → `prisma.workerTask.findFirst` (fallback) and, on a hit, `upsertWorkerTask` (seed local). **Claim stays Prisma `updateMany`**. → verify: tsc + tests
7. **Reaper** — alive-worker/running-task/live-producer reads: SQLite `getWorkerStatuses()`/`getWorkerTasks()`; if empty-stale → Prisma fallback. Sweep `updateMany` stays Prisma. → verify: tsc + tests
8. **Heartbeat** — change `workerStatus.upsert` (Prisma) → `upsertWorkerStatus` (SQLite) ONLY; Prisma reconciled at 12h. → verify: tsc + tests
9. **Task-status writes** — after claim, `workerTask.update` completed/failed → `upsertWorkerTask` (SQLite); rely on 12h reconcile for Prisma. → verify: tsc + tests
10. **Cron advance** — `cronJob.update nextRun` → `upsertCronJob` (SQLite); reconciled at 12h. → verify: tsc + tests

### Phase 3: Cron daemon (`lib/services/worker/cron-daemon.ts`)

11. **`syncCronJobs`** job-list read → SQLite `getCronJobs()` first (empty-stale → Prisma fallback). → verify: tsc + tests
12. **`fireJob`** re-fetch → SQLite `getCronJobs()` first. → verify: tsc + tests

### Phase 4: Extra write sites

13. `task-orchestrator.ts` `workerTask.create` → also `upsertWorkerTask` (seed local; Prisma create kept as shared-truth). → verify: tsc
14. `leader.ts` heartbeat-status write → `upsertWorkerStatus` (SQLite); **leader-lock claim stays Prisma**. → verify: tsc
15. `app/api/admin/cron/route.ts` + `admin/workers/*` → also mirror to SQLite (best-effort) so the local poll/scheduler sees them immediately. → verify: tsc

### Phase 5: Tests

16. **NEW `lib/__tests__/daemon-sqlite-first.test.ts`** — poll SQLite-first/fresh, Prisma-fallback/empty, claim skip, cron resync fresh/stale. → verify: `npm run test` passes
17. **Extend `lib/__tests__/sqlite.test.ts`** — `ensureControlColumns`, upsert roundtrips, empty/stale guard, reconcile. → verify: `npm run test` passes

### Phase 6: Verification + docs

18. **Local PG re-sample** — dev server against local PG, reset `pg_stat_user_tables`, confirm daemon-loop Prisma reads/writes drop to ~0 in steady state. → verify: stats
19. **Full gate** — `npx tsc --noEmit` (baseline 46), `npm run test` all pass. → verify: green

---

## ⚠️ Final decision divergences (recorded during implementation)

The implementation refined the original plan in a few places after re-reading the code. These are **deliberate** and documented in source comments + CHANGELOG:

| Original plan item | Final decision | Why |
|--------------------|----------------|-----|
| Phase 2 #7 — Reaper **alive-worker / running-task liveness reads** SQLite-first | **Stay on Prisma** (unchanged) | Liveness is **cross-instance coordination** — a local per-instance SQLite mirror only holds this process's data; serving liveness from it would blind the reaper to other Netlify instances and risk reaping their live work (the v3.12.0 prod bug). They're also low-frequency (≤1/min, breaker-guarded), not the 30s poll noise the directive targets. |
| Phase 2 #8 — stateless-transition **worker heartbeat** (`workerStatus.upsert`) SQLite-only | **Stay on Prisma** (unchanged) | `updateHeartbeat("busy"\|"idle")` fires only at task start/complete (~2 per task) so the reaper + admin keep a correct cross-instance view. The periodic 5-min `pingLiveness()` already writes SQLite-only (v3.22.0). |
| Phase 3 #12 — `fireJob` re-fetch SQLite-first | **Stay on Prisma** (unchanged) | `fireJob` runs on a cron tick (low-frequency) and re-fetches the authoritative row before `spawnDueCronJob`; `nextRun` advance must be correct. The 5-min resync (`syncCronJobs`) is the SQLite-first path. |
| Phase 4 #14 — `leader.ts` heartbeat write → SQLite | **Stay on Prisma** (unchanged) | The **leader lock + its heartbeat ARE the cross-instance coordination primitive** (PR #113 split-leadership bug). Its liveness must live in the shared store or a standby would claim a stale leader → split leadership. |
| Phase 4 #15 — admin routes mirror to SQLite | **Not done** (unchanged) | Admin cron/worker writes are low-frequency user actions with immediate cross-instance relevance; the orchestrator's `seedTaskMirror` covers the poll-visibility gap (a freshly created task seeds the local mirror so the SQLite-first poll sees it). |

**Net effect:** the SQLite-primary control plane covers exactly what the user directive targets — the **high-frequency daemon check-reads** (30s worker poll + 5-min cron resync) and the **task-status completion writes** — while every **cross-instance atomic exclusion / coordination read stays on Prisma** (claim, leader lock + heartbeat, reaper liveness, stateless-transition heartbeat, `fireJob` re-fetch).
20. **Docs** — AGENTS.md, CHANGELOG, TODO, Primer, agent-memory, Lessons, session files. → verify: docs
21. **Restore `.env`** — revert local-PG `DATABASE_URL` → Accelerate URL (sensitive; not committed; backup preserved). → verify: `.env` restored

---

## Test Strategy

### Unit Tests (Required)

| Test | File | Verifies |
|------|------|----------|
| Poll discovery SQLite-first (fresh) — zero Prisma read | `daemon-sqlite-first.test.ts` | Read tier |
| Poll discovery Prisma fallback when SQLite empty + seeds SQLite | `daemon-sqlite-first.test.ts` | Backfill |
| Atomic claim count 0 → skip | `daemon-sqlite-first.test.ts` | Safety |
| Reaper alive-set from SQLite; sweep on Prisma | `daemon-sqlite-first.test.ts` | Split |
| Reaper empty-stale → Prisma (never reap live) | `daemon-sqlite-first.test.ts` | Correctness |
| Cron resync/fire fresh vs empty-stale | `daemon-sqlite-first.test.ts` | Scheduler |
| Heartbeat SQLite-only (no Prisma write) | `daemon-sqlite-first.test.ts` | Write redirect |
| Control columns idempotent | `sqlite.test.ts` | Schema |
| Upsert roundtrip + empty/stale guard + reconcile | `sqlite.test.ts` | Primitives |

### Integration / E2E

None (service-layer; no UI). Playwright not required.

---

## Verification Checklist

```bash
npx tsc --noEmit                    # 0 new errors (baseline: 46)
npm run test                        # All pass (baseline 989 pass / 4 skip)
npm run lint                        # No warnings
# PG re-sample: reset pg_stat_user_tables, observe daemon-loop reads/writes → ~0
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Empty/stale SQLite → miss pending task or new cron | `isControlMirrorEmpty/Stale` falls back to Prisma + seeds SQLite | No |
| Reaper reap live work | Fail-safe liveness read; mirror read only when non-empty+fresh | No |
| Multi-instance duplicate execution | Atomic claim + leader lock stay on Prisma (confirmed) | No |
| Heartbeat liveness stale across instances until 12h reconcile | Liveness is advisory for reaping (fail-safe); heartbeat reconcile at 12h sync | Acceptable — per user directive |
| SQLite per-instance divergence → reconcile | 12h reconcile pushes SQLite diffs to Prisma (single leader) | No |

---

## Documentation Checklist

- [ ] **AGENTS.md** — version row
- [ ] **CHANGELOG** — `versions-v3.25.md` + index
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — status
- [ ] **agent-memory.md** — activity entry
- [ ] **Lessons.md** — lesson
- [ ] **Session memory** — `decisions.md` + `flow.md`
- [ ] **session-todos.md** — updated
- [ ] **handoffs/active/latest.md** — resume
- [ ] **Restore `.env`** to Accelerate

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk, no secrets, `.env` restored
5. Docs updated
6. Engineering checklist validated
