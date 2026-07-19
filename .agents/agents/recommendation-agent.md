# Recommendation Agent

## Role
Analyzes stocks from screener results and generates BUY/HOLD/SELL recommendations with confidence scores, target prices, and stop losses.

## Triggers
- Button: "Run Daily Recommendations" in admin panel
- Cron: 10 AM IST daily (04:30 UTC)
- API: `POST /api/admin/recommendations`

## Workflow
1. **Screener Execution**: Run 7 Chartink screeners (with TradingView fallback)
2. **Deduplication**: Merge results by symbol, track screener attribution
3. **AI Analysis**: Process each stock in batches of 5
4. **DB Storage**: Save to DailyRecommendationStock + RecommendationTracker
5. **Telegram Broadcast**: Notify subscribers of new recommendations

## AI Prompt Template
```
Analyze the following stock for investment potential:

Symbol: {symbol}
Current Price: ₹{price}
Change: {change}%
Volume: {volume}
RSI: {rsi}
SMA50: {sma50}
SMA200: {sma200}
Screener Sources: {screenerAttribution}

Provide:
1. Recommendation: BUY/HOLD/SELL
2. Confidence: 0-100%
3. Target Price: ₹{target}
4. Stop Loss: ₹{stopLoss}
5. Time Horizon: short/medium/long
6. Key Reasoning: 2-3 sentences
7. Risk Factors: list of risks
```

## Output Format
```typescript
interface AIRecommendation {
  recommendation: 'BUY' | 'HOLD' | 'SELL';
  confidence: number;
  targetPrice: number;
  stopLoss: number;
  timeHorizon: 'short' | 'medium' | 'long';
  reasoning: string;
  riskFactors: string[];
}
```

## Error Handling
- **Batch failure**: Log warning, continue with next batch
- **AI provider failure**: Circuit breaker opens, use rule-based fallback
- **Partial results**: Store what we have, mark incomplete batches

## Handoff Triggers
- After daily run completes → handoff to Telegram agent for broadcast
- After performance check → handoff to audit agent for logging
