---
handoff_version: "1.1"
session_id: "sess-20260905-v3283-audit-wb-queued-at"
agent: "system"
timestamp: "2026-09-05T00:00:00Z"
status: "in_progress"
priority: "high"
parent_session: "sess-20260904-v3282-lost-leader-stop"
child_sessions: []
checkpoint: "v3.28.3 audit write-behind promotion fix — strip queued_at before Prisma createMany — committed (separate commit, no push/merge); sqlite.test.ts 37/37 + tsc 46 exact baseline; docs updated (AGENTS.md, CHANGELOG index, versions-v3.28.md, session-todos, this file); merge/deploy of v3.28.1-3 + older-version commits + PR #114 still held pending user"
---

# Active Session Handoff

## Context
- **Task**: Fix the pre-existing audit write-behind promotion bug reported in the v3.28.2 UI-verification findings — `AuditLog createMany — Unknown argument queued_at` (db-health DB Errors ring full of ~15-min repeats, audit rows never promoting). User approved "fix now": small surgical fix + regression test + separate commit on the current branch (no push/merge).
- **Branch**: `fix/v3.28.1-sqlite-self-heal` (on top of v3.28.2 `5a63fc4`). **v3.28.3 COMMITTED (separate commit, no push)**. **Merge/deploy to `main`/prod still requires explicit user say-so; do not amend `718b5d2`/`8020dee`/`a6d902e`/`24e3586`/`3605c64`/`5a63fc4`/`c86f7ef` (or the new v3.28.3 commit)**.

## Progress
- [x] **v3.28.3 root cause**: `mapWbToPrisma` in `lib/sqlite.ts` (used by the write-behind flush `writeWbRowsToPrisma` :1629) has a `default` branch that passes same-name wb-row columns verbatim into `auditLog.createMany`; `queued_at` is a **SQLite wb-only bookkeeping column** (auto-added by `enqueueWriteBehind` :1434-1438) absent from the Prisma `AuditLog` model (`prisma/schema.prisma:481-505`) → every ~15-min flush threw → audit rows never promoted (sticky rows re-failed every flush, db-health logged each failure). Pre-existing since v3.22.0 promotion model.
- [x] **Fix (surgical, `lib/sqlite.ts` only)**: `mapWbToPrisma` gains a `case "queued_at": break;` skip branch before `default:` (with a pre-v3.28.3 bug comment). Only `audit_log` is ever promoted (`server_log`/`api_request` hard-refused — SQLite-primary store) so no other wb-only column can leak; the `id` passthrough is correct (client-side UUID per wb row, idempotent via `INSERT OR REPLACE`).
- [x] **Regression test (+1 → 37)**: "strips SQLite-only bookkeeping columns (queued_at) from the promoted Prisma createMany [v3.28.3]" — seeds an `audit_log` wb row, `mockClear()` on `createMany`, flushes, asserts flush not skipped, `flushed.audit_log >= 1`, **every** `createMany` data entry lacks `queued_at`, and mapped fields arrive (action/userId/userEmail/ipAddress/metadata parsed). Existing promotion tests only asserted call counts — why this slipped.
- [x] **Verification**: `sqlite.test.ts` **37/37** green; tsc **46 = exact baseline (0 new)**. No schema change → no migration.
- [x] **Docs (v3.28.3)**: AGENTS.md version-table row, `.agents/CHANGELOG.md` index row, `.agents/changelog/versions-v3.28.md` detail section, session-todos, this file.
- [x] **Earlier branch state (unchanged, still pending user)**: v3.28.2 `5a63fc4` (committed + pushed), v3.28.1 `718b5d2` (uncommitted-to-main); v3.28.0 SQLite-first NSE store (uncommitted, incl. regression-fix `8020dee`); v3.27.0 Accelerate (spec/plan `db5a5cc`); v3.26.0 prod-failure triage (PR #114 merged `3605c64` — reconcile PR #114 doc status in next doc pass).
- [x] **v3.28.2 findings recap**: (1) audit promotion `queued_at` failure — NOW FIXED by v3.28.3; (2) 4× benign `WorkerStatus create` P2002 — informational (leader claim races; v3.26.0 skip should filter once the running dev server hot-reloads the committed code — it predates it). Dev server PID 34672 pre-existing — do not kill/restart.
- [x] **UI verification (:3000, prior session)**: all pages verified, 0 console errors/warnings; single-active enforced (3 leader rows, one per role, same instance, fresh heartbeats); db-health all green; `/recommendations` live data with direction-aware levels; dark mode + mobile 375px clean.

## Decisions
- Fix scope = minimal surgical (`lib/sqlite.ts` `mapWbToPrisma` only: skip wb-only `queued_at` before default passthrough + one regression test + docs) — this is the confirmed defect behind the repeating db-health DB Errors + non-promoting audit rows.
- Only `audit_log` is ever promoted (server_log/api_request hard-refused) so the single skip branch fully covers the wb-only leak; future wb-only bookkeeping columns should follow the same skip pattern.
- The `id` passthrough is correct (client-side UUID per wb row, idempotent `INSERT OR REPLACE`) — preserved.
- Verification gate = tsc 46 = exact baseline + targeted `sqlite.test.ts` 37/37.
- No auto commit/push/merge/deploy without explicit user approval.

## Blockers
- **Merge/deploy of v3.28.1 + v3.28.2 + v3.28.3 (and older v3.28.0/v3.27.0/v3.26.0 diff + PR #114 reconciliation) await explicit user approval.** No schema change → no migration.
- Deferred: **daily recommendation job failures** (Issue 3) — on the audit the primary persistence paths all verify; any remaining job-failure cause is a distinct follow-up.

## Next Move
1. Report v3.28.3 result to user (fixed + committed; targeted sqlite 37/37 + tsc 46 baseline).
2. Await explicit user approval to merge `fix/v3.28.1-sqlite-self-heal` → `main` and deploy (Netlify rebuild applies v3.28.1 + v3.28.2 + v3.28.3).
3. Remind user of pending v3.28.0/v3.27.0/v3.26.0 commits + PR #114 doc reconcile + BUGS.md #14 (Prisma Postgres Phase 0 REQUIRED before Dec 1 2026 Accelerate retirement) + deferred daily-recommendation job failure investigation (Issue 3).
4. After v3.28.x ships: investigate any remaining daily recommendation job failures (Issue 3).

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