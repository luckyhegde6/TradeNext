# v3.48.0 — Spec 27 Async Google Sheets re-scan (worker queue migration)

> Branch `fix/daily-rec-swing-cron-worker` (base `main` = v3.47.0 MERGED via PR #134). Spec 26 COMMITTED `44156e6` (2026-10-10). Spec 27 Async Google Sheets re-scan implemented (user-approved spec `27-async-rescan.md` + plan `27-async-rescan.md`). MERGE + DEPLOY remain user actions (D9).

## Spec 27 — Async Google Sheets re-scan (worker queue migration)

**Problem.** Prod Google-Sheets console "Rescan" ran synchronously (`forceRefresh` + `tvFallbackLimit:200`) → Netlify function gateway 502. The request timeout was hit because the synchronous scan performed a full screener run (and custom config scan) in the HTTP request context.

**Fix.** Migrate rescan to the worker task queue. New dispatchable type `google_sheets_rescan` (#30 in the registry, `degradedSafe:false`, reason = irreversible external append + Prisma-only ScanConfig, spawned with `maxRetries:0`):

- `POST /api/admin/google-sheets/rescan` now VALIDATES → (custom only) `precheckCustomRescan` (extracted helper, reused by `rescanCustomConfig` — single DB read) → `spawnRegularTask` → audit `GOOGLE_SHEETS_RESCAN` → **202 `{success, queued, taskId, tab}`**. Never scans in-request. Validation 400s, custom 404/409/503/500, breaker 503, enqueue-fail 503 preserved.
- Executor `executeGoogleSheetsRescan` in `lib/services/worker/worker-service.ts` (screener → `rescanScreener`, custom → `rescanCustomConfig`; throws on `ok:false`; returns `{tab, appended, total, executionMs, delegatedExport, rowLimit}`).
- Console `app/admin/google-sheets/page.tsx`: enqueue → poll `GET /api/admin/workers?taskId=` (3 s × 200) → render `task.result` (identical notice text to today) → `await load()`; timeout notice → "track it on the Workers page".

**Live verification (end-to-end).**

- Task `bbd49e8c-0da9-480b-a148-c1aecc1388f9` spawned 11:34 → completed 11:40:52 `{appended:1410,total:1410,delegatedExport:true}` (scan 13 s, hits 1410).
- Console screener queue 2904→4314.
- 6-min pending was a DEV-ENV leader-lease artifact (old killed server's ~15-min DB lease delayed worker start), not a code issue. `invalid_grant` append/header-ensure = pre-existing local GS OAuth expiry (non-fatal, `delegatedExport:true`).

**Gates.** tsc **46 exact (prod 0)** · eslint 0 on changed files · Jest **134/134 suites** (incl. new `googleSheetsRescanTask.test.ts`; route tests rewritten to the 202 contract; registry test 29→30) · quickbuild rerun pending in pre-commit gate.

**Lesson 160.** Killing a dev server does NOT release the DB leader lock immediately — the new daemon/worker only starts after the old lease expires (TTL ~15 min; observed 11:30 boot → 11:40:08 "Starting background worker engine"). When a task looks starved, check the server log for the actual worker-engine start timestamp BEFORE suspecting the queue. Also: task logs are FILE-based (`worker_logs/<taskId>.log`), separate from the main pino console log.

## Files changed (Spec 27)

- `lib/services/googleSheets/rescanService.ts` (extracted `precheckCustomRescan`, reused by `rescanCustomConfig`)
- `lib/services/worker/worker-service.ts` (added `executeGoogleSheetsRescan`)
- `lib/services/worker/degradedTaskRegistry.ts` (registered `google_sheets_rescan` #30, `degradedSafe:false`, `maxRetries:0`)
- `app/api/admin/google-sheets/rescan/route.ts` (202 queued contract; validates, prechecks custom, spawns task, audits)
- `app/admin/google-sheets/page.tsx` (enqueue + poll worker task, render result, timeout notice)
- `lib/__tests__/googleSheetsRescan.test.ts` (rewritten to 202 contract)
- `lib/__tests__/googleSheetsRescanTask.test.ts` (NEW)
- Docs: `.agents/specs/27-async-rescan.md` + `.agents/plans/27-async-rescan.md`, `HANDOFF.md`, `Primer.md`, `Lessons.md` (Lesson 160), `agent-memory.md`, `.agents/session-todos.md`, `.agents/handoffs/active/latest.md`