# Session Decisions — 2026-08-16 (v3.13.0) — DB-backed Swing AI analysis job

Branch: `feat/swing-db-analysis-job` | Commit: pending (user merges PR → Netlify rebuild = deploy)

## D1 — Durable DB-backed Swing AI analysis job replaces the cache-only fire-and-forget (Option A, user-approved)

**Decision**: NEW Prisma `SwingAnalysisJob` model. `getSwingRecommendations({analyze:true})` does a
**pre-scan DB lookup** (`findFirst orderBy createdAt desc`) → done/failed/pending/running served WITHOUT
re-scanning (pending kicks `maybeProcessSwingAnalysis()`); absent → scan + create durable job + return
frozen pending feed. `force=1` supersedes pending/running jobs (`updateMany → failed "Superseded by a
newer force refresh"`), re-scans, creates a new job. Empty feed → synchronous skipped (no job).
**Why**: the v3.12.0 fix used an in-memory cache key + module-level `swingAnalysisInFlight` — on prod the
tab poll (10s) could evict the pending payload from `staticCache` (LRU, small), the process restarting
mid-run lost everything, and only ONE in-memory job could exist. A durable row survives restarts and
serves any number of concurrent readers; the daemon's 60s resync tick drains pending jobs.
**Not chosen**: Option B/C (pure daemon, smaller prompts) — user explicitly approved A; B/C don't fix the
lost-payload/lost-job problems.

## D2 — Non-destructive migration: `migrate diff` + `db execute`, NEVER `migrate dev` locally

**Decision**: local `tradenext` DB has NO `_prisma_migrations` ledger (79 tables) — `migrate dev` would
detect drift and attempt a destructive reset. Generated the clean delta via
`npx prisma migrate diff --from-config-datasource --to-schema prisma\schema.prisma --script`, wrote
`prisma/migrations/20260816000000_add_swing_analysis_job/migration.sql`, applied via
`npx prisma db execute --file`, verified columns + indexes, `npx prisma generate`. Prod will run the
migration normally via `migrate deploy` on build.
**Why**: the Prisma 7 CLI removed `--from-url`; `db execute` reads the datasource from `prisma.config.ts`.
**Not chosen**: `db push` on local (would diverge the migration history further from prod).

## D3 — Atomic claim = `updateMany({ where: { id, status: "pending" }, data: { status: "running", startedAt, attemptCount: { increment: 1 } } })`

**Decision**: the processor claims a job with the single-query conditional update — `count === 0` means
another instance/request claimed it (multi-instance safe, no unique-constraint games). After the AI
batches, it RE-READS the row and aborts unless status is still `running` (a force-refresh supersede racing
the completion must not overwrite the newer job or warm the cache with stale data).
**Why**: Netlify can run multiple server instances; a naive read-then-write could double-run or
last-writer-wins the wrong job.

## D4 — Stale recovery: `SWING_JOB_STALE_MS = 45 min`, max `SWING_JOB_MAX_ATTEMPTS = 2`

**Decision**: a `running` job whose `startedAt < now - 45min` is either reset to `pending` (attemptCount
< 2, retried) or failed with "timed out after 2 attempt(s)" — a dead process can't wedge the tab forever
(the pending feed the UI shows also self-expires from cache at 10 min, so a fully-dead process degrades
to failed state, never hangs).
**Why**: free-model batches take minutes; 45min covers 4 × ~60s batches + retries comfortably.

## D5 — Cache holds ONLY final done/failed; pending/running always served from the DB row

**Decision**: the `swing:recommendations:ai` cache key is only written with the final 30-min payload
(done) or a failed payload — never the pending feed. Pending/running requests reconstruct the feed from
the durable job JSON (jobToResponse), so cache eviction can't strand a pending tab.
**Why**: v3.12.0 cached the pending payload at a 10-min TTL — eviction = the tab fell back to the
screener-only cache and polling stopped showing progress.

## D6 — Daemon resync tick drains the queue

**Decision**: `cron-daemon.ts`'s existing 60s `RESYNC_INTERVAL_MS` tick now dynamic-imports
`@/lib/services/swingRecommendationService` and calls `maybeProcessSwingAnalysis()` fire-and-forget
(`.catch` logged) — pending jobs created while no request is in flight still get processed (and stale
running jobs get recovered). No circular import (dynamic import).

## D7 — Module guard + test hook

**Decision**: `swingProcessorInFlight` promise dedupes concurrent processor calls;
`flushSwingAnalysis()` returns the in-flight promise (test hook, mirroring v3.12.0).

## D8 — Tests: stateful in-memory job store mirrors the service queries

**Decision**: `lib/__tests__/swingRecommendationService.test.ts` now holds an in-memory
`swing_analysis_job` store whose `findFirst`/`findMany`/`update`/`updateMany`/`create` mirror the
service's real query shapes (orderBy createdAt asc/desc, compare `in/lt/lte/gt/gte`, `applyData` with
`{increment}`), exposed as `__swingJobs`. New orchestration suite: durable pending→failed on processor
error, success→done + targets, completed-job served without re-scan, pending frozen feed without
re-scan, force supersede, no double-run on concurrent kicks, stale recovery retry-once + exhaust-fail,
supersede-mid-analysis abort, `jobToResponse` unit tests. 44/44 pass in file.
**Why**: mocking Prisma wholesale hid the updateMany-claim + abort semantics in the v3.12.0 tests.

## D9 — No commit/push/PR without user approval (consistent holds)

**Decision**: code + tests + live-verification + docs complete; commit, push, and PR creation are
pending explicit user approval. Prod deploy only after the user merges the PR → Netlify rebuild.
