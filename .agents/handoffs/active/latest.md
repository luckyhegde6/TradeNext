# Live Resume — v3.48.0 Spec 27 Async Google Sheets re-scan (worker queue migration)

> Updated: 2026-10-10 · Snapshot of the active handoff for the current session state.

## Status

| Field | Value |
|-------|-------|
| **Task** | Spec 27 — the prod GS admin console "Rescan" ran the scan synchronously in the HTTP request (`forceRefresh` + `tvFallbackLimit:200`) → Netlify function gateway **502**. Migrated re-scan onto the worker task queue (never scans in-request). |
| **Branch** | `fix/daily-rec-swing-cron-worker` (base `main` = PR #134 MERGED; Spec 26 COMMITTED `44156e6`) |
| **State** | Spec 27 CODE + TESTS + GATES + LIVE-VERIFY + DOCS **DONE** — **COMMIT PENDING USER (D9)** · merge/push/deploy = user actions |
| **In-flight** | None — awaiting user "Commit Now" |
| **Blocked** | (none — commit only on explicit request per D9 RULE) |
| **Side note** | ⚠️ **BUG A (still open, from v3.47.0/25)**: degraded executor completes but never advances mirror `next_run` → recurring job re-fires every 5-min tick while due; fix idea = advance via `calculateNextRun` (`worker-engine.ts` :729/:762). |

## What's done (v3.48.0)

- **Queue migration**: new dispatchable task type `google_sheets_rescan` (**#30** in `lib/services/worker/degradedTaskRegistry.ts`, `degradedSafe:false` — irreversible external append + Prisma-only ScanConfig, `maxRetries:0`).
- **Route** (`app/api/admin/google-sheets/rescan/route.ts`): VALIDATES → (custom only) `precheckCustomRescan` → `spawnRegularTask` → audit `GOOGLE_SHEETS_RESCAN` → **202 `{success, queued, taskId, tab}`**. Never scans in-request. Preserves validation 400s + custom 404/409/503/500 + breaker 503 + enqueue-fail 503.
- **Helper**: extracted `precheckCustomRescan` in `lib/services/googleSheets/rescanService.ts` (single DB read, reused by `rescanCustomConfig`).
- **Executor** (`lib/services/worker/worker-service.ts`): `executeGoogleSheetsRescan` — screener→`rescanScreener`, custom→`rescanCustomConfig`; throws on `ok:false`; returns `{tab, appended, total, executionMs, delegatedExport, rowLimit}`.
- **Console** (`app/admin/google-sheets/page.tsx`): enqueue → poll `GET /api/admin/workers?taskId=` (3 s × 200) → render `task.result` (identical notice text) → `await load()`; on timeout shows the notice → "track it on the Workers page".
- **Tests**: NEW `lib/__tests__/googleSheetsRescanTask.test.ts`; `lib/__tests__/googleSheetsRescan.test.ts` rewritten to the **202** contract; registry test 29→30.
- **Gates**: tsc **46 exact (prod 0)** · Jest **134/134 suites** · eslint 0 on changed files · quickbuild rerun in the pre-commit gate.
- **Live-verified (end-to-end)**: task `bbd49e8c-0da9-480b-a148-c1aecc1388f9` spawned 11:34 → completed **11:40:52** `{appended:1410,total:1410,delegatedExport:true}` (scan 13 s, hits 1410); console screener 2904→4314.
- **Docs**: `.agents/changelog/versions-v3.48.md` (Spec 27) + AGENTS.md v3.48.0 row + `.agents/CHANGELOG.md` index + TODO + `.agents/changelog/todo-quick-reference-archive.md` (v3.47 row) + Primer + agent-memory + **Lesson 160** + session-todos + HANDOFF + plan 27 checkboxes.

## Not done (deliberately)

- **COMMIT Spec 27 — PENDING USER (explicit "Commit Now" only, D9)**: files = `lib/services/googleSheets/rescanService.ts`, `lib/services/worker/worker-service.ts`, `lib/services/worker/degradedTaskRegistry.ts`, `app/api/admin/google-sheets/rescan/route.ts`, `app/admin/google-sheets/page.tsx`, `lib/__tests__/googleSheetsRescan.test.ts`, `lib/__tests__/googleSheetsRescanTask.test.ts`, docs, `.agents/changelog/versions-v3.48.md`. Commit message style: `"Spec 27: <title> — <details>"`.
- **BUG A**: next_run advance in degraded completion path (follow-up spec, needs user approval).
- **quickbuild** — greens the pre-commit gate; kill dev server (PID 6612 on :3000) first (Lesson 150), restart after.
- Merge `fix/daily-rec-swing-cron-worker` → `main`, push, deploy — **user actions (D9), never automatic.**

## Next steps

1. **Await user "Commit Now"** for Spec 27 → single commit on `fix/daily-rec-swing-cron-worker` (pre-commit hook timeout ≥ 600000 ms).
2. After commit (user-requested): quickbuild (kill dev server first, restart after) and present gates.
3. User decides merge/push/deploy. BUG A fix = next spec/plan cycle (needs user approval).

## Gotchas / lessons for this handoff

- **D9 RULE (user directive)**: MERGE + DEPLOY are ALWAYS user actions — agent max git action = COMMIT on explicit request. No auto-merge/deploy even on green CI (`.agents/RULES.md` §6).
- **Lesson 160 (NEW)**: killing a dev server does **not** release the DB leader lock immediately — the new worker engine only starts after the old lease expires (TTL ~15 min; observed 11:30 boot → 11:40:08 "Starting background worker engine"). Check the server log for the actual worker-engine start timestamp **before** suspecting the queue. Task logs are **file-based** (`worker_logs/<taskId>.log`), separate from the main pino console log.
- **Lesson 159**: a degraded/catch-up executor that completes without advancing the mirror `next_run` re-fires "due" jobs on every poll tick — dedup-only protection.
- **Lesson 150**: `next build` hangs while a dev server holds `.next` — quickbuild requires killing the dev server first, then restarting it.
- Dev server PID **6612** on :3000; Chrome page 5 authed as admin; nav timeout ≥ 60000; log timestamps UTC.
- tsc baseline = **46 error lines (prod 0; all pre-existing test-file errors)** — must stay 46 exact.
- Windows cmd: no `tail` (use `Get-Content ... -Tail N | Select-String` via PowerShell); `grep` tool path-scoping unreliable — use `findstr /n` or `read`.
- AGENTS.md doc-gate cap 32,768 B (Lesson 142); AGENTS.md now **31,170 B** after the v3.48.0 row; **TODO.md is at 32,736 B — only 32 B headroom**, so any later TODO edit must be net-shrink.
- Admin login `admin@tradenext6.app` / `admin123`; demo `demo@tradenext6.app` / `demo123`.
- Pre-existing local GS OAuth expiry → `invalid_grant` on append/header-ensure (non-fatal; `delegatedExport:true`).

## Remaining-merge state of PREVIOUS workstreams

- v3.47.0 (Specs 25/26 — scheduled-execution reliability + GS header-label): Spec 25 COMMITTED `480cd3b`, **Spec 26 COMMITTED `44156e6`**; merge/deploy user-only.
- v3.46.0 (ops-counter authority / GS tolerance / catch-up): **MERGED via PR #134 `c0bb972`** into `main` (2026-10-09).
- v3.45.0 (degraded engine): **MERGED into `main`** (2026-10-06) — pending Netlify deploy + Dependabot alert clearance.
- v3.44.0 (legal pages): committed + pushed, PR #133 MERGED 2026-10-06.
- v3.43.0 (Sheets console): committed + pushed, PR #133 MERGED 2026-10-06.
- v3.41.3 (Laya): pushed, PR #132 MERGED `4b68e30` (2026-09-25).
- v3.38.x: PR #121 OPEN, PR #118 OPEN — merge/deploy pending user.
- Full detail: `.agents/changelog/versions-index.md`.
