# v3.15.0 — Closed IPOs with current prices + IPO analysis TTL cleanup + pipeline redesign (HOLDs collapsible)

**Date:** Aug 17 2026

**Summary:** Closed IPOs section with current prices + gain/loss, IPO analysis TTL cleanup (90-day retention), pipeline redesign (top-100 market cap → AI → top-50 actionable + collapsible HOLDs), IPO analysis cache-hit monitoring visibility.

---

## Pipeline Redesign

### selectTopByMarketCap — Top 100 before AI

- New function `selectTopByMarketCap(results: ScreenerResult[], limit: number)` in `dailyRecommendationService.ts`
- Sorts by `marketCap` descending, returns top 100 (configurable)
- Called after all screeners complete, before AI analysis
- Previously: AI analyzed ALL screener results (potentially 500+)

### rankActionableByConfidence — Top 50 BUY/SELL

- New function `rankActionableByConfidence(results: StockAnalysisResult[])` in `dailyRecommendationService.ts`
- Filters to BUY + SELL only (excludes HOLD)
- Sorts by confidence descending
- Returns top 50 (configurable via `MAX_RECOMMENDABLE_STOCKS`)
- HOLDs stored but shown separately in UI

### Config

- `MAX_AI_STOCKS = 100` — stocks sent to AI
- `MAX_RECOMMENDABLE_STOCKS = 50` — actionable picks shown

### Files Changed

- `lib/services/dailyRecommendationService.ts` — new functions + pipeline flow
- `app/components/recommendations/DailyPicksTab.tsx` — `showHolds` toggle + separate HOLD section

---

## IPO Analysis Cache-Hit Monitoring

### Problem

Cache hits (12h TTL) produced zero `trackAiCall` records → invisible in monitoring.

### Fix

Added `trackAiCall({action:"ipo_analysis_served", model:"cache"})` at:

- Memory cache hit path
- DB cache hit path

Fresh AI generations still record their actual model.

### Files Changed

- `lib/services/ipoAnalysisService.ts` — `trackAiCall` calls at cache hit paths

---

## IPO Analysis Pre-Warm

### executeIpoAnalysisPrewarm

- Runs as non-fatal step at end of `executeMarketDataSync()`
- Iterates active IPOs (status === "Active")
- Calls `getIpoAnalysis({symbol, analyze: false})` to warm cache
- Standalone `ipo_analysis_prewarm` task type for manual trigger

### Files Changed

- `lib/services/worker/worker-service.ts` — `executeIpoAnalysisPrewarm()` + switch case
- `app/api/admin/cron/route.ts` — TASK_TYPES updated
- `app/api/admin/workers/route.ts` — TASK_TYPES updated

---

## Closed IPOs API

### GET /api/recommendations/ipos/closed

- Filters IPOs with `status === "Closed"` + `issueEndDate` within last N days (default 30)
- Batch-fetches current prices via `getStockQuote()`
- Computes `gainPercent` from `parsePriceBandLow(issuePrice)` vs current `lastPrice`
- 1h memory cache
- Dynamic import for `getStockQuote` to keep route lightweight

### Files Created

- `app/api/recommendations/ipos/closed/route.ts`

---

## IPO Analysis TTL Cleanup

### cleanStaleIpoAnalysisRows

- Deletes `MarketCache` rows with `dataType="ipo_analysis"` + `lastSyncedAt < 90 days ago`
- Wired into `executeMarketDataSync()` as non-fatal step (after pre-warm)
- Standalone `ipo_analysis_cleanup` task type for manual trigger
- Admin cron + workers routes updated with new task type

### Files Changed

- `lib/services/ipoAnalysisService.ts` — `cleanStaleIpoAnalysisRows()` (lines ~812-845)
- `lib/services/worker/worker-service.ts` — `executeIpoAnalysisCleanup()` + switch case + wired into market-sync
- `app/api/admin/cron/route.ts` — TASK_TYPES updated
- `app/api/admin/workers/route.ts` — TASK_TYPES updated

---

## Closed IPOs UI

### IposTab.tsx Rewritten

- Main table shows only Active + Forthcoming IPOs (via `MAIN_SECTIONS`)
- Closed IPOs rendered in separate collapsible "Recently Closed IPOs" section
- Lazy-loaded on expand (fetches from `/api/recommendations/ipos/closed?days=30`)
- Shows current price + gain/loss % with color-coded `GainPill` component
- Empty state for no recently closed IPOs

### Files Changed

- `app/components/recommendations/IposTab.tsx` — rewritten with `MAIN_SECTIONS` filter + collapsible closed section + `GainPill` + `formatPrice`

---

## Tests

### NEW: closedIpoPrices.test.ts (18 tests)

- `parsePriceBandLow` — standard format, comma format, empty/null
- `calcGainPercent` — positive gain, negative loss, null cases, breakeven, rounding
- `parseIssueDate` — DD-MMM-YYYY parsing, invalid formats
- `isWithinDays` — within window, outside window, invalid date, today

### Extended: ipoAnalysisService.test.ts (+3 tests)

- `cleanStaleIpoAnalysisRows` — deletes rows older than retention, returns 0 on DB error, returns 0 when no stale rows

### Extended: ipoAnalysisPrewarm.test.ts (5 pre-warm tests)

- Pre-warm calls getIpoAnalysis for each active IPO
- Pre-warm skips non-Active IPOs
- Pre-warm continues on individual IPO failure
- Pre-warm returns count of warmed IPOs
- Pre-warm handles empty IPO list

### Suite

- **787 pass / 4 skip** (was 758/4, +29 new tests)
- tsc 46 = exact baseline, 0 new errors

---

## Live Verification

- Dev server on :3000
- Pipeline: 30 Total / 16 Buy / 5 Hold / 9 Sell
- HOLDs collapsed by default
- IPOs tab: 4 Active + 1 Upcoming
- AI Analysis modal opens and triggers API
- `ipo_analysis: 2 (29%)` visible in AI monitoring

---

## Specs & Plans

- `.agents/specs/pipeline-top100-confidence.md` — pipeline redesign spec (approved)
- `.agents/plans/pipeline-top100-confidence.md` — pipeline redesign plan (approved)
- `.agents/specs/closed-ipos-ttl-cleanup.md` — closed IPOs spec (approved)
- `.agents/plans/closed-ipos-ttl-cleanup.md` — closed IPOs plan (approved)
