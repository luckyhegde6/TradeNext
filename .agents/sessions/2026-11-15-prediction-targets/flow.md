# Flow — 2026-11-15 prediction targets & analysis mode (Spec 43)

## Timeline
- **Context resumed:** from checkpoint (Swing "AI targets off" + PR #155 quality-gate/test-evidence work already pushed on `feature/spec-42-durable-worker-cron-v2`).
- **User request:** never show "AI targets off" without targets; always generate prediction/calculated targets when AI unavailable; add `analysisMode` (`AI Targets` | `Prediction Targets`) across analyses (incl. daily); backfill historical targeted rows as AI Targets; prediction fallback must not produce HOLD (daily BUY/SELL required), Swing keeps LONG/SHORT/OBSERVE; auto prediction on screener-only Swing view/load; per-stock mode; performance checks generate/persist missing prediction targets+mode (bounded); Telegram/admin exports/Sheets keep working but include mode. Asked to update specs/TODOs and start implementing.

## Investigation (read-only)
- Reviewed Swing/Daily services, fallback analysis, performance services, Prisma schema, UI components, routes/exports/broadcast touchpoints:
  - `lib/services/swingRecommendationService.ts`, `lib/services/swingAutoSeedService.ts`, `lib/services/swingPerformanceService.ts`
  - `lib/services/dailyRecommendationService.ts`, `lib/services/ai/recommendation-agent.ts`, `lib/services/ai/fallbackAnalysis.ts`
  - `prisma/schema.prisma` (`RecommendationTracker`, `DailyRecommendationStock`, `SwingAnalysisJob`, `SwingSignal`)
  - `app/components/recommendations/SwingTab.tsx`, `SwingCard.tsx`, `RecommendationCard.tsx` (+ daily/swing API/export paths scanned)
- Findings: no `analysisMode` field; Swing exposes `skipped`/"AI targets off" targetless states; daily fallback/pipeline can yield HOLD/ai-unavailable behaviors; performance evaluates persisted rows but does not generate missing targets; SwingSignal status persistence/query contract needs alignment for reliable perf evaluation.

## Artifacts created/updated (this step)
- **Spec:** `.agents/specs/43-prediction-targets-analysis-mode.md` (new) — captures all 8 user decisions, schema/API/behavior/backfill/perf/UI/export requirements, risks.
- **Plan:** `.agents/plans/43-prediction-targets-analysis-mode.md` (new) — phased implementation with approval gates, schema/mirror, fallback directionality, daily+swing changes, perf/backfill, verification.
- **TODOs:** `TODO.md` and `.agents/session-todos.md` updated with detailed Spec 43 tracking and approval gate.
- **Session memory:** `.agents/sessions/2026-11-15-prediction-targets/decisions.md`, `.agents/sessions/2026-11-15-prediction-targets/flow.md`.

## Implementation progress (this session, uncommitted)
- Resumed on `feature/spec-43-prediction-targets` (`0e9c64f`, planning/docs). Spec 43 implementation is present across schema/migration, SQLite mirror/push sinks, fallback/agents, daily+swing prediction/perf persistence+propagation, broadcast/Telegram/perf consumers, Google Sheets tabs/rows, recommendation APIs/UI, and tests.
- Stabilized Swing prediction-backed serving:
  - `lib/services/swingRecommendationService.ts`: `jobToResponse` normalizes target-less/legacy analyses to prediction-backed results with `analysisMode`, treats terminal `done/failed/predicted` feeds as cacheable/servable (incl. Prisma-mirror-empty and stale-terminal paths), and re-notifies terminal jobs where applicable.
  - `lib/__tests__/swingRecommendationService.test.ts`: deterministic mirror-empty-path stock payload and async `flushSwingAnalysis()` cleanup in `beforeEach`.
- Fixed regressions uncovered during gates: `lib/__tests__/recommendationsPlanLimitFallbacks.test.ts` updated for `analysisMode: null` (21/21 pass); `TODO.md` trimmed to restore injected-doc budget (doc-size gate 14/14 pass, total 95.7 KB). Cleaned session temp/junk files and stopped session-started dev server processes on `:3000`.
- **Verification:** targeted Spec 43 suites **174/174 pass** (`dailyRecommendationService` 58, `swingRecommendationService` 68, `swingPerformanceService` 27, `recommendationsPlanLimitFallbacks` 21). `npm run lint` **0 errors / 1227 warnings**. `npx tsc --noEmit` **46 errors, baseline-aware (no Spec 43-modified prod/service/component or non-test errors identified)**. `node scripts/dev-checks/check-doc-sizes.mjs` **OK**. UI screenshot capture attempted for PR evidence; local dev run had DB-unavailable errors and capture produced `e2e-screenshots/spec43/error.png` only.

## Pending (before Spec 43 commit)
- Confirm remaining Spec 43 behavior/propagation gaps (per-stock/mixed runs, daily execute/coordinator/batch/finalizer and swing serve/job/status/auto-seed/admin-consumer paths, Telegram/admin/export/Sheets/perf backfill store coverage, idempotence/bounds, no targetless/AI-off states) and add targeted tests only for confirmed gaps.
- Reconfirm gates as needed: full `npm run test`, `npm run quickbuild` (prior runs indicated green in-session; capture final evidence for commit/docs), and improve UI screenshot evidence if feasible in local environment.
- Update required docs/session memory for Spec 43: `AGENTS.md`, `.agents/CHANGELOG.md` (+ changelog detail file), `TODO.md`, `Primer.md`, `Lessons.md` (if warranted), `agent-memory.md`, `HANDOFF.md`, `.agents/handoffs/active/latest.md`, session `decisions.md`/`flow.md`/todos.
- Stage and perform **Spec 43 commit** on `feature/spec-43-prediction-targets` (explicitly requested).

## After Spec 43 commit (approved sequence)
- Track 1: per-recipient/chatId outbound-notification tracking in structured logs + DB hooks for all outbound notifications.
- Track 2: unified notification persistence (schema/migration + SQLite mirror/push sinks) + manage/retry/cancel/bulk/filters/detail/audit.
- Track 3: `/admin/utils/notifications` + unified history/cross-links + announcement send records.
- Track 4: synchronous “Prepare for Deploy” with checks + `worker_tasks` record; fix `/admin/utils/workers` showing 0.
- Capture PR screenshots for Tracks 1–4/UI changes. S2 diagnostics remain blocked pending approval/tool access. Archify/Graphify installs/diagrams pending explicit package/tool-install permission.