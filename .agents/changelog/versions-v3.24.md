# v3.24.0 — Plan-limit breaker false-OPEN observability + leader-heartbeat renewal (stops cron/worker/sync stalls) + AI-monitoring two-tier merge

> **Date**: Sep 03 2026 · **Branches**: `fix/netlify-secrets-scan-wasm` (Netlify) + `fix/cron-breaker-leader` (this unit) · **Suite**: 989 pass / 4 skip / 0 fail (71 suites, was 986) · **tsc**: 46 = exact baseline (0 new) · **No schema change → no migration**. PRs #112 (Netlify) + #113 (this unit) pending user merge/deploy.

---

## Problem

Reported: **"Crons not firing at all."** Root-caused via `logs/` (2026-09-02/2026-09-03) that the in-process node-cron daemon **IS** running and fires on schedule, but every DB op it makes is rejected by the plan-limit circuit breaker, which is **OPEN on an otherwise-healthy local Postgres DB**. So node-cron fires → `fireJob`'s `prisma.cronJob.findUnique` throws `Plan limit circuit breaker open` → the cron catch marks the fire failed, **nothing spawns, and `nextRun` never advances** — the cron stays due forever yet can never run.

Evidence trail:
- `Cron job fire failed ... Plan limit circuit breaker open` at 03:00 / 03:30 / 04:00 UTC (the due DailyRecs / PerformanceCheck / MarketSync slots) — **nextRun stuck**.
- `Cron daemon resync deferred (DB unavailable)` throughout — the resync's own `prisma.cronJob.findMany` is breaker-rejected.
- `Swing analysis processor crashed` + worker polling back-off (`workerStopped`). Worker engine's `checkScheduledJobs` shares the same `spawnDueCronJob` path → same stall.
- Meanwhile the DB is healthy: reads + login (`Login successful` 2026-09-03 04:19:11 IST-equiv) and direct table queries succeed **seconds later** — so the OPEN breaker is a **false trip**, not a real hold.

AI-monitoring showed **"0 of 0 calls shown"** despite thousands of real AI runs in the same period.

---

## Root cause (two code defects) + the AI-monitoring display bug

### Defect 1 — breaker trip is invisible
`openPlanLimitBreaker()` (from `lib/db-utils.ts`, invoked from `lib/prisma.ts` `$allOperations`) logged **nothing** about the triggering error. On a healthy DB the trip is a *spurious match* of `isDbUnavailableError()` / `isPlanLimitHoldError()` — most likely a **120s per-query timeout** (`PRISMA_QUERY_TIMEOUT_MS`, whose `PrismaQueryTimeoutError` name contains "timeout" and matches both predicates), or a benign error matching one of the **broad message substrings** (`network`, `proxy`, `operational`, `tls`, `fetch failed`, `P1016`, `P1012`, `getaddrinfo`, ...). Because the trip was silent, the daemon just saw "failing fast" for 5-minute hold windows with zero diagnosis possible.

### Defect 2 — leader heartbeats are never renewed
`instrumentation.ts` calls `acquireLeaderLock(role)` **once** at boot, but `renewLeaderLock` had **zero call sites** (grep-confirmed). Every `worker_status` `leader-<role>` row therefore goes stale after `LEADER_STALENESS_MS = 5 min`. A standby instance (e.g. a Netlify cold-start burst — prod saw 5 instances) then claims the stale lock → **split leadership** → duplicate crons / duplicate SQLite sync / duplicate worker: exactly the multi-instance op-multiplication v3.22.0's leader election set out to prevent. Observed: all 3 leader rows stuck at `2026-09-02T05:56:02Z` (~22h stale).

### AI-monitoring display bug
Since v3.22.0, AI calls are write-behind enqueued to SQLite `wb_server_log` (write-behind log store). `drainWriteBehind` promotes **only** `isWbImportant` rows (api 5xx/rate-limited/anomaly/error, server_log error|warn, security/critical audits) to Prisma. So **info-level SUCCESS AI calls never reach Prisma**. `getPersistedAiCalls` read Prisma only → admin AI-monitoring showed **0 calls** despite thousands of runs.

---

## Fixes

### Fix 1 — breaker-open observability (`lib/prisma.ts`, +18)
At the breaker-open site in `$allOperations` catch block, added a **throttled** `logger.warn` carrying `model` / `operation` / `error.message` / `classifyDbError(err)` type. New `BREAKER_TRIP_LOG_THROTTLE_MS = 60_000`, last-log timestamp stored on `globalThis` (`g.__lastBreakerTripLog`) so repeated trips within 60s don't spam logs but every *new* trip window is visible. The next spurious trip is now diagnosable instead of invisible.

### Fix 2 — leader-heartbeat renewal (`lib/services/leader.ts` +38, `instrumentation.ts` +12)
NEW `startLeaderHeartbeat(role, onLost?)` in `leader.ts`:
- `setInterval` every `LEADER_HEARTBEAT_MS = 60_000` (1 min — safely under the 5-min `LEADER_STALENESS_MS`, and independent of the cron-daemon's 15-min `HEARTBEAT_INTERVAL_MS` SQLite heartbeat which is too slow to renew the DB lock).
- Calls `renewLeaderLock(role)`; if it returns `false` (lock lost / DB unavailable) logs, `clearInterval`, and invokes `onLost?` (future re-elect hook).
- `timer.unref?.()` so the timer never holds the process open.
- Returns a `stop()` function.
Wired into `instrumentation.ts` immediately after each `acquireLeaderLock(role)` returns true, for all three roles: `worker`, `cron-daemon`, `sqlite-sync`. Leadership now stays held continuously; split leadership / duplicate cron+sync+worker on multi-instance bursts is prevented.

### Fix 3 — AI-monitoring two-tier merge (`lib/sqlite.ts` +28, `lib/services/ai/ai-monitoring.ts` +113)
- NEW `getWriteBehindLogsBySource(source, limit)` in `lib/sqlite.ts` — reads back rows from the `wb_server_log` mirror by source, newest-first, sliced to limit (complements `getSqliteServerLogs`).
- `getPersistedAiCalls` (ai-monitoring.ts) now merges **Tier 1 (Prisma `serverLog`)** + **Tier 2 (SQLite `wb_server_log`)** newest-first, sliced to the request `limit`. Success info-level calls that were stranded in SQLite are now surfaced (drives the admin AI-monitoring table).
- Graceful when SQLite returns null / uninitialized (falls back to Tier 1 only — no crash).

---

## Files changed

| File | Change |
|------|--------|
| `lib/prisma.ts` | Fix 1 — throttled `logger.warn` at breaker-open with model/operation/error/type; `BREAKER_TRIP_LOG_THROTTLE_MS` |
| `lib/services/leader.ts` | Fix 2 — NEW `startLeaderHeartbeat(role, onLost?)` + `LEADER_HEARTBEAT_MS` |
| `instrumentation.ts` | Fix 2 — wire `startLeaderHeartbeat` for `worker`, `cron-daemon`, `sqlite-sync` after lock acquisition |
| `lib/sqlite.ts` | Fix 3 — NEW `getWriteBehindLogsBySource` |
| `lib/services/ai/ai-monitoring.ts` | Fix 3 — two-tier `getPersistedAiCalls` (Prisma + SQLite, newest-first, sliced) |
| `lib/__tests__/ai-monitoring.test.ts` | NEW — 3 regression tests (two-tier merge surfaces SQLite-only success rows; fallback when SQLite null; limit slicing) |

---

## Verification

- **`npm run test`**: **989 pass / 4 skip / 0 fail** (71 suites; was 986 — +3 from the new AI-monitoring regression tests).
- **`npx tsc --noEmit`**: **46 = exact baseline, 0 new** production errors.
- `leader.test.ts`: **18/18** pass (unchanged contract).
- No schema change → no migration.

## Related

- Netlify secrets-scan build fix (branch `fix/netlify-secrets-scan-wasm`, PR #112) is a separate focused commit (binary bootstrapping) — see AGENTS.md version row.