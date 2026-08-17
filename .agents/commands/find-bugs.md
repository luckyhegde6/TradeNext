# Find Bugs Command

> Hunt, reproduce, and verify TradeNext bugs — especially layer contract mismatches (UI ↔ API ↔ service ↔ DB).

## Usage

```
/find-bugs [target] [severity]
```

### Parameters

| Parameter | Required | Description | Values |
|-----------|----------|-------------|--------|
| `target` | - | What to audit | `contract` (default), `feature`, `api`, `all` |
| `severity` | - | Minimum severity to report | `critical` (default), `high`, `all` |

### Examples

```
/find-bugs                    # Contract audit, critical+high only
/find-bugs feature recs       # Audit recommendations feature end-to-end
/find-bugs api performance    # Audit performance API contract
/find-bugs all all            # Full sweep, all severities
```

## Workflow

### 1. Contract Audit (highest-yield)
1. Grep route zod enum vs UI sort/filter keys — mismatch → HTTP 400
   ```bash
   grep -n "z.enum" app/api/recommendations/performance/route.ts
   grep -n "sortBy" app/components/recommendations/PerformanceTab.tsx
   ```
2. Compare UI column `sortable` flags vs API accepted keys
3. Check query param names (`?sort=` vs `sortBy`)
4. Response field casing: raw SQL camelCase vs snake_case
5. Nullable vs required: UI assumes number, DB has null → bare `%`

### 2. Reproduce
```bash
# Raw API first — isolates UI from backend
curl "http://localhost:3000/api/...?sort=entryPrice&order=desc"
# 400 reveals the zod gap

# Then browser (Playwright): console + network tab
```

### 3. Edge-Case Battery
- Empty states (no rows, first-ever run)
- Null fields (confidence, price)
- Pagination boundaries (page 1 of N, next/prev, last)
- Sort asc↔desc every column, stable order
- Filter values match DB enums (`btst|short|swing|medium|long`)
- Cache staleness after writes (`?cache=false`)

### 4. Report
```markdown
## Bug Report: <Target>
### Critical / High
- [Bug] <description>
  - **Repro**: <curl or steps>
  - **Root cause**: ...
  - **Fix**: ...
  - **Status**: fixed / needs fix
### Medium / Low (documented in BUGS.md)
```

## Verification

- [ ] Raw API repro (curl) before browser
- [ ] Console + network errors checked
- [ ] Edge cases: empty/null/pagination/sort/filter/cache
- [ ] Fix verified: `npx tsc --noEmit` + `npx jest <affected>` + browser + curl
- [ ] Root cause recorded in @Lessons.md
