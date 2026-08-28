# Spec Document — Stock Analysis Skill: Professional Equity Research Decision Engine (Deep Upgrade of AI Intelligence)

> For review and approval before any implementation (spec-driven development gate).
> Save: `.agents/specs/03-stock-analysis-skill.md`

## 1. Overview

**What**: Deeply upgrade the existing v3.18.0 "AI Investment Intelligence" pipeline into a full
professional equity-research decision engine following the user's "Professional Equity Research &
Investment Analysis" framework: a 12-section institutional investment memorandum with an **8-level
verdict** (STRONG BUY → AVOID), **conviction /10**, **entry/fair/overvaluation zones**, **bull/base/bear
scenarios**, **contrarian test**, **thesis-invalidation conditions**, **portfolio action** (existing vs new
investor), strict **evidence discipline** (VERIFIED FACT / CALCULATED METRIC / ANALYST INTERPRETATION /
INVESTMENT INFERENCE), **management DNA analysis**, and optional **manual document ingestion**
(annual report / concall text) treated as secondary evidence with missing material recorded as data gaps.
Output is structured JSON rendered in the company page UI.

**Why**: The current intelligence gives only a 3-level verdict (BUY/HOLD/SELL) + flat confidence and
renders a summary panel. It does not force the model to answer "what is the market pricing in and is
that assumption justified by actual business performance", does not analyze management credibility,
does not compute conviction/zones/portfolio action, and ignores user-supplied fundamental documents.
The user explicitly wants a decision-oriented, evidence-based institutional-memo output, not a generic
AI stock summary.

**Scope (IN)**:
- Extend `IntelligenceAnalysis` to the full institutional-memo schema (all fields in section 4).
- Rewrite the prompt builder + parser to the 8-verdict + conviction + zones + management-DNA + portfolio-action
  framework with evidence typing and data-gap honesty.
- Add optional per-request document text ingestion (annual report + concall as secondary evidence). Accepted as
  **raw text / pasted .md** only (no PDF conversion — MarkItDown deferred; PDFs would be recorded as a data gap).
  Documents are **in-memory, not persisted** to a new table.
- Upgrade the company-page UI to render all memo sections.
- Extend existing adapters where cheap/possible (shareholding, peers, sma200) with fallback-first behavior.
- Add a strict "data unavailable" discipline: the model must state it rather than invent numbers.
- Tests + docs.

**Scope (OUT)**:
- NO new scraper/anti-bot bypass of NSE/Screener/Tijori/TradingView. Live discovery is best-effort fallback-first;
  inaccessible material is recorded as a data gap (per user's caveat).
- NO chart screenshot / vision-model analysis. Text-technicals only (computed indicators from NSE daily bars).
- NO new Prisma model / migration (document text is session-only in-memory; reuses existing `IntelligenceCache`).
- NO new duplicate pipeline — reuse endpoint, cache, adapters, company-page wiring.

**Depends on**: v3.18.0 AI Intelligence (types, adapters, cache, endpoint, CompanyIntelligence UI). No new
dependency (see section 6).

---

## 2. Routes

### New Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| — | — | — | None. Reuse existing `GET/POST /api/company/[ticker]/intelligence`. |

### Modified Routes
| Method | Path | Change |
|--------|------|--------|
| POST | `/api/company/[ticker]/intelligence` | Accept optional `{ force, documents: { annualReport?, concall? } }` in body. Pass documents to orchestrator. Adds `conviction`, `verdictMap` fields in response payload. |

> GET stays for cache reads (no document body on GET). POST is the document-aware entry point.

---

## 3. Database Schema

**No new models, no migration.** The optional document text is **in-memory only** (passed to the
orchestrator for that single run); already-generated reports reuse the existing `IntelligenceCache`
(Prisma `IntelligenceCache` + in-memory NodeCache). The cached report shape changes (new fields on
`analysis`), but `analysis` is stored as JSON inside the existing cache envelope — no schema change.
⚠️ Existing cached rows remain readable (they just lack the new fields; parser/UI must null-coalesce).

**Migration Notes**: N/A — no migration.

---

## 4. Functions to Implement / Modify

### A. `lib/services/intelligenceTypes.ts` (MODIFIED)

Extend/expand the analysis types:

```ts
export type Verdict =
  | "STRONG_BUY" | "BUY" | "ACCUMULATE" | "HOLD"
  | "REDUCE" | "SELL" | "STRONG_SELL" | "AVOID";

export type EvidenceLabel =
  | "VERIFIED_FACT" | "CALCULATED_METRIC" | "ANALYST_INTERPRETATION" | "INVESTMENT_INFERENCE";

export type MarketPhase =
  | "ACCUMULATION" | "MARKUP" | "DISTRIBUTION" | "MARKDOWN" | "BASE";

export interface EvidencePoint { label: EvidenceLabel; text: string; period?: string; source?: string; }

export interface ManagementDna {
  score: number;                // 0-10
  positives: string[];
  concerns: string[];
  guidanceCredibility: string;  // conservative | reliable | promotional | unclear
  capitalAllocation: string;
  promoterBehavior: string;     // incl. pledge status
  verdict: string;
}

export interface ValuationZones { attractiveLow?: number; attractiveHigh?: number; fairLow?: number; fairHigh?: number; overLow?: number; overHigh?: number; assumptions: string[]; }

export interface RiskItem { risk: string; category: "COMPANY" | "SECTOR" | "MACRO"; probability: string; impact: string; earlyWarning: string; pricedIn: boolean; }

export interface ContrarianView { marketBelief: string; whatIfWrong: string; supporting: string[]; contradicting: string[]; }

export interface PortfolioAction { existingHolder: string; newInvestor: string; positionSizing: "CORE" | "SATELLITE" | "SPECULATIVE" | "WATCHLIST"; }

export interface IntelligenceAnalysis {
  // (extend existing fields; keep backward-compatible keys where possible)
  verdict: Verdict;
  conviction: number;                 // 0-10
  confidence: number;                 // 0-100 (kept for continuity; derived)
  fairValue: { low: number; mid: number; high: number };
  valuationZones: ValuationZones;
  executiveSummary: { oneSentenceThesis: string; threeBiggestReasons: string[]; };
  fundamentalScore: { score: number; revenue: string; profit: string; margins: string; cashFlow: string; balanceSheet: string; roe: string; accountingQuality: string; verdict: string; evidence: EvidencePoint[]; };
  managementDna: ManagementDna;
  valuationReality: { current: string; historical: string; peer: string; growthAdjusted: string; conclusion: string; };
  technicalStructure: { trend: string; priceVs50: string; priceVs200: string; rsi: string; volume: string; support: number | null; resistance: number | null; marketPhase: MarketPhase; verdict: string; };
  shareholdingAnalysis: { promoter: string; promoterPledge: string; fii: string; dii: string; interpretation: string; };
  riskFactors: RiskItem[];
  catalysts: string[];
  scenarioAnalysis: { bull: string; base: string; bear: string; };
  contrarian: ContrarianView;
  whatWouldChangeMyMind: string[];
  portfolioAction: PortfolioAction;
  invalidation: { thesisInvalidation: string; entryZone: string; fairZone: string; overZone: string; holdingHorizon: string; };
  dataGaps: string[];                // explicit "Data unavailable" list
  summary: string;                   // kept (executive summary text)
}
```

### B. `lib/services/ai/intelligence-prompt.ts` (MODIFIED, or NEW `lib/services/ai/stock-analysis-prompt.ts`)

- **NEW `buildStockAnalysisPrompt(input)`**: builds the full institutional-memo prompt from the user's
  framework — 6 pillars (fundamentals, management DNA, valuation reality, technical structure, risks,
  catalysts), evidence discipline (label every conclusion FACT/METRIC/INTERPRETATION/INFERENCE), data-gap
  honesty ("Data unavailable — analysis cannot reliably determine this"), 8-verdict output contract, conviction /10,
  bull/base/bear, contrarian test, entry/fair/over zones, portfolio action, invalidation conditions.
- If user-supplied documents present, append `## User-Supplied Documents` sections (annual report, concall)
  as additional context with the note they are secondary/unverified.
- **NEW `parseStockAnalysisResponse(raw)`**: JSON parser handling markdown fences → braces extraction,
  normalizing to the expanded `IntelligenceAnalysis`. Never throws. Forward/backward compatible (fills
  missing new fields with defaults + appends to `dataGaps`).
- Keep the existing `buildIntelligencePrompt`/`parseIntelligenceResponse` as thin wrappers over the new
  ones for backward compatibility (existing callers/tests), OR migrate callers — decide in plan; prefer
  keep-wrappers to avoid breaking the 18 existing prompt tests.

### C. `lib/services/ai/intelligence.ts` (MODIFIED — orchestrator)

- Accept optional `documents?: { annualReport?: string; concall?: string }` in `IntelligenceOptions`.
- Pass documents into the prompt builder.
- Normalize verdict from 8-level enum for audit (`INTELLIGENCE_GENERATED` metadata includes `verdict`
  + `conviction`).
- On 3-verdict-only legacy cache rows, keep as-is (UI null-coalesces).
- **NEW `lib/services/ai/stockAnalysisService.ts`** (thin) if separation is cleaner: `getStockAnalysis(symbol, {documents, force, userId})`
  → routes to the same orchestrator path. Decide in plan (avoid duplication; likely reuse `intelligence.ts` directly).

### D. `lib/services/intelligence/adapters.ts` (MODIFIED — best-effort enrichment)

- `fetchTechnicalsData`: attempt 200-day window for `sma200` when ≥200 bars available (currently 90d
  returns `sma200: null`). Keep 90d default if only 90 fetchable; enrich when `daily_prices` has 200+ bars.
- `fetchShareholdingData` / `fetchPeersData` / `fetchNewsData`: keep `null` fallback (rarely available) but
  ensure they NEVER throw and populate `dataGaps` in the orchestrator when these are null.
- **NOT in scope**: adding new NSE endpoints for shareholding/peers (anti-bot; data-gap discipline).

### E. `lib/services/document/` (NEW, small)

Raw-text ingestion helper (server-only). **No MarkItDown / no new dependency.**

- `normalizeDocumentText(content: string, maxLen: number): string` — trims, collapses excessive whitespace,
  truncates to `maxLen` (default 50_000 chars) with an appended `…[truncated]` marker, and returns safe text.
  Never throws on empty input (returns `""`).
- Pure function, no I/O; place under `lib/services/document/` and guard with `import "server-only"` so it is
  never bundled into client components.

### F. `app/api/company/[ticker]/intelligence/route.ts` (MODIFIED — POST body)

- Zod: optional `documents?: { annualReport?: string; concall?: string }` (each max ~50KB to bound prompt).
- Pass to orchestrator. Response already returns `report`; no shape break (report.analysis grows).
- Audit metadata includes `hasDocuments`.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/intelligenceTypes.ts` | Modified | Expand `IntelligenceAnalysis` + new types (Verdict, EvidencePoint, etc.) |
| `lib/services/ai/intelligence-prompt.ts` | Modified | New 8-verdict memo prompt builder + parser (wrappers kept) |
| `lib/services/ai/intelligence.ts` | Modified | Orchestrator: optional documents, conviction/verdict audit |
| `lib/services/intelligence/adapters.ts` | Modified | sma200 best-effort; ensure null-safe data-gap population |
| `app/api/company/[ticker]/intelligence/route.ts` | Modified | POST body `documents` zod + pass-through |
| `lib/services/document/normalize.ts` | **Created** | Raw-text normalize/truncate (server-only, no dep) |
| `app/components/intelligence/IntelligencePanel.tsx` | Modified | Render new memo sections |
| `app/components/intelligence/sections/` | Modified/Added | Extend/replace section components for the 12-section memo |
| `app/components/intelligence/CompanyIntelligence.tsx` | Modified | Accept optional document text inputs for POST |
| `lib/audit.ts` | Modified | Add audit tags (e.g., `STOCK_ANALYSIS_GENERATED`) if new action names needed |
| `lib/__tests__/stock-analysis-prompt.test.ts` | **Created** | Prompt + parser tests |
| `lib/__tests__/stock-analysis-service.test.ts` | **Created** | Orchestrator + documents tests |
| `lib/__tests__/document-normalize.test.ts` | **Created** | normalize/truncate pure-function tests |
| `AGENTS.md`, `.agents/CHANGELOG.md`, `versions-v3.21.md`, `Primer.md`, `agent-memory.md`, `Lessons.md` | Modified | Mandatory docs |

---

## 6. Dependencies

### New Packages
| Package | Version | Reason |
|---------|---------|--------|
| None | — | **No new dependency.** MarkItDown deferred (raw-text ingestion only; PDF converted by user or recorded as a data gap). |

### Internal Dependencies
| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/prisma` | `IntelligenceCache` | Persist generated reports |
| `@/lib/logger` | `logger.info/warn/error` | Structured logging |
| `@/lib/audit` | `createAuditLog` | Audit trail |
| `lib/services/ai/llm-provider` | `directPrompt`, `isQuotaExhausted`, `QUOTA_EXHAUSTED_MESSAGE` | AI call |
| `lib/services/ai/modelChain` | `modelFallbackChain` | Model fallback |
| `@/lib/stock-service` | `getStockQuote` | Quote adapter |
| `@/lib/screener/technical-analysis` | indicator fns | Technicals adapter |

---

## 7. API Contract

### GET /api/company/[ticker]/intelligence — unchanged (cache reads; no documents)

### POST /api/company/[ticker]/intelligence

**Body (optional):**
```json
{ "force": false, "documents": { "annualReport": "...text or pasted...", "concall": "...text..." } }
```

**Response (200):** `{ success, status, symbol, report }` where `report.analysis` is the expanded
`IntelligenceAnalysis` (8-verdict enum, conviction, zones, managementDna, etc.). All new fields present
(parser fills defaults); `dataGaps` lists what was unavailable.

**Response (400):** invalid ticker or document too large (> ~50KB each).

**Response (401):** unauthenticated. **Response (503):** quota exhausted.

---

## 8. UI/UX Requirements

Mirror the existing `CompanyIntelligence` → `IntelligencePanel` structure. Add document input in the panel
(optional) and render all 12 memo sections. Keep the existing section components where they still fit
(VerdictCard, FairValueGauge, TechnicalSummary, FundamentalInsights, ValuationView, NewsCatalystList,
ShareholdingTrend, CorporateActionsSummary, RiskCatalystMatrix, ScenarioAnalysis, ExecutiveSummary).

### New/updated components (in `app/components/intelligence/`)
- `VerdictCard.tsx` — map 8 verdicts → distinct color/emoji (STRONG_BUY green, BUY green, ACCUMULATE light-green,
  HOLD amber, REDUCE orange, SELL red, STRONG_SELL dark-red, AVOID gray) + conviction /10 bar (in addition to confidence).
- `DocumentInput.tsx` (**Created**) — optional annual-report + concall text/PDF inputs (POST body).
- `ManagementDnaSection.tsx` (**Created**) — management DNA (positives/concerns/guidance/capital allocation/promoter).
- `ValuationZonesSection.tsx` (**Created**) — attractive/fair/over zones + assumptions.
- `ContrarianSection.tsx` (**Created**) — market belief, what-if-wrong, supporting/contradicting evidence.
- `PortfolioActionSection.tsx` (**Created**) — existing vs new investor action + position sizing.
- `DataGapsBanner.tsx` (**Created**) — amber note listing unavailable data points (honesty).
- `IntelligencePanel.tsx` — compose the new sections; keep backwards compatible with legacy reports (null-coalesce).

### States
- **Loading**: existing skeletons.
- **Empty**: existing.
- **Error**: existing (failed/quota).
- **Data**: render memo; if `dataGaps.length`, show DataGapsBanner; if document text provided, show a small
  "Included: Annual Report · Concall" chip.

### Responsive
- Desktop 1440px full grid; tablet 768px stacked; mobile 375px single column, tables scroll horizontally. Dark/light both.

---

## 9. Rules & Guardrails

- [ ] No Prisma in client components
- [ ] Document normalize is server-only (`import "server-only"`), never client import
- [ ] All POST-body inputs validated via Zod (ticker + document size bounds)
- [ ] Errors return safe defaults; Parser never throws
- [ ] Logging via `@/lib/logger` only
- [ ] AI call via existing `directPrompt` + `modelFallbackChain` + quota guard
- [ ] Backward-compatible prompt/parser (keep wrappers so existing 18 prompt tests pass)
- [ ] Cache reuse (in-memory + IntelligenceCache); new report shape stored as JSON in existing envelope
- [ ] No new NSE scraping/anti-bot bypass; data-gap discipline
- [ ] Audit trail for generated runs
- [ ] Evidence discipline enforced in prompt (no invented numbers; "Data unavailable" honesty)

---

## 10. Expected Behavior

1. `buildStockAnalysisPrompt(input)` yields a prompt containing all 6 pillars and the 8-verdict output contract.
2. `parseStockAnalysisResponse` returns a fully-populated `IntelligenceAnalysis` with `verdict` ∈ 8-level
   enum, `conviction` 0-10, `valuationZones`, `managementDna`, `contrarian`, `portfolioAction`, `invalidation`, `dataGaps`.
3. Missing new fields in a response (or a legacy cached row) are null-coalesced to defaults, and the
   missing concern is appended to `dataGaps` where determinable.
4. POST with `documents.annualReport` → prompt includes the doc text + data-gap note; response `dataGaps`
   excludes annual-report gap.
5. `normalizeDocumentText` truncates oversized documents with a `[truncated]` marker; empty input → `""`.
6. Document text is NOT persisted to a new table (in-memory only); `IntelligenceCache` still stores the report.
7. VerdictCard renders all 8 verdict variants with correct colors/emojis + conviction bar.
8. DataGapsBanner shows when `dataGaps.length > 0`.
9. Existing cached 3-verdict reports still render (null-coalesced) without error.
10. `npx tsc --noEmit` adds 0 new errors beyond baseline (57); suite passes (883/4 plus new tests).

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Document text > size bound | Zod reject → 400 | warn |
| Empty document text | ignored (treated as not provided) | info |
| AI parse fails (new schema) | retry simplified prompt → on fail status `failed` | error |
| All adapters null | status `failed`, safe default, dataGaps populated | warn |
| Legacy cached row missing new fields | null-coalesce; no throw | info |
| AI quota exhausted | status `quota_exhausted`, 503 | warn |
| NSE adapter failure | adapter → null (never throws); dataGaps entry | warn |

---

## 12. Test Strategy

### Unit Tests
- **`lib/__tests__/stock-analysis-prompt.test.ts`** (NEW, ~20):
  - prompt contains 6 pillars + 8-verdict contract + evidence labels + data-gap honesty instruction
  - with documents → includes doc sections; without → no doc sections
  - parser: full JSON → all fields; markdown-fence JSON; braces extraction; missing new fields → defaults +
    dataGaps; legal 8 verdicts each map correctly; malformed → null
  - backward compat: legacy 3-verdict-shaped JSON still parses to a valid 8-level verdict (BUY/SELL/HOLD)
- **`lib/__tests__/stock-analysis-service.test.ts`** (NEW, ~8):
  - orchestrator passes documents to prompt; conviction+verdict in audit metadata; dataGaps populated when
    adapters null; cache hit skips prompt; force regenerates.
- **`lib/__tests__/document-normalize.test.ts`** (NEW, ~5): normalize whitespace; truncate with marker; empty → `""`;
  `server-only` guard import resolves.
- Update/extend `intelligence-prompt.test.ts` (existing 18) + `intelligence.test.ts` (10) for new shape —
  keep passing.

### Integration
- POST route with documents → 200 + expanded report; oversized docs → 400; unauth → 401.

### E2E (`e2e/`)
- Company page: intelligence panel renders expanded memo (8-verdict card, conviction, zones, management DNA);
  document-input chip shows when documents provided; data-gaps banner renders when gaps present.

---

## 13. Performance Considerations

- **No new DB writes beyond existing cache** (report JSON in `IntelligenceCache`); document text in-memory only.
- Prompt size bounded (documents capped ~50KB each) to avoid token blowup; long docs truncated with data-gap note.
- Adapters already parallel (`Promise.allSettled`); unchanged.
- sma200 enrichment only when `daily_prices` has ≥200 bars (single query, existing timeseries path).

---

## 14. Security Considerations

- **Auth**: POST/GET require session (`auth()`), same as existing.
- **Input**: ticker Zod-validated; documents Zod string with size caps; no HTML/script execution (rendered as text).
- **Secrets**: none added. No shell invocation (MarkItDown explicitly out of scope — nothing to inject into).
- **RBAC**: unchanged (any authenticated user, same as existing intelligence).
- **Dependency**: none added.

---

## 15. Definition of Done

- [ ] All typed fields per section 4 implemented
- [ ] All files created/modified per section 5
- [ ] POST route accepts documents + returns expanded report per section 7
- [ ] No Prisma schema change; cache envelope reused
- [ ] `npx prisma generate` not needed (no schema change) — confirm
- [ ] Unit tests written + passing (`npm run test`) — new + existing intelligence tests pass
- [ ] `npx tsc --noEmit` passes (0 new beyond baseline 57)
- [ ] `npm run lint` passes
- [ ] UI renders all 12 memo sections + data-gaps banner + document chip
- [ ] Legacy cached reports still render (null-coalesced)
- [ ] Responsive 375/768/1440 + dark/light
- [ ] Audit trail for generated runs
- [ ] No new NSE scraper/anti-bot code; data-gap discipline honored
- [ ] Documentation updated (AGENTS.md, CHANGELOG, versions-v3.21, TODO, Primer, agent-memory, Lessons)
- [ ] Live-verified on :3000 (UI change) — 0 console errors
- [ ] Playwright e2e: company-page intelligence expanded memo renders
