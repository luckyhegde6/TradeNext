# v3.55.0 — DB Health runtime visibility + scheduled task timestamps + Google Sheets publish diagnostics

- **Date:** 2026-11-04
- **Branch:** `fix/sqlite-sync-startup-amplification`
- **State:** Implementation written on the feature branch; verification pending. No deployment or PR.
- **Spec / Plan:** Spec 41 / Plan 41; also continues Spec 40 SQLite sync amplification investigation.

## Changes
- **SQLite query amplification fix:** recurring 15-minute recovery probes now perform a lightweight Prisma liveness read and SQLite→Prisma outbox push only; they no longer run a full Prisma→SQLite mirror pull. Boot hydration and explicit admin pulls remain intact. Regression test guards against recurring collection reads.
- **Swing failure publishing:** Swing screener rows are appended to the `swing` tab even when AI analysis throws or all stock analyses fail; the job remains honestly marked failed and does not fabricate target levels.
- **Performance diagnosis:** recommendation performance results/task timeline include checked, updated and skipped-for-missing-price counts, making a successful run with no refreshed rows distinguishable from an empty tracker set.
- **CI fixes:** corrected malformed Google Sheets admin JSX and updated tracking tests to mock the effective config gate.
- **Run-triggered Sheets publishing:** daily-rec and Swing producer appends are awaited (best-effort) before their worker-owned operation completes and log row count/outcome. Performance cycles append a KPI snapshot to `metrics`; combined recommendation+Swing checks emit one snapshot, standalone Swing performance emits one. KPI publish result is recorded as a task progress event.
- **Empty-run diagnosis:** all-AI-failed daily runs now log an explicit skipped-publish reason; no synthetic fallback picks are written.
0. **Idle worker cleanup in live view** — runtime endpoint excludes idle-status and stale-heartbeat WorkerStatus records from the Active Instances list and reports an excluded count. Persisted records are retained; no DB deletion is performed because a status row is not the worker process itself.
1. **Runtime activity endpoint** — NEW `app/api/admin/db-health/runtime/route.ts`, admin-only and bounded. Returns recent WorkerStatus records (24h window, max 50), cron definitions (max 30), and tracked worker tasks (7d, max 40) with TaskEvent timestamps. Active/stale derives from a 15-minute heartbeat window. First-seen is WorkerStatus.createdAt, not guaranteed process boot time.
2. **DB Health UI** — NEW Active Instances & Scheduled Activity section in `app/admin/utils/db-health/page.tsx`. Displays worker/daemon/leader identity, state, first-seen, last heartbeat/age; cron expression, exact last/next timestamps and outcomes; task trigger source, status, created/started/completed timestamps, duration and event timeline. Runtime polling is separate (2 min) from the existing zero-Prisma DB Health polling.
3. **System job visibility** — runtime task rows label cron-linked jobs whose CronJob name contains `(System)` as `system cron`. Recommendation performance now persists TaskEvent progress for its main check and the Swing companion start/completion/failure, without creating a second swing run or cron. Raw error text is not stored in the new event metadata.
4. **Google Sheets header diagnostics** — `readHeaderDiagnostic` classifies missing sheet ID, permission, auth, not-found, rate-limit and provider-unavailable failures; only sanitized codes are returned. Status payload/UI show the reason beside `unknown`.
5. **Publish vs queue semantics** — successful direct exporter appends update the operator-facing last-publish timestamp. Metrics action now reports explicit appended/disabled/failed outcomes; failure returns 502 and states the retry-ledger behavior. UI says Publish metrics snapshot and accurately reports success. Sync now remains a drain of undelivered ledger rows only; it does not replay delivered history.

## Verification
- Targeted tests added/updated: `dbHealthRuntimeRoute.test.ts`, `googleSheetsStatus.test.ts`, `googleSheetsTracking.test.ts`, `googleSheetsAdminRoutes.test.ts`, `worker-service.test.ts`.
- Automated checks have **not yet been run** in a local checkout. Record targeted Jest, full Jest, tsc, lint and quickbuild results only after they actually run.
- No schema migration, package change, production env change, or deployment.
