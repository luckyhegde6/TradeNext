# v3.20.0 — NSE Resilience: All NSE Routes Graceful Empty + MCP GET Fix + MCP/Corp-Actions Graceful Empty + Constants Consolidation

> **Date**: Aug 26 2026 · **Branch**: `fix/nse-resilience` · **Suite**: 869 pass / 4 skip · **tsc**: 57 = baseline (0 production errors)

## Problem

NSE India blocks cloud server IPs (Netlify, Prisma Accelerate proxy) with HTTP 403/429 anti-bot responses. Every NSE-dependent API route threw unhandled 500/502 errors, breaking the Market Analytics page, news page, and any feature backed by NSE data. Additional issues: MCP GET endpoint was POST-only, MCP and corporate-actions routes returned 500 on data unavailability, corporate actions route blocked on NSE refresh, constants duplicated across files, and `netlify.toml` contained a stale Prisma Postgres extension that triggered `prisma migrate deploy` during builds.

## Root Cause

NSE API responses are non-deterministic from cloud environments — success depends on IP reputation, cookie state, and NSE's anti-bot rules. All routes assumed NSE would always respond successfully; no try/catch or fallback path existed.

## Architecture: NSE Resilience Pattern

```
Memory Cache (fast path, ~1ms)
  ↓ miss
DB Query (always runs, never blocked)
  ↓ stale/missing
NSE Fetch (fire-and-forget background refresh, never blocks response)
  ↓ failure
Stale Memory Cache (if available)
  ↓ empty
Graceful Empty ([], null, { data: [] }) — never 500/502
```

## Files Created

_No new files — all changes are modifications to existing routes._

## Files Modified

| File | Change |
|------|--------|
| `app/api/mcp/route.ts` | Extracted shared `handleMcpRequest()`; both POST and GET call it — GET now supports all 29+ functions (was POST-only). **POST+GET catch blocks** now return `{success:true, data:null, warning:...}` instead of HTTP 500 — data unavailability ≠ server error |
| `app/api/corporate-actions/combined/route.ts` | NSE refresh decoupled from DB read via `triggerNseRefresh()` fire-and-forget with module-level `nseRefreshInFlight` guard. **Outer catch** now returns `{data:[], warning:...}` instead of HTTP 500 when all fallback sources (SQLite, stale cache) are exhausted |
| `app/api/news/market/route.ts` | Fixed `{ prisma }` named import → default import; DB reads wrapped in try/catch with `dbAvailable` flag; DB upserts fire-and-forget; catch serves memory cache → empty |
| `app/api/nse/gainers/route.ts` | Wrapped `nseFetchSWR` in try/catch, returns `{ data: [], stale: false }` on failure |
| `app/api/nse/losers/route.ts` | Wrapped `nseFetchSWR` in try/catch, returns `{ data: [], stale: false }` on failure |
| `app/api/nse/most-active/route.ts` | Catch returns `{ data: [], timestamp }` instead of 500 |
| `app/api/nse/corporate-announcements/route.ts` | Catch returns `[]` instead of 500 |
| `app/api/nse/corporate-events/route.ts` | Catch returns `[]` instead of 500 |
| `app/api/nse/corporate-info/route.ts` | Returns `{ data: [], source: "unavailable" }` on failure |
| `app/api/nse/corporate-news/route.ts` | Returns `[]` on failure instead of 500 error object |
| `app/api/nse/deals/route.ts` | Returns `{ data: [], meta: {}, source: "unavailable" }` on failure |
| `app/api/nse/insider-trading/route.ts` | Returns `[]` on failure instead of 500 |
| `app/api/nse/marquee/route.ts` | Added try/catch with in-memory cache fallback → `{ indices: [] }` (previously had NO error handling) |
| `app/api/nse/indexes/route.ts` | Catch serves stale memory cache → `{ data: [], source: "unavailable" }` instead of 502 |
| `app/api/nse/index/[index]/route.ts` | Returns `null` instead of 502; added logger |
| `app/api/nse/index/[index]/heatmap/route.ts` | Returns `[]` instead of 502 |
| `app/api/nse/index/[index]/advance-decline/route.ts` | Returns `{ advances: [], declines: [], unchanged: [] }` instead of 502 |
| `app/api/nse/index/[index]/announcements/route.ts` | Returns `[]` instead of 502 |
| `app/api/nse/index/[index]/corp-actions/route.ts` | Returns `[]` instead of 502 |
| `app/api/nse/index/[index]/chart/route.ts` | Returns `null` instead of 502; added logger |
| `app/api/nse/index/[index]/symbols/route.ts` | Serves stale cache → `{ symbols: [] }` instead of 502; added logger |
| `app/api/nse/stock/[symbol]/quote/route.ts` | Returns `null` instead of 502 |
| `app/api/nse/stock/[symbol]/chart/route.ts` | Returns `null` instead of 502 |
| `app/api/nse/stock/[symbol]/trends/route.ts` | Returns `null` instead of 502 |
| `app/api/nse/stock/[symbol]/corporate/route.ts` | Changed `Promise.all` → `Promise.allSettled` for partial success on `type=all`; returns `{ financials: null, events: null, announcements: null, actions: null }` instead of 502 |
| `lib/constants.ts` | Canonical `NIFTY_50` array (50 symbols, 2026-confirmed), `INITIAL_SYMBOLS` deprecated alias (`[...NIFTY_50]`), `MARKET_HOLIDAYS` includes 2026 dates |
| `lib/services/marketCapClassification.ts` | Imports `NIFTY_50` from `@/lib/constants` (was its own duplicate list) |
| `netlify.toml` | Removed `[template] required-extensions = ["prisma-postgres"]`; build = `npx prisma generate && npm run quickbuild` only |

## Key Design Decisions

1. **Never 500 for data-unavailable**: NSE blocking is a data-availability issue, not a server error. Routes return HTTP 200 with empty/`null` data + optional `source: "unavailable"` field.
2. **Stale cache before empty**: Routes with in-memory cache (`marquee`, `indexes`, `index/symbols`) serve the last-known-good value before falling back to empty.
3. **Fire-and-forget background refresh**: Corporate actions route decouples NSE refresh from DB read — NSE response is fetched in background and writes to DB when it arrives.
4. **Promise.allSettled for partial success**: Corporate `/stock/[symbol]/corporate` fetches 4 NSE endpoints in parallel; some may succeed while others fail.
5. **MCP graceful empty (POST+GET)**: The MCP API is an external data interface — NSE failures return `{success:true, data:null, warning:...}` not 500. Callers check `data === null` + `warning` field.
6. **Corporate-actions catch = empty array**: Even when DB + SQLite + stale cache all fail, return `{data:[], warning:...}` (HTTP 200). Frontend empty-state components handle `[]` cleanly.

## Verification

- **tsc**: 57 errors = baseline (all pre-existing test-only jest-dom/Prisma mock issues; 0 production errors)
- **Tests**: 869 pass / 4 skip = exact baseline (no new tests — route changes are simple try/catch wrappers)
- **DB-down test (local)**: Stopped Docker PG container, hit 22+ NSE routes + DB-dependent routes — ALL returned HTTP 200 with graceful empty data. Restarted PG → full data recovery confirmed.
- **Frontend resilience**: `MarketAnalyticsTabs.tsx` and `news/page.tsx` handle empty/null API responses gracefully via `if (!data || ...length === 0)` guards.
