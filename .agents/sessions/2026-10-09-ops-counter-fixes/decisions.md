# Session Decisions — 2026-10-09 v3.46.0 Specs 22/23/24

Branch: `feature/fix-ops-counter-authority-sync` (PR #134, base `main` `5a0ddb2`)

## Decisions

### D1. Spec 22 — authority day lives in `DbHealthCheck`, not the ops counter state
- **What**: `buildQueryConsumption(state, live, planLimit, authorityToday?)` in `lib/services/opsMonthly.ts`; the ops month mirrors the live day from `DbHealthCheck.live_ops_month`/`last_reset`; db-health route GET (counters + authority) + PATCH `set_ops_counter` (zod, :226/:444, audit `DB_HEALTH_SET_OPS_COUNTER`).
- **Why**: the month boundary (and which day "today" is) belongs to the DB health record, the same authority the ops counter itself is enforced against — a drifted Postgres counter can then be corrected through the API instead of manual SQL.

### D2. Spec 23 — missing Google-Sheets tables are tolerated at the mirror-writer, never a worker throw
- **What**: `lib/sqlite.ts` catches Prisma `P2021`/"does not exist" for the Google-Sheets tables → `logger.info` + `return null` (no-op). `netlify.toml` build = `npx prisma migrate deploy && node scripts/predeploy/preserve-mirror.mjs && npx prisma generate && npm run quickbuild`.
- **Why**: the prod schema bootstrap predates the v3.43.0 GS models; a cold-start deploy must not have the SQLite sync write path throw into the worker. Running `migrate deploy` before the build creates the tables on prod. **Flagged as production-affecting in the PR.**

### D3. Spec 24 — missed ticks: in-window spawn, stale re-arm forward, never retro-fire
- **What**: `catchUpMissedCronJobs()` (`worker-engine.ts` ~L855), `CRON_CATCHUP_WINDOW_MS=15min`; missed ≤15min **spawned** (same guards as `checkScheduledJobs`, skip `running`); stale >15min re-armed (`nextRun` advanced), record `cron_missed_tick` then set the nextRun forward WITHOUT firing. Wired at daemon boot + 5-min resync tick (`cron-daemon.ts`).
- **Why**: Netlify suspends idle instances ~2h so node-cron ticks stop; the daemon only polls due jobs so a missed `nextRun` is never re-discovered on wake. Spawning stale jobs retroactively would produce meaningless duplicate work — the window binds what may still be "fresh enough" to fire.

### D4. Docs: AGENTS.md row deferred again (cap), detail moved to `.agents/changelog/versions-v3.46.md` (Lesson 142 pattern)
- **Why**: AGENTS.md is 32,949 B > 32,768 B cap; the version-row edit is recorded in the changelog and must be landed when AGENTS.md is next slimmed (Lesson 158).
- **D4 addendum (2026-10-09, same session)**: the user then approved **"Trim AGENTS.md now (+4 KB)"** — superseding the deferral. AGENTS.md was rewritten (temp script → committed version): re-landed v3.44.0/v3.45.0/v3.46.0 rows, compacted v3.43.0/v3.41.x rows → **32,564 → 29,197 B** (< cap). The user also approved **"Commit + push to PR #134"** (ONE commit: code + docs + trim; merge/deploy still user-controlled).

### D5. No OpenAPI/swagger update for v3.46.0
- **Why**: no new API routes in this diff (only existing routes changed); per Lesson 151 the swagger capture is route-coverage based.

## Gate results (recorded, not re-run)

- tsc **46 exact (0 new; prod 0)** · ESLint **0 errors (8 files)** · quickbuild **199/199**.
- Targeted Jest 4 suites **192/192** (10 new: 7 catch-up + 3 wiring).
- Full Jest **133/134 suites · 1979 pass / 4 skip / 3 fail** — only `check-doc-sizes.test.ts` red (AGENTS.md 32,949 > 32,768 B; pre-existing, not caused by this diff).
- **Post-trim (same session)**: AGENTS.md 29,197 B → `check-doc-sizes.test.ts` **14/14 green** → full Jest **134/134 · 1979 pass / 4 skip / 0 fail**; doc-budget gate 91.8/100 KB OK.