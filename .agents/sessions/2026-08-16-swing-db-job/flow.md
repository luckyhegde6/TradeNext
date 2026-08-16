# Session Flow — 2026-08-16 (v3.13.0) — DB-backed Swing AI analysis job

Branch: `feat/swing-db-analysis-job` (on top of main, v3.12.0 merged via PR #95)

## Execution path

1. **Situation**: v3.12.0 (request-time split) worked locally but was fragile on prod — the pending
   payload lived in the in-memory `staticCache` (LRU-evictable by the tab's 10s poll churn), the module
   guard allowed only one in-flight job, and a Netlify instance restart mid-analysis lost everything.
   Root cause chain: free-model AI calls take 38–53s each (4 batches) → Netlify 30s request wall killed
   the ORIGINAL sync pipeline; the async split fixed the wall but kept results in volatile memory.
2. **User decision (D1)**: Option A — durable DB-backed `SwingAnalysisJob` + cron daemon drains it.
   Migration + tests explicitly pre-approved; "continue building and fixing".
3. **Migration (D2)**: local DB has no `_prisma_migrations` ledger → `migrate diff --from-config-datasource
   --to-schema prisma\schema.prisma --script` → clean delta → `prisma/migrations/20260816000000_add_swing_analysis_job/migration.sql`
   → `prisma db execute --file` (datasource from `prisma.config.ts`) → verified columns + indexes →
   `prisma generate` (v7.9.1). Prod: normal `migrate deploy` on build.
4. **Service rewrite** `lib/services/swingRecommendationService.ts`:
   - `SWING_PENDING_TTL` / `runSwingAnalysisInBackground` / `swingAnalysisInFlight` REMOVED.
   - NEW: `jobToResponse`, `processSwingAnalysisJob`, `maybeProcessSwingAnalysis`,
     `flushSwingAnalysis()`, `SWING_JOB_STALE_MS = 45*60*1000`, `SWING_JOB_MAX_ATTEMPTS = 2`.
   - `getSwingRecommendations` rewritten per D1/D5 (pre-scan DB lookup, force supersede, durable job,
     empty-feed skipped, analyze=false unchanged).
   - Type-narrowing fix: `analysisStatusAfterBatch(stocks) as "done" | "failed"` (Prisma JsonValue
     assignment).
5. **Daemon wiring** `lib/services/worker/cron-daemon.ts`: `RESYNC_INTERVAL_MS` (60s) tick now
   dynamic-imports the service and calls `maybeProcessSwingAnalysis()` fire-and-forget (D6).
6. **Tests** `lib/__tests__/swingRecommendationService.test.ts`: stateful in-memory `swing_analysis_job`
   store (D8) + orchestration suite + `jobToResponse` unit tests. Stale-recovery fixture corrected to
   `attemptCount: 1` (claims always increment). 44/44 in file; suite **730 pass / 4 skip** (was 722/4,
   +8); `npx tsc --noEmit` 46 = exact baseline, 0 new. Grep: zero refs to the removed identifiers.
7. **Live verification (:3000)** — dev server via `start /b cmd /c "npm run dev > dev-server.log 2>&1"`:
   - `GET /api/recommendations/swing?analyze=1&force=1` → HTTP 200 | **11.11s**, 34 templates / 200 raw /
     20 top, `analysisStatus: "pending"` (was 30s+ wall before the split).
   - DB job `68bbed30-d340-4a28-b78d-aa816063e321`: running / attemptCount 1 → (batches logged,
     `swing_analysis_batch` success 24.9s) → **done, analyzedCount 20/20**.
   - Non-force during processing: **39ms** frozen pending feed from the DB row (no re-scan);
     after done: **25ms** cache-served `analysisStatus: "done"`, 20/20 with targets (MARKSANS LONG 72%,
     LGEINDIA LONG 75%, MANORAMA LONG 65%, IDEA SHORT 55%, …).
   - Audit trail: SWING_RUN_START → SWING_ANALYSIS_START → SWING_ANALYSIS_COMPLETE → SWING_RUN_COMPLETE;
     swing trackers persisted (5 new today, idempotent-skipped the rest).
   - UI (chrome-devtools /recommendations → 🌊 Swing): "AI targets ready" badge, 20 cards with
     direction-aware ENTRY/TARGET/STOP, 0 console errors.
8. **Docs**: AGENTS.md v3.13.0 row, CHANGELOG index + versions-v3.md entry, TODO.md row, Primer,
   agent-memory, Lessons #81, session-todos, session decisions/flow (this file).
9. **Pending**: commit + push + PR `feat/swing-db-analysis-job` (user approval); Netlify cron UI entries
   cleanup post-deploy; report missing local `_prisma_migrations` ledger (pre-existing; `migrate dev`
   dangerous locally until fixed).

## Code touched

- `prisma/schema.prisma` (+`SwingAnalysisJob` after `DailyRecommendationStock`)
- `prisma/migrations/20260816000000_add_swing_analysis_job/migration.sql` (NEW)
- `lib/services/swingRecommendationService.ts` (job orchestration rewrite)
- `lib/services/worker/cron-daemon.ts` (+9: resync-tick drain)
- `lib/__tests__/swingRecommendationService.test.ts` (stateful mock + orchestration tests)
- Docs: `AGENTS.md`, `.agents/CHANGELOG.md`, `.agents/changelog/versions-v3.md`, `TODO.md`, `Primer.md`,
  `agent-memory.md`, `Lessons.md`, `.agents/session-todos.md`, `.agents/sessions/2026-08-16-swing-db-job/`

## Notes / leftovers

- Stray untracked files left as-is (pre-existing): `scripts/check-recs-tables.ts`,
  `scripts/check-swing-prices.ts`, `scripts/fetch-swing-prices-to-prod.ts`,
  `scripts/sync-local-to-prod.ts`, `prod-diagnostic.tmp.ts` (LSP-only, not in git status).
- `resp.json`/`resp2.json`/`resp3.json` verification artifacts DELETED.
- Dev server still running on :3000 (`dev-server.log`) — kill after verification per Lesson 24/playbook.
- Old branch `fix/swing-async-analysis` was merged (PR #95) — this branch builds on it.
