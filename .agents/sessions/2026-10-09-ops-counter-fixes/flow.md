# Session Flow — 2026-10-09 v3.46.0 Specs 22/23/24

Branch: `feature/fix-ops-counter-authority-sync` (PR #134, base `main` `5a0ddb2`)

## Execution path

1. **Spec/plan docs** — `.agents/specs/22-ops-counter-authority-sync.md`, `23-gsheets-table-missing-tolerance.md`, `24-cron-missed-tick-catchup.md` + `.agents/plans/22|23|24-*.md` (user-approved).
2. **Implementation**:
   - (22) `lib/services/opsMonthly.ts` — `buildQueryConsumption(state, live, planLimit, authorityToday?)`; `app/api/admin/db-health/route.ts` — GET counters+authority :226 + PATCH `set_ops_counter` zod :444.
   - (23) `lib/sqlite.ts` — `P2021`/"does not exist" tolerance for the GS tables (`logger.info` + `return null`); `netlify.toml` — build order with `prisma migrate deploy` + `preserve-mirror` before `generate` + `quickbuild`.
   - (24) `lib/services/worker/worker-engine.ts` ~L855 — `catchUpMissedCronJobs()` (+ `CRON_CATCHUP_WINDOW_MS` const); `lib/services/worker/cron-daemon.ts` — import L24, boot wiring ~L118–130, 5-min resync tick ~L143.
3. **Tests** — `lib/__tests__/worker-engine.test.ts` (7 catch-up), `lib/__tests__/cron-daemon.test.ts` (3 wiring), `lib/__tests__/dbHealthRoute.test.ts` (spec-22 route), `lib/__tests__/sqlite.test.ts` (spec-23 tolerance).
4. **Gates** — tsc 46 exact (prod 0) · ESLint 0 (8 files) · targeted 192/192 · full Jest 133/134 (3 fail = pre-existing AGENTS.md doc-gate only) · quickbuild 199/199. **POST-TRIM re-run**: AGENTS.md trimmed −3,367 B → 29,197 B (user-approved) → `check-doc-sizes.test.ts` 14/14 → **full Jest 134/134**.
5. **Docs** — `versions-v3.46.md` (NEW full detail) · `.agents/CHANGELOG.md` index row · `.agents/changelog/versions-index.md` row · `Lessons.md` Lesson 158 + Update Log bullet · `TODO.md` in-progress block (v3.45.0 demoted to Prior) · `Primer.md` Last Updated + Current Project Status · `agent-memory.md` entry · `HANDOFF.md` Current State YAML + Handoff Required headline · `.agents/handoffs/active/latest.md` rewrite · `.agents/session-todos.md` · session archive (this dir). **AGENTS.md EDITED** (user-approved 2026-10-09): trimmed −3,367 B → 29,197 B; deferred v3.44.0–v3.46.0 rows landed; doc-gate green.

## Files touched (uncommitted, all mine)

- M `app/api/admin/db-health/route.ts`, `lib/services/opsMonthly.ts`, `lib/sqlite.ts`, `netlify.toml` (production-affecting), `lib/services/worker/{cron-daemon,worker-engine}.ts`
- M `lib/__tests__/{cron-daemon,dbHealthRoute,worker-engine}.test.ts`
- ?? `.agents/specs/22|23|24-*.md`, `.agents/plans/22|23|24-*.md`, `.agents/changelog/versions-v3.46.md`, `.agents/sessions/2026-10-09-ops-counter-fixes/`
- M docs: `Lessons.md`, `.agents/CHANGELOG.md`, `.agents/changelog/versions-index.md`, `TODO.md`, `Primer.md`, `agent-memory.md`, `HANDOFF.md`, `.agents/handoffs/active/latest.md`, `.agents/session-todos.md`

## Next

- Delete repo-root `jest-full.log` (artifact); final `git status` review.
- **PENDING USER**: commit v3.46.0 (code + docs) → push PR #134 (flag `netlify.toml` prisma-migrate-deploy production change in the PR description) → merge/deploy.

---

## PROD-FIX pass addendum (same session, later turns)

### Live diagnosis (read-only, admin login via Playwright at `/auth/signin`)
- Outbox stuck since **2026-09-16T23:00**: `chartink_screener_result` 13,261 · `recommendation_tracker` 300 · `daily_recommendation_stock` 200 · `daily_recommendation_run` 3.
- `sqlite.recentSyncs` = boot `prisma_to_sqlite` ONLY — **zero `sqlite_to_prisma`**; `dbErrorSummary` 2026-10-09 all zeros (breaker CLOSED).
- `queryConsumption` month 2026-10 = **120 ops (43r/77w)** vs Prisma dashboard **26,819**.
- GS: `envEnabled false` · `oauthConfigured.refreshToken false` · `sheetIdMasked "1mRD…DXzQ"`; `prisma.tableCounts.google_sheets_config 0` but **GS tables EXIST on prod** (missing-tables premise weakened — hence Spec 23 tolerance is defensive).
- Prod = **PRE-v3.46.0** build (no authority/syncHistory/dbErrors fields); decision/degraded endpoints reachable.

### ROOT CAUSE (stuck outbox)
`startRecoveryProbe()` (lib/sqlite.ts ~2412-2476) is a `setInterval` calling `pushSqliteToPrisma()` only after **6 continuous hours** on the `sqlite-sync` leader — Netlify suspends idle instances ~2h ⇒ the timer never survives ⇒ only boot syncs ran. Drain paths: manual admin "Push to Prisma" (`leaderGate:false`) or each deploy's `preserve-mirror.mjs` (breaker-closed only). Spec 24 catch-up covers node-cron only, NOT this probe.

### Counter fix EXECUTED (user-approved)
- User corrected: **26,819 = CURRENT MONTH (Oct-to-date), NOT lifetime** → the ledger undercounts ~220× and a correction WAS needed.
- User chose **"Use ratio estimate"** for the reads/writes split → POST `/api/admin/db-health` `{action:"set_ops_counter", reads:9610, writes:17209, scope:"month"}` (43:77 ledger ratio applied to 26,819) → HTTP 200, `queryConsumption.totalOperations = 26,819`; today backfilled 9,575R/17,132W; live counter untouched; audit `ADMIN_DB_SET_OPS_COUNTER` `{scope:"month", dayKey:"2026-10-09", reads:9610, writes:17209}`.
- Route contract (prod v3.38-era + local v3.46 branch): **POST `/api/admin/db-health` with body `action` discriminator** (`set_ops_counter`), `OPS_COUNTER_INPUT_SCHEMA` {reads, writes, scope today|month default today}; v3.46 branch also exposes GET authority (AGENTS.md/plan describe the PATCH form :226/:444 — both forms coexist; the POST form is what prod accepted).

### Durability finding (per-Netlify-instance ledger)
- Ops ledger = `globalThis` in-memory + per-instance SQLite (`persistOpsCounter` :2537 · `persistOpsMonthly` :2592 · `restoreOpsMonthly` :2612 · `startOpsCounterPersistence` :2634, 60s tick **disk-only** per :2640-2642).
- Blobs uploads happen ONLY after boot `syncFromPrisma()` or deploy-time `preserve-mirror.mjs` → a follow-up GET on another instance still showed 122.
- **Conclusion**: the correction is per-instance until deploy; PR #134 deploy propagates it cluster-wide; v3.46 `authorityToday` makes post-deploy re-correction land properly. Post-deploy verify (GET shows 26,819 — or one re-PATCH on the v3.46 build) is bundled into the deploy checklist.

### PR re-confirmation
PR #134 **OPEN + MERGEABLE**, **11/11 checks SUCCESS** (10 prior + GitGuardian), HEAD `d0ea87ec4b6296a81987985661c450c4d6017dd4`, base `main` `5a0ddb2`.