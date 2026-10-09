# v3.46.0 — Specs 22/23/24 (ops-counter authority + proactive Google-Sheets/schema fixes + cron missed-tick catch-up)

> Branch `feature/fix-ops-counter-authority-sync` (PR #134, base `main` @ `5a0ddb2`). CODE + TESTS + GATES DONE;
> **commit/push/PR PENDING USER** (commit includes ⚠️ production-affecting `netlify.toml` `prisma migrate deploy` step).
> Specs/plans: `.agents/specs|plans/{22-fix-db-ops-counter-authority-sync,23-fix-google-sheets-prod-migrations,24-cron-missed-tick-catchup}.md`.

## Spec 22 — db-health ops-counter authority sync

**Problem**: the admin "Sync Operations Count" (v3.38.0) manually entered a day + total (`setOpsMonthlyDay` /
`setOpsMonthlyTotal`), but `buildQueryConsumption()` merged the live counter back over the entered figure on the SAME
day (current-day numbers were always replaced by the live `dbOpsCounter` high-water) — the admin's authoritative
correction appeared to apply and then silently reverted on the next GET.

**Fix** (`lib/services/opsMonthly.ts` — NEW `buildQueryConsumption(state, live, planLimit, authorityToday?)`):
when `authorityToday.dayKey === getIstDayKey()` the current-day read/write values in the returned consumption become
the entered figure EXACTLY (no `Math.max` high-water re-merge); otherwise the previous high-water-merge behaviour is
preserved unchanged (idempotent fold). The db-health route wires it: GET `queryConsumption` (:226) and POST
`set_ops_counter` (:444) now pass the authority day read from `setOpsMonthlyDay`/`readOpsLedger` — Sync Today/Month
reflects the entered figure from the moment the operator saves it.

## Spec 23 — Google Sheets tables missing on prod (schema migration ordering)

**Problem**: the two Spec 20/21 Prisma models + `20260926000000_*` migrations were **written but never applied** to
prod, so `app/api/admin/google-sheets/*` status/config reads hit "table does not exist" → the GS console showed
`disabled/unavailable` despite a valid saved config; v3.43.0 verification was blocked by this (P6003 hold rejected
`ScanConfig` reads + the migration could not run under Prisma 7 CLI without `migrate deploy`).

**Fixes**:
1. `netlify.toml` — ❗ **production-affecting**: build command now
   `npx prisma migrate deploy && node scripts/predeploy/preserve-mirror.mjs && npx prisma generate && npm run quickbuild`.
   New prod deploys auto-apply pending migrations (fixes the GS tables for good); `migrate deploy` is a no-op when
   nothing is pending, and it runs BEFORE the predeploy mirror preserve so the mirror never snapshots a half-migrated DB.
2. `lib/sqlite.ts` — Google-Sheets sync paths made **tolerant of missing tables** (P2021 / message contains
   "does not exist" → `logger.info` + return `null`; any other error rethrown). A concurrent-less local/edge instance
   with a stale schema no longer throws out of the GS sync accessors; once the migration applies, rows flow normally.

## Spec 24 — cron jobs missed on Netlify (node-cron tick loss → re-scan of `nextRun`)

**Root cause**: Netlify suspends/recycles instances (~2h idle), and on cold start `cron-daemon.ts` only boots the
**static** node-cron schedule. Jobs DUE while the instance was down are NEVER fired until the cron expression comes
around again (payload runs at the next schedule slot, e.g. a 10:00 IST daily job silently skipped the whole day).
The 60s async poll / `checkScheduledJobs` was never started in prod (it is for the swing drain only), so nothing
re-scanned `nextRun`.

**Fix**:
- `lib/services/worker/worker-engine.ts` — NEW `CRON_CATCHUP_WINDOW_MS = 15 * 60_000` + `catchUpMissedCronJobs()`
  (~L855): scans `cron_job` rows, `nextRun <= now` **and** `nextRun >= now - 15min` → SPAWNED (recovery, non-duplicating:
  `spawnDueCronJob` requires `nextRun <= now`, and the ledger dedups by cron id); rows older than the window →
  **re-armed** (`nextRun` advanced to the next schedule slot, never fired — a stale catch-up run could flood NSE/AI).
  Same guards as `checkScheduledJobs`: no-op when `isDegradedModeActive()` or `isPlanLimitBreakerOpen()`.
- `lib/services/worker/cron-daemon.ts` — piggyback wiring: `catchUpMissedCronJobs()` on boot (before the first
  schedule pass) + on the existing 5-min resync tick, so a fresh instance recovers missed runs within 5 minutes.

**Tests**: `worker-engine.test.ts` +7 (`catchUpMissedCronJobs`: recover-in-window fires, skip-beyond-window re-arms,
mixed, recovery dedups against the ledger, breaker-open no-op, degraded no-op, window constant) · `cron-daemon.test.ts`
+3 (boot recovers a missed job, boot re-arms a stale job, 5-min resync-tick recovery via `advanceTimersByTimeAsync`).

## Verification

- **tsc baseline** `node scripts/dev-checks/check-tsc-baseline.mjs` → total **46 exact / prod 0 / delta +0** (0 new).
- **Targeted Jest** 4 suites (`worker-engine`, `cron-daemon`, `dbHealthRoute`, `sqlite`) → **192/192**; all 10 new
  tests verified executing green (`-t` + `--verbose`).
- **ESLint** on the 8 touched files: **0 errors** (pre-existing warnings only, none in new code).
- **Full Jest** `npm run test`: **133/134 suites · 1979 pass / 4 skip / 3 fail** — the ONLY failing suite is the
  **pre-existing** `check-doc-sizes.test.ts` gate: `AGENTS.md` at **32,949 B > 32,768 B** per-file cap (Lesson 142;
  last touched `84299ee`, v3.41.3 era; git status shows NO working-tree AGENTS.md change — not caused by this work).
  Total injected doc budget **93.6/100 KB**.
- **Full-run log debug noise** (non-failure, captured console): "Google Sheets: config mirror read failed …
  `getGoogleSheetsConfig is not a function`" from GS-config mirror fallback reads in suites that don't mock the
  fallback interface — pre-existing log noise, all affected suites still green.

## Docs

`versions-v3.46.md` (this file) · `.agents/CHANGELOG.md` index row · `.agents/changelog/versions-index.md` row ·
`TODO.md` block · `Primer.md` Last Updated + Current Project Status · `agent-memory.md` · `Lessons.md` **158** ·
`HANDOFF.md` + `.agents/handoffs/active/latest.md` · session archive
`.agents/sessions/2026-10-09-ops-counter-fixes/`. **AGENTS.md rows v3.44.0–v3.46.0 LANDED** (2026-10-09 — AGENTS.md trimmed −3,367 B to 29,197 B per user approval; doc-gate script green + `check-doc-sizes.test.ts` 14/14).

## Audit trail

Specs/plans written and user-approved before implementation; branch created from `main` `5a0ddb2`. No schema change
(no migration); no new packages; no new API routes (db-health route internally rewired → OpenAPI unchanged).