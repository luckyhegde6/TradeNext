# Live Resume — Spec 40/41 (SQLite sync amplification · DB Health runtime visibility · Sheets publish diagnostics)

> Updated: 2026-11-04 · Branch: fix/sqlite-sync-startup-amplification
> Base: latest main after PR #153 merge, SHA 7934335793a0773b39ecbc01ccbb59742dfdcfc5.

## Status
- **PR #153:** merged and deployed per user confirmation.
- **Branch:** fix/sqlite-sync-startup-amplification, created from latest main. No application-code changes on main.
- **Spec/Plan:** Spec 40/Plan 40 (sync amplification); Spec 41/Plan 41 (runtime observability + Sheets publish recovery).
- **Implementation:** source and focused tests written on branch. Verification pending; do not claim green.
- **Deployment:** not performed. User controls PR/merge/deploy.

## Implemented
- **Idle workers:** runtime endpoint and DB Health live list now exclude `status=idle` and heartbeat-stale rows; an excluded count is shown. Persisted WorkerStatus rows are retained, not deleted (they are status records, not process controls). Focused regression test added; verification still pending.
- **Google Sheet link:** user supplied spreadsheet ID matches the masked ID shown in the previous admin screenshot (`1mRD…DXzQ`), so it appears already configured. Google Drive connector is disabled by admin and public URL fetch failed; sheet tab/header contents have not been inspected. Do not invent a schema mapping. Need authorized live sheet access to verify headers and publish behavior.
1. New admin-only bounded endpoint: app/api/admin/db-health/runtime/route.ts; returns recent WorkerStatus, CronJob and tracked WorkerTask/TaskEvent data.
2. DB Health UI now displays worker/daemon/leader records with active/stale state, first-seen, heartbeat timestamp/age; cron schedule + last/next run timestamps and outcomes; task created/started/completed/duration/event timeline.
3. System cron tasks are labeled system cron; recommendation performance task records durable progress events for its Swing performance companion without scheduling or running a duplicate task.
4. Google Sheets status includes sanitized header diagnostics (missing sheet ID, permission/auth, not found, rate limit, provider unavailable).
5. Successful direct Sheets publishes update last-publish timestamp. Metrics publish reports explicit success/disabled/failure and the UI distinguishes Publish from Sync queue drain.
6. Tests added/updated: dbHealthRuntimeRoute.test.ts, googleSheetsStatus.test.ts, googleSheetsTracking.test.ts, googleSheetsAdminRoutes.test.ts.

## Verification / remaining
- Run targeted Jest suites and then required checks individually: npm run test; npx tsc --noEmit; npm run lint; npm run quickbuild.
- Inspect actual CI runs and branch diff after checks.
- Verify production cron executions and Google Sheets publish only after user-controlled deployment/auth context is available.
- No schema migration, new package, or environment changes.

## Operational caveats
- Active/stale uses WorkerStatus heartbeat freshness (15 minutes). Idle worker processes may not continuously refresh shared Prisma heartbeats; the view reports recorded worker/daemon instances, not every serverless request instance.
- First-seen uses WorkerStatus.createdAt and is not guaranteed to equal process boot time.
- Runtime endpoint uses bounded Prisma queries and is polled separately; existing DB Health GET remains zero-Prisma.
- Sheets Sync now drains undelivered retry-ledger rows only. Delivered rows are not replayed; stream history cannot be reconstructed unless the corresponding producer is explicitly re-run.
- The Google Sheets screenshot showed queued=0 and header=unknown; the new diagnostic will reveal the failure category, but no live OAuth/Sheets operation was performed here.
