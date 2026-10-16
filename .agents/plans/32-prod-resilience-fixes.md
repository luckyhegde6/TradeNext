# Plan — Spec 32: Prod resilience fixes (AI quota latch · breaker tighten · degraded dedup)

> Companion to `.agents/specs/32-prod-resilience-fixes.md`. Ordered, verifiable steps.
> Status: **DONE (2026-10-16)** — Phases 0–5 complete (tsc 46 exact · Jest 138/138 · 2078 pass · eslint 0 · quickbuild 201/201); **COMMIT PENDING USER (D9)**.

## Phase 0 — Recon (done)
- Confirmed: `DEGRADED_DEDUP_SQL` (`lib/sqlite.ts:297`) filters `status IN ('pending','running')`.
- Confirmed: `enqueueDueCronJobsFromMirror` (`worker-engine.ts:357`) re-enqueues due mirror jobs; `next_run` never advanced.
- Confirmed: `catchUpMissedCronJobs` (`worker-engine.ts:815`) → `runDegradedPathIfActive("cron")` at boot + 5-min resync.
- Confirmed: `isPlanLimitHoldError` (`db-utils.ts:236`) matches `name.includes("timeout")`.
- Confirmed: `analyzeBatch` (`recommendation-agent.ts:266`) detects quota, throws; no latch.

## Phase 1 — Fix 3 (dedup on completed rows; cadence-aware window)
1. `lib/cron-parser.ts`: add `cronNextGapMs(expr, from)`.
2. `lib/sqlite.ts`: `DEGRADED_DEDUP_SQL` drops the status filter; update the comment.
3. `lib/services/worker/degradedQueue.ts`: add `cronDedupWindowMs`; default the window to it; update comments.
4. Tests: `cronParser.test.ts`, `degradedQueue.test.ts`; keep `sqlite.test.ts` real-engine guard green.

## Phase 2 — Fix 2 (breaker narrowing)
1. `lib/db-utils.ts`: `isPlanLimitHoldError` matches only genuine holds.
2. Update `db-utils.test.ts` (timeout → false; genuine hold → true).

## Phase 3 — Fix 1 (AI quota latch)
1. `lib/sqlite.ts`: `persistBackupMeta` / `restoreBackupMeta` / `deleteBackupMeta`.
2. `lib/services/ai/quotaLatch.ts` (new): mark/get/is/clear + `isDailyFreeQuotaMessage`.
3. `lib/services/ai/llm-provider.ts`: append the error body (keeps `HTTP <status>`).
4. `lib/services/ai/recommendation-agent.ts`: mark on quota; short-circuit when latched.
5. `app/api/admin/ai/monitoring/route.ts`: `quota` in GET stats; `POST {action:"clear-quota"}`.
6. `app/admin/utils/ai-monitoring/page.tsx`: banner.
7. Tests: `quotaLatch.test.ts` (new), `recommendation-agent` latch case.

## Phase 4 — Gates
- `npx tsc --noEmit` → 46 exact.
- `npm run lint` on touched files.
- Targeted `npm run test` (never chained).
- `npm run quickbuild`.

## Phase 5 — Docs
- `AGENTS.md` version row (v3.51.0) + `.agents/CHANGELOG.md` index + new `versions-v3.51.md`.
- `Primer.md`, `agent-memory.md`, `Lessons.md`, `.agents/session-todos.md`, `HANDOFF.md`.
- Session folder `.agents/sessions/<date>-…/{decisions,flow}.md`.

## Risks / rollbacks
- Breaker narrowing could (theoretically) let a hold that manifests ONLY as
  timeouts run slow. Accepted: a genuine hold returns P6003/"hold on your
  account", which still trips; transient timeouts must not freeze the app.
- Cadence window: derived from the cron expression, so a job's own schedule
  governs its dedup. Jobs with an invalid expression fall back to 90 min.

## Out of scope
Schema change, new deps, fund/credits, the actual push/deploy.
