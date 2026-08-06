---
name: nse-integration
description: Workflow for integrating with NSE India stock market APIs - use nseFetch, caching, and type safety
metadata:
  audience: developers
  workflow: api-integration
---

## API Pattern

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

## NSE Historical Data (Backtest + MCP)

### Endpoint
```
GET /api/historicalOR/generateSecurityWiseHistoricalData
  ?from=DD-MM-YYYY&to=DD-MM-YYYY&symbol=SYMBOL&type=priceVolumeDeliverable&series=ALL
```

### Fetcher (in `lib/nse-api.ts`, never call NSE from client)
```typescript
import { fetchSecurityWiseHistoricalData, securityWiseBarsToOHLCV } from "@/lib/nse-api";

const rows = await fetchSecurityWiseHistoricalData(symbol, "01-01-2021", "31-12-2025");
const bars = securityWiseBarsToOHLCV(rows, symbol);  // sorts by timestamp
```

### Response Fields (`SecurityWiseHistoricalRow`, all optional — validate)
`CH_SYMBOL`, `CH_SERIES` (EQ|BL), `mTIMESTAMP`/`CH_TIMESTAMP` (date), `CH_OPENING_PRICE`, `CH_HIGH_PRICE`, `CH_LOW_PRICE`, `CH_CLOSING_PRICE`, `CH_PREVIOUS_CLOSE_PRICE`, `VWAP`, `CH_TOT_TRADED_QTY`, `CH_TOT_TRADED_VAL`, `CH_TOTAL_TRADES`, `COP_DELIV_QTY`, `COP_DELIV_PERC`, optional `CA` (corporate actions array).

### Backtest Data Chain (ALWAYS use — never hit NSE directly for backtests)
```typescript
import { getBacktestData } from "@/lib/services/backtestDataService";

const { bars, dataSource } = await getBacktestData(symbol, fromDate, toDate);
// dataSource: "memory" (24h) | "db" (backtest_history temp table) | "daily_prices" (main, read-only) | "nse"
```

### Rules
- **NEVER write NSE-fetched bars to main `daily_prices`** — temp table `backtest_history` only (age-pruned at 30d).
- Memory `historicalCache` TTL 24h; temp-table unique key `[symbol, fromDate, toDate, series]`.
- MCP function `getHistoricalData` reuses `getBacktestData()` — one shared data path.

## Checklist Compliance

When working with NSE data:
- [ ] Server-side proxy only - no client calls to NSE
- [ ] Redis cache with TTL implemented
- [ ] Retry and backoff ] Rate limit respected configured
- [
- [ ] No secrets exposed in logs
