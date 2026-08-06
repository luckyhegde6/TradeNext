# Pattern: Hybrid API Fallback

## Problem
External APIs (Chartink, TradingView, etc.) may be unreliable, have rate limits, or change without notice.

## Solution
Implement a fallback chain: try primary API first, fall back to equivalent data source on failure.

## Example (Chartink → TradingView)
```typescript
async function runScreener(screenerId: string): Promise<StockResult[]> {
  try {
    // Try Chartink API first
    const chartinkResults = await chartinkService.runScreener(screenerId);
    if (chartinkResults.length > 0) return chartinkResults;
  } catch (e) {
    logger.warn({ msg: 'Chartink failed, falling back to TradingView', screenerId, error: e });
  }
  
  // Fallback to TradingView templates
  const templateId = screenerToTemplateMap[screenerId];
  return await tradingviewService.advancedScan(templateId);
}
```

## Trade-offs
- **Pros**: Higher reliability, graceful degradation
- **Cons**: More code to maintain, potential data inconsistency between sources

## When to Use
- Primary API has uptime issues
- Data is available from multiple sources
- User experience depends on data availability

## Anti-patterns
- Don't use fallback as excuse for not fixing primary API
- Don't silently swallow errors — always log the fallback trigger
