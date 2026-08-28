# v3.21.0 — Professional Equity Research Decision Engine (deep upgrade of AI Investment Intelligence)

> **Date**: Aug 28 2026 · **Branch**: `feat/stock-analysis-skill` · **Suite**: 915 pass / 4 skip (+32 vs 883) · **tsc**: 46 = baseline (0 production errors)

## Problem

The v3.18.0 "AI Investment Intelligence" pipeline produced a shallow 3-verdict (BUY/HOLD/SELL) + confidence output with a handful of sections. For a serious equity-research product the output needed to be a professional decision engine: an 8-level verdict, a conviction score, an institutional-grade memo (fair-value, valuation zones, bull/base/bear scenarios, contrarian view, management DNA, portfolio action, thesis invalidation), honest acknowledgment of missing data, and optional user-supplied document ingestion (annual report / earnings-call transcript) to ground the analysis.

## Solution

A deep **in-place upgrade** of the existing intelligence pipeline (no duplicate pipeline). The orchestrator now uses a new prompt/parser (8-verdict, full memo) while legacy `buildIntelligencePrompt`/`parseIntelligenceResponse` are kept as unchanged wrappers so all existing prompt tests pass. All NEW `IntelligenceAnalysis` fields are **optional** so legacy cached rows and existing test literals stay type-valid — **no schema migration required**.

## Architecture

```
Company page (CompanyIntelligence.tsx)
  ├─ document textareas (annual report / concall, 50KB cap each) → POST body
  ├─ /api/company/[ticker]/intelligence  (Zod validates documents, 400 on invalid)
  └─ getInvestmentIntelligence(symbol, { documents })
       ├─ normalizeDocumentText() (trim, collapse ws, …[truncated], empty→"", 50K cap)
       ├─ cache-first → 8 parallel NSE adapters (Promise.allSettled, null-tolerant)
       ├─ buildStockAnalysisPrompt(input, docs)  → directPrompt + modelFallbackChain
       ├─ parseStockAnalysisResponse(raw)  (8-verdict, conviction /10, 6 pillars, memo)
       ├─ retry (simplified 8-verdict prompt) on parse failure
       └─ audit: modelUsed/verdict/conviction/confidence/hasDocuments/partialData
```

## Files Created

| File | Purpose |
|------|---------|
| `lib/services/document/normalize.ts` | `normalizeDocumentText(content, maxLen=50_000)` — trim, collapse whitespace/blank runs, truncate with `…[truncated]` marker, empty/`""` for non-string; never throws. (NO `import "server-only"` — resolves to unrelated parent path that throws and breaks Jest; kept as convention-comment.) |
| `app/components/intelligence/sections/ManagementDnaSection.tsx` | Management DNA (score, positives/concerns, guidance credibility, capital allocation, promoter behavior, verdict) |
| `app/components/intelligence/sections/ValuationZonesSection.tsx` | Attractive/Fair/Over bands with current-price marker + assumptions |
| `app/components/intelligence/sections/ContrarianSection.tsx` | Market belief vs what-if-wrong, supporting/contradicting, what-would-change-my-mind |
| `app/components/intelligence/sections/PortfolioActionSection.tsx` | positionSizing badge (CORE/SATELLITE/SPECULATIVE/WATCHLIST/NONE), existing-holder/new-investor action |
| `app/components/intelligence/sections/DataGapsBanner.tsx` | Lists missing data points (evidence-honesty banner) |
| `app/components/intelligence/sections/TechnicalStructureSection.tsx` | trend/price-vs-MAs/RSI/volume/support/resistance/marketPhase + verdict |
| `app/components/intelligence/sections/FundamentalScoreSection.tsx` | score/10 + evidence tags (CALCULATED_METRIC, FACT, MANAGEMENT, INFERENCE, INTERPRETATION) |
| `app/components/intelligence/sections/ShareholdingAnalysisSection.tsx` | promoter/FII/DII interpretation |
| `app/components/intelligence/sections/ExecutiveThesisSection.tsx` | one-sentence thesis + three biggest reasons |
| `lib/__tests__/stock-analysis-prompt.test.ts` | NEW prompt+parser tests (21) |
| `lib/__tests__/document-normalize.test.ts` | NEW normalize tests (9) |

## Files Modified

| File | Change |
|------|--------|
| `lib/services/intelligenceTypes.ts` | + `Verdict` (8-level: STRONG_BUY/BUY/ACCUMULATE/HOLD/REDUCE/SELL/STRONG_SELL/AVOID), `EvidenceLabel`, `MarketPhase`, `EvidencePoint`, `ManagementDna`, `ValuationZones`, `RiskItem` (now object with category/probability/impact/earlyWarning/pricedIn), `ContrarianView`, `PortfolioAction`, `DataGap`; expanded `IntelligenceAnalysis` (all new fields optional `?`) |
| `lib/services/ai/intelligence-prompt.ts` | Legacy `buildIntelligencePrompt`/`parseIntelligenceResponse` KEPT unchanged. + `StockAnalysisDocuments`, `buildStockAnalysisPrompt(input, documents?)` (8-verdict contract, conviction /10 + confidence /100, 6 pillars, evidence labels, valuation zones, scenario, contrarian, portfolio action, invalidation, data gaps; docs appended as secondary-unverified sections), `parseStockAnalysisResponse(raw)` (normalizes to expanded `IntelligenceAnalysis`, never throws, null-coalesces/backward-compatible, derives conviction from verdict when missing) |
| `lib/services/ai/intelligence.ts` | Orchestrator: `IntelligenceOptions.documents?`; normalize docs (whitespace-only → `hasDocuments:false`); pass to `buildStockAnalysisPrompt`; parse + retry via new functions; audit metadata `modelUsed/verdict/conviction/confidence/hasDocuments/partialData` |
| `lib/services/intelligence/adapters.ts` | `fetchTechnicalsData` fetch window 90→280 days so `sma200` computes best-effort with ≥250 bars (else null → data gap) |
| `app/api/company/[ticker]/intelligence/route.ts` | POST body Zod `{ force?: boolean, documents?: { annualReport?: string, concall?: string } }` (each max 50_000); 400 on invalid; audit `hasDocuments` |
| `app/components/intelligence/VerdictCard.tsx` | Rewritten for 8 verdicts (distinct color/emoji) + conviction /10 bar (defaults to `Math.round(confidence/100*10)`); "Decision Engine" header suffix when new fields present |
| `app/components/intelligence/RiskCatalystMatrix.tsx` | Accepts `RiskItem[]` + `catalysts: string[]`; category badge, probability/impact, earlyWarnings, pricedIn flag |
| `app/components/intelligence/IntelligencePanel.tsx` | Composes new memo sections with legacy fallbacks (`technicalStructure` else `TechnicalSummary`, `fundamentalScore` else `FundamentalInsights`, `shareholdingAnalysis` else `ShareholdingTrend`) |
| `app/components/intelligence/CompanyIntelligence.tsx` | Collapsible document textareas (annual report / concall, 50KB client cap, Clear button); sends `documents` in POST only when non-empty |
| `lib/__tests__/intelligence.test.ts` | +3 orchestrator tests (documents→prompt contains doc text; `hasDocuments:true` audit; whitespace docs → false) |

## Key Design Decisions

1. **Backward compatibility**: legacy 3-verdict prompt/parser kept unchanged (18 tests pass); legacy cached reports render via null-coalescing in the UI; legacy JSON parses onto the 8-level enum (BUY/HOLD/SELL valid members). All new `IntelligenceAnalysis` fields optional → **no DB migration**.
2. **server-only import removed** from `normalize.ts` — package is not a declared dependency and resolves to an unrelated parent `node_modules` that always throws (breaks the Jest loader). Kept as a convention comment only.
3. **Document grounding**: user pastes annual-report/concall text (raw text only — MarkItDown/PDF explicitly deferred). Documents are appended to the prompt as **secondary-unverified** sections so the model treats them as supplementary, not authoritative.
4. **Evidence discipline**: every qualitative claim is tagged with an evidence label (FACT/METRIC/INTERPRETATION/INFERENCE/MANAGEMENT); missing data is surfaced in `dataGaps` (shown in the DataGapsBanner) rather than fabricated.
5. **Whitespace-only doc gotcha fixed**: `hasDocuments` now reflects whether any *normalized* document has content (whitespace-only docs aren't counted).

## Verification

- `npx jest document-normalize stock-analysis-prompt intelligence-prompt intelligence --silent` → 57/57.
- Full `npx jest --silent` → **66 suites, 915 pass / 4 skip** (+32 vs 883 baseline).
- `npx tsc --noEmit` → **46 errors, ALL pre-existing** (test-file jest-dom matcher noise + known `scripts/test-prod-db.ts` LSP); **0 new production errors**.
- Playwright UI rendered on company page (desktop + mobile), 0 console errors.

## Note

There is no `v3.21.0` deploy gate note beyond "user merges PR so Netlify rebuilds". Document ingestion is currently **raw-text only**; MarkItDown/PDF and chart-vision remain future enhancements.
