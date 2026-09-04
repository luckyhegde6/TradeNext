# Session Todos

## Current (v3.28.1 — SQLite partial-init self-heal + promote not-ready guard)

Branch: `v3.26.0-prod-failure-triage` (on top of v3.28.0 + v3.27.0 + v3.26.0 work). v3.28.1 code + tests + docs VERIFIED: tsc **46 = baseline (0 new)**, full suite **998 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake; excluding it 71 suites / 998 pass / 4 skip / 0 fail). **Diff pending user commit** (no auto-commit/push/deploy).

- [x] v3.28.1 diagnosis: prod "SQLite Not Ready" + `promoteNseToPrisma … no such table: daily_price`/`chartink_screener_result` → single root cause — `initSqliteBackup` (:970) set `state.db = db` (:976) before the schema loop (:979-982); a throw left state.db non-null + ready:false and the `if (state.db) return` (:971) made retry a permanent no-op; `ensureNseColumns` ALTER-only can't create missing tables — DONE
- [x] v3.28.1 Fix #1 (`lib/sqlite.ts`): init catch resets `state.db = null` + `_instance = null` so next `ensureSqliteBackup()` REBUILDS from scratch (self-healing) — DONE
- [x] v3.28.1 Fix #2 (`lib/sqlite.ts`): `promoteNseToPrisma()`/`promoteTable()` now require `!state.ready ||` → partial mirror skipped (zero summary, no Prisma ops, no throw) — DONE
- [x] v3.28.1 Tests (+2 in `sqlite.test.ts`, `ensureSqliteBackup (lazy on-demand init)` describe): partial-init repair (patched `MockDatabase.run` throws in schema loop → fallback null after catch → next init ready); promote not-ready returns all-zero summary — DONE
- [x] v3.28.1 Verification: `npx jest lib/__tests__/sqlite.test.ts` 36/36; daemon-sqlite-first/dbOpTiering/historical (31) green; full suite 998 pass / 4 skip / 1 fail; tsc 46 = baseline; diff `git diff --stat` surgical (sqlite.test.ts +57, sqlite.ts +16/-2) — DONE
- [x] v3.28.1 Docs: AGENTS.md v3.28.1 row, `.agents/CHANGELOG.md` index + `.agents/changelog/versions-v3.28.md`, Primer.md (Last Updated + Current Project Status + Session History), agent-memory.md — DONE
- [ ] User decision: commit v3.28.1 diff (code + docs) — PENDING USER (no auto-commit/push/deploy; do not amend `8020dee`/`a6d902e`/`24e3586`/`3605c64`)
- [ ] Post-ship: investigate **daily recommendation job failures** (Issue 3, deferred from this triage) — PENDING
- [ ] v3.28.0 commit (code + docs, incl. regression-fix commit `8020dee`) — PENDING USER (still uncommitted after v3.27.0)
- [ ] PR #114 (v3.26.0 fixes + Accelerate docs) — still pending user merge against `main`

## Deferred / Other Workstreams
- [ ] **REQUIRED (Dec 1 2026 Accelerate retirement)**: Phase 0 — manual Prisma Postgres provisioning in Prisma Console at deploy-time (no code); post-move, `withAccelerate()` wrapper may be dropped (Prisma Postgres caches by default; `PRISMA_ACCELERATE_CACHE_TTL` remains the knob); `DATABASE_URL`+`DIRECT_URL` already documented (v3.20.5). See BUGS.md #14 + `.agents/specs/05-prisma-postgres-migration.md`
- [ ] Post-deploy: live-verify `/admin/utils/db-health` on Netlify (SQLite Ready + Total Ops restored + Cache & Read-Tier Utilisation card)
- [ ] Prod (post-hold): corporate-actions backfill; remove Prisma Postgres extension from Netlify Dashboard then deploy
