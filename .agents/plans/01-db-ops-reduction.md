# Plan — DB Ops Reduction: Leader Lock + Write-Behind Logging

> Branch: `feat/db-ops-reduction` (created from `fix/sqlite-wasm-netlify`)
> Spec: `.agents/specs/01-db-ops-reduction.md`

## Goal
Cut Prisma op pressure that trips the plan-limit breaker: (1) leader-lock so only one Netlify instance runs worker/cron/sync, (2) move high-frequency log writes (`APIRequestLog`, `ServerLog`, `AuditLog`) to a SQLite write-behind queue flushed in bulk.

## Verification targets
- Jest baseline 945 pass / 4 skip (+ new leader/write-behind tests)
- `npx tsc --noEmit` — 0 new errors beyond baseline 46
- Suite green before and after

---

## Steps

### Step 1 — `lib/services/leader.ts` (NEW)
- `LEADER_STALENESS_MS = 5*60_000`, `LEADER_HEARTBEAT_MS = 60_000`
- `leaderWorkerId(role)` → `leader-<role>`
- `acquireLeaderLock(role)`: `updateMany` on stale row; fallback `upsert`; DB-unavailable degrade to local-true.
- `renewLeaderLock(role)`, `releaseLeaderLock(role)`, `isLeader(role)`.
- Verify: `npx tsc --noEmit` no new errors.

### Step 2 — SQLite write-behind (in `lib/sqlite.ts`)
- Add 3 `wb_*` tables to `SCHEMA_SQL`.
- `enqueueWriteBehind(kind, row)` — local insert; in-memory early-buffer if not ready.
- `drainWriteBehind()` — read queue → `createMany` to Prisma → delete flushed → metadata + ops counter.
- `getWriteBehindStats()`, `flushWriteBehind()`.
- Verify: `lib/__tests__/writeBehind.test.ts` green.

### Step 3 — Route write paths through queue
- `lib/rate-limit.ts` `logAPIRequest` → enqueue; fallback direct-DB if SQLite down.
- `lib/services/db-logger.ts` `logToDb` → enqueue.
- `lib/audit.ts` `createAuditLog` → enqueue.
- `lib/services/ai/ai-monitoring.ts` (`serverLog.create`) → enqueue.
- Verify: existing suites re-run (no regressions).

### Step 4 — Leader gate on daemon/worker/sync
- `lib/sqlite.ts` `syncFromPrisma(opts?)` — skip unless `isLeader("sqlite-sync")` (unless `force`).
- `cron-daemon.ts` `startCronDaemon` — acquire cron-daemon lock; standby on non-leader; heartbeat renews.
- `worker-engine.ts` `startWorker` — acquire worker lock; stand down on non-leader.
- `instrumentation.ts` — acquire locks, start only if leader (or DB-down degrade).
- Verify: `lib/__tests__/leader.test.ts` green; suite green.

### Step 5 — Admin flush + stats
- `app/api/admin/db-health/route.ts` POST `flush_logs` + GET `writeBehind` stats.
- `app/admin/utils/db-health/page.tsx` Log Flush card.
- Verify: typecheck; Playwright DB Health page renders + flushes.

### Step 6 — Tests
- `lib/__tests__/leader.test.ts` (~8 tests)
- `lib/__tests__/writeBehind.test.ts` (~10 tests)
- `lib/__tests__/sqlite.test.ts` (+5)
- Run full `npm run test`; confirm baseline + new green, 0 fail.

### Step 7 — Docs + commit
- Docs-updater: AGENTS.md version row, CHANGELOG, TODO, Primer, agent-memory, Lessons.
- Commit WASM hotfix + this feature together (one PR from `fix/sqlite-wasm-netlify` base → main).

---

## Risks / Notes
- `syncFromPrisma` currently called in several places (init, recovery probe, flush). The leader gate must not deadlock — recovery probe should still trigger a leader attempt (probe stays on every instance; only the leader performs the heavy sync).
- `logAPIRequest` uses `.upsert` on `requestId` (unique). The write-behind must preserve dedup (insert by `request_id`, `INSERT OR REPLACE`).
- DB-down degrade for leader election is intentional (avoid halting cron). Re-elect on recovery.
- Early-boot in-memory buffer bounded (e.g. 500 rows) to avoid unbounded memory pre-init.