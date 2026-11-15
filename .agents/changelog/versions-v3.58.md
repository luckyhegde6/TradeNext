# v3.58.0 — Spec 43 Prediction targets & analysis mode (no "AI targets off")

**Date:** 2026-11-15  
**Branch:** `feature/spec-43-prediction-targets` (from `main` merged with `origin/main`, post PR #155 / v3.57.0)  
**Spec/Plan:** `.agents/specs/43-prediction-targets-analysis-mode.md`, `.agents/plans/43-prediction-targets-analysis-mode.md`  
**Session:** `.agents/sessions/2026-11-15-prediction-targets/{decisions,flow}.md`  
**Status:** Spec/plan approved (DB migration/backfill + verification permitted). Implementation + targeted gates completed in-session; commit prepared on explicit user request.

## Summary
Implements Spec 43: always show persisted prediction/calculated targets when AI is unavailable (removes "AI targets off"/targetless screener-only states) with explicit per-stock `analysisMode` (`"AI Targets"` | `"Prediction Targets"`) across Swing and Daily recommendations — DB/persistence, fallback/agent logic, service/API/UI propagation, Telegram/broadcast, admin exports/Google Sheets, and bounded/idempotent performance-check backfill.

## Key decisions (user-approved)
- Per-stock `analysisMode`: `"AI Targets"` | `"Prediction Targets"`.
- Historical rows with any target/analysis backfilled/interpreted as `"AI Targets"` (migration intent where applicable).
- Daily fallback/prediction must **never** return `HOLD` on weak signals (always `BUY/SELL`); normal AI analysis may allow rare neutral `HOLD`.
- Swing keeps `LONG/SHORT/OBSERVE` but prediction targets are auto-computed/persisted on every screener-only view/load (no targetless state).
- Mixed runs keep per-stock mode.
- `checkRecommendationPerformance` / `checkSwingPerformance` generate+persist missing prediction targets/mode (bounded/idempotent).
- Telegram/admin exports/Google Sheets continue to work and include mode.

## Implementation (representative)
- **Schema/migration/persistence:** `analysisMode` added to `DailyRecommendationStock`, `RecommendationTracker`, `SwingSignal` in `prisma/schema.prisma` and migration `prisma/migrations/20261115160000_add_analysis_mode_prediction_targets/migration.sql`; SQLite mirror/push-sink coverage updated in `lib/sqlite.ts`, `lib/sqlitePushSinks.ts`.
- **Fallback/agents:** directional daily BUY/SELL prediction fallback and swing prediction targets in `lib/services/ai/fallbackAnalysis.ts`; propagation through `lib/services/ai/recommendation-agent.ts`, `lib/services/ai/swing-agent.ts`.
- **Daily/Swing services:** per-stock prediction/mode persistence and propagation in `lib/services/dailyRecommendationService.ts`, `lib/services/swingRecommendationService.ts`, `lib/services/swing-types.ts`, `lib/services/recommendationPerformanceService.ts`, `lib/services/swingPerformanceService.ts` (bounded/idempotent perf backfill hooks).
- **Broadcast/Telegram/exports/Sheets:** mode-aware messaging/export behavior in `lib/services/recommendationBroadcast.ts`, `lib/services/telegramBotService.ts`, `lib/services/googleSheets/{rows,tabs}.ts`.
- **APIs/UI:** recommendation endpoints and UI components updated for prediction-backed targets and `analysisMode` display/handling (`app/api/recommendations/**`, `app/components/recommendations/**`).
- **Stabilization (this session):** `swingRecommendationService.jobToResponse` normalized target-less/legacy analyses to prediction-backed results with `analysisMode` and improved terminal serve/cache/notify behavior (incl. Prisma-mirror-empty/stale-terminal paths); hardened swing tests for deterministic mirror-empty behavior and async flush cleanup.

## Verification (in-session)
- **Targeted Jest:** 174/174 pass (`dailyRecommendationService` 58, `swingRecommendationService` 68, `swingPerformanceService` 27, `recommendationsPlanLimitFallbacks` 21). Prior full-suite checkpoint this session reached **2145 pass / 4 skip / 0 fail / 141 suites** after fixes; re-run full suite before merge/CI as needed.
- **Lint:** `npm run lint` — 0 errors, 1227 pre-existing warnings.
- **TypeScript:** `npx tsc --noEmit` — 46 errors (baseline-aware; no Spec 43-modified production/service/component or non-test errors identified).
- **Doc budget:** `node scripts/dev-checks/check-doc-sizes.mjs` — OK (95.7 KB / 100 KB injected total).
- **Build:** `npm run quickbuild` — run as commit gate (see commit/CI evidence).
- **UI evidence:** local Playwright/screenshot capture attempted; dev environment had DB-unavailable errors and produced limited evidence (`e2e-screenshots/spec43/error.png`).

## Notes / follow-up
- No push/merge/deploy in this step; user controls merge/deploy. `WORKER_DISPATCH_SECRET` must be set in Netlify dashboard before deploy (Spec 42 carry-forward).
- Track 1–4 (outbound notification tracking/persistence/admin + deploy-prep/worker fixes) and Archify/Graphify diagram tooling are sequenced after Spec 43 commit per user direction.
- S2 prod Prisma-Remote read-only diagnostics remain blocked pending approval/tool access.
