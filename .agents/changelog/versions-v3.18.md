# v3.18.0 — AI Investment Intelligence

> Branch: `feature/ai-intelligence` · Date: Aug 19 2026

## Summary

Company-level AI analysis — comprehensive investment intelligence for every NSE equity, combining real-time NSE data, fundamentals, technicals, news, shareholding, corporate intelligence, and LLM synthesis into a professional-grade investment report accessible via the `/company/[ticker]` page.

## What Changed

### Backend (6 files created, 3 modified)

| File | Change |
|------|--------|
| `lib/services/intelligenceTypes.ts` | **NEW** — 14 TypeScript interfaces (QuoteData, TechnicalsData, ValuationData, FundamentalsData, ShareholdingData, CorporateData, NewsData, PeersData, IntelligenceInput, IntelligenceAnalysis, IntelligenceReport) |
| `lib/screener/technical-analysis.ts` | **MODIFIED** — added `computeATR(bars, period=14)` and `findSupportResistance(bars)` |
| `prisma/schema.prisma` | **MODIFIED** — added `IntelligenceCache` model (`@@unique([symbol])`, `@@index([symbol, expiresAt])`) |
| `lib/audit.ts` | **MODIFIED** — added 5 intelligence audit tags (INTELLIGENCE_REQUESTED, INTELLIGENCE_GENERATED, INTELLIGENCE_CACHE_HIT, INTELLIGENCE_FAILED, INTELLIGENCE_UNAUTHORIZED) |
| `lib/services/intelligence/cache.ts` | **NEW** — write-through dual-layer cache: in-memory NodeCache (~1ms) + Prisma IntelligenceCache (persistent DB); reads memory→DB→restore-to-memory; DB writes fire-and-forget; `restoreIntelligenceCacheFromDB()` for startup restore |
| `lib/services/intelligence/adapters.ts` | **NEW** — 8 NSE data adapters (quote, technicals, valuation, fundamentals, shareholding→null, corporate, news→null, peers→null); all try/catch→return null (never throw) |
| `lib/services/ai/intelligence-prompt.ts` | **NEW** — structured JSON prompt builder + parser with markdown-fence extraction; never throws on bad input |
| `lib/services/ai/intelligence.ts` | **NEW** — orchestrator: cache-first → parallel adapter fetch → prompt → `directPrompt()` + `modelFallbackChain()` → parse → cache store → audit return; `isQuotaExhausted()` guard; partial failure tolerance (Promise.allSettled) |
| `app/api/company/[ticker]/intelligence/route.ts` | **NEW** — GET (with `?force=1`) + POST endpoints; auth required, Zod validation, audit logging |
| `app/api/mcp/route.ts` | **MODIFIED** — added `getInvestmentIntelligence` MCP function (29 total) |
| `instrumentation.ts` | **MODIFIED** — added `restoreIntelligenceCacheFromDB()` call on startup |

### UI (14 files created)

| File | Description |
|------|-------------|
| `app/components/intelligence/CompanyIntelligence.tsx` | Client wrapper — manages auth state, button state machine, API calls, loading/error states |
| `app/components/intelligence/IntelligenceButton.tsx` | 5-state button: unauthenticated, idle, loading, ready, failed |
| `app/components/intelligence/IntelligencePanel.tsx` | Expandable panel with smooth height animation; renders all 11 sections |
| `app/components/intelligence/sections/VerdictCard.tsx` | BUY/HOLD/SELL verdict with confidence bar |
| `app/components/intelligence/sections/FairValueGauge.tsx` | Visual fair value range gauge (low/mid/high + current price dot) |
| `app/components/intelligence/sections/TechnicalSummary.tsx` | Trend, support/resistance, indicator summary |
| `app/components/intelligence/sections/FundamentalInsights.tsx` | Strengths/weaknesses grid |
| `app/components/intelligence/sections/ValuationView.tsx` | Assessment + relative value text |
| `app/components/intelligence/sections/NewsCatalystList.tsx` | Positive/negative/neutral news items with arrows |
| `app/components/intelligence/sections/ShareholdingTrend.tsx` | FII/DII/promoter trend summary |
| `app/components/intelligence/sections/CorporateActionsSummary.tsx` | Recent corporate actions list |
| `app/components/intelligence/sections/RiskCatalystMatrix.tsx` | Risk factors + catalysts grid |
| `app/components/intelligence/sections/ScenarioAnalysis.tsx` | Bull/base/bear case cards |
| `app/components/intelligence/sections/ExecutiveSummary.tsx` | AI-generated summary + model/version/cache metadata |

### Wired into page

`app/company/[ticker]/page.tsx` — `CompanyIntelligence` rendered below `StockQuoteHeader`, above `NSEStockChart`. Server component fetches auth session and passes `isAuthenticated` flag.

### Tests (38 new)

| File | Tests | What |
|------|-------|------|
| `lib/__tests__/technical-analysis.test.ts` | +16 | computeATR known OHLC, empty bars; findSupportResistance pivot points, insufficient data |
| `lib/__tests__/intelligenceCache.test.ts` | 10 | Memory hit, DB→memory restore, DB write fire-and-forget, bulk restore, stats |
| `lib/__tests__/intelligence-prompt.test.ts` | 18 | Prompt includes all sections, null data handling, JSON extraction, bad input |
| `lib/__tests__/intelligence.test.ts` | 10 | Cache hit, force refresh, quota exhaustion, partial failures, parse retry, version increment |

## Root Cause / Feature Description

**Problem**: Users had to manually cross-reference NSE data, technical analysis, fundamentals, shareholding patterns, and news to form an investment thesis. No single view synthesized all data points with AI analysis.

**Solution**: A full-stack intelligence system that:
1. **Collects** real-time data via 8 parallel NSE adapters (quote, technicals, valuation, fundamentals, shareholding, corporate, news, peers)
2. **Caches** results in a write-through dual-layer cache (in-memory + persistent DB) with 7-day TTL
3. **Analyzes** via structured JSON prompt to an LLM (with model fallback chain and quota exhaustion guard)
4. **Renders** a professional-grade expandable panel with 11 semantic sections (verdict, fair value gauge, technical summary, fundamentals, valuation, news catalysts, shareholding trend, corporate actions, risk/catalyst matrix, scenario analysis, executive summary)
5. **Persists** via `IntelligenceCache` Prisma model and startup restore

## Verification

- `npx tsc --noEmit` — 46 errors (exact baseline, 0 new)
- `npm run test` — 62 suites, 852 pass, 4 skip, zero regressions
- UI wired into company page below StockQuoteHeader
- All 14 UI components handle null/missing data gracefully
