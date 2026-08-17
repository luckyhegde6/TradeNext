# Spec — Closed IPOs Section + TTL Cleanup

## 1. Overview

**What**: Add a collapsible "Recently Closed IPOs" section below Upcoming on the IPOs tab, showing current stock price and gain/loss % vs issue price for IPOs closed in the last 30 days. Add TTL-based cleanup to remove stale IPO analysis data from the database.

**Why**: Users want to track post-listing performance of recently closed IPOs. The current IPO tab shows Closed IPOs in the same flat table with no current price or gain data. Old IPO analysis data accumulates in `MarketCache` indefinitely with no cleanup.

**Scope**: IN — Collapsible Closed IPOs section with current prices, batch price endpoint, TTL cleanup function wired into market-sync. OUT — Listing-day alerts, IPO allotment tracking, historical IPO performance charts.

**Depends on**: v3.14.0 (current main), existing `MarketCache` IPO analysis rows, `getStockQuote()` from `lib/stock-service.ts`.

---

## 2. Routes

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/recommendations/ipos/closed` | public | Closed IPOs (last 30 days) enriched with current stock prices |

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| (none) | — | Existing `/api/recommendations/ipos` unchanged |

---

## 3. Database Schema

### A. No new model — uses existing `MarketCache`

IPO analysis is already persisted via `MarketCache` (`dataType="ipo_analysis"`). No schema change needed.

### B. TTL Cleanup

New function `cleanStaleIpoAnalysisRows()` deletes `MarketCache` rows where:
- `dataType = "ipo_analysis"` AND `lastSyncedAt < 90 days ago`

Wired into `executeMarketDataSync()` as a non-fatal step (like `executeIpoAnalysisPrewarm`).

---

## 4. API Design

### GET `/api/recommendations/ipos/closed`

Query params: `days` (default 30, max 90)

Response:
```json
{
  "success": true,
  "issues": [
    {
      "symbol": "TATA123",
      "companyName": "Tata Technologies Ltd",
      "series": "EQ",
      "status": "Closed",
      "issueStartDate": "05-Aug-2026",
      "issueEndDate": "07-Aug-2026",
      "issuePrice": "Rs.475 to Rs.500",
      "issueSize": "23456789",
      "currentPrice": 542.30,
      "gainPercent": 8.46,
      "listingDate": "12-Aug-2026"
    }
  ],
  "source": "cache",
  "syncedAt": "2026-08-18T10:00:00Z"
}
```

Logic:
1. `getUpcomingIpoIssues()` → filter `status === "Closed"` + `issueEndDate` within `days`
2. Batch `getStockQuote()` for each symbol (chunked, graceful failure → `currentPrice: null`)
3. Compute `gainPercent = ((currentPrice - priceBandLow) / priceBandLow) * 100`
4. Cache result in memory (1h TTL) to avoid N + 1 NSE calls on every page load

---

## 5. UI Design

### `IposTab.tsx` changes

- **Closed section becomes collapsible** — default collapsed, toggle via header click
- **New columns for Closed rows**: "Current" (current price ₹), "Gain/Loss" (green/red %)
- **Section header**: "⚪ Recently Closed (N) · Last 30 days ▾/▴"
- **Empty Closed section**: don't render the section at all (hide if 0 closed IPOs in last 30 days)
- **Loading state**: skeleton for closed prices (non-blocking — main table renders first)

### Layout

```
🟢 Current IPOs (2) · Open for subscription
  [existing table rows]

🕐 Upcoming IPOs (1) · Opens soon
  [existing table rows]

⚪ Recently Closed (3) · Last 30 days ▾
  Company | Series | Open | Close | Price | Issue Size | Current | Gain/Loss
  Tata... | EQ     | ...  | ...   | ...   | ...        | ₹542.30 | +8.46%
  XYZ...  | SME    | ...  | ...   | ...   | ...        | ₹312.10 | -5.23%
```

---

## 6. TTL Cleanup

### `cleanStaleIpoAnalysisRows()`

- Location: `lib/services/ipoAnalysisService.ts`
- Deletes `MarketCache` rows: `dataType = "ipo_analysis"` AND `lastSyncedAt < NOW() - INTERVAL '90 days'`
- Returns count of deleted rows (for logging)
- Wired into `executeMarketDataSync()` step 5 (non-fatal, try/catch)
- Also available as standalone worker task `ipo_analysis_cleanup` for manual trigger

### Why 90 days?

- IPO analysis has long-term value (users revisit months later)
- 90 days balances storage vs utility
- The 12h memory TTL handles hot data; this cleans cold DB rows

---

## 7. Tests

### New tests
- `lib/__tests__/closedIpoPrices.test.ts` — batch price enrichment logic, gain % calculation, graceful fallback
- `lib/__tests__/ipoAnalysisService.test.ts` — +2 tests for `cleanStaleIpoAnalysisRows` (deletes old, keeps fresh)

### Updated tests
- `IposTab.test.tsx` — collapsed Closed section, expand/collapse toggle, current price display

---

## 8. Out of Scope

- Listing-day alerts (covered by existing alert engine, separate feature)
- IPO allotment result tracking
- Historical IPO performance charts
- Real-time price updates in the Closed section (1h cache is sufficient)
