---
handoff: v3.32.0-time-correction
session_id: v3.32.0-time-correction
date: 2026-09-10
branch: fix/sqlite-init-reserved-keyword (working tree @ 8c67e89; NO new branch created)
last_commits: 8c67e89 (fix/sqlite-init-reserved-keyword HEAD — v3.32.0 code+tests+docs are in the WORKING TREE, NOT committed)
dev: local :3000 (dev PID 12096 do not kill, MCP 4096 do not kill, pg docker 5432 do not kill)
status: in_progress
commit: pending user approval
---

# Handoff — v3.32.0 — Admin Time Synchronisation (probe_time + persisted time-correction engine)

## Summary
**Code + tests + docs are DONE and VERIFIED (DOC COMMIT PENDING USER — no push/merge/deploy).**
User directive (verbatim): "in admin db health screen display server time and db time. and also admin can enter ist time so if server time is misaligned it can be corrected through admin entered input for timezone corrections."
Root cause: Netlify host clock treats IST wall-clock as UTC → stored cron `nextRun` skew ≈ +5.5h; `calculateNextRun` (UTC-correct) takes `from` from the server clock.

## What shipped
- **(1) DB probe + persistence** (`lib/sqlite.ts`): NEW `probeDbTimeNow()` (`SELECT NOW()` via `$queryRawUnsafe`, 10s timeout, `IST_OFFSET_MINUTES = 330`, `TIME_ALIGN_TOLERANCE_MS = 60_000`) + `persistTimeCorrection`/`deleteTimeCorrection`/`restoreTimeCorrection`/`persistTimeProbe`/`restoreTimeProbe` (`_backup_meta` keys `time_correction`/`time_probe_db`; types `:1753-1789`, interface `:247-257`, fallback `:5978-5983`).
- **(2) Correction engine**: NEW `lib/services/timeCorrection.ts` (`offsetMinutes = trueNow − serverNow`; `applyOffset` identity@0; `getCorrectedNow()`/`getCronFrom()` lazy read-through, no cache; `getTimeDiagnostics()`); **REAL BUG FIXED**: `parseIstDateTimeLocal` round-trip guard → `toIstIso(parsed).slice(0,16) === input` (epoch = `Date.UTC(y,m-1,d,h,min) − offset`).
- **(3) Device API/UI**: db-health POST `probe_time` (`route.ts:395-425`, 30s throttle → 200-throttled; PG-down → 200 `available:false`; audit `ADMIN_DB_SYNC`/`time-probe`) + `set_time_correction`/`clear_time_correction`; GET zero-Prisma `time` block; **Time Synchronisation card** (`page.tsx:247/505-515/1540`); `lib/audit.ts` +`ADMIN_DB_TIME_CORRECTION_SET`/`ADMIN_DB_TIME_CORRECTION_CLEARED`.
- **(4) Scheduling wiring**: `getCronFrom()` (`recommendationCronService.ts` + `worker-engine.ts` nextRun sites `:598`/`:631`); `getCorrectedNow()` at due-claim `:645`/`:657`.

## Verification
- NEW `timeCorrection.test.ts` 20/20 (full manual `@/lib/sqlite` mock — no `...actual` spread, no `process.env.TZ`); sqlite.test.ts **71/71**; targeted 4 suites **118/118**; full **1106 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake); tsc **46 = exact baseline (0 new)**; no migration; no new packages; diff 7 modified +565/−10.

## Deferred / Next
- **Deferred**: live `probe_time` DB check (local Postgres not running); durable fix = correct `TZ`/`UTC` env on Netlify (header-documented).
- **Next**: run `/pre-commit-check` → stage EXACTLY the v3.32.0 working-tree files (7 modified code + 2 new code + 2 new spec/plan + 9 doc updates + 2 new docs; `.visual.html` untracked — do NOT commit) → commit `feat(admin): v3.32.0 Admin Time Synchronisation (probe_time + persisted time-correction engine)` (final branch name user decides) → **no push/merge/deploy without explicit approval**.

## Session archive
`.agents/sessions/2026-09-10-time-correction/` — decisions.md (D1-D5) + flow.md (symptom→root-cause trace, changes table, verification matrix, execution order). Plus spec `10-admin-time-correction.md` + plan `10-admin-time-correction.md` → IMPLEMENTED status; `.agents/changelog/versions-v3.32.md`.