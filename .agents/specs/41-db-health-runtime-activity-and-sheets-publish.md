# Spec 41 — DB Health runtime visibility, scheduled activity, and Sheets publish recovery

> Status: implementation planned on branch fix/sqlite-sync-startup-amplification; base is latest main after PR #153 merge. No production operations.
> Related: Spec 40 SQLite sync amplification investigation.

## Problem / value
Operators cannot easily determine which serverless instances are alive, when each instance started, whether scheduled jobs actually fired, or when worker tasks started/completed. The admin Google Sheets console can show an empty queue and unknown headers without explaining whether data was exported, queued, or blocked by auth/config/API errors.

## Existing modules to reuse
- DB Health: app/api/admin/db-health/route.ts, app/admin/utils/db-health/page.tsx, SQLite local liveness and sync history.
- Runtime data: Prisma WorkerStatus, WorkerTask, CronJob; existing /api/admin/workers, /api/admin/workers/status, /api/admin/cron contracts.
- Scheduler: lib/services/recommendationCronService.ts, lib/services/worker/cron-daemon.ts, lib/services/worker/worker-service.ts, lib/services/worker/task-orchestrator.ts.
- Sheets: app/api/admin/google-sheets/status/route.ts, sync/route.ts, metrics/route.ts, and googleSheets status/sync/exporter/tabs/config services plus existing ledger/tests.

## Requirements
1. Add admin-authenticated runtime/activity data without adding Prisma queries to the existing DB Health GET path. Use a separate runtime endpoint and bounded queries.
2. Active instances list recent worker/daemon/leader records with identity, role, status, first-seen timestamp, last heartbeat, and computed heartbeat age/state. Do not call stale rows active; do not delete history.
3. Show cron expression, timezone where known, next scheduled timestamp, last run timestamp, counts, and active state.
4. Show worker task trigger source/status and created/started/completed timestamps plus duration when both start/end exist. Include recent recommendation, recommendation performance, swing performance and historical price sync activity.
5. Make scheduled task execution traceable using existing task/cron ledger/event records. Avoid creating duplicate swing-performance execution; represent the existing companion execution distinctly under the performance task if supported by task events/logging.
6. Google Sheets console must distinguish producer publish/export from queue drain; report status/auth/header/API failure reason instead of opaque unknown where safely available. Preserve append-only behavior, existing ledger, idempotency/cursor and confirmation cap.
7. Add safe admin action(s) to publish a fresh metrics snapshot and/or re-run a supported producer only when that operation already exists and is explicit. Do not fabricate historical stream rows or replay delivered rows.
8. No schema migration, new package, secrets in responses/logs, destructive sheet operations, or production env/deployment changes.

## Failure / security
- Admin role required on runtime and Sheets mutation endpoints.
- Runtime endpoint returns bounded data and graceful partial errors; no secrets or task payloads with sensitive values.
- Google API 401/403/429/5xx surfaced as actionable sanitized status; append failure remains retryable per existing contract.
- Unknown header state includes a sanitized reason; never expose OAuth token/client secret or full sheet ID.

## Acceptance criteria
- Tests cover admin auth, bounded query filters, active/stale heartbeat classification, timestamp serialization, task duration null handling, and partial DB failures.
- DB Health core GET remains zero-Prisma and unchanged in ops footprint.
- Scheduled system job history is visible with UTC/IST display clarity; task event timeline distinguishes queued/started/completed/failed.
- Daily recommendations, recommendation performance and swing companion execution can be traced without double execution.
- Sheets status distinguishes header-read failure causes; Sync now still drains only queued rows; explicit publish action appends only newly generated supported output and never duplicates delivered ledger rows.
- Sheets tests cover queue empty, tracking disabled, missing sheet ID, auth failure, append success/failure, and status diagnostics.
- Run targeted Jest, full required checks individually, inspect diff/status; report only checks actually run.

## Out of scope
- Production deployment or changing Netlify env vars/OAuth consent.
- Changing scheduler cadence/business logic or adding a separate swing cron without evidence and explicit design.
- Rewriting/reordering sheet tabs, deleting rows, or bulk replaying historical delivered rows.
