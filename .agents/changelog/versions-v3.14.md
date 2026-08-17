# v3.14.0 — Swing Signal Persistence + Performance Tracking + Spec-Driven Development Workflow

> Date: 2026-08-17 · Branch: `feat/swing-signals` (on top of docs branch `docs-readme-refs-agentic-coding`)
> Predecessor: v3.13.0 (DB-backed Swing AI analysis job, merged via PR #96)

## Summary

Persists posted swing picks to `SwingSignal` at creation, patches AI levels at analysis completion, evaluates targets/stops/45-day expiry via a `swing_performance` worker task, adds an admin trigger button, audit tags, and caches AI targets until the next swing run. Also adds a Worker-logs tab in the monitoring UI, and creates a mandatory spec-driven development workflow for all future features.

---

## 1. Swing Signal Persistence (`SwingSignal`)

### Schema
- **NEW** `SwingSignal` model in `prisma/schema.prisma` — `@@unique([jobId, symbol])`; fields: `jobId`, `symbol`, `direction` (LONG/SHORT/OBSERVE), `confidence`, `entryPrice`, `targetPrice`, `stopLoss`, `analysis` (JSON nullable), `currentPrice`, `targetHitAt`, `stopHitAt`, `expiredAt`, `status` (open/target_hit/stop_hit/expired), `createdAt`, `updatedAt`.
- **Migration** `20260817000000_add_swing_signal` — applied locally via `migrate diff` + `db execute`.

### Service Wiring
- **`persistSwingSignals(jobId, stocks)`** in `swingRecommendationService.ts` — `createMany` + `skipDuplicates` at job creation time; non-fatal try/catch. Only runs when the analysis job is created (non-force path).
- **`patchSwingSignalAnalysis(jobId, stocks)`** — per-symbol `updateMany` at analysis completion; patches `analysis`/`analysisError`, computes `analysisStatusAfterBatch`, persists swing trackers (non-fatal). Only stocks with analysis get patched.
- **`SWING_DONE_CACHE_TTL`** = 24h (done/files cached until next swing run supersede).
- **`staticCache.del`** on supersede + job create — stale pending never served after force refresh.

## 2. Performance Evaluation

### `lib/services/swingPerformanceService.ts` (NEW)
- **`SWING_EXPIRY_DAYS`** = 45.
- **`evaluateSwingSignalStatus(signal, currentPrice?)`** — direction-aware: LONG target >= targetPrice → target_hit; stop <= stopLoss → stop_hit; SHORT inverted; expired if createdAt + 45d past; else open.
- **`checkSwingPerformance(options?)`** — batch DB query for open signals, live-price bridge via `getStockQuote` (capped 50, chunked `Promise.allSettled`), per-signal evaluation, `updateMany` status writes, audit `SWING_SIGNAL_STATUS_CHANGED` per update, summary `SWING_PERFORMANCE_CHECK`.

### Worker Task
- **`worker-service.ts`** — new `swing_performance` task case + `executeSwingPerformance()` (non-fatal, mirrors `checkRecommendationPerformance` convention).

### Admin Trigger
- **`app/api/admin/recommendations/route.ts`** — new `check_swing_performance` action.
- **`app/admin/recommendations/daily/page.tsx`** — teal "📊 Check Swing Performance" button + banner.

## 3. Audit Tags

- `SWING_PERFORMANCE_CHECK` — summary of a performance-check run.
- `SWING_SIGNAL_STATUS_CHANGED` — per-signal status update.

## 4. Worker-Logs Tab

- **`worker-logger.ts`** — `resolveLogsDir()` first candidate `cwd/worker_logs` (dropped `.next/server_logs`), fallback `os.tmpdir()/tradenext-logs`, then DB.
- **`/api/admin/monitoring`** — new `type=worker-logs` list/read/delete endpoints.
- **Monitoring page** — new "Workers" tab showing worker log files.

## 5. Spec-Driven Development Workflow (NEW)

Mandatory for ALL feature development. Workflow: `.agents/rules/spec-driven-development.md`.
- **Templates**: `.agents/templates/spec-template.md` (TradeNext-specific: Prisma, Next.js, NSE API, Netlify) + `.agents/templates/plan-template.md` (6 phases, verification commands, doc checklist).
- **Workflow**: pull → branch → spec → review → plan → implement → verify → iterate.
- **Checklist**: `.agents/rules/checklist.md` upgraded v1.2 → v1.3 with spec gate at top.
- **Rules README**: `.agents/rules/README.md` updated with spec-driven development reference.
- **AGENTS.md**: Agent Operating Model section updated with spec-driven workflow bullet + docs table updated with checklist v1.3 + spec-driven dev reference.
- **Directories**: `.agents/specs/` + `.agents/plans/` created.

---

## Tests

### `lib/__tests__/swingPerformanceService.test.ts` (NEW, 18 tests)
- 9 `evaluateSwingSignalStatus` (direction-aware status evaluation: LONG/SHORT target_hit/stop_hit/expired/open).
- 9 `checkSwingPerformance` (DB-path with mocks: batch query, live-price bridge, status updates, error tolerance).

### `lib/__tests__/swingRecommendationService.test.ts` (extended, +10)
- Draft persistence suite: creates signals on job creation, handles DB errors gracefully.
- Patch suite: patches analysis on completion, skips unanalyzed stocks.
- Orchestration: verifies signals persisted at creation, patched at completion.
- Total file: 44/44 → 54/54.

### Suite totals
- **758 pass / 4 skip** (was 730/4, +28 = exactly the new tests).
- **`npx tsc --noEmit`** = 46 errors (exact baseline, 0 new).

---

## Files Created
- `lib/services/swingPerformanceService.ts`
- `lib/__tests__/swingPerformanceService.test.ts`
- `prisma/migrations/20260817000000_add_swing_signal/migration.sql`
- `.agents/templates/spec-template.md`
- `.agents/templates/plan-template.md`
- `.agents/rules/spec-driven-development.md`
- `.agents/specs/` (directory)
- `.agents/plans/` (directory)

## Files Modified
- `prisma/schema.prisma` — SwingSignal model
- `lib/services/swingRecommendationService.ts` — persistSwingSignals, patchSwingSignalAnalysis, SWING_DONE_CACHE_TTL, staticCache.del
- `lib/services/swing-types.ts` — exported `SignalFamily`
- `lib/services/worker/worker-service.ts` — swing_performance task case
- `lib/services/worker/worker-logger.ts` — resolveLogsDir() worker_logs first
- `lib/audit.ts` — SWING_PERFORMANCE_CHECK, SWING_SIGNAL_STATUS_CHANGED
- `app/api/admin/recommendations/route.ts` — check_swing_performance action
- `app/admin/recommendations/daily/page.tsx` — teal button + banner
- `app/api/admin/monitoring/route.ts` — worker-logs list/read/delete
- `app/admin/utils/monitoring/page.tsx` — Workers tab
- `lib/__tests__/swingRecommendationService.test.ts` — extended
- `AGENTS.md` — v3.14.0 version table row + spec-driven workflow + docs table update
- `.agents/CHANGELOG.md` — v3.14.0 index entry
- `.agents/changelog/versions-v3.md` — v3.14.0 index entry
- `.agents/rules/checklist.md` — v1.3 with spec gate
- `.agents/rules/README.md` — spec-driven development reference
- `TODO.md` — v3.14.0 quick reference + detailed entry
- `Primer.md` — v3.14.0 status
- `agent-memory.md` — v3.14.0 activity entry
- `Lessons.md` — Lesson #82

---

## Status

✅ CODE + TESTS VERIFIED — commit pending user, no deploy.
