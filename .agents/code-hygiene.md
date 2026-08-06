# Code Hygiene Rules — TradeNext

> Clean, maintainable, minimal code. Follows ponytail's "lazy senior dev" philosophy: minimum code that solves the problem, nothing speculative.

## 1. Ponytail Rules (Minimal Code)

Before writing any code, ask in order:

```
1. Do we need this at all?                     (YAGNI — no speculative features)
2. Does the standard library do it?            (no new deps for what's built-in)
3. Does an installed dependency cover it?      (reuse, don't reinvent)
4. Native platform feature?                    (Node.js/Next.js built-ins)
5. One line?                                   (write the minimum that works)
6. Only then: the minimum that works
```

**Lazy, not negligent**: trust-boundary validation, data-loss handling, security, and accessibility are NEVER on the chopping block.

- If you write 200 lines and it could be 50, rewrite it.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- Ask: "Would a senior engineer say this is overcomplicated?"

## 2. File Size Limits

| Type | Max Lines | Action if Exceeded |
|------|-----------|--------------------|
| Component | 300 | Split into sub-components |
| Hook | 150 | Extract logic to utility |
| Utility | 200 | Split by responsibility |
| API route | 150 | Extract to service layer |
| Test file | 400 | Split by test group |

## 3. Function Complexity

| Metric | Limit | Action |
|--------|-------|--------|
| Lines per function | 50 | Extract helpers |
| Parameters per function | 5 | Use options object |
| Nesting depth | 3 | Use early returns |
| Cyclomatic complexity | 10 | Simplify logic |

## 4. Import Order (TradeNext)

```typescript
// 1. React hooks
import { useState, useEffect } from "react";
// 2. Third-party
import clsx from "clsx";
// 3. Internal from @/lib
import logger from "@/lib/logger";
// 4. Local imports
import { DataTable } from "./DataTable";
```

## 5. Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Component | PascalCase | `RecommendationCard.tsx` |
| Hook | camelCase + use | `useLivePrice.ts` |
| Utility | camelCase | `date-utils.ts` |
| Constant | UPPER_SNAKE | `MAX_RECOMMENDED_STOCKS` |
| Type/Interface | PascalCase | `StockQuote` |
| API route | kebab-case | `top-stocks/route.ts` |

## 6. Comment Rules

```typescript
// ✅ GOOD: Explain WHY
// Prefer tracker live price (updated by 3:30 PM check) over run snapshot
const price = s.tracker?.currentPrice ?? s.price;

// ❌ BAD: Explain WHAT (redundant)
// Set price
const price = s.price;
```

- TODO format: `// TODO(username): description`
- Comments explain WHY, not WHAT

## 7. Error Handling Patterns

```typescript
// ✅ GOOD: Non-critical work never breaks the run
recordPrediction({...}).catch((e) => {
  logger.warn({ msg: "Prediction tracking failed", error: e instanceof Error ? e.message : String(e) });
});

// ✅ GOOD: Return safe defaults on error
try {
  return await fetchData();
} catch (e) {
  logger.error({ msg: "Fetch failed", error: e instanceof Error ? e.message : String(e) });
  return [];
}

// ❌ BAD: Swallowing errors
try { await riskyOperation(); } catch (e) { /* ignore */ }

// ❌ BAD: Leaking internals to client
catch (e) { return NextResponse.json({ error: e.message }); }
```

## 8. TypeScript Rules

```
□ Strict mode enabled — do not disable
□ Explicit return types on exported functions
□ Use `unknown` for external API responses, then narrow with type guards
□ No `any` — use `unknown` or proper typing
□ Always parse strings: parseFloat(), parseInt()
```

## 9. Testing Standards

```typescript
// ✅ GOOD: Descriptive test names
test("caps AI analysis at MAX_AI_STOCKS (50)", async () => {
  // arrange → act → assert
  expect(result.aiProcessed).toBe(50);
});
```

- Tests live in `lib/__tests__/` or `app/components/*/__tests__/`
- Run with `npm run test`
- Update mocks when service internals change (e.g., `.catch()` fire-and-forget needs `mockResolvedValue`)

## 10. Git Hygiene

- See `.agents/linear-history.md` for commit messages + branch naming
- One logical change per commit
- Review `git status` before committing — no junk artifacts
- No `console.log` in production — use `logger` from `@/lib/logger`

## 11. Performance Checklist

```
□ Pagination applied to list APIs
□ No N+1 queries (pre-fetch, look up in-memory)
□ Batch DB operations (createMany/findMany, not N individual queries)
□ Parallelize independent queries (Promise.all)
□ Cache with TTL (lib/enhanced-cache) where applicable
□ No unnecessary re-renders
```
