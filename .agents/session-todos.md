# Session Todos

## Current (v3.28.3 — Audit write-behind promotion fix, strip `queued_at`)

Branch: `fix/v3.28.1-sqlite-self-heal` (on top of v3.28.2 `5a63fc4`). v3.28.3 VERIFIED (tsc **46 = exact baseline (0 new)**, targeted `sqlite.test.ts` **37/37**) and committed (separate commit, no push/merge). No schema change → no migration.

- [x] v3.28.3 root cause: `AuditLog createMany — Unknown argument queued_at` — `mapWbToPrisma` (`lib/sqlite.ts`) `default` branch passes SQLite wb-only `queued_at` verbatim into Prisma `auditLog.createMany` (wb-only column auto-added by `enqueueWriteBehind`, absent on Prisma `AuditLog`) → ~15-min flush throws, audit rows never promote (sticky rows re-fail every flush, db-health DB Errors full of repeats). Pre-existing since v3.22.0 promotion model — DONE
- [x] v3.28.3 fix (surgical, `lib/sqlite.ts` only): `mapWbToPrisma` gains `case "queued_at": break;` skip branch before `default:` (pre-v3.28.3 bug comment). Only audit_log is ever promoted (server_log/api hard-refused) so no other wb column leaks; id passthrough correct (client-side UUID, idempotent INSERT OR REPLACE) — DONE
- [x] v3.28.3 regression test (+1 in `sqlite.test.ts` → **37**): seeds an audit_log wb row, flushes, asserts flush not skipped, `flushed.audit_log >= 1`, **every** `createMany` data entry lacks `queued_at`, and mapped fields arrive (action/userId/userEmail/ipAddress/metadata parsed). Existing promotion tests only asserted call counts — why this slipped — DONE
- [x] v3.28.3 verification: tsc **46 = exact baseline (0 new)**; targeted `sqlite.test.ts` **37/37** green — DONE
- [x] v3.28.3 docs: AGENTS.md row, CHANGELOG index + versions-v3.28.md, session-todos, HANDOFF — DONE
- [x] v3.28.3 commit (code + test + docs, separate commit) — DONE (no push/merge)

## Completed earlier (v3.28.2 — Lost-leader engine stop, single-active-worker enforcement)

- [x] v3.28.2 post-ship audit: verify all persistence paths — AI-call tracking persists (`trackAiCall` → memory ring + `enqueueWriteBehind("server_log")`, two-tier merge); Recommendations (run + trackers + stocks + run.update, no-fake-HOLD intact); performance (status updates + history + 360d archive); IPO details (DB `market_cache` + memory); Swing trackers (`persistSwingTrackers` + `patchSwingSignalAnalysis` on done); crons synced during normal sync (`syncFromPrisma` pulls `cron_job` + `reconcileControlToPrisma` 6h push) — DONE
- [x] v3.28.2 fix (`instrumentation.ts` only): worker onLost → `stopWorkerEngine()`; cron onLost → `stopCronDaemon()`; sqlite-sync onLost log-only (fail-open leader + log-only onLost = zombie multi-worker) — DONE
- [x] v3.28.2 regression test: NEW `lib/__tests__/instrumentation.test.ts` (5 — leader-elected start 3 roles; worker/cron onLost → stop fired; not-leader; non-node early return) 5/5 — DONE
- [x] v3.28.2 verification: tsc 46 = baseline; targeted 85/85; full suite 1003 pass / 4 skip / 1 fail (flake only) — DONE
- [x] v3.28.2 docs: AGENTS.md row, CHANGELOG index + versions-v3.28.md, Primer (Last Updated + Status + Session 22), agent-memory, Lessons #105 — DONE
- [x] v3.28.2 commit `5a63fc4` (code + tests + docs, 11 files) — DONE (user-approved)
- [x] v3.28.2 push to origin (`upstream` set) — DONE (user-approved 2026-09-05)
- [x] v3.28.2 UI verification (:3000, logged in as Admin User) — DONE: dashboard, `/admin/utils` (DB healthy 2ms, Workers IDLE, Jobs ACTIVE), `/admin/utils/workers` (3 leader rows — one per role, same instance `LAPTOP-HM25SVAR-34672`, fresh heartbeats → single-active enforced; 50 tasks 47 done / 3 historical pre-fix `stocks is not iterable`; cron daemon confirmed firing 9/4), `/admin/utils/db-health` (Prisma Online / SQLite Ready / Price Cache OK; ops 1,359 = 14% of plan; today errors 0; all 3 leaders "Just now"), `/recommendations` (live data 95/47 Buy/19 Hold/29 Sell; direction-aware levels correct; filters/sort/Load More/HOLDs; dark mode renders slate-950; mobile 375px clean; **0 console errors/warnings anywhere**)
- [x] FINDING (resolved → v3.28.3): write-behind audit promotion FAILS — `AuditLog createMany → Unknown argument queued_at` (SQLite wb rows passed verbatim; promoted audit:0, sticky rows re-fail every 15-min flush; ring buffer full of repeats) — FIXED in v3.28.3 (strip `queued_at` in `mapWbToPrisma`)
- [ ] FINDING (minor, likely pre-fix server): 4× `WorkerStatus create` P2002 in ring buffer at "1m ago" — benign leader-claim races; v3.26.0 `isBenignUniqueConflict` skip should filter (running server hot-reload may predate it; dev server PID 34672 must not be killed / restarting it would apply current code)

## Pending (held by user)
- [ ] User decision: merge/deploy v3.28.1 + v3.28.2 + v3.28.3 (`fix/v3.28.1-sqlite-self-heal` → `main`/prod) — PENDING USER (held; do not amend `718b5d2`/`8020dee`/`a6d902e`/`24e3586`/`3605c64`/`5a63fc4`/`c86f7ef`)
- [ ] Post-ship: investigate **daily recommendation job failures** (Issue 3, deferred from earlier triage) — PENDING
- [ ] v3.28.0 commit (code + docs, incl. regression-fix commit `8020dee`) — PENDING USER (still uncommitted after v3.27.0)
- [ ] v3.27.0 Accelerate diff commit — PENDING USER (uncommitted code beyond spec/plan `db5a5cc`)
- [ ] PR #114 (v3.26.0 fixes + Accelerate docs) — still pending user merge against `main` (merge `3605c64` done; reconcile PR #114 doc status in next doc pass)

## Deferred / Other Workstreams
- [ ] **REQUIRED (Dec 1 2026 Accelerate retirement)**: Phase 0 — manual Prisma Postgres provisioning in Prisma Console at deploy-time (no code); post-move, `withAccelerate()` wrapper may be dropped (Prisma Postgres caches by default; `PRISMA_ACCELERATE_CACHE_TTL` remains the knob); `DATABASE_URL`+`DIRECT_URL` already documented (v3.20.5). See BUGS.md #14 + `.agents/specs/05-prisma-postgres-migration.md`
- [ ] Post-deploy: live-verify `/admin/utils/db-health` on Netlify (SQLite Ready + Total Ops restored + Cache & Read-Tier Utilisation card)
- [ ] Prod (post-hold): corporate-actions backfill; remove Prisma Postgres extension from Netlify Dashboard then deploy
