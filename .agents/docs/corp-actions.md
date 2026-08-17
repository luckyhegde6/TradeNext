# Corporate Actions (dedup fix v1.10.1, NSE field fix v1.10.5, enhanced v1.4.0, mgmt v1.3.0)

> Legacy feature deep-dive. Index: [../CHANGELOG.md](../CHANGELOG.md).

## Corporate Actions Deduplication Fix (v1.10.1)

### Problem
Corporate Actions table showed duplicate entries for the same symbol and ex-date:
```
VESUVIUS   30-APR-2026
VESUVIUS   30-APR-2026  (duplicate)
SCHAEFFLER 23-APR-2026
SCHAEFFLER 23-APR-2026  (duplicate)
```

### Root Cause
1. **Deduplication mismatch**: Code checked `symbol + exDate` but schema unique constraint is `symbol + actionType + exDate`
2. **Timezone inconsistency**: Date parsing created dates at midnight local time, causing timezone mismatches
3. **Multiple sync paths**: Different sync functions had inconsistent deduplication logic

### Solution
1. **Fixed date parsing**: All `parseNseDate` functions now create dates at noon UTC:
   ```typescript
   new Date(Date.UTC(parseInt(yr), month, parseInt(dd), 12, 0, 0, 0))
   ```

2. **Fixed deduplication**: All sync functions now use Prisma `upsert` with correct unique constraint:
   ```typescript
   await prisma.corporateAction.upsert({
     where: {
       symbol_actionType_exDate: { symbol, actionType, exDate }
     },
     update: { ... },
     create: { ... }
   });
   ```

### Files Changed
- `app/api/corporate-actions/combined/route.ts` - Fixed date parsing and upsert
- `app/api/admin/nse/live-sync/route.ts` - Fixed date parsing and upsert
- `app/api/admin/corporate-actions/route.ts` - Fixed date parsing and upsert
- `app/api/admin/nse/historical/route.ts` - Fixed date parsing (already had upsert)
- `lib/services/sync-service.ts` - Fixed to use upsert

### Cleanup SQL (for existing duplicates)
```sql
-- View duplicate counts
SELECT symbol, "actionType", "exDate", COUNT(*) as cnt
FROM corporate_actions
GROUP BY symbol, "actionType", "exDate"
HAVING COUNT(*) > 1;

-- Delete duplicates (keep the newest record)
DELETE FROM corporate_actions a
USING corporate_actions b
WHERE a.id < b.id
  AND a.symbol = b.symbol
  AND a."actionType" = b."actionType"
  AND a."exDate" = b."exDate";
```

---

## Corporate Actions NSE Field Fix (v1.10.5)

### Problem
- Corporate actions sync saved all records with `actionType = "OTHER"`
- Company names were empty, record dates missing
- Dividend amounts showing "-"

### Root Cause
NSE API returns lowercase field names but code looked for uppercase:
- `subject` vs `PURPOSE` / `purpose`
- `comp` vs `COMPANY NAME`
- `recDate` vs `RECORD DATE`
- `faceVal` vs `FACE VALUE`

### Solution
Fixed field mappings in both routes:

```typescript
// Before (WRONG)
const purpose = item.PURPOSE || item.purpose || '';
const companyName = item['COMPANY NAME'] || item.companyName || "";

// After (CORRECT)
const purpose = item.PURPOSE || item.purpose || item.subject || '';
const companyName = item['COMPANY NAME'] || item.companyName || item.comp || "";
```

Also fixed dividend amount field name mismatch:
```typescript
// Before (WRONG)
dividendPerShare: action.dividendAmount,

// After (CORRECT)
dividendPerShare: action.dividendPerShare ?? action.dividendAmount ?? null,
```

### Files Changed
- `app/api/admin/nse/live-sync/route.ts` - Added lowercase field mappings
- `app/api/corporate-actions/combined/route.ts` - Added lowercase field mappings
- `app/components/analytics/CorporateActionsTable.tsx` - Added Subject, FV, Price columns to Upcoming Actions

### NSE API Field Names
| Field | NSE API | Code Was Looking For |
|-------|---------|---------------------|
| Purpose | `subject` | `PURPOSE`, `purpose` |
| Company | `comp` | `COMPANY NAME`, `companyName` |
| Record Date | `recDate` | `RECORD DATE`, `recordDate` |
| Face Value | `faceVal` | `FACE VALUE`, `faceValue`, `FV`, `fv` |

---
