# Spec Document — DB Ops Reduction: Leader Lock + Write-Behind Logging

> Branch: off `fix/sqlite-wasm-netlify` → `feat/db-ops-reduction`
> Date: 2026-09-02

## 1. Overview

**What**: Two coupled production fixes that together cut Prisma Postgres operations dramatically:

1. **Leader lock** — only ONE Netlify instance runs the in-process worker engine + cron daemon + startup SQLite sync. Today every instance runs `instrumentation.ts`, so a cold-start burst of 5 instances spawned 5 worker engines, 5 cron daemons, and 8–10 concurrent full `syncFromPrisma()` runs (~7s each, reading all 10 tables), multiplying DB ops ~5–10× at boot and scheduling duplicate cron jobs.

2. **Write-behind logging queue** — `APIRequestLog` (`logAPIRequest` in `lib/rate-limit.ts`), `ServerLog` (`logToDb` in `lib/services/db-logger.ts` + `ai-monitoring.ts`), and `AuditLog` (`createAuditLog` in `lib/audit.ts`) currently write **directly to Prisma on every call** (fire-and-forget but still a DB write). During a plan-limit hold these writes timed out at 120s (`APIRequestLog.upsert timed out after 120000ms`) and contributed to the op pressure that tripped the breaker. These high-frequency log writes are moved to a **SQLite write-behind queue**: local insert (zero Prisma ops) immediately, then bulk-flushed to Prisma periodically (nightly + on-demand via admin button).

**Why**: The 2026-09-02 04:54–05:15 prod log showed: (a) repeated `Plan limit circuit breaker open` with `APIRequestLog.upsert timed out after 120000ms`, `WorkerTask.findMany timed out`, and `Swing analysis processor crashed`; (b) multiple instances each logging `SQLite: sync complete, totalRows=2034-2056, durationMs=~7000` at the same 04:54–05:01 window; (c) memory spiking to 460MB per instance. These are the two largest recurring DB-op sources after the v3.19-v3.21 op reductions. This is the direct fulfillment of the user's "optimize the db and fixing the errors" instruction.

**Scope IN**:
- Leader-election guard so only one instance runs `startWorker` + `startCronDaemon` + full startup SQLite sync (liveness takeover).
- Write-behind SQLite queue for `APIRequestLog`, `ServerLog`, `AuditLog` (local insert → periodic/on-demand bulk Prisma flush).
- SQLite→Prisma flush period (daily, on-demand from admin button), read fallback to SQLite when Prisma down.
- Ops-count tracking for the write-behind flush (so the admin dashboard remains accurate).
- Tests + docs.

**Scope OUT**:
- The WASM copy hotfix (already verified on `fix/sqlite-wasm-netlify`; ships as its own commit in the same PR).
- Changing `daily_recommendation_stock` / `corporate_action` write paths (deferred — the log tables are the highest-frequency writes; recs/corp-actions are lower-volume).
- Full SQLite-primary read path during market hours (read chain stays cache → SQLite → Prisma as already implemented).

**Depends on**: v3.21.x SQLite layer (`lib/sqlite.ts` `syncFromPrisma`, `_backup_meta`, ops-counter persistence), v3.11.x in-process daemon (`instrumentation.ts`, `cron-daemon.ts`, `worker-engine.ts`), v3.20.3 breaker (`isDbUnavailableError`, `PlanLimitOpenError`).

---

## 2. Routes

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/admin/db-health` | Return `writeBehind` queue stats (pending rows per table, last flush) |
| POST | `/api/admin/db-health` | New `action: "flush_logs"` — flush SQLite write-behind logs → Prisma |

### Admin UI

| Page | Change |
|------|--------|
| `app/admin/utils/db-health/page.tsx` | New "Log Flush" card with per-table pending counts + "Flush Now" button |

---

## 3. Database Schema

**No Prisma schema change.** `APIRequestLog`, `ServerLog`, `AuditLog` models already exist. The write-behind queue lives **entirely in SQLite** (`lib/sqlite.ts`), so no migration is needed.

### New SQLite tables (in `lib/sqlite.ts` SCHEMA_SQL)

```sql
-- Write-behind queue for high-frequency log writes. Rows are inserted here
-- (zero Prisma ops) and bulk-flushed to Prisma by the nightly/on-demand flush.
CREATE TABLE IF NOT EXISTS wb_api_request (
  request_id  TEXT PRIMARY KEY,
  user_id     INTEGER,
  user_email  TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  method      TEXT,
  path        TEXT,
  query_params TEXT,
  status_code INTEGER,
  response_time INTEGER,
  error_message TEXT,
  is_nse      INTEGER,
  nse_endpoint TEXT,
  is_rate_limited INTEGER,
  is_anomaly  INTEGER,
  anomaly_type TEXT,
  queued_at   TEXT
);

CREATE TABLE IF NOT EXISTS wb_server_log (
  id          TEXT PRIMARY KEY,
  level       TEXT,
  message     TEXT,
  source      TEXT,
  task_id     TEXT,
  metadata    TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  request_id  TEXT,
  queued_at   TEXT
);

CREATE TABLE IF NOT EXISTS wb_audit_log (
  id              TEXT PRIMARY KEY,
  user_id         INTEGER,
  user_email      TEXT,
  action          TEXT,
  resource        TEXT,
  resource_id     TEXT,
  method          TEXT,
  path            TEXT,
  response_status INTEGER,
  response_time   INTEGER,
  ip_address      TEXT,
  metadata        TEXT,
  error_message   TEXT,
  queued_at       TEXT
);
```

> Note: `syncFromPrisma` currently populates the read mirrors `server_log` / `audit_log` (last 200) via `syncTable`. The write-behind tables (`wb_*`) are **separate** — they hold pending writes yet to reach Prisma. The flush drains `wb_*` → Prisma; the read mirrors (`server_log`/`audit_log`) are refreshed by sync and are what fallback reads use.

### Migration Notes
- No migration. Schema change is in the SQLite layer only (self-created at init).

---

## 4. Functions to Implement

### A. `lib/services/leader.ts` (NEW) — Leader election

#### `acquireLeaderLock(role: LeaderRole): Promise<boolean>`
- Roles: `"cron-daemon"`, `"sqlite-sync"`, `"worker"`. Uses a single `WorkerStatus` row `leader-<role>`.
- Atomic acquire: `prisma.workerStatus.updateMany({ where: { workerId: LEADER_ID(role), lastHeartbeat: { lt: STALE_AT } }, data: { lastHeartbeat: now, workerName: "<host>-<pid>", status: "leader" } })`.
  - If 1 row updated → acquired (or renewed an expired lock).
  - If 0 rows → try `upsert` (create-if-absent; unique on workerId). If the upsert create path throws a unique-conflict (another instance holds a fresh lock), return false.
- **Non-blocking**: if the DB is unavailable, degrade to `true` (local process becomes leader) to avoid halting cron/work entirely — but log a warning. When a DB-unavailable leader is running, ops stay localized; on DB recovery the election re-runs.

#### `renewLeaderLock(role): Promise<boolean>`
- Heartbeat the leader row to `now`. Returns whether we're still the leader.

#### `releaseLeaderLock(role): Promise<void>`
- Delete the row if it's still ours (`workerId` match + same `pid` in name). Best-effort.

#### `isLeader(role): Promise<boolean>`
- Reads the row; `true` if it exists and `workerName` host-pid matches this process. Used by the SQLite sync gate and cron/worker guards.

#### `LEADER_STALENESS_MS` / `LEADER_HEARTBEAT_MS`
- Staleness window: 2× heartbeat cadence. Heartbeat every 60s (existing worker) / cron heartbeat uses its own. Leader lock staleness = 5 min.

### B. `lib/sqlite.ts` (MODIFIED) — Leader-gated sync + write-behind queue

#### `syncFromPrisma(opts?: { force?: boolean })`
- New gate: at start, unless `opts.force`, call `isLeader("sqlite-sync")`; if not leader, **skip** the full sync (return early `{ skipped: true }`) so only the leader drives the startup/recovery sync. Prevents the 8–10× concurrent-sync storm.
- Non-leaders still `ensureSqliteBackup()` (schema ready) but skip the heavy read-all-tables sync.

#### NEW `enqueueWriteBehind(kind: "api_request" | "server_log" | "audit_log", row: Record<string, unknown>): void`
- Synchronous (or fire-and-forget) local SQLite insert into `wb_*`. Zero Prisma ops. Deduped: `api_request` upserts on `request_id`; `server_log`/`audit_log` use their Prisma `id` (uuid generated client-side) so a flush is idempotent via `create`/`createMany` + `ON CONFLICT`.
- If SQLite isn't ready yet, fall back to a module-level in-memory buffer (array) that's drained into SQLite once ready (so early-boot writes aren't lost).

#### NEW `drainWriteBehind(): Promise<{ flushed: Record<string, number>; skipped: boolean }>`
- Read rows from `wb_api_request` / `wb_server_log` / `wb_audit_log`, strip `queued_at`, bulk-insert into Prisma (`createMany`), then delete the flushed rows from SQLite. Respects `isDbUnavailableError` (on DB down, keep rows in queue, return `skipped`).
- Bounded chunk (e.g. 250 per table per pass) to avoid a giant transaction.
- Tracks the flush in `_backup_meta` (`wb_flush_at`, `wb_flush_counts`) and bumps the Prisma ops counter (`read` per drain + `write` per row via `dbOpsCounter` when the op passes through Prisma).

#### NEW `getWriteBehindStats(): { pending: Record<string, number>; lastFlushAt: string | null; lastFlushCounts: Record<string, number> }`
- Read-only: row counts per `wb_*` table + last flush metadata.

#### NEW `flushWriteBehind()` (public wrapper used by the admin route)
- Awaits readiness, calls `drainWriteBehind()`, returns the aggregate.

### C. Write-path interception (MODIFIED)

| File | Change |
|------|--------|
| `lib/rate-limit.ts` `logAPIRequest` | Replace the direct `prisma.aPIRequestLog.upsert` with `enqueueWriteBehind("api_request", {...})`. Keep the old Prisma path ONLY as a fallback when SQLite is unavailable AND DB is available. |
| `lib/services/db-logger.ts` `logToDb` | Route the `serverLog.create` through `enqueueWriteBehind("server_log", {...})`. Keep `getDbLogs`/`cleanupOldLogs`/`getLogStats` reading Prisma unchanged (the flush keeps them populated). |
| `lib/audit.ts` `createAuditLog` | Route the `prisma.auditLog.create` through `enqueueWriteBehind("audit_log", {...})`. Keep the fallback direct write if SQLite is not ready. |
| `lib/services/ai/ai-monitoring.ts` (line 171 `serverLog.create`) | Route through `enqueueWriteBehind("server_log", {...})`. |

### D. Daemon/worker gating (MODIFIED)

| File | Change |
|------|--------|
| `lib/services/worker/cron-daemon.ts` `startCronDaemon` | Acquire `leader-role: "cron-daemon"`; if not acquired, log "standby (non-leader)" and return `{ alreadyRunning: false, registeredJobs: 0, leader: false }` WITHOUT registering cron tasks. Standby runs a lightweight re-check interval; when the lock becomes available (leader died), upgrade to active. Heartbeat renews the lock. |
| `lib/services/worker/worker-engine.ts` `startWorker` | Acquire `leader-role: "worker"`; if not leader, stand down (don't poll). Heartbeat renews the worker lock. |
| `instrumentation.ts` | Order becomes: acquire worker+cron-daemon leader locks → start worker/cron only if leader holds both (or DB-down degrade). SQLite sync runs leader-gated inside `syncFromPrisma`. |

### E. Admin flush route (MODIFIED)

| File | Change |
|------|--------|
| `app/api/admin/db-health/route.ts` | POST `action: "flush_logs"` → `flushWriteBehind()`; GET adds `writeBehind: getWriteBehindStats()`. |
| `app/admin/utils/db-health/page.tsx` | New "Log Flush" card: pending per table + "Flush Now" button + last-flush time/counts. |

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/leader.ts` | **Created** | Leader-election + lock helpers |
| `lib/sqlite.ts` | Modified | 3 `wb_*` tables, `syncFromPrisma` leader gate, `enqueueWriteBehind`, `drainWriteBehind`, `flushWriteBehind`, `getWriteBehindStats`, in-memory early-buffer |
| `lib/rate-limit.ts` | Modified | `logAPIRequest` → write-behind queue |
| `lib/services/db-logger.ts` | Modified | `logToDb` → write-behind queue |
| `lib/audit.ts` | Modified | `createAuditLog` → write-behind queue |
| `lib/services/ai/ai-monitoring.ts` | Modified | `serverLog.create` → write-behind queue |
| `lib/services/worker/cron-daemon.ts` | Modified | Leader-gated start + standby recheck + heartbeat renew |
| `lib/services/worker/worker-engine.ts` | Modified | Leader-gated `startWorker` + heartbeat renew |
| `instrumentation.ts` | Modified | Acquire locks; start worker/cron/sync behind leader |
| `app/api/admin/db-health/route.ts` | Modified | `flush_logs` action + `writeBehind` stats |
| `app/admin/utils/db-health/page.tsx` | Modified | Log Flush card |
| `lib/__tests__/leader.test.ts` | **Created** | Leader-election unit tests |
| `lib/__tests__/writeBehind.test.ts` | **Created** | Queue/drain/flush unit tests |
| `lib/__tests__/sqlite.test.ts` | Modified | New write-behind + leader-gate tests |

---

## 6. Dependencies

### New Packages
None.

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/prisma` | `prisma.workerStatus`, `prisma.aPIRequestLog`, `prisma.serverLog`, `prisma.auditLog`, `dbOpsCounter`, `isDbUnavailableError` | DB access + breaker |
| `@/lib/db-utils` | `isDbUnavailableError` | Detecting DB-down for skip semantics |
| `@/lib/sqlite` | `enqueueWriteBehind`, `drainWriteBehind`, `getWriteBehindStats`, `isLeader` | Write-behind queue + leader gate |
| `@/lib/logger` | `logger.info/warn/error` | Structured logging |

---

## 7. API Contract

### POST /api/admin/db-health `{ action: "flush_logs" }`

**Request:** `{ action: "flush_logs" }`

**Response (200):**
```json
{
  "success": true,
  "writeBehind": {
    "pending": { "api_request": 0, "server_log": 12, "audit_log": 3 },
    "flushed": { "api_request": 20, "server_log": 5, "audit_log": 2 },
    "lastFlushAt": "2026-09-02T05:00:00.000Z"
  }
}
```

### GET /api/admin/db-health (added field)

```json
{
  "writeBehind": {
    "pending": { "api_request": 3, "server_log": 40, "audit_log": 9 },
    "lastFlushAt": "2026-09-02T04:00:00.000Z",
    "lastFlushCounts": { "api_request": 100, "server_log": 50, "audit_log": 20 }
  }
}
```

---

## 8. UI/UX Requirements

### Log Flush card on DB Health page

- **Pending counts** per table (api_request / server_log / audit_log), refreshed with the page (auto-refresh 30s).
- **"Flush Now" button** → POST `flush_logs`, updates the card with flushed counts + last-flush timestamp.
- **States**: Loading (button disabled + pulse), Error (amber "Flush failed — DB unavailable"), Success (green check + counts).
- Responsive: stacks on mobile.

---

## 9. Rules & Guardrails

- [x] No Prisma schema change → no migration
- [x] Write-behind insert is local SQLite (zero Prisma ops) — never blocks the caller
- [x] `drainWriteBehind` respects `isDbUnavailableError` (skips, keeps queue, no 500)
- [x] Fallback to direct-DB write ONLY when SQLite unavailable AND DB available
- [x] Leader lock: non-leaders never start worker/cron/sync; leader takeover on staleness
- [x] DB-unavailable degrade: node runs as leader locally (avoids halting cron/work), re-elects on recovery
- [x] Logging via `@/lib/logger` (no `console.log`)
- [x] No Prisma in client components
- [x] Idempotent flush (client-generated `id` / `request_id` + `INSERT OR REPLACE`)

---

## 10. Expected Behavior

1. On cold start with N instances, only ONE runs worker-poll + cron-daemon + full SQLite sync; others log `standby (non-leader)` and do NOT register cron tasks or poll DB.
2. If the leader's heartbeat goes stale (crash, recycle), a standby acquires the lock within the staleness window and becomes the active daemon.
3. `logAPIRequest`, `logToDb`, `createAuditLog`, and ai-monitoring's `serverLog.create` insert into the SQLite `wb_*` queue — no Prisma write at call time.
4. `drainWriteBehind()` bulk-flushes the queue to Prisma (`createMany`), deletes flushed rows, records `lastFlushAt` + counts, and respects the DB plan-limit/breaker (skips silently while DB down).
5. Admin "Flush Now" drains the queue; GET returns pending counts.
6. During a plan-limit hold, log writes never time out at 120s because they're local SQLite inserts.
7. Full test suite passes (baseline + new), tsc has 0 new errors.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| SQLite not ready at enqueue time | Buffer in-memory; drain into SQLite on readiness | `debug` |
| DB down during drain | Skip pass, keep queue intact, return `skipped: true` | `warn` (once) |
| DB down during leader election | Acquire lock locally (degrade), log warn; re-elect on recovery | `warn` |
| Leader heartbeat write fails | Non-fatal; keep processing | `debug` |
| Non-leader tries to sync | Early-return `{ skipped: true }`, no tables touched | `debug` |
| Flush `createMany` partial fail | `createMany` skipDuplicates → remaining stay in queue | `error` |

---

## 12. Test Strategy

### Unit Tests

#### `lib/__tests__/leader.test.ts` (NEW, ~8 tests)
- [ ] fresh lock acquired by first node
- [ ] second node does not acquire while first holds a fresh lock
- [ ] second node acquires after first's heartbeat goes stale
- [ ] DB-unavailable degrades to local leader
- [ ] renew preserves leadership
- [ ] release clears the row
- [ ] idempotent acquire (already leader)

#### `lib/__tests__/writeBehind.test.ts` (NEW, ~10 tests)
- [ ] enqueue inserts into `wb_*` (api_request/server_log/audit_log)
- [ ] enqueue dedupes api_request by request_id
- [ ] drain flushes rows to Prisma and clears the queue
- [ ] drain skips when Prisma reports DB-unavailable
- [ ] drain is bounded (chunked) and records flush metadata
- [ ] stats return pending counts
- [ ] early-boot in-memory buffer drains into SQLite once ready
- [ ] client-generated id makes flush idempotent

#### `lib/__tests__/sqlite.test.ts` (MODIFIED, +=5)
- [ ] syncFromPrisma gate: non-leader skips (returns `{ skipped: true }`)
- [ ] leader-gated sync still runs full tables
- [ ] write-behind tables exist after init
- [ ] `flushWriteBehind` wrapper returns aggregate
- [ ] write-behind + leader gate coexist with existing state reset hook

### E2E
- [ ] Admin DB Health shows Log Flush card with pending + flushes on click (manual/Playwright)

---

## 13. Performance Considerations

- **Zero-ops hot path**: log writes become local sql.js inserts (sub-ms, no network).
- **Bulk flush**: `createMany` (chunked 250) replaces N individual `create`s.
- **Batch reads**: leader-gated sync removes 8–10× redundant full-table reads at boot.
- **Dedup**: `updateMany`-style acquire + `INSERT OR REPLACE` idempotent flush avoids dup rows.
- **Queue bounded**: pending `wb_*` rows bounded by daily traffic; nightly + on-demand flush keeps it low.

---

## 14. Security Considerations

- Log rows carry user/email data — write-behind is server-local SQLite (same trust boundary as the existing SQLite backup).
- Admin flush route protected by existing admin auth.
- No secrets in log rows (already sanitized at call sites).
- No new external input added.

---

## 15. Definition of Done

- [x] Leader lock implemented (new `lib/services/leader.ts`) + wired into cron-daemon, worker-engine, instrumentation, sqlite sync
- [x] Write-behind queue implemented (3 `wb_*` tables) + all 4 log write-paths routed through it
- [x] `flush_logs` admin action + `writeBehind` GET stats + DB Health Log Flush card
- [x] No Prisma schema change / no migration
- [x] Unit tests written and passing (2026-09-02 baseline 945 pass / 4 skip)
- [x] `npx tsc --noEmit` → 0 new errors beyond baseline (46)
- [x] Error handling per section 11 (safe defaults, DB-down skip, no 500)
- [x] WASM hotfix (copy to build) ships in the SAME PR as this feature
- [x] Documentation updated (AGENTS.md, CHANGELOG, TODO, Primer, agent-memory, Lessons)
- [x] Live-verified on :3000 (DB Health page, leader log lines, flush button)