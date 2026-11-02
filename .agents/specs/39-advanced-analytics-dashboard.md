# Spec Document — Spec 39: Advanced Analytics (Pulse, Radar, Calm, Orderflow, Liquidity)

> Saved to `.agents/specs/39-advanced-analytics-dashboard.md`
> Companion plan: `.agents/plans/39-advanced-analytics-dashboard.md`
> Branch (planned): `feature/advanced-analytics` (off `main`)
> Status: **SPEC DRAFT — pending human approval before implementation (D9)**
> Depends on: Spec 37 (Market Pulse + Strength data contracts), Spec 38 (RefSite-style theme)

## 1. Overview

**What**: A new top-level "Advanced Analytics" section in TradeNext's navigation, containing five sub-pages that replicate RefSite's analytical dashboards adapted to NSE data: **Market Pulse** (mood, indices, VIX, sector treemap, money flow), **Stock Radar** (per-stock multi-axis composite score + plan + levels), **Calm Zone** (low-volatility screener), **Order Flow** (per-stock order book / volume profile / order blocks), and **Liquidity Map** (price + futures OI buildup overlay + option walls). Each sub-page shares a common sub-nav and the RefSite-style theme (Spec 38).

**Why**: TradeNext's existing pages cover portfolio, screener, recommendations, F&O analytics, and swing signals, but lack the "market-level pulse" and "per-stock flow" analytics that RefSite provides. Users currently have no single place to see market mood, sector rotation, relative strength, low-volatility candidates, or order-flow context. These are high-value for traders making daily decisions.

**Scope**:
- IN: Top-nav "Advanced Analytics" entry; sub-nav with 5 tabs; 5 sub-routes; data services + API routes + UI components for each; reuse existing NSE data (daily_prices, F&O option chain, technical analysis, sector grouping); cron-fed JSON cache (reuse `market_cache`); responsive + dark/light.
- OUT: Crypto & Gold (not NSE). News (already have announcements). Journal & Academy (content, lower priority, defer). No new packages. No schema migration (reuse `market_cache`).

**Depends on**: Spec 37 (Market Pulse + Strength data contracts, deferred), Spec 38 (theme tokens). Can be implemented independently of Spec 37.

## 2. Routes

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/analytics` | public (redirects to `/analytics/pulse`) | Advanced Analytics landing |
| GET | `/analytics/pulse` | public | Market Pulse (mood, indices, VIX, sector treemap, money flow) |
| GET | `/analytics/radar` | public | Stock Radar (composite per-stock analysis) |
| GET | `/analytics/calm` | public | Calm Zone (low-volatility screener) |
| GET | `/analytics/orderflow` | public | Order Flow (per-stock order book / volume profile / OBs) |
| GET | `/analytics/liquidity` | public | Liquidity Map (price + OI buildup + walls) |
| GET | `/api/analytics/pulse` | public | Pulse data (mood, indices, VIX, sectors, flow) |
| GET | `/api/analytics/radar?symbol=X` | public | Radar data for a symbol |
| GET | `/api/analytics/calm` | public | Calm Zone ranked list |
| GET | `/api/analytics/orderflow?symbol=X` | public | Order flow data for a symbol |
| GET | `/api/analytics/liquidity?symbol=X&tf=15m` | public | Liquidity data for a symbol |

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| — | `app/Header.tsx` | Add "Advanced Analytics" nav link |

## 3. Database Schema

No changes. Reuse `market_cache` table (keyed by `pulse`, `flow`, `strength`, `calm`, `orderflow:<symbol>`, `liquidity:<symbol>:<tf>`, `radar:<symbol>`).

## 4. Functions to Implement

### A. `lib/services/analytics/pulseService.ts`

#### `getPulseData(): Promise<PulseData>`

- Computes market mood score (0–100) from 4 drivers: Breadth (35%), Money flow (30%), NIFTY signal (20%), Volatility (15%).
- Breadth = adv/(adv+dec) from `daily_prices` (today vs prev close).
- Money flow = net sector flow (sum of (close-prev) × volume per sector).
- NIFTY signal = NIFTY % change normalized (−5..+5 → 0..1).
- Volatility = India VIX level (lower VIX → higher score).
- Returns: mood `{ score, label, parts: { breadth, flow, nifty, vix } }`, headline (auto-generated string), indices (NIFTY, BANKNIFTY: spot, chg, chg_pct, bias, spark, range, walls, conviction), vix (last, chg, pctile, regime, spark), sectors (group, tv, p, f, n, top stocks), adv, dec, inflow, outflow, ts, open.
- Cache: `market_cache` key `pulse`, TTL 17s (live) / 10min (closed). IST market hours 09:15–15:30.

#### `getFlowData(): Promise<FlowData>`

- Per-sector: `{ g, f, fin, fout, tv, n, adv, dec, p, spd, vel, dens, surge }`.
- Cache: `market_cache` key `flow`, TTL 27s (live) / 10min (closed).

### B. `lib/services/analytics/radarService.ts`

#### `getRadarData(symbol: string): Promise<RadarData>`

- 8-axis composite (0–100 each): OI (futures OI buildup), Options (PCR, ΔOI), VWAP (price vs VWAP), Vol profile (price vs value area), RSI (15m/1h/1d), Price action (HH/HL/LH/LL, BOS), VIX/ATR calm, S/R room.
- Composite score = weighted average of axes.
- Verdict: auto-generated string (e.g. "Bullish (+2.7/10) led by futures OI & VWAP").
- Plan: entry range, stop, targets, nearest support/resistance.
- Levels: S1/S2/S3, R1/R2/R3, POC, VAH, VAL, VWAP, walls.
- Components: `{ name, score, reason }[]`.
- Series: 15m/1h/1d OHLC + VWAP.
- Cache: `market_cache` key `radar:<symbol>`, TTL 143s.

Data sources: NSE quote (spot), F&O option chain (OI, PCR), `daily_prices` (for RSI/ATR via technical-analysis), VWAP (computed from intraday if available, else daily).

### C. `lib/services/analytics/calmService.ts`

#### `getCalmData(): Promise<CalmData>`

- Screen all F&O stocks (or NIFTY 500) for low volatility.
- For each stock: calm score (composite of RV, IV, IVR, beta, ATR, earnings proximity), calm (0–100), rv (realized vol 20d), inr (intraday range %), atr, beta, iv, ivr, oi, earn (reported/upcoming), earn_text, verdict, prem (premium/discount), st (strength).
- Rank by calm score descending.
- Cache: `market_cache` key `calm`, TTL 62s.

Data sources: `daily_prices` (RV, ATR), F&O option chain (IV, IVR, OI), earnings calendar.

### D. `lib/services/analytics/orderflowService.ts`

#### `getOrderflowData(symbol: string): Promise<OrderflowData>`

- Index-level: `orderflow.json` (summary per stock: symbol, name, sector, ltp, prev, chg_pct, poc, vah, val, vwap, cvd, buy_pct, sh, tv, imb, levels, ob).
- Shard-level: `orderflow_pN.json` (detailed: candles [ts,o,h,l,c,vol,delta,cumdelta], profile {lo, step, buy[], sell[]}, poc, vah, val, vwap, cvd, buy_pct, levels, depth, sh).
- **Feasibility note**: volume profile + delta require 1-min bars. TradeNext's `daily_prices` is EOD. Options:
  - (a) Fetch 1-min bars on-demand from NSE (rate-limited, fragile) — **not recommended for v1**.
  - (b) Use daily OHLC as a coarse approximation (no volume profile, no delta) — **v1 approach**.
  - (c) Store intraday bars in a new `intraday_prices` table — **deferred to v2**.
- v1 scope: ship the index summary (POC, VAH, VAL, VWAP, CVD estimate from daily bars, buy_pct estimate, levels, OB detection from daily OHLC). Skip the volume-profile chart and cumulative-delta intraday chart. Mark as "estimated" in UI.

### E. `lib/services/analytics/liquidityService.ts`

#### `getLiquidityData(symbol: string, tf: string): Promise<LiquidityData>`

- Price bars (OHLCV) for the given timeframe.
- Futures OI buildup overlay (SB/LU/SC/LB per bar).
- Option walls (support/resistance from OI, max pain, bid/ask walls).
- Chips (support/resistance scores).
- Text read (auto-generated summary).
- **Feasibility note**: OI buildup requires intraday futures OI snapshots. TradeNext doesn't store these. v1: use daily futures OI change (coarse). Defer intraday overlay.

### F. `lib/services/analytics/analyticsCache.ts`

- Wrapper around `market_cache` for analytics keys.
- `getOrFetch(key, fetchFn, ttl)` with TTL based on market hours (live vs closed).

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `app/Header.tsx` | Modified | Add "Advanced Analytics" nav link |
| `app/analytics/layout.tsx` | **Created** | Shared layout with sub-nav tabs |
| `app/analytics/page.tsx` | **Created** | Redirect to `/analytics/pulse` |
| `app/analytics/pulse/page.tsx` | **Created** | Market Pulse page |
| `app/analytics/radar/page.tsx` | **Created** | Stock Radar page |
| `app/analytics/calm/page.tsx` | **Created** | Calm Zone page |
| `app/analytics/orderflow/page.tsx` | **Created** | Order Flow page |
| `app/analytics/liquidity/page.tsx` | **Created** | Liquidity Map page |
| `app/api/analytics/pulse/route.ts` | **Created** | Pulse data API |
| `app/api/analytics/radar/route.ts` | **Created** | Radar data API |
| `app/api/analytics/calm/route.ts` | **Created** | Calm data API |
| `app/api/analytics/orderflow/route.ts` | **Created** | Order flow data API |
| `app/api/analytics/liquidity/route.ts` | **Created** | Liquidity data API |
| `app/components/analytics/AnalyticsSubNav.tsx` | **Created** | Sub-nav tabs component |
| `app/components/analytics/PulseMoodGauge.tsx` | **Created** | Mood gauge (0–100) |
| `app/components/analytics/PulseIndexCard.tsx` | **Created** | NIFTY/BANKNIFTY card |
| `app/components/analytics/PulseSectorTreemap.tsx` | **Created** | Sector treemap |
| `app/components/analytics/PulseVixGauge.tsx` | **Created** | India VIX gauge |
| `app/components/analytics/PulseMoneyFlow.tsx` | **Created** | Money rotation + flow table |
| `app/components/analytics/RadarComposite.tsx` | **Created** | 8-axis radar chart |
| `app/components/analytics/RadarPlan.tsx` | **Created** | Entry/stop/targets/levels |
| `app/components/analytics/CalmTable.tsx` | **Created** | Calm Zone ranked table |
| `app/components/analytics/OrderflowChart.tsx` | **Created** | Volume profile + delta + OBs |
| `app/components/analytics/LiquidityChart.tsx` | **Created** | Price + OI buildup + walls |
| `lib/services/analytics/pulseService.ts` | **Created** | Pulse data service |
| `lib/services/analytics/radarService.ts` | **Created** | Radar data service |
| `lib/services/analytics/calmService.ts` | **Created** | Calm Zone service |
| `lib/services/analytics/orderflowService.ts` | **Created** | Order flow service |
| `lib/services/analytics/liquidityService.ts` | **Created** | Liquidity service |
| `lib/services/analytics/analyticsCache.ts` | **Created** | Cache wrapper |
| `lib/__tests__/pulseService.test.ts` | **Created** | Tests |
| `lib/__tests__/radarService.test.ts` | **Created** | Tests |
| `lib/__tests__/calmService.test.ts` | **Created** | Tests |
| `e2e/analytics.spec.ts` | **Created** | E2E tests |

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None (required) | — | Recharts (already in deps) for charts |
| `d3` (optional) | latest | Treemap layout (or use recharts Treemap) |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/nse-client` | `nseFetch` | NSE data |
| `@/lib/market-cache` | `getOrFetch` | Cache |
| `@/lib/services/technical-analysis` | RSI, ATR, S/R | Radar axes |
| `@/lib/services/backtestDataService` | Historical bars | Radar series |
| `@/lib/prisma` | `daily_prices` | Breadth, flow, calm |
| `@/lib/logger` | logging | Structured logs |

## 7. API Contract

### GET /api/analytics/pulse

**Response (200):**
```json
{
  "success": true,
  "data": {
    "mood": { "score": 72.7, "label": "Risk-on", "parts": { "breadth": 0.565, "flow": 0.564, "nifty": 0.458, "vix": -0.025 } },
    "headline": "Risk-on tape: breadth 392:109, ...",
    "indices": [{ "symbol": "NIFTY", "spot": 23331.1, "chg": 278, "chg_pct": 1.21, "bias": "BULLISH", "spark": [...], "range": [23215, 23443], "walls": [23000, 23500], "conviction": 28 }],
    "vix": { "last": 15.5, "chg": 0.2, "pctile": 71, "regime": "normal", "spark": [...] },
    "sectors": [{ "g": "Oil & gas", "tv": 12600, "p": 7.89, "f": 10716, "n": 19, "top": [...] }],
    "adv": 392, "dec": 109, "inflow": 42035.8, "outflow": -11716.1,
    "ts": "2026-11-02 15:27:01", "open": false
  }
}
```

### GET /api/analytics/radar?symbol=RELIANCE

**Response (200):**
```json
{
  "success": true,
  "data": {
    "symbol": "RELIANCE", "spot": 1274.5, "chg_pct": 9.41, "bias": "BULLISH", "norm": 2.7,
    "verdict": "Bullish (+2.7/10) led by futures OI & VWAP",
    "axes": [{ "k": "OI", "v": 100, "line": "Long Buildup; ..." }, ...],
    "comp": [{ "name": "Futures OI buildup", "score": 2.0, "reason": "..." }, ...],
    "plan": { "entry": [1270.55, 1278.87], "stop": [1241.68], "targets": [[1300, "R3"]], "nearest_support": [...], "nearest_resistance": [...] },
    "levels": [{ "p": 1270.55, "t": "S1", "k": "sup" }, ...],
    "series": { "15m": { "c": [...], "vwap": [...] }, "1h": {...}, "1d": {...} },
    "conviction": 37, "expiry": "23-Nov-2026"
  }
}
```

### GET /api/analytics/calm

**Response (200):**
```json
{
  "success": true,
  "data": {
    "asof": "2026-11-02", "expiry": "29-Dec-2026", "days": 57,
    "rows": [{ "s": "SUNPHARMA", "rank": 1, "score": 90.3, "calm": 93.1, "rv": 17.38, "inr": 95.65, "atr": 2.18, "beta": 0.44, "iv": 19.74, "ivr": 1.35, "oi": 545, "earn": "reported", "earn_text": "results already out (30-Oct)", "verdict": "very calm; ...", "prem": null, "st": null }],
    "top": 20
  }
}
```

### GET /api/analytics/orderflow?symbol=RELIANCE

**Response (200):** Returns index entry + shard data (candles, profile, levels, depth, ob). See Spec 38 Appendix B.

### GET /api/analytics/liquidity?symbol=NIFTY&tf=15m

**Response (200):** Returns bars, walls, buildup, chips, read, asof. See Spec 38 Appendix B (liq schema).

## 8. UI/UX Requirements

### Sub-nav component (`AnalyticsSubNav.tsx`)

Horizontal tab bar below the main header, inside the analytics layout:
- Tabs: Pulse | Radar | Calm | Order Flow | Liquidity
- Active tab: brand color + bottom border
- Mobile: horizontal scroll or dropdown

### Components per page

| Page | Key Components |
|------|----------------|
| Pulse | PulseMoodGauge, PulseIndexCard (×2), PulseSectorTreemap, PulseVixGauge, PulseMoneyFlow, PulseHeadline |
| Radar | SymbolSearch, RadarComposite (8-axis), RadarPlan, RadarLevels, RadarSeriesChart, RadarComponents |
| Calm | CalmTable (sortable), CalmFilters |
| Order Flow | OrderflowChart (candles + volume profile + OBs + depth), OrderflowMetrics, OrderflowLevels |
| Liquidity | LiquidityChart (bars + OI buildup + walls), LiquidityChips, LiquidityRead |

### States (all pages)

- Loading: skeleton
- Empty: "No data available" with retry
- Error: "Failed to load" with retry
- Data: full render

### Responsive

- Desktop (1440px): full multi-column layout
- Tablet (768px): 2-column or stacked
- Mobile (375px): single column, horizontal scroll for tables/charts

### Dark/light

- Uses Spec 38 `.dark` class tokens
- All components tested in both modes

## 9. Rules & Guardrails

- [ ] No Prisma in client components
- [ ] All DB operations via Prisma (parameterized)
- [ ] Server-side proxy only for NSE API
- [ ] All external inputs validated via Zod
- [ ] Errors return safe defaults
- [ ] Logging via `@/lib/logger`
- [ ] Background sync fire-and-forget
- [ ] Cache invalidation on write
- [ ] No hardcoded colors — use CSS variables
- [ ] All components responsive (375/768/1440)
- [ ] Dark/light mode for all new components

## 10. Expected Behavior

1. `/analytics` redirects to `/analytics/pulse`
2. "Advanced Analytics" appears in top nav (desktop) and mobile menu
3. Sub-nav tabs switch between the 5 pages without full reload
4. Pulse page shows mood gauge, NIFTY/BANKNIFTY cards, sector treemap, VIX gauge, money flow
5. Radar page: enter symbol → shows 8-axis composite, verdict, plan, levels, charts
6. Calm page: shows ranked table of low-vol stocks, sortable
7. Order Flow page: enter symbol → shows volume profile, delta, OBs, levels (v1: daily approximation)
8. Liquidity page: enter symbol → shows price + OI buildup + walls (v1: daily approximation)
9. All pages refresh per RefSite cadence (17s pulse live, 62s calm, etc.)
10. All pages render in light + dark mode
11. No console errors

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| NSE API timeout | Fallback to cache, log warning | `warn` |
| Symbol not found | Return 404 with message | `warn` |
| Insufficient historical data | Return partial data + "limited history" flag | `warn` |
| Cache miss + NSE fail | Return empty, don't throw | `error` |

## 12. Test Strategy

### Unit Tests

| Test | File | What It Verifies |
|------|------|------------------|
| Mood score computation | `pulseService.test.ts` | Correct weighted average |
| Breadth calculation | `pulseService.test.ts` | adv/(adv+dec) |
| Flow aggregation | `pulseService.test.ts` | Sector net flow |
| Radar axis scoring | `radarService.test.ts` | Each axis 0–100 |
| Calm score ranking | `calmService.test.ts` | Sort by calm desc |
| Cache TTL by market hours | `analyticsCache.test.ts` | Live vs closed |

### E2E Tests

| Test | What It Verifies |
|------|------------------|
| Analytics nav link visible | Nav wiring |
| Sub-nav tabs switch pages | Routing |
| Pulse page renders mood + indices | Component rendering |
| Radar page loads with symbol | Data flow |
| Calm page shows table | Component rendering |
| Responsive at 375px | Mobile layout |
| Dark mode renders | Theme support |

## 13. Performance Considerations

- **Cache**: `market_cache` with per-screen TTL (live/closed based on IST market hours)
- **Pagination**: Calm table paginated (50 per page)
- **Batching**: Sector aggregation in single pass over `daily_prices`
- **Lazy loading**: Charts load on demand (dynamic import)

## 14. Security Considerations

- **Auth**: All analytics routes public (market data only, no user-specific data)
- **Input**: Symbol validated via Zod (alphanumeric, max 20 chars)
- **Rate limiting**: Reuse existing rate-limit middleware
- **No secrets**: No API keys in client

## 15. Definition of Done

- [ ] All 5 sub-pages implemented
- [ ] All API routes working
- [ ] All services implemented
- [ ] Sub-nav component working
- [ ] Top-nav link added
- [ ] All components responsive (375/768/1440)
- [ ] Dark/light mode renders
- [ ] `npx tsc --noEmit` 0 new errors
- [ ] `npm run test` all pass
- [ ] `npm run lint` 0 errors
- [ ] Playwright E2E passes
- [ ] Documentation updated
- [ ] Live-verified on :3000

---

## Feasibility notes (v1 scope)

| Feature | v1 (this spec) | Deferred to v2 |
|---------|----------------|----------------|
| Pulse mood + indices + VIX + sector treemap + money flow | ✅ Full | — |
| Radar composite (8 axes) + plan + levels | ✅ Full (using daily data) | Intraday VWAP/series (needs intraday bars) |
| Calm Zone (low-vol screener) | ✅ Full | IV/IVR (needs option chain per stock — heavy) |
| Order Flow (volume profile + delta + OBs) | ⚠️ Simplified (daily approximation, no volume profile) | Full intraday version needs `intraday_prices` table |
| Liquidity Map (price + OI buildup + walls) | ⚠️ Simplified (daily bars + OI walls, no buildup overlay) | Intraday OI buildup overlay |

**Recommendation**: Start with Phase 1 (Pulse) + Phase 2 (Radar) + Phase 3 (Calm) as the MVP. Defer Order Flow and Liquidity to a follow-up spec once intraday data storage is decided.

---

**End of Spec 39.** Implementation pending human approval (D9).
