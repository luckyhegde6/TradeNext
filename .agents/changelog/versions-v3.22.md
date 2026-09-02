# v3.22.0 — Write-behind log store (SQLite-primary, Prisma promotion for important logs only) + leader election + audit-tag gap fill

> **Date**: Sep 02 2026 · **Branch**: `feat/db-health-ops-visibility` (on top of v3.21.3) · **Suite**: 972 pass / 4 skip / 0 fail (+27 vs 945) · **tsc**: 46 = exact baseline (0 new) · **No schema change → no migration**. Commit/PR/deploy pending user.

## Problem

Two forces were pushing Prisma Postgres *plan ops/day* far above the target:

| Force | Symptom |
|-------|---------|
| **Multi-instance boot duplication** | 2026-09-02 prod log showed **5 Netlify instances**, each booting and independently syncing SQLite (`syncFromPrisma`) + scheduling duplicate cron jobs + workers → Prisma ops/BG work multiplied ~5–10× on cold-start bursts with no single-writer coordination. |
| **Write-behind drain wrote everything to Prisma** | The previous `drainWriteBehind` promoted **every** queued API/log/audit row to Prisma (`createMany` per chunk) — bulk info logs alone could push daily ops into the tens of thousands. There was no "what is actually important to persist across a deploy?" filter. |

Plus two clean-up gaps surfaced while fixing the above:

- **Audit-tag gap fill**: several admin actions (DB sync/flush/backup/restore/deploy-prep; recommendations run/performance checks) wrote no audit entry, or wrote tags that were **not in the security/critical auto-promote set**.
- **db-health UI keying mismatch**: `pending` / `lastFlushCounts` were keyed by **table** (`wb_*`) in the UI while the API returns them keyed by **kind** (`api_request`/`server_log`/`audit_log`) → pending cards + "Last Flush" read zeros forever.

## Solution

### 1) Leader election — single writer across instances

NEW `lib/services/leader.ts`:

- `LeaderRole` = `cron-daemon` | `worker` | `sqlite-sync`.
- `acquireLeaderLock(role, id, ttlMs)` / `renewLeaderLock` / `releaseLeaderLock` — a single-writer lock on `worker_status` (`leader-<role>` role row + heartbeat, **5-min staleness** via expiry check). On claim it writes a `leader-<role>` row with `leaderId` + `acquiredAt` + `expiresAt`.
- who's leader is decided by **staleness** (any old row is reclaimable), so the 5 instances reconcile to **one** SQLite sync + one scheduler + one flush timer.
- **DB down → fail-open to local leader** (`isLeaderLeader` returns true locally, `isDbWritable` false); on recovery the lock is re-acquired. Netlify cold starts can no longer multiply Prisma ops / BG jobs.
- `isLeader(role, id)` / `getLeaderInfo(role)` exported for consumers (e.g. the flush timer gates on the `sqlite-sync` role).
- **Reconcile fix** (pre-existing WIP bug): the outer catch in `acquireLeaderLock` swallowed genuine non-conflict `create` errors into `return false`. Now a `createPath` origin flag distinguishes — **create-path non-conflict / non-unavailable errors rethrow** (never silently stand down), generic `updateMany` claim-step failures **stand down → return false**, and DB-unavailable returns **true** (fail-open). Tested (leader.test A `create` rethrow, B `updateMany` stand-down, fail-open).

### 2) Write-behind promotion model — SQLite = primary durable log store

`lib/sqlite.ts`:

- SQLite is the **primary** durable log store (14-day TTL); Prisma receives **only the important subset** in a single `createMany` per drain.
- **Promotion rules** — NEW `isWbImportable` (renamed `isWbImportant` in branch docs):
  - `api_request` → `is_anomaly=1`, `is_rate_limited=1`, `status_code >= 500`, or has `error_message`.
  - `server_log` → only `level` in (`error`, `warn`) — info logs stay SQLite-only.
  - `audit_log` → action prefix in `AUTH|JOIN|PASSWORD|ADMIN|SESSION|LOGIN|LOGOUT` OR ends `_FAILED`/`_BLOCKED`/`_REJECTED` OR (`response_status >= 400` with `error_message`).
- `drainWriteBehind` reads up to `WB_CHUNK * WB_MAX_DRAIN_CHUNKS` (250 × 8 = **2000**) rows, filters via the important-predicate, **promotes only the important subset in ONE `createMany` (1 op)**, deletes only the promoted rows; non-promoted rows stay in SQLite (0 Prisma ops). Returns `{ flushed, retained, skipped }` (kind-keyed).
- **Double-count fix**: removed `dbOpsCounter.writes += chunk.length` in `writeWbRowsToPrisma` — a single `createMany` is **1 op** via `$allOperations`. (`executeRawUnsafe` bulk writes are never double-counted.)
- Constants: `WB_CHUNK=250`, `WB_MAX_DRAIN_CHUNKS=8`, `WB_RETENTION_MS=14d`, `WB_FLUSH_INTERVAL_MS=15min`.
- NEW `pruneWriteBehind()` — 14-day TTL purge by PK (resolves ids for the sql.js mock, then `DELETE WHERE pk IN (...)`).
- NEW `startWriteBehindFlush()` / `stopWriteBehindFlush()` — **leader-gated** on the `sqlite-sync` role, 15-min interval, drains + prunes. Booted after `startOpsCounterPersistence()` in `instrumentation.ts`.
- State + stats surface `wbLastPromoted` / `wbLastRetained`; `WriteBehindStats` has `lastPromoted` / `lastRetained`; `getWriteBehindStats()` returns them; `flushWriteBehind()` returns `retained`.
- `SqliteFallback.flushWriteBehind` interface updated to include `retained`.
- **sql.js mock fixes**: `__resetStore` exposed on the mock factory (reset between tests), `DELETE` honors `WHERE <pk> IN (...)`.

Net Prisma ops target: **< 1000/day** (bulk info/api logs never touch Prisma; only important rows do, in 1-op batches every 15 min).

### 3) Audit-tag gap fill (auto-promoted — `ADMIN_*` prefix)

`lib/audit.ts` union **+9**:
- `ADMIN_DB_SYNC`, `ADMIN_DB_FLUSH_PRICES`, `ADMIN_DB_FLUSH_LOGS`, `ADMIN_DB_DEPLOY_PREP`, `ADMIN_DB_BACKUP`, `ADMIN_DB_RESTORE` — each `void createAuditLog` in `app/api/admin/db-health/route.ts` POST actions (fire-and-forget per v3.20.3). `flush_logs` carries `{ flushed, retained, pending }`; `deploy_prep` surfaces `retained`.
- `ADMIN_RECOMMENDATION_RUN`, `ADMIN_PERFORMANCE_CHECK`, `ADMIN_SWING_PERFORMANCE_CHECK` — admin recommendations POST `run_now` / `check_performance` / `check_swing_performance`, each with `taskId` metadata.

### 4) db-health UI kind-key fix

`app/admin/utils/db-health/page.tsx` — `pending` and `lastFlushCounts` are keyed by **kind** (`api_request` / `server_log` / `audit_log`), not table (`wb_*`). Fixed the pending cards + "Last Flush" line to read the kind keys, and added an emerald (`lastPromoted`) vs amber (`lastRetained`) split per kind.

### 5) cron-daemon heartbeat → local SQLite (zero Prisma ops)

`lib/services/worker/cron-daemon.ts` `writeHeartbeat` now writes `writeLivenessHeartbeat("cron-daemon", { daemonId, registeredJobs, memoryUsageMb })` into `_backup_meta` (in-memory `lastHeartbeatAt` powers the admin chip) instead of a `workerStatus` upsert → **0 Prisma ops per heartbeat**. `cron-daemon.test.ts` updated to assert the new SQLite contract (via a `@/lib/sqlite` mock exposing `getSqliteFallback().writeLivenessHeartbeat`), asserting `prisma.workerStatus.upsert` is NOT called.

## Files Created

| File | Purpose |
|------|---------|
| `lib/services/leader.ts` | leader-election lock (`acquireLeaderLock`/`renewLeaderLock`/`releaseLeaderLock`/`isLeader`/`getLeaderInfo`, `LeaderRole`) |
| `lib/__tests__/leader.test.ts` | 18 tests — claim/reclaim/staleness/renew/release/fail-open/stand-down/rethrow contracts |
| `.agents/specs/01-db-ops-reduction.md` | spec (this work) |
| `.agents/plans/01-db-ops-reduction.md` | plan (this work) |

## Files Modified

- `lib/sqlite.ts` — `isWbImportant`, promotion `drainWriteBehind`, `pruneWriteBehind`, `startWriteBehindFlush`/`stopWriteBehindFlush`, state/stats `wbLastPromoted`/`wbLastRetained`, `WriteBehindStats`, `flushWriteBehind` retained, `SqliteFallback` interface, `wbLastFlushCounts` kind-keyed, double-count removal, mock `__resetStore` + `DELETE IN`.
- `instrumentation.ts` — boots `startWriteBehindFlush()` after `startOpsCounterPersistence()`.
- `lib/audit.ts` — `AuditAction` +9 (`ADMIN_DB_SYNC`, `ADMIN_DB_FLUSH_PRICES`, `ADMIN_DB_FLUSH_LOGS`, `ADMIN_DB_DEPLOY_PREP`, `ADMIN_DB_BACKUP`, `ADMIN_DB_RESTORE`, `ADMIN_RECOMMENDATION_RUN`, `ADMIN_PERFORMANCE_CHECK`, `ADMIN_SWING_PERFORMANCE_CHECK`).
- `app/api/admin/db-health/route.ts` — 6 `ADMIN_DB_*` audit calls on POST actions; `deploy_prep` surfaces `retained`.
- `app/api/admin/recommendations/route.ts` — 3 admin audit calls (run/perf/swing-perf) with `taskId`.
- `app/admin/utils/db-health/page.tsx` — kind-keyed pending/lastFlushCounts; `lastPromoted` vs `lastRetained` split.
- `lib/services/worker/cron-daemon.ts` — heartbeat → local SQLite.
- `lib/__tests__/sqlite.test.ts` — `.test.ts` (33/33): promotion split, regression (600 error rows → 3 createMany, writes counter unchanged), `__resetStore` isolation.
- `lib/__tests__/audit.test.ts` — asserts the 9 new `AuditAction` values.
- `lib/__tests__/cron-daemon.test.ts` — heartbeat now asserts SQLite contract.

## Key Design Decisions

1. **SQLite is the primary durable log store; Prisma holds only cross-deploy-logged important rows.** In-memory SQLite is wiped on deploy — accepted: retained rows are low-value metric logs already in pino/file logger; only important rows get Prisma cross-deploy durability.
2. **One `createMany` per drain, not per chunk** — a chunked drain used to be *many* ops; promoting the filtered subset in one op keeps net ops at the target (`<1000/day`).
3. **`createMany` = 1 op, never `+= chunk.length`** — the earlier double-count would have inflated the write budget gauge.
4. **Leader-gated flush** on the `sqlite-sync` role so 5 instances don't each drain/prune/duplicate; DB down degrades to local leader, re-elects on recovery.
5. **Fail-open beats silent stand-down** — a genuine DB-claim error must not silently stop leadership; only a lost claim-race retries.
6. **Cron heartbeat to local SQLite** removes a steady 15-min Prisma write, freeing the admin chip while staying deploy-`_backup_meta`.

## Verification

- `npx jest` → **69/69 suites, 972 pass / 4 skip / 0 fail** (was 945/4; +27: leader 18 + sqlite promotion/regression + audit-actions). 4 skips = pre-existing intentional client-cache IndexedDB.
- `npx tsc --noEmit` → **46 = exact baseline (0 new production errors)**.
- `leader.test.ts` + `cron-daemon.test.ts` (32 tests) pass together.
- No schema change → no migration (`prisma validate` unaffected).
- Commit/PR/deploy pending user approval.