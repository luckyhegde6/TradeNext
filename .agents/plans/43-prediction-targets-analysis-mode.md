# Plan 43: Prediction Targets & Analysis Mode

**Spec**: `.agents/specs/43-prediction-targets-analysis-mode.md`  
**Branch**: `feature/spec-42-durable-worker-cron-v2` (current working branch; confirm with user if a separate branch is preferred)  
**Created**: 2026-11-15

## Preconditions (approval gates)
- [ ] User approves Spec 43 and this plan.
- [ ] User grants explicit permission for DB schema migration (Prisma + SQLite mirror) and data backfill changes.
- [ ] User grants permission to run tests/build/lint/typecheck and local dev verification as needed.

## Phase 0 — Documentation & session tracking
1. Add Spec 43 + Plan 43 with user decisions (done in docs step). 
2. Update `TODO.md` and `.agents/session-todos.md` with detailed implementation/backfill/verification tasks.
3. Maintain session `decisions.md` / `flow.md` for significant changes.

## Phase 1 — Schema & persistence plumbing
4. Add `analysisMode String?` to `DailyRecommendationStock`, `RecommendationTracker`, `SwingSignal` in `prisma/schema.prisma`.
5. Update SQLite mirror schema and read/write paths in `lib/sqlite.ts` and push sinks/mappings in `lib/sqlitePushSinks.ts` (and any mirror type definitions).
6. Create Prisma migration for the new columns; prepare idempotent backfill logic (historical rows with any target/analysis => `AI Targets`).
7. Regenerate Prisma client; validate schema/types.

## Phase 2 — Prediction/fallback correctness (no HOLD fallback, directional targets)
8. Update `lib/services/ai/fallbackAnalysis.ts` (and related types) so daily prediction fallback **never returns HOLD** (deterministic BUY/SELL with valid target/stop/confidence/reasoning) while allowing normal AI/rare-neutral HOLD cases outside fallback path. Ensure swing fallback always yields target-bearing analysis (LONG/SHORT/OBSERVE allowed).
9. Add/adjust unit tests for fallback directionality, level validity, and mode expectations.

## Phase 3 — Daily recommendations (persist mode, prediction when AI unavailable)
10. Update `lib/services/ai/recommendation-agent.ts` and `lib/services/dailyRecommendationService.ts` to assign per-stock `analysisMode` (`AI Targets` on AI success, `Prediction Targets` on fallback-filled/missing-AI paths), persist mode to daily stock + tracker records, and ensure AI-unavailable/partial flows produce usable prediction targets (no targetless fallback-HOLD rows).
11. Update daily APIs/broadcast/export/Sheets integration points to include `analysisMode` while keeping existing behavior compatible.
12. Add/update tests for daily pipeline, persistence, and API payloads.

## Phase 4 — Swing recommendations (auto prediction on load, no "AI targets off")
13. Update `lib/services/swingRecommendationService.ts` to auto-compute prediction targets/analysis for screener-only loads/results lacking targets so users see targets immediately (`Prediction Targets`), carry per-stock mode through job payloads/signals, and replace "AI targets off"/skipped-targetless UX semantics with prediction-ready mode-aware responses (preserve necessary compatibility/status fields).
14. When AI analysis completes, mark AI-analyzed stocks `AI Targets` and keep fallback-filled as `Prediction Targets`; patch persisted signals accordingly.
15. Align `SwingSignal` active/status contract so performance-evaluable signals are queried/updated correctly.
16. Update Swing UI components (`SwingTab`, `SwingCard`, related) to display mode and remove "AI targets off" messaging in favor of prediction/AI target labels.
17. Add/update tests (service + UI/API as applicable) including auto-prediction-on-load and per-stock mode.

## Phase 5 — Performance backfill + historical backfill
18. Update `checkSwingPerformance` / daily performance-check paths to generate & persist missing prediction targets/mode for eligible rows (bounded per run, idempotent) and to stamp `AI Targets` for historical rows with existing targets/analysis when encountered; then evaluate performance.
19. Add one-time idempotent backfill script/routine for historical `analysisMode="AI Targets"` on rows with any target/analysis (and safe prediction backfill where required), with audit/logging and bounds.
20. Add/update performance/backfill tests.

## Phase 6 — Verification & evidence
21. Run targeted tests for touched areas, then `npm run test` (as feasible), `npx tsc --noEmit`, `npm run lint`, `npm run quickbuild`.
22. Verify UI locally (Swing shows prediction targets immediately without "AI targets off"; daily shows mode) and capture before/after evidence if behavior changed from current branch state.
23. Update docs/changelog/session artifacts as required by repo rules once implementation is complete; prepare commit only on explicit user request.

## Risks / notes
- Bounded perf backfill limits must prevent long-running cron/admin jobs.
- SQLite mirror + Prisma schema + push sinks must stay consistent.
- Prediction-on-load must remain fast (calculation-based, no AI dependency).