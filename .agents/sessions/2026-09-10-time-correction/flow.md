# Session Flow — 2026-09-10 — v3.32.0 Admin Time Synchronisation

> Execution trace for the v3.32.0 session. Format per `.agents/sessions/README.md`.

## Symptom → Root-cause trace
1. User reported admins need to see server time AND db time in the db-health screen, and to enter an IST time so a misaligned server clock can be corrected (timezone corrections).
2. Trace: `probe_time` never validated against the real DB locally (Postgres not running) → **Deferred** (D4).
3. Root cause hunt: Netlify host clock treats IST wall-clock as UTC → stored cron `nextRun` skew ≈ +5.5h; `calculateNextRun(cron, from = new Date())` is UTC-correct but `from` = server clock.
4. Secondary bug found while fixing: `parseIstDateTimeLocal` round-trip guard compared parsed-UTC vs IST input → silently rejected valid IST inputs → corrupt epochs. Fixed via `toIstIso(parsed).slice(0,16) === input` (D2).

## Changes
| File | Change |
|------|--------|
| `lib/sqlite.ts` | NEW `probeDbTimeNow()` (`SELECT NOW()` via `$queryRawUnsafe`, 10s timeout, `IST_OFFSET_MINUTES = 330`, `TIME_ALIGN_TOLERANCE_MS = 60_000`) + `persistTimeCorrection`/`deleteTimeCorrection`/`restoreTimeCorrection`/`persistTimeProbe`/`restoreTimeProbe` (`_backup_meta` keys `time_correction`/`time_probe_db`; types `:1753-1789`, interface `:247-257`, fallback `:5978-5983`); `parseIstDateTimeLocal` round-trip fix |
| `lib/services/timeCorrection.ts` (NEW) | Correction engine: `offsetMinutes = trueNow − serverNow`; `applyOffset` identity@0; `getCorrectedNow()`/`getCronFrom()` lazy read-through no cache; `getTimeDiagnostics()` |
| `app/api/admin/db-health/route.ts` | POST `probe_time` (`:395-425`, 30s throttle → 200-throttled; PG-down → 200 `available:false`; audit `ADMIN_DB_SYNC`/`time-probe`) + `set_time_correction`/`clear_time_correction`; GET zero-Prisma `time` block |
| `app/admin/utils/db-health/page.tsx` | **Time Synchronisation card** (`:247/505-515/1540`): server/IST/DB time, misalignment badge, probe + correction input |
| `lib/audit.ts` | +`ADMIN_DB_TIME_CORRECTION_SET` / `ADMIN_DB_TIME_CORRECTION_CLEARED` |
| `lib/services/recommendationCronService.ts` | `getCronFrom()` at `:5/:118` |
| `lib/services/worker/worker-engine.ts` | `getCronFrom()` nextRun `:598/:631`; `getCorrectedNow()` due-claim `:645/:657` |
| `lib/__tests__/sqlite.test.ts` | +probe persist/restore describe (71/71 total) |
| `lib/__tests__/timeCorrection.test.ts` (NEW) | 20/20 — full manual `@/lib/sqlite` mock, no `process.env.TZ` |
| Docs | `.agents/changelog/versions-v3.32.md` (NEW), AGENTS.md row, CHANGELOG index row, TODO.md row, Primer (Last Updated + Current Project Status), agent-memory entry, Lessons #111 + Update Log, session-todos Current section, HANDOFF.md, plan + spec → IMPLEMENTED status, `.agents/sessions/2026-09-10-time-correction/` (decisions.md + flow.md), `.agents/handoffs/active/latest.md` |

## Verified
- Targeted suites: timeCorrection **20/20**, sqlite **71/71**, recommendationCronService, worker-engine → **118/118**
- Full suite: **1106 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake)
- `npx tsc --noEmit`: **46 = exact baseline (0 new)**
- No migration; no new packages; diff 7 modified +565/−10

## Verification matrix
| Item | Status |
|------|--------|
| Probe persist/restore round-trip (`_backup_meta`) | ✅ sqlite.test.ts 71/71 |
| `applyOffset` identity @ 0 / −330 | ✅ timeCorrection.test.ts |
| `getTimeDiagnostics` shape | ✅ timeCorrection.test.ts |
| `getCronFrom` / due-claim wiring | ✅ worker-engine + recs suites |
| `parseIstDateTimeLocal` round-trip regression | ✅ timeCorrection.test.ts |
| 30s probe throttle → 200-throttled | ✅ route + sqlite mock |
| Live `probe_time` DB check | ⏸ **Deferred** (Postgres/Docker not running) |

## Execution order (as performed)
1. Batch A: cleaned 9 scratch files; created session dir; wrote `.agents/changelog/versions-v3.32.md`
2. Batch B1: AGENTS.md row ✅ · TODO.md row ✅ · session-todos Current swap ✅ · plan status ✅ · spec status ✅ · latest.md read ✅ · CHANGELOG row ❌(anchor) → re-read + ✅ · agent-memory entry ❌(anchor) → re-read + ✅ · latest.md rewrite ✅
3. Batch B2: Primer Last Updated ✅ · Lessons #111 ✅ · HANDOFF yaml ✅ · HANDOFF block re-read
4. Batch B3: HANDOFF Handoff-Required block → v3.32.0 ✅ · Primer anchor re-read
5. Batch B4: Primer Current Project Status section ✅ · Lessons Update Log bullet ✅
6. Batch B5: session archive decisions.md + flow.md ✅
7. Pre-commit check: `git status` + junk scan (pending — next step)