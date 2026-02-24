# NSE API Integration Skill

Workflow for integrating with NSE (National Stock Exchange of India) APIs.

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
