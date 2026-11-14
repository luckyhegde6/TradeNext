---
name: bug-finder
description: Systematic bug hunting and verification workflow for TradeNext - audit API contracts (zod vs UI), test edge cases, verify fixes with curl/Playwright, classify by severity
metadata:
  audience: agents
  workflow: quality
---

# Bug Finder Skill

Systematic approach to finding, reproducing, and verifying TradeNext bugs — especially contract mismatches between layers (UI ↔ API ↔ service ↔ DB).

## 1. Contract audit (highest-yield)

Mismatches between layers are the most common bug class. Check every changed/fetched surface:

- **UI sort/filter keys vs API zod enums**: UI column `sortBy` sends `sort=entryPrice`, API zod only allows `["createdAt","returnPercent","symbol","confidence"]` → HTTP 400. Grep the route's zod enum, grep the UI state type, compare.
- **UI column metadata vs service return shape**: `getPerformanceColumns()` marks fields `sortable: true` that the API rejects.
- **Query param names**: UI sends `?sort=` but route reads `sortBy` (or vice versa).
- **Response field casing**: raw SQL with camelCase vs snake_case (`"tradeDate"` vs `trade_date`).
- **Nullable vs required**: UI assumes `confidence` is a number, DB has null → renders bare `%`.

## 2. Reproduction protocol

```
1. Reproduce via raw API first (curl) — isolates UI from backend:
   curl "http://localhost:3000/api/...?limit=25&offset=0&sort=entryPrice&order=desc"
   → expect 200; 400 reveals the zod gap.
2. Reproduce in browser (Playwright) — confirm the UI path hits the same error.
3. Check console for errors (console.error), network tab for 4xx/5xx.
4. Verify DB state matches assumption (npx tsx script or prisma studio).
```

## 3. Edge-case battery

- Empty states (no rows, no data yet, first-ever run).
- Null fields (confidence null, price null) — do they crash or render gracefully?
- Pagination: page 1 of N, next/prev, last page boundary.
- Sort toggling: asc↔desc on every column, stable order.
- Filters: category values match DB enum values (`btst|short|swing|medium|long`), case sensitivity.
- Cache staleness: after a write, does the UI show fresh data? (`?cache=false` to bypass TTL).

## 4. Severity classification

| Severity | Definition | Action |
|----------|-----------|--------|
| Critical | 400/500 error, data loss, broken flow | Fix before commit |
| High | Wrong data shown, dead feature path | Fix before commit |
| Medium | Cosmetic/edge-case incorrect | Fix or document in BUGS.md |
| Low | Polish | Document, batch |

## 5. Verification of a fix

```
1. Apply the fix (e.g. widen zod enum to match UI keys).
2. npx tsc --noEmit  — no new errors (ph20 files clean).
3. Re-run the original repro: curl now 200; browser click now works.
4. npx jest <affected tests> — targeted pass.
5. Regression: re-test sort asc/desc, category filter, pagination, mobile viewport.
6. Record root cause + fix in Lessons.md.
```

## 6. Where bugs hide

- `app/api/**/route.ts` — zod schemas (enums too narrow, required vs optional)
- `lib/services/**` — orderBy maps to DB fields that don't exist; computed fields (returnPercent) sorted via DB when they need JS sort
- `app/components/**` — state types narrower than API, casts that hide mismatches
- `prisma/schema.prisma` — nullable vs required, camelCase mapping
- Cache layer — stale TTL after writes

## Checklist

- [ ] Contract audit: UI keys ↔ zod enums ↔ service orderBy ↔ DB fields
- [ ] Raw API repro (curl) before browser
- [ ] Console + network errors checked
- [ ] Edge cases: empty/null/pagination/sort/filter/cache
- [ ] Fix verified: tsc + jest + browser + curl
- [ ] Root cause recorded in Lessons.md
