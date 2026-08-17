# Plan: Daily Recommendation Pipeline Redesign

**Date**: 2026-08-18
**Spec**: `.agents/specs/pipeline-top100-confidence.md`
**Branch**: feat/recs-pipeline-v2

## Steps

### Step 1: Pipeline Redesign in `dailyRecommendationService.ts`
**Verify**: Read current `runDailyRecommendations` and `rankAndCapRecommendations`

1. Add `selectTopByMarketCap(results: ScreenerResult[], limit: number)` — sort by marketCap descending, take top N
2. Change `MAX_AI_STOCKS` from 50 to 100
3. Replace `rankAndCapRecommendations(screenerResults)` with `selectTopByMarketCap(screenerResults, 100)`
4. After AI analysis, partition results:
   - `actionable = successfulResults.filter(r => r.recommendation !== "HOLD")`
   - `holdOnly = successfulResults.filter(r => r.recommendation === "HOLD")`
5. Rank `actionable` by confidence descending, take top 50
6. Mark top 50 with `isTopPick: true` flag
7. Store ALL results (including HOLDs) for history/performance tracking
8. **Verify**: Run existing tests, ensure pipeline still completes

### Step 2: AI Fallback Chain Fix
**Verify**: Read `analyzeBatch` and `modelFallbackChain`

1. Read `lib/services/ai/config.ts` — verify `modelChain` includes fallbacks
2. Read `lib/services/ai/recommendation-agent.ts` — verify `modelFallbackChain` iterates through all models
3. If primary model fails, ensure fallback models are tried (not just skipped)
4. Add logging for which model was used per batch
5. **Verify**: Test with a mock that makes primary model fail, ensure fallback is attempted

### Step 3: UI — Separate HOLD Section
**Verify**: Read `DailyPicksTab.tsx`

1. Add `isTopPick` field to stock data type
2. Filter main grid to show only `isTopPick === true` stocks
3. Add collapsible "HOLDs (N)" section below main grid
4. Update summary cards: show "X Buy/Sell · Y Hold" instead of total
5. **Verify**: Playwright test — verify HOLDs appear in separate section

### Step 4: Tests
**Verify**: All existing tests pass

1. Update `dailyRecommendationService.test.ts` for new pipeline (top 100, confidence ranking)
2. Add test for `selectTopByMarketCap`
3. Add test for HOLD/BUY/SELL partitioning
4. Run full test suite
5. **Verify**: `npm run test` passes

### Step 5: Live Verification
**Verify**: Playwright on tradenext6.netlify.app

1. Navigate to Recommendations → Today's Picks
2. Verify main grid shows BUY/SELL only
3. Verify HOLDs appear in separate collapsible section
4. Verify summary cards show correct counts
5. **Verify**: 0 console errors
