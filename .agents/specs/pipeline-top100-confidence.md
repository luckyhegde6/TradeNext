# Spec: Daily Recommendation Pipeline Redesign

**Date**: 2026-08-18
**Status**: DRAFT
**Branch**: feat/recs-pipeline-v2

## Problem

1. Current pipeline sends only 50 stocks to AI, ranked by composite score (screenerCount + marketCap + momentum). This misses high-confidence picks that rank lower on screener agreement.
2. AI model `nvidia/nemotron-3-ultra-550b-a55b:free` returns errors → all HOLD runs. Fallback chain not triggered properly.
3. All 50 picks are HOLD when AI fails, with no visual separation between actionable (BUY/SELL) and non-actionable (HOLD) picks.

## Proposed Changes

### 1. Pipeline Redesign (`dailyRecommendationService.ts`)

**Current flow:**
```
Screener (600+) → rankAndCapRecommendations (top 50 by composite) → AI analyze 50 → persist
```

**New flow:**
```
Screener (600+) → sort by market cap (top 100) → AI analyze 100 → separate BUY/SELL from HOLDs → rank BUY/SELL by confidence (top 50) → persist
```

Key changes:
- Remove `rankAndCapRecommendations` at step 2
- Add `selectTopByMarketCap(results, 100)` — sort by marketCap descending, take top 100
- Increase `MAX_AI_STOCKS` from 50 to 100
- After AI analysis, partition into `actionable` (BUY/SELL) and `holdOnly` (HOLD)
- Rank `actionable` by confidence descending, take top 50
- Store ALL 100 stocks (including HOLDs) but mark top 50 as `isTopPick: true`
- Today's Picks shows top 50 (BUY/SELL) in main grid, HOLDs in collapsible section

### 2. AI Fallback Fix (`recommendation-agent.ts`, `config.ts`)

**Root cause**: Pre-flight gate runs `runAiConnectionTest(120s)` → model returns error → status "failed" → `skipAi = true` → all HOLD.

**Fix**:
- In `analyzeBatch`, when primary model throws, ensure fallback chain (`openrouter/free` → `openrouter/auto`) is actually attempted
- Log which model was used for each batch (already done via `trackAiCall`)
- If ALL models fail, then `holdFallback` kicks in (existing behavior)

### 3. UI Changes (`DailyPicksTab.tsx`)

- Main grid shows top 50 (BUY/SELL only, sorted by confidence)
- Collapsible "HOLDs" section below with N HOLD picks
- Summary cards updated: "50 Buy/Sell · 50 Hold" instead of "50 Hold"

## Files to Modify

| File | Change |
|------|--------|
| `lib/services/dailyRecommendationService.ts` | Pipeline redesign (top 100 by market cap, confidence ranking) |
| `lib/services/ai/recommendation-agent.ts` | Fallback chain verification |
| `lib/services/ai/config.ts` | Verify model chain includes fallbacks |
| `app/components/recommendations/DailyPicksTab.tsx` | Separate HOLD section |
| `lib/__tests__/dailyRecommendationService.test.ts` | Update tests for new pipeline |

## Out of Scope

- Changing the AI model itself (nvidia/nemotron is the user's choice)
- Changing the 7 screener templates
- Modifying the Swing tab pipeline

## Success Criteria

1. Pipeline sends top 100 stocks (by market cap) to AI
2. AI fallback chain works when primary model fails
3. Today's Picks shows BUY/SELL in main grid, HOLDs in separate section
4. All existing tests pass
5. Live-verified on tradenext6.netlify.app
