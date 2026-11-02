## Current (2026-11-02 — Spec 36: AI-down actionable picks + duplicate daily-notice fix)

- [x] **Spec 36 created** — `.agents/specs/36-ai-down-actionable-picks-dedup.md` + plan `.agents/plans/36-ai-down-actionable-picks-dedup.md` (approved by user; Phase D added per follow-up directive "also fix for the SWING target generation and Stock ai analysis").
- [x] **Phase A** — AI failure-mode handling: NEW `isAiCreditExhaustionMessage` in `lib/services/ai/quotaLatch.ts`; agent latches day on `isDailyFreeQuotaMessage || isAiCreditExhaustionMessage`; connection-test surfaces `quotaExhausted`. Jest `quotaLatch` + `recommendation-agent` green (53 tests).
- [x] **Phase B** — Duplicate-notice dedup: NEW in-process per-UTC-day suppression (`lastDailyRecNoticeDay`) at daily-recommendations completion broadcast; worker-engine catch-up dedup (Spec 30) verified green.
- [x] **Phase C** — AI-down actionable BUY/SELL broadcast: `buildRecommendationBroadcast(..., {aiDown})` + wiring in `dailyRecommendationService` (`aiDown: skipAi === true`). Jest `recommendationBroadcast` green (new AI-down tests).
- [x] **Phase D** — Swing/stock AI fallbacks verified: `calculateFallbackSwingAnalysis` / `calculateFallbackRecommendation` with `success:true` (tests green).
- [x] **Gates** — tsc 46 exact (0 new) on touched files · targeted Jest (8 suites / 286 tests) green · eslint 0 errors on changed files · doc-size gate PASS.
- [ ] **External**: OpenRouter credits/AI availability (user action) — remaining prod blocker; deploy pending user (D9).

## Previous (2026-10-30 — AI fallback targets for Swing + Daily Recommendations)

- [x] **Create `lib/services/ai/fallbackAnalysis.ts`** — pure technical-analysis fallback target/SL calculation using momentum20, volatility20, distanceFrom20dHigh, changePercent; direction-aware via `evaluateRecommendationLevels`
- [x] **Modify `lib/services/ai/swing-agent.ts`** — replace `getDefaultSwingAnalysis` (OBSERVE, success:false) with `calculateFallbackSwingAnalysis` (directional, success:true) so targets show and analysisStatus becomes "done"
- [x] **Modify `lib/services/ai/recommendation-agent.ts`** — replace `getDefaultRecommendation` (HOLD, success:false) with `calculateFallbackRecommendation` (directional, success:true) so daily picks persist with targets
- [x] **Modify `lib/services/dailyRecommendationService.ts`** — remove the all-fail early-return that discards the run; fallback results now succeed so the run completes normally
- [x] **Add/update tests** for fallback analysis + agent integration — 113 tests pass
- [x] **Verify**: tsc (prod 0), Jest (fallback + swing + daily suites), eslint
- [x] **Document**: agent-memory.md, Primer.md, session-todos.md
