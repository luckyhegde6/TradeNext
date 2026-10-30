## Current (2026-10-30 — AI fallback targets for Swing + Daily Recommendations)

- [x] **Create `lib/services/ai/fallbackAnalysis.ts`** — pure technical-analysis fallback target/SL calculation using momentum20, volatility20, distanceFrom20dHigh, changePercent; direction-aware via `evaluateRecommendationLevels`
- [x] **Modify `lib/services/ai/swing-agent.ts`** — replace `getDefaultSwingAnalysis` (OBSERVE, success:false) with `calculateFallbackSwingAnalysis` (directional, success:true) so targets show and analysisStatus becomes "done"
- [x] **Modify `lib/services/ai/recommendation-agent.ts`** — replace `getDefaultRecommendation` (HOLD, success:false) with `calculateFallbackRecommendation` (directional, success:true) so daily picks persist with targets
- [x] **Modify `lib/services/dailyRecommendationService.ts`** — remove the all-fail early-return that discards the run; fallback results now succeed so the run completes normally
- [x] **Add/update tests** for fallback analysis + agent integration — 113 tests pass
- [x] **Verify**: tsc (prod 0), Jest (fallback + swing + daily suites), eslint
- [x] **Document**: agent-memory.md, Primer.md, session-todos.md
