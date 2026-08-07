# Bug Finder Skill

Systematic bug hunting and verification for TradeNext — especially contract mismatches between layers (UI ↔ API ↔ service ↔ DB).

## 1. Contract audit (highest-yield)

- **UI sort/filter keys vs API zod enums**: UI sends `sort=entryPrice`, zod only allows `["createdAt","returnPercent","symbol","confidence"]` → HTTP 400.
- **UI column metadata vs service return shape**: columns marked `sortable: true` that the API rejects.
- **Query param names**: UI sends `?sort=` but route reads `sortBy`.
- **Response field casing**: raw SQL camelCase vs snake_case (`"tradeDate"` vs `trade_date`).
- **Nullable vs required**: UI assumes a field is a number, DB has null → bare `%`.

## 2. Reproduction protocol

```
1. Raw API first (curl) — isolates UI from backend:
   curl "http://localhost:3000/api/...?sort=entryPrice&order=desc" → 400 reveals zod gap.
2. Browser (Playwright) — confirm UI path hits same error.
3. Console errors + network tab (4xx/5xx).
4. Verify DB state assumption (tsx script / prisma studio).
```

## 3. Edge-case battery

Empty states, null fields, pagination boundaries (page 1 of N, next/prev, last), sort asc↔desc on every column, filter values match DB enums, cache staleness after writes (`?cache=false`).

## 4. Severity

| Severity | Definition | Action |
|----------|-----------|--------|
| Critical | 400/500, data loss, broken flow | Fix before commit |
| High | Wrong data, dead feature path | Fix before commit |
| Medium | Cosmetic/edge-case | Fix or BUGS.md |
| Low | Polish | Document, batch |

## 5. Verify a fix

1. Apply fix (e.g. widen zod enum).
2. `npx tsc --noEmit` — no new errors.
3. Re-run original repro: curl 200 + browser works.
4. `npx jest <affected tests>`.
5. Regression: sort asc/desc, category filter, pagination, mobile.
6. Record root cause in Lessons.md.

## 6. Where bugs hide

`app/api/**/route.ts` (zod enums too narrow), `lib/services/**` (orderBy → non-existent DB fields; computed fields sorted via DB when they need JS sort), `app/components/**` (state types narrower than API), `prisma/schema.prisma` (nullable vs required, casing), cache layer (stale TTL).

Source: `.opencode/skills/bug-finder/SKILL.md`
