# Plan — Closed IPOs Section + TTL Cleanup

> Based on spec: `.agents/specs/closed-ipos-ttl-cleanup.md`

## Steps

### Step 1: New API endpoint `GET /api/recommendations/ipos/closed`
- Create `app/api/recommendations/ipos/closed/route.ts`
- Filter `getUpcomingIpoIssues()` for `status === "Closed"` + `issueEndDate` within last N days (default 30)
- Batch-fetch current prices via `getStockQuote()` (dynamic import, chunked 10, `Promise.allSettled`)
- Compute `gainPercent` from price band low vs current price
- Memory-cache result 1h (`IPO_CLOSED_CACHE_TTL = 3600`)
- Verify: `npx tsc --noEmit`

### Step 2: TTL cleanup function
- Add `cleanStaleIpoAnalysisRows()` to `ipoAnalysisService.ts`
- Deletes `MarketCache` rows: `dataType = "ipo_analysis"` + `lastSyncedAt < 90 days ago`
- Returns deleted count for logging
- Wire into `worker-service.ts` `executeMarketDataSync()` as step 5 (non-fatal)
- Add `ipo_analysis_cleanup` switch case in `worker-service.ts`
- Add to admin TASK_TYPES in `cron/route.ts` and `workers/route.ts`
- Verify: `npx tsc --noEmit`

### Step 3: UI — Collapsible Closed section with current prices
- Modify `IposTab.tsx`:
  - Add `closedIssues` state + `fetchClosedPrices()` effect (calls new `/api/recommendations/ipos/closed`)
  - Add `showClosed` state (default `false` = collapsed)
  - Closed section: collapsible header with toggle, "Current" and "Gain/Loss %" columns
  - Current price formatted as ₹, gain % green/red colored
  - Don't render section if 0 closed IPOs
  - Remove Closed rows from the main flat table (they now render in their own section)
- Verify: `npx tsc --noEmit`

### Step 4: Tests
- `lib/__tests__/closedIpoPrices.test.ts` — gain % calculation, graceful price fallback, date filtering
- `lib/__tests__/ipoAnalysisService.test.ts` — +2 tests for cleanup function
- `npm run test` — full suite passes

### Step 5: Documentation
- Update AGENTS.md version table + `.agents/CHANGELOG.md`
- Update `@Primer.md`, `@agent-memory.md`

### Step 6: Commit (on user request)
- All pending changes: pipeline redesign + IPO monitoring + Closed IPOs + TTL cleanup
