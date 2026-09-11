# v3.37.0 — Worker engine monitoring fixes 1–5 (issue #119) — long-task busy heartbeat (no mid-flight reaping) + dead worker-logs route + Scheduler Leadership card + cron-ledger running-guard + daemon leader cross-check

- **Date**: Sep 12 2026
- **Branch**: `fix/workers-tasks-monitoring` (issue #119 branch, on top of PR #118 merge `10e2a00`; code + tests **VERIFIED + live-verified, commit/push pending user** — merge/deploy PENDING USER)
- **Status**: Code + tests VERIFIED; live-verified on :3000 (all 5 fixes, 0 console errors); commit/push pending; merge/deploy PENDING USER
- **Plan / Spec**: none — user-directed batch in the issue #119 worker-engine monitoring workstream ("Continue if you have next steps")

## Root cause (Fix 1 — the reaping defect)

Prod incident #119: **"Manual: Daily Recommendations (System)" was reaped mid-flight by a cross-instance reaper** (`worker-169.254.80.183` reaped a healthy RUNNING task owned by another instance). Root cause: the worker's 5-min liveness timer (`pingLiveness`) writes the **SQLite mirror ONLY** — the Prisma `worker_status.lastHeartbeat` therefore went stale ~10 min into a long task (daily-recommendations takes 30+ min on slow free-tier AI days). The old rule "`TASK_TIMEOUT_MS` must stay below `STALE_MS`" plus the stale Prisma heartbeat made a live owner look dead to the cross-instance reaper.

## Fix 1 — per-task BUSY heartbeat keeps the owner alive (`lib/services/worker/worker-engine.ts`)

- NEW `TASK_HEARTBEAT_MS = 240_000` — while `pollAndExecute` owns a task it runs a `setInterval(() => updateHeartbeat("busy", task.id))` (unref'd, cleared in `finally`) which refreshes the **Prisma** `worker_status.lastHeartbeat` every 4 min → a cross-instance reaper keeps the live owner in its ALIVE set and never reaps a healthy long-running task.
- `TASK_TIMEOUT_MS` raised **40 → 240 min** as a pure last-resort safety net for a genuinely wedged task (the old timeout-vs-STALE_MS race is dead — a legitimately slow task no longer fails on timeout because its owner stays alive). When the timeout does fire, `executeTask()` continues in the background (Prisma/HTTP calls can't be aborted cleanly), but the worker is free to pick up new work and the cron ledger gets the failure recorded first (Fix 4).
- `pollAndExecute` exported for tests.

## Fix 4 — cron-ledger running-guard (no double-count of one run) (`worker-service.ts` + `worker-engine.ts`)

- `recordSystemRunOutcome` now exported and gains a `status` guard on the re-fetch: records only `if (task?.cronJobId && task.status === "running")`.
- The engine's **timeout path** and the **stale-task reaper** now call `recordSystemRunOutcome(taskId, taskType, false)` **BEFORE** their failed-status write — the guard requires the task to still be `running`. A late background continuation of `executeTask()` (post-timeout) finishes afterwards and skips (status already flipped to `failed`), so one run is never double-counted in the cron ledger. Both calls non-throwing (`try/catch` → `logger.warn`).

## Fix 2 — worker log files route DID NOT EXIST (dead Logs tab since v3.14.0) (`app/api/admin/workers/logs/route.ts`)

- The admin Workers page Logs tab has fetched `/api/admin/workers/logs` since v3.14.0 but **no route ever existed** → every fetch 404'd → the tab rendered empty ("no execution logs in timeline" on prod incident #119).
- NEW route contract (matches the page fetches):
  - `GET /api/admin/workers/logs` → `{ files: {taskId,path,size,created}[] }`
  - `GET /api/admin/workers/logs?taskId=` → `{ content }` (`MAX_TASK_ID_LEN = 128` length cap + trim)
  - `DELETE /api/admin/workers/logs?taskId=` → `{ deleted }` (empty/oversized taskId → 400)
- Auth mirrors the cron/daemon route: `auth()` + admin role → else 401 (NOT the no-auth workers/status heartbeat POST). Traversal-guarded inside `worker-logger`.

## Fix 3 — Scheduler Leadership card (`app/admin/utils/workers/page.tsx`)

- `worker_status` also holds leader-election ownership rows (`workerId: leader-<role>`, v3.33.0 watchdogs) — they are NOT task workers. They now render as a separate **"Scheduler Leadership"** chip row (Worker engine / Cron daemon / SQLite sync · `● holding` = lastHeartbeat < 10 min, `● stale` otherwise) and are filtered OUT of the Active Workers grid (`activeWorkers = workers.filter(w => !w.workerId.startsWith("leader-"))`).

## Fix 5 — cron daemon status cross-checks BOTH persisted heartbeats (`app/api/admin/cron/daemon/route.ts`)

- The in-process daemon ALSO refreshes the shared `leader-cron-daemon` row via `watchLeaderRole` (v3.33.0 heartbeats it every `LEADER_HEARTBEAT_MS`). The route now does `Promise.all([findUnique(DAEMON_ID), findUnique(leaderWorkerId("cron-daemon"))])` and reports:
  - `lastHeartbeatAt` = newest of `{status.lastHeartbeatAt, own row, leader row}`
  - `leaderFresh` = leader row within `LEADER_STALENESS_MS` (10 min)
  - `running = status.running || isDaemonHeartbeatFresh(lastHeartbeatAt) || leaderFresh`
  - `lastHeartbeatAgeMs` — so even in a Turbopack **dev** module-graph split (daemon lives in the instrumentation graph, route in its own copy → `registeredJobs` reads 0 there) the persisted leader heartbeat proves the scheduler is alive; in `next start` (single bundle) both agree.

## Tests

- NEW `lib/__tests__/worker-service.test.ts` **7/7** (Fix 4: guard records only while running; no cronJobId → no record; task not found → warn-no-throw; success and failure paths with `skipSpawnCounted: true`; non-system taskType → early return).
- `lib/__tests__/worker-engine.test.ts` **23/23** (+~254 lines: busy-heartbeat interval starts while owning + cleared in finally; timeout path records ledger failure BEFORE failed-status write; reaper records outcome per reapable BEFORE its status write; late-background-continuation skip; `pollAndExecute` export).
- NEW `lib/__tests__/cronDaemonRoute.test.ts` **4/4** (Fix 5: running via `status.running`; running via fresh leader row when module state says stopped; running via fresh own-row heartbeat; not running when all stale/missing).

## Verification

- **Full suite**: 88 suites / **1192 passed / 4 skipped / 0 failed**; `npx tsc --noEmit` **46 = exact baseline (0 new)**; no schema change → no migration; no new packages; diff 6 files +407/−53 + 2 new test files.
- **Live-verified** (Playwright :3000, admin): Scheduler Leadership card shows all 3 roles **● holding** on `LAPTOP-HM25SVAR-19820`; Logs tab lists worker log files; `GET /api/admin/cron/daemon` → **200** `running:true`, daemonId `cron-daemon-LAPTOP-HM25SVAR-19820`, heartbeat 42s fresh; `GET /api/admin/workers/logs?type=check` → **200** `{files:[...]}`; Cron tab chip **"Scheduler Live"** + daemonId + "heartbeat 102s ago"; `registeredJobs` shows "0 job(s)" in dev = the documented Turbopack module-graph split artifact (correct in prod single bundle); **0 console errors / 0 warnings** across all admin pages visited.
- **Cleanup**: no dev server left behind (prior-session PID on :3000 NOT killed); no stray root junk.