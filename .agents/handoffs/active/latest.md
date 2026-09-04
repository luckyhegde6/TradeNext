---
handoff_version: "1.1"
session_id: "sess-20260904-v3282-lost-leader-stop"
agent: "system"
timestamp: "2026-09-04T00:00:00Z"
status: "in_progress"
priority: "high"
parent_session: "sess-20260904-v3281-sqlite-self-heal"
child_sessions: []
checkpoint: "v3.28.2-lost-leader-engine-stop — post-ship audit verified all persistence paths + instrumentation onLost now stops its engine (single-active-worker); code tests docs verified, tsc 46 baseline, suite 1003/4/1, commit pending user"
---

# Active Session Handoff

## Context
- **Task**: Post-ship audit (user reported "tasks/worker failing, only 1 worker/task active at a time") — verify that all post-analysis persistence paths survive (AI-call tracking, Recommendations, performance tracking, IPO details, Swing trackers, cron sync) AND fix the remaining multi-worker/task defect. **Audit complete — all persistence verified**; the confirmed defect (lost-leader zombie workers) is fixed in v3.28.2.
- **Branch**: `fix/v3.28.1-sqlite-self-heal` (on top of v3.28.1 `718b5d2`). v3.28.2 diff (`instrumentation.ts`, NEW `lib/__tests__/instrumentation.test.ts`, docs) pending user commit; **no auto-commit/push/merge/deploy without explicit user say-so; do not amend `718b5d2`/`8020dee`/`a6d902e`/`24e3586`/`3605c64`**.

## Progress
- [x] **Audit — all persistence paths VERIFIED**: (1) AI-call tracking — `trackAiCall` → memory ring + `enqueueWriteBehind("server_log")` to SQLite (zero Prisma per call) + two-tier `getPersistedAiCalls` merge (v3.24.0); (2) Recommendations — run create → `tracker.createMany` → `stock.createMany` → run.update, no-fake-HOLD `deleteMany` intact (v3.11.1); (3) performance — status updates + `RecommendationStatusHistory` creates + 360-day archive sweep; (4) IPO details — `ipoAnalysisService` → DB `market_cache` + memory, cleanup + stale prune; (5) Swing trackers — `persistSwingTrackers` + `patchSwingSignalAnalysis` on `analysisStatus==="done"` (non-fatal); (6) crons synced during normal sync — `syncFromPrisma` pulls `cron_job`, `reconcileControlToPrisma` at the 6h sync pushes `nextRun`/`lastRun`/counters + heartbeats + task statuses.
- [x] **Defect root cause**: `instrumentation.ts` `onLost` callbacks only `logger.warn`; combined with `acquireLeaderLock` **fail-open on DB-unavailable** (every instance starts worker poll loop + cron daemon during a blip), the losers' `renewLeaderLock` returned false on DB recovery → `onLost` fired → they **kept polling forever** → N active workers/tasks concurrently.
- [x] **Fix (surgical, `instrumentation.ts` only)**: worker onLost → `stopWorkerEngine()` (poll timeout + heartbeat + scheduler intervals); cron onLost → `stopCronDaemon()` (node-cron tasks + intervals); sqlite-sync onLost stays log-only (sync is gated per-run by `isLeader`). Both stop helpers already existed and are synchronous.
- [x] **Tests**: NEW `lib/__tests__/instrumentation.test.ts` (5 — leader-elected start for all 3 roles; worker onLost → `stopWorkerEngine`; cron onLost → `stopCronDaemon`; not-leader → no start; non-node runtime → early return). **5/5 pass**.
- [x] **Verification**: tsc **46 = exact baseline (0 new)**; targeted 85/85 (sqlite 36 + daemon-sqlite-first + dbOpTiering + historical + leader); full suite **1003 pass / 4 skip / 1 fail** (1003 = 998 + 5; 1 = documented pre-existing `intelligence.test.ts` flake — excluding it 72 suites / 1003 / 4 / 0). No schema change → no migration.
- [x] **Docs (v3.28.2)**: AGENTS.md version-table row, `.agents/CHANGELOG.md` index row, `.agents/changelog/versions-v3.28.md` detail section, Primer.md (Last Updated + Current Project Status + Session 22), agent-memory.md activity-log entry, Lessons #105, session-todos + this file.
- [x] **Earlier branch state (unchanged, still pending user)**: v3.28.1 `718b5d2` (10 files, +192/-39, uncommitted-to-main); v3.28.0 SQLite-first NSE store (uncommitted, incl. regression-fix `8020dee`); v3.27.0 Accelerate (spec/plan `db5a5cc`); v3.26.0 prod-failure triage (PR #114 pending merge).

## Decisions
- Fix scope = minimal surgical (`instrumentation.ts` only + regression test + docs) — this is the confirmed defect behind "only 1 worker/task active at a time".
- Accepted edge trade-off: a transient non-DB renew error stops the worker with no replacement until redeploy/admin "Start Worker" — matches the user's no-idle-workers priority (liveness gap, not a regression).
- Idle `worker_status` rows of resigned instances are informational/harmless (reaper ignores stale) — no extra pruning.
- Verification gate = tsc 46 = exact baseline + instrumentation suite + targeted + full suite; documented pre-existing `intelligence.test.ts` flake excluded from this change's attribution.
- No auto commit/push/merge/deploy without explicit user approval.

## Blockers
- **Commit/push of v3.28.2 (and v3.28.1/v3.28.0/v3.27.0/v3.26.0) diff await explicit user approval.** No schema change → no migration.
- Deferred: **daily recommendation job failures** (Issue 3) — on the audit the primary persistence paths all verify; any remaining job-failure cause is a distinct follow-up.

## Next Move
1. Present the v3.28.2 diff for user commit approval (`git diff --stat` = `instrumentation.ts`, NEW `lib/__tests__/instrumentation.test.ts`, plus AGENTS.md/CHANGELOG/versions-v3.28.md/Primer/agent-memory/Lessons/session-todos/HANDOFF).
2. After v3.28.x ships: investigate any remaining daily recommendation job failures (Issue 3).
3. Remind user of pending v3.28.1/v3.28.0/v3.27.0/v3.26.0 commits + PR #114 merge + BUGS.md #14 (Prisma Postgres Phase 0 REQUIRED before Dec 1 2026 Accelerate retirement).

## Progress
- [x] **v3.28.1 root cause**: `initSqliteBackup` (`lib/sqlite.ts` :970) sets `state.db = db` (:976) BEFORE the schema loop (:979-982). A schema statement throw left `state.db` non-null (partially built — `daily_price`/`chartink_screener_result` missing) + `ready:false`, and the `if (state.db) return` early-return (:971) made the `ensureSqliteBackup()` retry a **permanent no-op** → "SQLite Not Ready" (from `ready`) AND "no such table" (promote guarded only non-null `state.db`, not `ready`). `ensureNseColumns` is ALTER-only (can't create missing tables).
- [x] **Fix #1 (self-healing)**: init catch now resets `state.db = null` + `_instance = null` so the next `ensureSqliteBackup()` REBUILDS from scratch. **Fix #2 (promote guard)**: `promoteNseToPrisma()`/`promoteTable()` now require `!state.ready ||` → partial mirror skipped (all-zero summary, no Prisma ops, no throw).
- [x] **Tests (+2 in `sqlite.test.ts`)**: partial-init repair (patched `MockDatabase.run` throws in the schema loop → `getSqliteFallback()` null after the catch → next `ensureSqliteBackup()` ready); promote not-ready returns all-zero summary.
- [x] **Verification**: tsc **46 = exact baseline (0 new)**; sqlite 36/36 (log `SQLite backup init failed, error=simulated schema-loop failure` confirms the path) + daemon-sqlite-first/dbOpTiering/historical (31) green; full suite **998 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` async cache-flake — excluding it 71 suites / 998 pass / 4 skip / 0 fail from these changes). No schema change → no migration.
- [x] **Docs (v3.28.1)**: AGENTS.md version-table row, `.agents/CHANGELOG.md` index row, `.agents/changelog/versions-v3.28.md` detail section, Primer.md (Last Updated + Current Project Status + Session History entry), agent-memory.md activity-log entry, session-todos + this file.
- [x] **Earlier branch state (unchanged, still pending user)**: v3.28.0 SQLite-first NSE store (code+tests+docs verified, uncommitted, incl. regression-fix commit `8020dee`); v3.27.0 Accelerate `withAccelerate()` + `cacheStrategy` ×5 (committed-`db5a5cc` spec/plan, code verified); v3.26.0 prod-failure triage (PR #114 pending merge).

## Decisions
- Fix scope = minimal surgical (2 files + docs): (1) self-heal null-out on init failure; (2) promote requires `state.ready`. Spec `.agents/specs/06-sqlite-first-nse-store.md` unchanged (operational self-heal defect, not a design change).
- Verification gate = tsc 46 = exact baseline + sqlite suite + full suite; documented pre-existing `intelligence.test.ts` flake excluded from this change's attribution.
- No auto commit/push/merge/deploy without explicit user approval.

## Blockers
- **Commit/push of v3.28.1 (and v3.28.0/v3.27.0/v3.26.0) diff await explicit user approval.** No schema change → no migration.
- Deferred: **daily recommendation job failures** (Issue 3) — investigate after this ships.

## Next Move
1. Present the v3.28.1 diff for user commit approval (`git diff --stat` = sqlite.test.ts +57, sqlite.ts +16/-2, plus AGENTS.md/CHANGELOG/versions-v3.28.md/Primer/agent-memory/session-todos/HANDOFF).
2. After v3.28.1 ships: investigate daily recommendation job failures (Issue 3).
3. Remind user of pending v3.28.0/v3.27.0/v3.26.0 commits + PR #114 merge + BUGS.md #14 (Prisma Postgres Phase 0 REQUIRED before Dec 1 2026 Accelerate retirement).