# Session Todos

## Current (v3.28.2 — Lost-leader engine stop, single-active-worker enforcement)

Branch: `fix/v3.28.1-sqlite-self-heal` (on top of v3.28.1 `718b5d2`). v3.28.2 COMPLETE: code + tests + docs VERIFIED (tsc **46 = baseline (0 new)**, full suite **1003 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake; excluding it 72 suites / 1003 / 4 / 0), targeted 85/85) and **COMMITTED `5a63fc4`** (11 files, +291/−27). No auto-push/merge/deploy.

- [x] v3.28.2 post-ship audit: verify all persistence paths — AI-call tracking persists (`trackAiCall` → memory ring + `enqueueWriteBehind("server_log")`, two-tier merge); Recommendations (run + trackers + stocks + run.update, no-fake-HOLD intact); performance (status updates + history + 360d archive); IPO details (DB `market_cache` + memory); Swing trackers (`persistSwingTrackers` + `patchSwingSignalAnalysis` on done); crons synced during normal sync (`syncFromPrisma` pulls `cron_job` + `reconcileControlToPrisma` 6h push) — DONE
- [x] v3.28.2 fix (`instrumentation.ts` only): worker onLost → `stopWorkerEngine()`; cron onLost → `stopCronDaemon()`; sqlite-sync onLost log-only (fail-open leader + log-only onLost = zombie multi-worker) — DONE
- [x] v3.28.2 regression test: NEW `lib/__tests__/instrumentation.test.ts` (5 — leader-elected start 3 roles; worker/cron onLost → stop fired; not-leader; non-node early return) 5/5 — DONE
- [x] v3.28.2 verification: tsc 46 = baseline; targeted 85/85; full suite 1003 pass / 4 skip / 1 fail (flake only) — DONE
- [x] v3.28.2 docs: AGENTS.md row, CHANGELOG index + versions-v3.28.md, Primer (Last Updated + Status + Session 22), agent-memory, Lessons #105, session-todos, HANDOFF — DONE
- [x] v3.28.2 commit `5a63fc4` (code + tests + docs, 11 files) — DONE (user-approved)
- [ ] User decision: commit v3.28.1 diff (code + docs) — PENDING USER (no auto-commit/push/deploy; do not amend `8020dee`/`a6d902e`/`24e3586`/`3605c64`/`718b5d2`)
- [ ] Post-ship: investigate **daily recommendation job failures** (Issue 3, deferred from earlier triage) — PENDING
- [ ] v3.28.0 commit (code + docs, incl. regression-fix commit `8020dee`) — PENDING USER (still uncommitted after v3.27.0)
- [ ] PR #114 (v3.26.0 fixes + Accelerate docs) — still pending user merge against `main`

## Deferred / Other Workstreams
- [ ] **REQUIRED (Dec 1 2026 Accelerate retirement)**: Phase 0 — manual Prisma Postgres provisioning in Prisma Console at deploy-time (no code); post-move, `withAccelerate()` wrapper may be dropped (Prisma Postgres caches by default; `PRISMA_ACCELERATE_CACHE_TTL` remains the knob); `DATABASE_URL`+`DIRECT_URL` already documented (v3.20.5). See BUGS.md #14 + `.agents/specs/05-prisma-postgres-migration.md`
- [ ] Post-deploy: live-verify `/admin/utils/db-health` on Netlify (SQLite Ready + Total Ops restored + Cache & Read-Tier Utilisation card)
- [ ] Prod (post-hold): corporate-actions backfill; remove Prisma Postgres extension from Netlify Dashboard then deploy
