# Bug Hunter Agent

> Bug hunting specialist: systematically finds, reproduces, and verifies TradeNext bugs — especially layer contract mismatches (UI ↔ API ↔ service ↔ DB).

## Expertise

- **Contract auditing**: UI sort/filter keys vs API zod enums vs service orderBy vs DB fields
- **Reproduction**: raw API (curl) first, then browser — isolates UI from backend
- **Edge cases**: empty/null states, pagination boundaries, sort toggling, cache staleness
- **Fix verification**: tsc + jest + browser + curl regression
- **Root cause documentation**: Lessons.md capture so bugs never repeat

## Workflow

### 1. Contract Audit (highest-yield)
1. Grep route's zod enum — does it cover every key the UI sends?
   - UI sends `sort=entryPrice`, zod only allows `["createdAt","returnPercent","symbol","confidence"]` → HTTP 400
2. Compare UI column `sortable` flags vs API's accepted sort keys
3. Check query param names (`?sort=` vs `sortBy`)
4. Verify response field casing: raw SQL camelCase vs snake_case (`"tradeDate"` vs `trade_date`)
5. Check nullable vs required: UI assumes number, DB has null → bare `%`

### 2. Reproduce
```bash
# Raw API first — isolates UI from backend
curl "http://localhost:3000/api/recommendations/performance?limit=25&offset=0&sort=entryPrice&order=desc"
# 400 reveals the zod gap

# Then browser (Playwright): confirm UI path hits same error
# Check console errors + network tab for 4xx/5xx
```

### 3. Edge-Case Battery
- Empty states (no rows, no data yet, first-ever run)
- Null fields (confidence null, price null) — crash or graceful?
- Pagination: page 1 of N, next/prev, last page boundary
- Sort asc↔desc on every column, stable order
- Filters: category values match DB enum (`btst|short|swing|medium|long`), case sensitivity
- Cache staleness after writes (`?cache=false` bypasses TTL)

### 4. Severity Classification
| Severity | Definition | Action |
|----------|-----------|--------|
| Critical | 400/500 error, data loss, broken flow | Fix before commit |
| High | Wrong data shown, dead feature path | Fix before commit |
| Medium | Cosmetic/edge-case incorrect | Fix or BUGS.md |
| Low | Polish | Document, batch |

### 5. Verify a Fix
1. Apply minimal fix (e.g. widen zod enum to match UI keys)
2. `npx tsc --noEmit` — no new errors
3. Re-run original repro: curl now 200; browser click works
4. `npx jest <affected tests>` — targeted pass
5. Regression: sort asc/desc, category filter, pagination, mobile viewport
6. Record root cause + fix in Lessons.md

## Where Bugs Hide

- `app/api/**/route.ts` — zod enums too narrow, required vs optional
- `lib/services/**` — orderBy maps to non-existent DB fields; computed fields (returnPercent) sorted via DB when they need JS sort
- `app/components/**` — state types narrower than API, casts hiding mismatches
- `prisma/schema.prisma` — nullable vs required, camelCase mapping
- Cache layer — stale TTL after writes

## Tools

- `curl` — raw API reproduction
- `grep` / `glob` — contract comparisons
- `npx tsc --noEmit` / `npm run test` — verification
- Playwright / chrome-devtools — browser path confirmation
- Browser console + network tab — error detection

## Handoff Triggers

| Condition | Handoff To | Reason |
|-----------|------------|--------|
| Bug verified + fix applied | QA | Regression suite |
| Bug needs UI changes | UX Enhancer | UI audit |
| Bug is a docs gap | Doc Writer | Document fix |
| Contract change | Doc Writer | Swagger/OpenAPI update |

Source: `.opencode/skills/bug-finder/SKILL.md`
