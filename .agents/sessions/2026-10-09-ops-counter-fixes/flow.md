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
## GS-tracking verification addendum (2026-10-09)
- Brought up local infra: Docker Desktop + `docker compose up -d db redis` (bypassed the WSL bash wrapper that broke `db:up`) + `prisma migrate deploy` (none pending) + `prisma db seed`.
- Dev server (`npm run dev`, background) + Playwright: login admin -> `/admin/google-sheets` -> status API 200 `{trackingEnabled:true, oauth:{clientId,clientSecret,refreshToken all true}}`.
- Cleanup: dev server (pid 25468) killed; throwaway scripts deleted; temp token artifacts shredded; `.playwright-mcp/` is gitignored.
- Test row remains on the sheet `custom!A2` ("GS-E2E-TEST" / "DELETE-ME local pipeline verify") - safe to delete.

## Scheduled-execution reliability pass (branch `fix/daily-rec-swing-cron-worker`, off `main` @ `c8bdad1`)
- **Diagnosis only (no code yet)**: confirmed 5 defects (tz split-brain, 15-min catch-up skip, degraded no-op, dead `startScheduler`/`checkScheduledJobs`, outbox drained only on 6h probe/admin/deploy). Reads: `cron-daemon.ts`, `worker-engine.ts` (:179/:712-:721/:803/:856), `recommendationCronService.ts` (:208/:227), `cron-parser.ts` (UTC), `timeCorrection.ts`, `sqlite.ts` (`pushSqliteToPrisma` :4996, `getCronJobs` :5742, `upsertCronJob` :7710), `degradedQueue.ts`, `degradedMode.ts`, `dailyRecommendationService.ts` (`runDailyRecommendations` :149+), `app/admin/google-sheets/page.tsx` (:17/:124-131/:546), `lib/services/googleSheets/tabs.ts` (:116/:128).
- **Artifacts drafted (awaiting approval)**: `.agents/specs/25-scheduled-execution-reliability.md`, `.agents/plans/25-*.md`, `.agents/specs/26-google-sheets-header-label-fix.md`, `.agents/plans/26-*.md`.
- **Live prod probes**: `/api/admin/google-sheets/status` (custom+metrics `matched`, others `absent`, queued 0) · `/api/admin/cron` (4 system jobs; `lastRun` Sept, `nextRun` 2026-10-12 UTC) · `/api/admin/cron/daemon` (`running:true`, `registeredJobs:0`).
- **Next**: user approval of spec 25 → plan 25 → implement → verify. Spec 26 is small and independent.

### Spec 25 IMPLEMENTATION + SMOKE VERIFICATION (same branch, uncommitted)

**Code (working tree, not committed):** `recommendationCronService.ts` (+36, tz self-heal), `cron-daemon.ts` (+35 — `DEFAULT_TIMEZONE = "UTC"`, per-job override kept :260-261, non-UTC system-job warning :266-272), `worker-engine.ts` (−139/+… big rework — `catchUpMissedCronJobs` :791 fires any `{isActive:true, nextRun:{lte:now}}`, no 15-min skip; spawn advances `nextRun` via `calculateNextRun` :729/:762). Tests updated: `worker-engine.test.ts` (±209), `cron-daemon.test.ts` (±77), `recommendationCronService.test.ts` (+40), `daemon-sqlite-first.test.ts` (±4). (flow.md section above predates the code — code landed after.)

**Smoke (degraded catch-up, live dev server):**
- 13:49:58 `Degraded: enqueued due cron jobs from mirror, count=1` (fc7fb5bd) → claimed → executed → **completed 13:50:43** (daily rec degraded, stockCount=10870) → drained. Overdue-job recovery WORKS.
- 13:54:59 **2nd enqueue** (7e90adda) on the next 5-min tick → claimed, `running` — confirmation of the **BUG-A loop** (see decisions D14): the degraded executor completes but never advances the mirror `next_run`, so the job stays "due" and catch-up legitimately re-fires it; only the pending/running dedup (90-min) stopped a 3rd fire while the row was running.
- Process killed mid-run (14:07) → row `7e90adda` stayed `running` **in the mirror file** — proves the queue is the durable `_degraded_task` table (36-table snapshot; my earlier "not persisted" probe was wrong — I queried `degraded_queue`, not `_degraded_task`). Stale-running reclaim (30 min) is GATED on degraded-active — with `active=false` the row sits dormant; harmless (SQLite-only table, no Prisma model).
- **Restore executed** (user-approved scope): psql UPDATE all 4 `cron_jobs` → nextRun 2026-10-12 (daily-rec .627 = psql; others .697/.736/.815 = old-process ensure writes) + mirror file edit (node+sql.js) → restarts (46784 → 14676).
- **Final verification (all ✓):** psql 4×10-12 · mirror node dump 4×10-12 · **live daemon boot 14:21:17: `Recomputed` ×4 all `changed=false` (10-12), jobs=4 registered with correct UTC expressions, leader, ZERO degraded enqueues** · `GET /api/admin/cron` 4 jobs 10-12 · `GET /api/admin/degraded-mode` mode=auto active=false reason=threshold · no `Degraded: enqueued` since 13:54:59. 10-min boot delay = stale leader lease expiry (normal, fail-closed).
- **BUG B confirmed**: `POST /api/admin/degraded-mode` = 405 (route is GET+PATCH only).
