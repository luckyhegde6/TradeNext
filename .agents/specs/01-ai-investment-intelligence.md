# Spec: AI Investment Intelligence

> Institutional-quality investment analysis for every NSE equity on the `/company/[symbol]` page.

## 1. Overview

**What**: An AI Investment Intelligence feature that provides a comprehensive, multi-section investment analysis report for each NSE equity — combining live NSE data, fundamentals, technicals, news, shareholding patterns, corporate actions, and LLM-synthesized analysis into a single expandable panel on the company page.

**Why**: Users currently see raw data across tabs (CorporateDataTabs, PiotroskiFScore, charts) but lack a unified, actionable investment thesis. This feature synthesizes all available intelligence into a professional-grade report with a clear BUY/HOLD/SELL recommendation, fair value estimate, risk factors, and catalysts.

**Scope**:

| IN Scope | OUT of Scope (v1) |
|----------|-------------------|
| NSE data adapter layer for new endpoints (chart, yearwise, shareholding, financials, corporate actions, announcements, sector peers) | Intraday tick data (volume spikes, block deals) |
| Technical analysis extensions (ATR, support/resistance, pattern summary) | Real-time Level 2 order book / DMA depth |
| Valuation calculations (P/E, P/B, EV/EBITDA, dividend yield) | DCF with Monte Carlo |
| News aggregation (NSE announcements + TradingView news feed) | AI-powered sentiment classification of news |
| AI analysis prompt + structured JSON response (VERDICT, valuation, technicals, risks, catalysts, scenarios) | Bloomberg-style report PDF export |
| Intelligence API endpoint + caching | Portfolio-level optimization suggestions |
| UI: button states (loading/ready/failed) + expandable analysis panel with sections | Charts beyond existing NSEStockChart/UnifiedChart |
| v1 version cache in MarketCache (TTL-based refresh) | Real-time watchlist alerts from intelligence |

**Depends on**: None (builds on existing NSE client, AI services, and technical analysis libs).

---

## 2. Routes

> **Auth requirement**: ALL intelligence routes require an authenticated session. Unauthenticated requests return 401. Every AI trigger is audit-logged with user ID.

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/company/[symbol]/intelligence` | **required** | Returns cached or fresh AI investment intelligence for a symbol |
| POST | `/api/company/[symbol]/intelligence` | **required** | Force-refresh intelligence (or trigger if missing) |

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/mcp` | Add `getInvestmentIntelligence` function (MCP uses its own API key auth, not session auth) |

---

## 3. Database Schema

### A. New Model: `IntelligenceCache`

```prisma
model IntelligenceCache {
  id              String   @id @default(cuid())
  symbol          String
  version         Int      @default(1)
  data            Json     // Full intelligence report as JSON
  modelUsed       String?
  generatedAt     DateTime @default(now())
  expiresAt       DateTime // generatedAt + TTL
  createdAt       DateTime @default(now())

  @@unique([symbol])
  @@index([symbol, expiresAt])
  @@map("intelligence_cache")
}
```

### B. Migration Notes

- Migration name: `2026MMDDHHMMSS_add_intelligence_cache`
- Applied via: `migrate diff --to-schema` + `db execute` (local DB has no `_prisma_migrations` ledger)
- TTL-based expiry: query checks `expiresAt > now()` before serving cached data

---

## 4. Functions to Implement

### A. `lib/market-data/nse/adapters.ts` — NSE Data Adapter

Thin wrappers around `nseFetch` and existing NSE API functions that normalize responses into the intelligence report's input types. Reuses `nseFetch`, `getOrFetchNseData`, `getOrFetchSyncedData` per NSE integration skill patterns.

#### `fetchIntelligenceQuoteData(symbol: string): Promise<QuoteData>`

- Calls existing `getStockQuote(symbol)` — already returns price, P/E, market cap, 52W high/low, sector, industry, VWAP, EPS, book value, dividend yield
- Returns normalized `QuoteData` (price, change, % change, P/E, P/B, market cap, 52W range, volume, VWAP, sector, industry, face value, book value, EPS)

#### `fetchIntelligenceTechnicals(symbol: string, days?: number): Promise<TechnicalsData>`

- Calls `fetchSecurityWiseHistoricalData(symbol, from, to)` via existing NSE historical endpoint
- Computes via existing functions in `technical-analysis.ts`: `computeSMA(bars, period)`, `computeEMA(bars, period)`, `computeRSI(bars, 14)`, `computeMACD(bars)`, `computeBollinger(bars, 20, 2)`
- Computes NEW: `computeATR(bars, 14)` — Average True Range
- Computes NEW: `findSupportResistance(bars)` — pivot-point based S/R levels
- Returns: current trend, SMA20/50/200, EMA12/26, RSI14, MACD signal, Bollinger bands, ATR14, support/resistance levels, trend strength description

#### `fetchIntelligenceValuation(symbol: string): Promise<ValuationData>`

- Derives from `QuoteData` (P/E, P/B, EPS, dividend yield, market cap) plus peer comparison
- Computes: relative valuation vs sector median (if sector available), PEG ratio (if earnings growth available), dividend yield, interest coverage proxy (from financial status)
- Returns: valuation metrics, valuation assessment string, sector comparison

#### `fetchIntelligenceFundamentals(symbol: string): Promise<FundamentalsData>`

- Calls `getFinancialStatus(symbol)` — returns credit rating, interest coverage, debt-to-equity, ROCE, ROE, net-worth, debt levels
- Calls `getCorpEvents(symbol)` — recent board meetings, results dates
- Calls `getCorporateAnnouncements(symbol, 20)` — last 20 announcements
- Calls `fetchCorporateResults("Quarterly", symbol)` via `nseIpoService` or direct `nseFetch` — quarterly P&L, balance sheet, cash flow
- Returns: financial status, quarterly results trend, debt profile, profit trend, revenue trend, ROCE/ROE, working capital pattern

#### `fetchIntelligenceShareholding(symbol: string): Promise<ShareholdingData>`

- Calls NSE `getHistoricalData("shareholding", symbol)` or equivalent NSE endpoint for shareholding patterns
- Computes quarter-over-quarter changes in FII, DII, promoter, public holdings
- Returns: latest shareholding breakdown, QoQ changes, FII/DII trends, promoter pledge status

#### `fetchIntelligenceCorporate(symbol: string): Promise<CorporateData>`

- Calls existing `fetchCorporateActions(symbol)` — dividends, splits, bonuses, rights
- Calls existing `fetchEventCalendar(symbol)` — upcoming events
- Calls `getCorporateAnnouncements(symbol, 50)` — broader announcement scan for MD&A keywords, related-party disclosures
- Returns: recent actions (dividend/split/bonus), upcoming events (results date, AGM, board meeting), key announcements (MD&A, related-party, auditor qualifications), corporate governance signals

#### `fetchIntelligenceNews(symbol: string): Promise<NewsData>`

- Calls NSE corporate announcements (already available via `getCorporateAnnouncements`)
- Calls TradingView news feed via existing `app/api/news/market/route.ts` pattern or direct `fetch('https://news-headlines.tradingview.com/v2/...')`
- Returns: recent news items (title, source, date, sentiment-pending-v2), announcement count by category

#### `fetchIntelligencePeers(symbol: string): Promise<PeersData>`

- Extracts sector/industry from `getStockQuote(symbol)`
- Calls NSE stocks list or `getStockList()` to filter same-sector stocks
- Calls `getStockQuote(peerSymbol)` for each peer (capped at 5 peers)
- Returns: peer list with symbol, price, P/E, market cap, sector

### B. `lib/services/ai/intelligence-prompt.ts` — Prompt Engineering

#### `buildIntelligencePrompt(input: IntelligenceInput): string`

- Takes all adapter outputs (quote, technicals, valuation, fundamentals, shareholding, corporate, news, peers)
- Builds a comprehensive prompt instructing the AI to return a single valid JSON object with:
  - `verdict`: BUY | HOLD | SELL
  - `confidence`: 0–100
  - `fairValue`: { low, mid, high }
  - `technicalAnalysis`: { trend, support, resistance, indicators summary }
  - `fundamentalAnalysis`: { strengths, weaknesses }
  - `valuationAssessment`: { assessment, relativeValue }
  - `newsCatalysts`: { positive, negative, neutral }
  - `shareholdingTrend`: { summary }
  - `riskFactors`: string[]
  - `catalysts`: string[]
  - `scenarioAnalysis`: { bull, base, bear with reasoning }
  - `summary`: string (3-5 sentence executive summary)
- System prompt rules: no hallucination, cite specific numbers, acknowledge data gaps, never fabricate news

#### `parseIntelligenceResponse(raw: string): IntelligenceAnalysis | null`

- Reuses pattern from `ipoReport.ts`: extract JSON from markdown fences → braces extraction → normalize
- Never throws — returns null on failure

### C. `lib/services/ai/intelligence.ts` — Orchestrator

#### `getInvestmentIntelligence(symbol: string, options?: { force?: boolean; userId?: number }): Promise<IntelligenceReport>`

1. Check `getIntelligenceFromCache(symbol)` — if valid and not expired, return cached (memory first → DB fallback → restore to memory)
2. If not `force` and cache hit: return cached data
3. Parallel fetch all adapter data (Promise.allSettled — partial data is OK)
4. Build prompt from all available data
5. Call `directPrompt(prompt, { maxTokens: 8192 })` with `modelFallbackChain()`
6. Check `isQuotaExhausted()` — if exhausted, return cached or error state
7. Parse response via `parseIntelligenceResponse()`
8. If parse fails: retry once with simplified prompt
9. Store result via `setIntelligenceCache()` (write-through: Prisma DB + in-memory NodeCache)
10. Audit: `INTELLIGENCE_GENERATED` tag with userId + symbol
11. Return full `IntelligenceReport`

#### `isIntelligenceCacheValid(symbol: string): Promise<boolean>`

- Check cache entry exists and `expiresAt > now()`
- TTL: 7 days (configurable via `INTELLIGENCE_CACHE_TTL_MS`)

#### `invalidateIntelligenceCache(symbol?: string): Promise<void>`

- Delete cache entry for symbol (or all if no symbol)
- Called on force refresh

### D. `lib/services/intelligenceTypes.ts` — Type Definitions

All TypeScript interfaces for the intelligence report:

```typescript
export interface QuoteData {
  symbol: string; price: number; change: number; percentChange: number;
  pe: number | null; pb: number | null; marketCap: number;
  fiftyTwoWeekHigh: number; fiftyTwoWeekLow: number;
  volume: number; vwAP: number | null; sector: string; industry: string;
  faceValue: number | null; bookValue: number | null; eps: number | null;
  dividendYield: number | null; weekHigh52: number; weekLow52: number;
}

export interface TechnicalsData {
  currentTrend: "UPTREND" | "DOWNTREND" | "SIDEWAYS";
  sma20: number | null; sma50: number | null; sma200: number | null;
  ema12: number | null; ema26: number | null;
  rsi14: number | null;
  macdLine: number | null; macdSignal: number | null; macdHistogram: number | null;
  bollingerUpper: number | null; bollingerMiddle: number | null; bollingerLower: number | null;
  atr14: number | null;
  support: number | null; resistance: number | null;
  trendStrength: string;
  indicatorSummary: string;
}

export interface ValuationData {
  pe: number | null; pb: number | null; evEbitda: number | null;
  peg: number | null; dividendYield: number | null;
  sectorMedianPe: number | null; relativeValue: string;
  valuationAssessment: string;
}

export interface FundamentalsData {
  financialStatus: any; // from getFinancialStatus
  quarterlyResults: any[];
  profitTrend: string; revenueTrend: string;
  roce: number | null; roe: number | null;
  debtToEquity: number | null; interestCoverage: number | null;
  workingCapitalTrend: string;
}

export interface ShareholdingData {
  promoters: number | null; fiis: number | null; diis: number | null;
  public: number | null; others: number | null;
  qoqChanges: { promoters: number; fiis: number; diis: number; public: number; };
  fiiTrend: string; diiTrend: string;
  promoterPledge: number | null;
}

export interface CorporateData {
  recentActions: Array<{ type: string; date: string; details: string; }>;
  upcomingEvents: Array<{ type: string; date: string; details: string; }>;
  keyAnnouncements: Array<{ title: string; date: string; category: string; }>;
  governanceSignals: string[];
}

export interface NewsData {
  recentNews: Array<{ title: string; source: string; date: string; }>;
  announcementsByCategory: Record<string, number>;
}

export interface PeersData {
  peers: Array<{ symbol: string; price: number; pe: number | null; marketCap: number; }>;
}

export interface IntelligenceInput {
  quote: QuoteData | null;
  technicals: TechnicalsData | null;
  valuation: ValuationData | null;
  fundamentals: FundamentalsData | null;
  shareholding: ShareholdingData | null;
  corporate: CorporateData | null;
  news: NewsData | null;
  peers: PeersData | null;
  symbol: string;
}

export interface IntelligenceAnalysis {
  verdict: "BUY" | "HOLD" | "SELL";
  confidence: number;
  fairValue: { low: number; mid: number; high: number };
  technicalAnalysis: { trend: string; support: number | null; resistance: number | null; indicators: string; };
  fundamentalAnalysis: { strengths: string[]; weaknesses: string[]; };
  valuationAssessment: { assessment: string; relativeValue: string; };
  newsCatalysts: { positive: string[]; negative: string[]; neutral: string[]; };
  shareholdingTrend: { summary: string; };
  riskFactors: string[];
  catalysts: string[];
  scenarioAnalysis: { bull: string; base: string; bear: string; };
  summary: string;
}

export interface IntelligenceReport {
  symbol: string;
  analysis: IntelligenceAnalysis;
  dataUsed: IntelligenceInput;
  modelUsed: string | null;
  generatedAt: string;
  version: number;
  isCacheHit: boolean;
}
```

### E. `lib/services/intelligenceCache.ts` — Write-Through Cache Layer

Dual-layer cache: in-memory `NodeCache` (fast reads, ~1ms) + `IntelligenceCache` Prisma model (persistent, survives restarts). Writes go to both; reads check memory first, fall back to DB, then restore to memory. On service startup, bulk-load all non-expired entries from DB into memory.

#### `getIntelligenceFromCache(symbol: string): Promise<IntelligenceReport | null>`

1. Check in-memory `NodeCache` — if hit, return immediately (~1ms)
2. If miss, query `IntelligenceCache` Prisma where `symbol = ? AND expiresAt > now()`
3. If DB hit, restore to in-memory cache (write-through restore), return report
4. If DB miss or expired, return null

#### `setIntelligenceCache(symbol: string, report: IntelligenceReport, ttlMs?: number): Promise<void>`

1. Upsert `IntelligenceCache` Prisma row with `expiresAt = now() + (ttlMs || INTELLIGENCE_CACHE_TTL_MS)`
2. Set in-memory `NodeCache` entry with same TTL
3. Both writes are non-atomic — DB failure is logged but doesn't block (in-memory is the fast path)

#### `invalidateIntelligenceCache(symbol?: string): Promise<void>`

1. Delete from in-memory `NodeCache`
2. Delete from `IntelligenceCache` Prisma (specific symbol or all)

#### `restoreIntelligenceCacheFromDB(): Promise<void>` (called on service startup)

- Bulk-loads all `IntelligenceCache` rows where `expiresAt > now()` into in-memory `NodeCache`
- Logs count of restored entries
- Called from `instrumentation.ts` register hook or lazy on first request

#### `getIntelligenceCacheStats(): Promise<{ total: number; active: number; expired: number }>`

- Returns cache statistics for admin monitoring

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `prisma/schema.prisma` | Modified | Add `IntelligenceCache` model |
| `lib/market-data/nse/adapters.ts` | **Created** | NSE data adapter functions for intelligence |
| `lib/services/intelligenceTypes.ts` | **Created** | All TypeScript interfaces |
| `lib/services/intelligenceCache.ts` | **Created** | Cache layer (Prisma CRUD) |
| `lib/services/ai/intelligence-prompt.ts` | **Created** | Prompt builder + JSON parser |
| `lib/services/ai/intelligence.ts` | **Created** | Orchestrator (fetch → prompt → AI → parse → cache) |
| `lib/screener/technical-analysis.ts` | Modified | Add `computeATR()`, `findSupportResistance()` |
| `app/api/company/[symbol]/intelligence/route.ts` | **Created** | GET/POST API endpoint (auth required, audit logged) |
| `app/components/intelligence/IntelligenceButton.tsx` | **Created** | Button with loading/ready/failed states |
| `app/components/intelligence/IntelligencePanel.tsx` | **Created** | Expandable analysis panel |
| `app/components/intelligence/sections/VerdictCard.tsx` | **Created** | BUY/HOLD/SELL badge + confidence |
| `app/components/intelligence/sections/FairValueGauge.tsx` | **Created** | Low/mid/high fair value range |
| `app/components/intelligence/sections/TechnicalSummary.tsx` | **Created** | Trend + indicators summary |
| `app/components/intelligence/sections/FundamentalInsights.tsx` | **Created** | Strengths/weaknesses |
| `app/components/intelligence/sections/ValuationView.tsx` | **Created** | Valuation assessment + peers table |
| `app/components/intelligence/sections/NewsCatalystList.tsx` | **Created** | News + announcements list |
| `app/components/intelligence/sections/ShareholdingTrend.tsx` | **Created** | FII/DII/promoter QoQ |
| `app/components/intelligence/sections/CorporateActionsSummary.tsx` | **Created** | Dividends/splits/events |
| `app/components/intelligence/sections/RiskCatalystMatrix.tsx` | **Created** | Risks + catalysts side-by-side |
| `app/components/intelligence/sections/ScenarioAnalysis.tsx` | **Created** | Bull/base/bear scenarios |
| `app/components/intelligence/sections/ExecutiveSummary.tsx` | **Created** | AI-generated summary |
| `app/company/[ticker]/page.tsx` | Modified | Add IntelligenceButton + panel below header |
| `instrumentation.ts` | Modified | Add `restoreIntelligenceCacheFromDB()` call at startup (alongside cron daemon + worker) |
| `app/api/mcp/route.ts` | Modified | Add `getInvestmentIntelligence` function |
| `lib/__tests__/intelligence.test.ts` | **Created** | Unit tests |
| `lib/__tests__/intelligence-prompt.test.ts` | **Created** | Prompt + parser tests |
| `lib/__tests__/intelligenceCache.test.ts` | **Created** | Cache tests |
| `lib/__tests__/technical-analysis.test.ts` | Modified | Add ATR + S/R tests |
| `lib/__tests__/adapters.test.ts` | **Created** | Adapter function tests |
| `lib/audit.ts` | Modified | Add `INTELLIGENCE_GENERATED`, `INTELLIGENCE_CACHE_HIT`, `INTELLIGENCE_FAILED`, `INTELLIGENCE_REQUESTED`, `INTELLIGENCE_UNAUTHORIZED` tags |

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | All computations use existing libs |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/nse-client` | `nseFetch` | All NSE API calls |
| `@/lib/nse-api` | `getStockQuote`, `getFinancialStatus`, `getCorpEvents`, `fetchCorporateActions`, `fetchCorporateAnnouncements`, `fetchEventCalendar`, `fetchSecurityWiseHistoricalData`, `securityWiseBarsToOHLCV` | Data fetching |
| `@/lib/market-cache` | `getOrFetchNseData`, `getOrFetchSyncedData` | Caching |
| `@/lib/screener/technical-analysis` | `computeSMA`, `computeEMA`, `computeRSI`, `computeMACD`, `computeBollinger` | Technical indicators |
| `@/lib/services/ai/llm-provider` | `directPrompt`, `isQuotaExhausted`, `QUOTA_EXHAUSTED_MESSAGE` | AI inference |
| `@/lib/services/ai/modelChain` | `modelFallbackChain` | Model selection |
| `@/lib/services/ipoReport` | `parseIpoReportJson` (pattern reference) | JSON parsing pattern |
| `@/lib/prisma` | `prisma.intelligenceCache.*` | DB cache |
| `@/lib/logger` | `logger.info/warn/error` | Logging |
| `@/lib/audit` | `audit()` | Audit trail |

---

## 7. API Contract

### GET /api/company/[symbol]/intelligence

**Auth**: Required — `session.user.id` must exist (NextAuth JWT session cookie).

**Query Params:**
```typescript
{ force?: string }  // "1" to bypass cache
```

**Response (401):**
```json
{
  "success": false,
  "error": "Unauthorized"
}
```

**Response (200):**
```json
{
  "success": true,
  "symbol": "RELIANCE",
  "data": {
    "symbol": "RELIANCE",
    "analysis": {
      "verdict": "BUY",
      "confidence": 72,
      "fairValue": { "low": 2800, "mid": 3100, "high": 3400 },
      "technicalAnalysis": { "trend": "...", "support": 2950, "resistance": 3150, "indicators": "..." },
      "fundamentalAnalysis": { "strengths": [...], "weaknesses": [...] },
      "valuationAssessment": { "assessment": "...", "relativeValue": "..." },
      "newsCatalysts": { "positive": [...], "negative": [...], "neutral": [...] },
      "shareholdingTrend": { "summary": "..." },
      "riskFactors": [...],
      "catalysts": [...],
      "scenarioAnalysis": { "bull": "...", "base": "...", "bear": "..." },
      "summary": "..."
    },
    "modelUsed": "nvidia/nemotron-3-ultra-550b-a55b:free",
    "generatedAt": "2026-08-19T14:30:00Z",
    "version": 1,
    "isCacheHit": false
  }
}
```

**Response (202 — generating):**
```json
{
  "success": true,
  "symbol": "RELIANCE",
  "status": "generating",
  "message": "AI analysis is being generated. Please retry in a few seconds."
}
```

**Response (503 — quota exhausted):**
```json
{
  "success": false,
  "symbol": "RELIANCE",
  "error": "AI credits exhausted — try after 6 hours or wait for the daily reset.",
  "cachedAvailable": true
}
```

### POST /api/company/[symbol]/intelligence

**Auth**: Required — `session.user.id` must exist. Every POST triggers an audit log with user ID + symbol.

**Body:** none (or `{}`)

**Response (200):** Same as GET with fresh data + `isCacheHit: false`

---

## 8. UI/UX Requirements

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `IntelligenceButton.tsx` | `app/components/intelligence/` | Trigger button with states |
| `IntelligencePanel.tsx` | `app/components/intelligence/` | Expandable panel container |
| `sections/VerdictCard.tsx` | `app/components/intelligence/sections/` | BUY/HOLD/SELL + confidence |
| `sections/FairValueGauge.tsx` | `app/components/intelligence/sections/` | Fair value range bar |
| `sections/TechnicalSummary.tsx` | `app/components/intelligence/sections/` | Technical indicators overview |
| `sections/FundamentalInsights.tsx` | `app/components/intelligence/sections/` | Strengths/weaknesses |
| `sections/ValuationView.tsx` | `app/components/intelligence/sections/` | Valuation assessment + peers |
| `sections/NewsCatalystList.tsx` | `app/components/intelligence/sections/` | News + announcements |
| `sections/ShareholdingTrend.tsx` | `app/components/intelligence/sections/` | FII/DII/promoter changes |
| `sections/CorporateActionsSummary.tsx` | `app/components/intelligence/sections/` | Dividends/splits/events |
| `sections/RiskCatalystMatrix.tsx` | `app/components/intelligence/sections/` | Risks + catalysts |
| `sections/ScenarioAnalysis.tsx` | `app/components/intelligence/sections/` | Bull/base/bear |
| `sections/ExecutiveSummary.tsx` | `app/components/intelligence/sections/` | AI summary paragraph |

### Button States

| State | Visual | Behavior |
|-------|--------|----------|
| **Idle** (no cache) | Gray pill: "AI Analysis" with sparkle icon | Click → POST to generate |
| **Loading** (generating) | Pulsing sky-blue badge: "Analyzing..." | Disabled, no click |
| **Ready** (cache hit) | Green pill: "AI Analysis ✓" | Click → expand/collapse panel |
| **Failed** | Amber pill: "Analysis unavailable" | Click → retry (POST) |

### Panel Layout

- Placed below `StockQuoteHeader`, above `NSEStockChart`
- Full-width, dark theme consistent with existing company page
- Collapsible with smooth height animation
- Each section is a card with header + content
- Sections are independently loaded (skeleton per section)
- Mobile: stacked single column, horizontally scrollable tables

### States

- **Loading**: Skeleton cards per section
- **Empty**: "No intelligence data available" with generate button
- **Error**: "Analysis generation failed" with retry button
- **Data**: Full panel with all sections

### Responsive

- Desktop (1440px): Two-column layout for some sections (valuation + peers side-by-side)
- Tablet (768px): Stacked single column
- Mobile (375px): Full-width cards, tables scroll horizontally

---

## 9. Rules & Guardrails

- [ ] No Prisma in client components
- [ ] All DB operations use parameterized queries (Prisma handles this)
- [ ] Server-side proxy only for NSE API — never call from client
- [ ] All external inputs validated via Zod (symbol param)
- [ ] Intelligence API routes require authenticated session (401 for unauthenticated)
- [ ] Every intelligence request is audit-logged with userId + symbol
- [ ] Errors return safe defaults, never expose internals
- [ ] Logging via `@/lib/logger` only (no `console.log`)
- [ ] AI calls check `isQuotaExhausted()` before attempting
- [ ] Partial data is acceptable — missing adapters don't block the report
- [ ] AI response is always validated before caching
- [ ] Cache TTL is configurable via env (`INTELLIGENCE_CACHE_TTL_MS`, default 7 days)
- [ ] No new npm packages — all computations use existing libs
- [ ] Reuse existing `nseFetch`, `getOrFetchNseData`, `getOrFetchSyncedData` patterns
- [ ] Existing company page layout preserved — intelligence is additive

---

## 10. Expected Behavior

1. Company page renders with intelligence button below the header (button disabled if not logged in)
2. Unauthenticated user sees "Sign in to view AI analysis" instead of the generate button
3. Authenticated user: first visit (no cache) → button shows "AI Analysis" in idle state
4. Authenticated user clicks idle button → POST (auth session cookie sent) → button shows "Analyzing..." pulsing state
5. AI completes → button turns green "AI Analysis ✓", panel expands with all sections; audit log recorded with userId + symbol
5. Panel shows: Verdict card → Fair value gauge → Technical summary → Fundamental insights → Valuation + peers → News → Shareholding → Corporate actions → Risks/catalysts → Scenarios → Executive summary
6. Second visit (cache hit): button shows green immediately, click expands cached data
7. Cache expiry (7 days): button returns to idle, user can regenerate
8. Force refresh: `?force=1` query param bypasses cache
9. AI quota exhausted: button shows amber "Analysis unavailable", clicking retry returns cached if available
10. Partial data: missing adapters (e.g., shareholding unavailable) result in "Data unavailable" placeholders in those sections, rest of report generates normally
11. AI parse failure: retry once with simplified prompt; if still fails, return error state
12. Mobile (375px): panel renders as stacked cards, no horizontal overflow
13. Existing company page tabs (CorporateDataTabs, PiotroskiFScore, charts) unaffected

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| NSE API failure for one adapter | Skip that section, include null in prompt, AI acknowledges gap | `warn` |
| All adapters fail | Return error state, don't call AI | `error` |
| AI quota exhausted | Return cached if available, else error with quota message | `warn` |
| AI returns unparseable response | Retry once with simplified prompt; if fails, return error | `error` |
| DB cache write failure | Log error, return report without caching (non-fatal) | `error` |
| Invalid symbol | 400 with validation error | `warn` |
| AI timeout | Return cached if available, else error | `warn` |
| Partial data (some null adapters) | Proceed with available data, AI notes gaps in analysis | `info` |

---

## 12. Test Strategy

### Unit Tests (`lib/__tests__/intelligence.test.ts`)

- [ ] `getInvestmentIntelligence` returns cached data when valid cache exists
- [ ] `getInvestmentIntelligence` generates fresh data when cache expired
- [ ] `getInvestmentIntelligence` with `force: true` bypasses cache
- [ ] `getInvestmentIntelligence` handles partial adapter failures gracefully
- [ ] `getInvestmentIntelligence` handles AI quota exhaustion (returns cached or error)
- [ ] `getInvestmentIntelligence` handles AI parse failure (retries once)
- [ ] `getInvestmentIntelligence` handles all-adapters-fail scenario
- [ ] Cache TTL expiry is respected
- [ ] Version increments on each regeneration

### Unit Tests (`lib/__tests__/intelligence-prompt.test.ts`)

- [ ] `buildIntelligencePrompt` includes all available data sections
- [ ] `buildIntelligencePrompt` handles null adapter data gracefully
- [ ] `parseIntelligenceResponse` parses valid JSON correctly
- [ ] `parseIntelligenceResponse` extracts JSON from markdown fences
- [ ] `parseIntelligenceResponse` returns null for unparseable input
- [ ] `parseIntelligenceResponse` normalizes missing optional fields

### Unit Tests (`lib/__tests__/intelligenceCache.test.ts`)

- [ ] `getIntelligenceFromCache` returns null for missing symbol
- [ ] `getIntelligenceFromCache` returns null for expired entry
- [ ] `getIntelligenceFromCache` returns valid entry for fresh cache
- [ ] `setIntelligenceCache` upserts correctly
- [ ] `invalidateIntelligenceCache` deletes specific symbol
- [ ] `invalidateIntelligenceCache` deletes all when no symbol

### Unit Tests (`lib/__tests__/technical-analysis.test.ts` additions)

- [ ] `computeATR` returns correct values for known OHLC data
- [ ] `computeATR` handles empty bars array
- [ ] `findSupportResistance` identifies pivot highs/lows
- [ ] `findSupportResistance` handles insufficient data

### Unit Tests (`lib/__tests__/adapters.test.ts`)

- [ ] `fetchIntelligenceQuoteData` returns normalized QuoteData
- [ ] `fetchIntelligenceTechnicals` computes all indicators
- [ ] `fetchIntelligenceValuation` derives metrics from quote data
- [ ] Adapter functions handle NSE API failures gracefully (return null)
- [ ] Adapter functions respect caching patterns

### E2E Tests

- [ ] Company page renders intelligence button
- [ ] Click idle button → loading state → ready state
- [ ] Panel expands with sections
- [ ] Cached data loads on second visit
- [ ] Mobile (375px) renders without overflow

---

## 13. Performance Considerations

- **Write-through cache**: AI analysis stored in both in-memory `NodeCache` (~1ms reads) and Prisma `IntelligenceCache` (persistent). Memory is the fast path; DB is the durability layer.
- **Cache restoration**: On service startup, `restoreIntelligenceCacheFromDB()` bulk-loads all non-expired entries into memory — no cold-start penalty.
- **Individual NSE data**: Uses existing 3-tier cache (memory → `market_cache` DB → NSE HTTP)
- **Parallel fetching**: All 8 adapter calls run in parallel via `Promise.allSettled`
- **Partial data**: Missing adapters don't block — null values passed to AI with gap acknowledgment
- **AI call**: Single call with `maxTokens: 8192` (adequate for structured JSON report)
- **DB index**: `IntelligenceCache` indexed on `[symbol, expiresAt]` for fast lookup + startup bulk-load
- **Lazy panel**: Panel only fetches on button click, not on page load
- **Rate limiting**: Intelligence generation is user-triggered (not cron), no NSE rate-limit concern

---

## 14. Security Considerations

- **Auth**: ALL intelligence routes require authenticated session (`auth()` from `@/lib/auth`). Unauthenticated requests return 401.
- **Audit logging**: Every intelligence request (GET + POST) is audit-logged via `createAuditLog()` with: action (`INTELLIGENCE_REQUESTED`), userId, symbol, force flag, cache hit, and result status.
- **Input validation**: Symbol param validated via Zod (alphanumeric + dots, max 20 chars). Invalid symbols return 400.
- **Rate limiting**: Apply existing rate-limit middleware to intelligence endpoint (10 req/min per IP, 20 req/min per user for authenticated requests).
- **Cache isolation**: Symbol-keyed cache — no cross-symbol data leakage. Cache is shared across all users (market data is public).
- **AI safety**: Prompt instructs AI to cite specific numbers, never fabricate data, acknowledge gaps.
- **No secrets in AI prompt**: All data is market data, no user credentials or API keys passed to LLM.
- **Session validation**: `session.user.id` is extracted from JWT, never trusted from client headers.

---

## 15. Definition of Done

> checkboxes that MUST all pass before the feature is complete.

- [ ] All adapter functions implemented in `lib/market-data/nse/adapters.ts`
- [ ] `computeATR` and `findSupportResistance` added to `lib/screener/technical-analysis.ts`
- [ ] All type definitions in `lib/services/intelligenceTypes.ts`
- [ ] Prompt builder + parser in `lib/services/ai/intelligence-prompt.ts`
- [ ] Orchestrator in `lib/services/ai/intelligence.ts`
- [ ] Cache layer in `lib/services/intelligenceCache.ts`
- [ ] `IntelligenceCache` Prisma model + migration applied
- [ ] `npx prisma generate` run
- [ ] Intelligence API routes require authenticated session (401 for unauthenticated)
- [ ] Every intelligence request is audit-logged with userId + symbol
- [ ] GET/POST API routes in `app/api/company/[symbol]/intelligence/route.ts`
- [ ] MCP function `getInvestmentIntelligence` added
- [ ] IntelligenceButton component with all states (including unauthenticated)
- [ ] IntelligencePanel + all 12 section components
- [ ] Company page wired with button + panel (disabled state when not logged in)
- [ ] All unit tests written and passing (`npm run test`)
- [ ] `npx tsc --noEmit` — 0 new errors (baseline: 46)
- [ ] `npm run lint` — no warnings
- [ ] UI states (loading/empty/error/data/unauthenticated) all implemented
- [ ] Responsive at 375px, 768px, 1440px
- [ ] Dark/light mode renders correctly
- [ ] Audit trail: `INTELLIGENCE_REQUESTED`, `INTELLIGENCE_GENERATED`, `INTELLIGENCE_CACHE_HIT`, `INTELLIGENCE_FAILED`, `INTELLIGENCE_UNAUTHORIZED`
- [ ] Error handling per section 11
- [ ] Documentation updated (AGENTS.md, CHANGELOG, TODO, Primer, agent-memory)
- [ ] Live-verified on :3000 (login required, verify 401 for unauthenticated)
- [ ] 0 console errors in browser
