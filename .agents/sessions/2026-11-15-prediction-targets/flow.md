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

## Pending (blocked on approval)
- Explicit approval of Spec 43 + Plan 43.
- Explicit permission for DB schema migration (Prisma/SQLite mirror/push sinks) and data backfill.
- Implementation phases 1–6 after approval (no code/schema changes made yet in this step).