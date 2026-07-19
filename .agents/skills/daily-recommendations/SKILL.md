# Daily Recommendations Engine Skill

## Overview
Manages the daily stock recommendation pipeline: Chartink screeners → deduplication → AI analysis → database storage → Telegram broadcast.

## Key Files
| File | Purpose |
|------|---------|
| `lib/services/chartinkService.ts` | Chartink API + TradingView fallback |
| `lib/services/dailyRecommendationService.ts` | Orchestration service |
| `lib/services/ai/recommendation-agent.ts` | AI analysis agent |
| `app/api/recommendations/route.ts` | Public API (latest) |
| `app/api/recommendations/history/route.ts` | Historical data |
| `app/api/recommendations/[symbol]/route.ts` | Stock detail |
| `app/recommendations/page.tsx` | Tabbed UI |

## Cron Schedule
- **Generation**: 10 AM IST (04:30 UTC) daily
- **Performance Tracking**: 3:30 PM IST (10:00 UTC) daily

## Data Flow
1. Chartink screeners run (7 screeners)
2. Results deduplicated by symbol
3. AI analyzes each stock (batches of 5)
4. Results stored in DB (DailyRecommendationStock + RecommendationTracker)
5. Telegram broadcast to subscribers

## Key Patterns
- **Hybrid Fallback**: Try Chartink API first, fall back to TradingView templates
- **Batch Processing**: AI processes 5 stocks at a time to stay within token limits
- **Deduplication**: Track screenerAttribution (which screeners found each stock)
- **Tracker Entity**: RecommendationTracker (long-lived) vs DailyRecommendationStock (per-run)

## Screeners (7)
1. Short Term Breakouts (tpl_27)
2. RSI Overbought/Oversold (tpl_11+12)
3. BOSS Scanner BTST (tpl_57)
4. Bullish Momentum (tpl_50)
5. Bullish Marubozu 15min (tpl_40)
6. Potential Breakouts (tpl_28)
7. First 15min Breakout (tpl_33)

## AI Output Schema
```typescript
{
  recommendation: 'BUY' | 'HOLD' | 'SELL';
  confidence: number; // 0-100
  targetPrice: number;
  stopLoss: number;
  timeHorizon: 'short' | 'medium' | 'long';
  reasoning: string;
  riskFactors: string[];
}
```

## Testing
- Unit tests: `lib/__tests__/chartinkService.test.ts`
- Unit tests: `lib/__tests__/dailyRecommendationService.test.ts`
- Unit tests: `lib/__tests__/recommendation-agent.test.ts`
