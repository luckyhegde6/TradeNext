# NSE API Integration Skill

Workflow for integrating with NSE (National Stock Exchange of India) APIs and TradingView.

## NSE API Pattern

```typescript
import { nseFetch } from "@/lib/nse-client";

// Use nseFetch for all NSE API calls
const data = await nseFetch("/api/endpoint", "?param=value");
```

## Type Safety

Always cast external API responses to `unknown` first, then narrow:

```typescript
const rawData = await nseFetch("/api/NextApi/GetQuote", qs) as unknown;
const data = rawData as { metaData?: any };

// Then parse safely
const price = parseFloat(data.metaData?.lastPrice || 0);
```

## Caching

Use the centralized cache system:

```typescript
import { enhancedCache, nseCache } from "@/lib/enhanced-cache";

const cacheConfig = nseCache.stockQuote(symbol);
const data = await enhancedCache.getWithCache(cacheConfig, fetchFn);
```

## Error Handling

Always log with context and return safe defaults:

```typescript
try {
  return await fetchQuote();
} catch (e) {
  logger.error({ msg: 'Failed to fetch quote', symbol, error: e });
  return null;
}
```

---

## TradingView Screener Integration

TradingView provides a public screener API for NSE stocks.

### API Endpoint
```
POST https://scanner.tradingview.com/india/scan?label-product=screener-stock
```

### Working Fields (Tested March 2026)
```typescript
const columns = [
  "name",           // Stock name
  "close",          // Current price
  "change",         // Price change
  "volume",         // Trading volume
  "market_cap_basic", // Market capitalization
  "price_earnings_ttm", // P/E ratio
  "dividend_yield_recent", // Dividend yield %
  "sector",         // Industry sector
  "industry",       // Specific industry
  "price_book_ratio", // P/B ratio
  "relative_volume_10d_calc", // Relative volume
  "return_on_equity_fq", // ROE %
  "debt_to_equity_fq", // D/E ratio
];
```

### Invalid Fields (Do NOT Use)
- `perf.W`, `perf.M` (performance metrics)
- `beta_1_year`, `beta`
- `technical_rating`
- `change_percent`

### Response Mapping
When mapping column indices, use 0-based indexing:
```typescript
return {
  symbol: item.s,
  name: getVal(0),           // index 0
  close: item.d[1],          // index 1
  change: item.d[2],         // index 2
  volume: item.d[3],         // index 3
  market_cap: item.d[4],     // index 4
  pe: item.d[5],             // index 5
  // etc.
};
```

### Usage in Screener
```typescript
import { scanStocks } from "@/lib/services/tradingview-service";

// Fetch directly from TradingView
const stocks = await scanStocks({
  filter: [{ left: "exchange", operation: "equal", right: "NSE" }],
  range: { from: 0, to: 2000 },
});
```

### Common Issues
1. **Unknown field errors**: Check that field names are correct (case-sensitive)
2. **Empty data**: The API may reject requests with too many columns
3. **CORS**: Works from server-side, not directly from browser

