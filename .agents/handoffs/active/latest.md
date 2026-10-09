# Live Resume — v3.46.0 Specs 22/23/24 (ops-counter authority sync + GS table-missing tolerance + cron missed-tick catch-up)

> Updated: 2026-10-09 · Snapshot of the active handoff for the current session state.

## Status

| Field | Value |
|-------|-------|
| **Task** | Three production-hardening fixes on top of v3.45.0: (22) ops-counter authority sync, (23) Google-Sheets table-missing tolerance, (24) cron missed-tick catch-up (Specs 22/23/24) |
| **Branch** | `feature/fix-ops-counter-authority-sync` (PR #134, HEAD `5a0ddb2`, base `main` = v3.45.0 MERGED) |
| **State** | CODE + TESTS + GATES + DOCS **DONE** · **COMMIT/PUSH PENDING USER** (2026-10-09) |
| **In-flight** | None — implementation + docs complete; awaiting user approval to commit to PR #134 |
| **Blocked** | (none — commit+push **approved by user** 2026-10-09; PR #134 merge + Netlify deploy still user-controlled. Doc-gate now **green**: AGENTS.md trimmed to 29,197 B, `check-doc-sizes.test.ts` 14/14) |
| **Side note** | ⚠️ **PRODUCTION-AFFECTING** in this PR: `netlify.toml` build = `npx prisma migrate deploy && node scripts/predeploy/preserve-mirror.mjs && npx prisma generate && npm run quickbuild` — flag in the PR description. v3.45.0 MERGED into `main` (2026-10-06). |

## What's done (v3.46.0)

- **(22) Ops-counter authority sync**: `buildQueryConsumption(state, live, planLimit, authorityToday?)` in `lib/services/opsMonthly.ts` — the ops month now mirrors the live day from `DbHealthCheck.live_ops_month`/`last_reset`; db-health route GET (counters + authority) + PATCH `set_ops_counter` (zod, :226/:444, audit `DB_HEALTH_SET_OPS_COUNTER`) so a drifted Postgres counter can be corrected via API.
- **(23) Google-Sheets tables missing on prod**: SQLite mirror-writer tolerates `P2021`/"does not exist" for the Google-Sheets tables (`logger.info` + `return null`, never throws into the worker; the prod schema bootstrap predates the v3.43.0 models); `netlify.toml` build now runs `prisma migrate deploy` + `preserve-mirror` before `generate` + `quickbuild`.
- **(24) Cron missed-tick catch-up**: `catchUpMissedCronJobs()` in `lib/services/worker/worker-engine.ts` (~L855) with `CRON_CATCHUP_WINDOW_MS=15min` — Netlify suspends idle instances ~2h so node-cron ticks stop and the daemon (which only polls due jobs) never re-discovers a missed `nextRun`; missed ≤15min **spawned** (same guards as `checkScheduledJobs`, skip `running`), stale re-armed advance **never fired**; wired at daemon boot + 5-min resync tick in `cron-daemon.ts` (import L24, boot ~L118–130, resync tick ~L143).
- **Tests**: 10 new (7 `catchUpMissedCronJobs` in `worker-engine.test.ts` + 3 Spec-24 wiring in `cron-daemon.test.ts`); targeted 4 suites 192/192 — full Jest **133/134 suites · 1979 pass / 4 skip / 3 fail** (only pre-existing AGENTS.md doc-gate).
- **Gates**: tsc **46 exact (0 new; prod 0)** · ESLint **0 errors (8 files)** · quickbuild **199/199**.
- **Docs**: `.agents/changelog/versions-v3.46.md` + CHANGELOG + versions-index + Lesson 158 + TODO/Primer/agent-memory/session-todos/HANDOFF/latest + session archive `2026-10-09-ops-counter-fixes/`. **AGENTS.md rows v3.44.0–v3.46.0 LANDED** — AGENTS.md trimmed −3,367 B to 29,197 B; doc-gate script + `check-doc-sizes.test.ts` 14/14 green.

## Not done (deliberately)

- **Commit v3.46.0 to PR #134 — APPROVED by user (2026-10-09)** — ONE commit (code + docs + AGENTS.md trim) then push; includes the `netlify.toml` prisma-migrate-deploy change — flag in the PR description; merge/deploy still needs explicit OK.
- AGENTS.md version-row edit — **DONE** (user-approved trim; deferred v3.44.0/v3.45.0 rows landed alongside v3.46.0).
- No OpenAPI/swagger update — no new API routes (per a quick scan, only existing routes changed).
- Netlify deploy — user-controlled (separate step).

## Next steps

1. **NOW EXECUTING (user-approved)**: single commit v3.46.0 (code + docs + AGENTS.md trim) → push PR #134 → update PR description (flag `netlify.toml` production change). Merge/deploy remains user-controlled.
2. After the merge: a Netlify deploy will exercise the new build order (`prisma migrate deploy` first) — required so the Google-Sheets tables get created on prod (Spec 23).
3. ~~Pre-existing red~~ — **RESOLVED**: AGENTS.md trimmed to 29,197 B; `check-doc-sizes.test.ts` 14/14 — full Jest now 134/134.

## Gotchas / lessons for this handoff

- **Lesson 158**: check-doc-sizes gate — never add files/GitHub paths to make a doc-gate pass; fix the size (AGENTS.md needs a trim pass to re-land deferred version rows).
- The `grep` tool's path-scoping is unreliable on this repo (searched repo root despite a file path) — use `findstr /n` (cmd) or `read` for single-file lookups.
- Windows cmd: no `tail` (use findstr/find). Admin login `admin@tradenext6.app` / `admin123`; demo `demo@tradenext6.app` / `demo123`.
- AGENTS.md at **29,197 B** (< 32,768 B cap) — the Lesson 142 "do not edit" policy was superseded by explicit user approval (2026-10-09); keep version rows compact going forward.
- Spec 24 policy: stale missed ticks are re-armed forward, NEVER fired retroactively — the catch-up window (15 min) is the only thing that spawns missed jobs; keep it a constant, not magic.

## Remaining-merge state of PREVIOUS workstreams

- v3.45.0 (degraded engine): **MERGED into `main`** (2026-10-06) — pending Netlify deploy + Dependabot alert clearance.
- v3.44.0 (legal): committed + pushed — `fb29b16` → `66db159` → `ac24ede` + `4010a26` (PR #133 MERGED 2026-10-06).
- v3.43.0 (Sheets console): committed `645cf85` + `aba7fa6` — pushed, PR #133 MERGED 2026-10-06.
- v3.41.3 (Laya): pushed, PR #132 MERGED `4b68e30` (2026-09-25).
- v3.38.x: PR #121 OPEN, PR #118 OPEN — merge/deploy pending user.
- Full detail: `.agents/changelog/versions-index.md`.