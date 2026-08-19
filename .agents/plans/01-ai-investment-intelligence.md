# Implementation Plan — AI Investment Intelligence

> Generated from spec: `.agents/specs/01-ai-investment-intelligence.md`
> Branch: `feature/ai-intelligence`
> Created: 2026-08-19

---

## Implementation Steps

### Phase 1: Foundation — Types, Technical Extensions, DB Schema, Auth/Audit Tags

1. **Create `lib/services/intelligenceTypes.ts`** — all TypeScript interfaces (QuoteData, TechnicalsData, ValuationData, FundamentalsData, ShareholdingData, CorporateData, NewsData, PeersData, IntelligenceInput, IntelligenceAnalysis, IntelligenceReport)
   → verify: `npx tsc --noEmit` (0 new errors)

2. **Add `computeATR(bars, period=14)` and `findSupportResistance(bars)`** to `lib/screener/technical-analysis.ts` — ATR = average of true ranges; S/R = pivot-point highs/lows with touch-count clustering
   → verify: `npx tsc --noEmit` (0 new errors)

3. **Add `IntelligenceCache` Prisma model** to `prisma/schema.prisma` — `@@unique([symbol])`, `@@index([symbol, expiresAt])`
   → verify: `npx prisma validate`

4. **Generate + apply migration** — `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema prisma/schema.prisma --script > migration.sql` → `npx prisma db execute --file migration.sql` → `npx prisma generate`
   → verify: `npx prisma db pull` shows `intelligence_cache` table

5. **Add audit tags** to `lib/audit.ts` — `INTELLIGENCE_GENERATED`, `INTELLIGENCE_CACHE_HIT`, `INTELLIGENCE_FAILED`, `INTELLIGENCE_REQUESTED`, `INTELLIGENCE_UNAUTHORIZED`
   → verify: tags exported

6. **Add technical analysis tests** to `lib/__tests__/technical-analysis.test.ts` — `computeATR` (known OHLC data, empty bars), `findSupportResistance` (pivot highs/lows, insufficient data)
   → verify: `npm run test -- --testPathPatterns technical-analysis`

---

### Phase 2: Cache Layer + NSE Data Adapters

7. **Create `lib/services/intelligenceCache.ts`** — write-through dual-layer cache:
    - In-memory `NodeCache` (fast reads) + Prisma `IntelligenceCache` (persistent)
    - `getIntelligenceFromCache`: memory hit → return; DB hit → restore to memory → return; miss → null
    - `setIntelligenceCache`: upsert DB + set memory (non-atomic, DB failure logged non-fatal)
    - `invalidateIntelligenceCache`: delete from both memory + DB
    - `restoreIntelligenceCacheFromDB`: bulk-load non-expired DB rows into memory on startup
    - `getIntelligenceCacheStats`: total/active/expired counts for admin monitoring
    → verify: `npx tsc --noEmit`

8. **Create `lib/market-data/nse/adapters.ts`** — all 8 adapter functions: `fetchIntelligenceQuoteData`, `fetchIntelligenceTechnicals`, `fetchIntelligenceValuation`, `fetchIntelligenceFundamentals`, `fetchIntelligenceShareholding`, `fetchIntelligenceCorporate`, `fetchIntelligenceNews`, `fetchIntelligencePeers`
   - Reuse: `getStockQuote`, `getFinancialStatus`, `getCorpEvents`, `fetchCorporateActions`, `fetchCorporateAnnouncements`, `fetchEventCalendar`, `fetchSecurityWiseHistoricalData`, `securityWiseBarsToOHLCV`, `getCorporateAnnouncements`, `computeSMA/EMA/RSI/MACD/Bollinger`, new `computeATR/findSupportResistance`
   - All functions: try/catch → return null on failure (never throw)
   → verify: `npx tsc --noEmit`

9. **Create `lib/__tests__/adapters.test.ts`** — mock NSE functions, test each adapter returns normalized data or null on failure
   → verify: `npm run test -- --testPathPatterns adapters`

10. **Create `lib/__tests__/intelligenceCache.test.ts`** — write-through cache tests:
    - `getIntelligenceFromCache` returns null for missing symbol
    - `getIntelligenceFromCache` returns null for expired entry
    - `getIntelligenceFromCache` returns valid entry (memory hit path)
    - `getIntelligenceFromCache` restores from DB to memory on memory miss
    - `setIntelligenceCache` upserts both DB + memory
    - `invalidateIntelligenceCache` deletes from both memory + DB
    - `restoreIntelligenceCacheFromDB` bulk-loads non-expired entries
    - `getIntelligenceCacheStats` returns correct counts
    → verify: `npm run test -- --testPathPatterns intelligenceCache`

---

### Phase 3: AI Prompt + Orchestrator

11. **Create `lib/services/ai/intelligence-prompt.ts`** — `buildIntelligencePrompt(input)` + `parseIntelligenceResponse(raw)` (JSON extraction from markdown fences, normalize, never throw)
    → verify: `npx tsc --noEmit`

12. **Create `lib/__tests__/intelligence-prompt.test.ts`** — prompt includes all sections, handles null data, parser extracts valid JSON, returns null on bad input
    → verify: `npm run test -- --testPathPatterns intelligence-prompt`

13. **Create `lib/services/ai/intelligence.ts`** — `getInvestmentIntelligence(symbol, { force?, userId? })` orchestrator:
    - Cache check → parallel adapter fetch → build prompt → `directPrompt()` + `modelFallbackChain()` → parse → cache store → audit return
    - `isQuotaExhausted()` check before AI call
    - Partial failure tolerance (Promise.allSettled)
    - Retry once on parse failure with simplified prompt
    - Audit: `createAuditLog({ action: "INTELLIGENCE_GENERATED", userId, metadata: { symbol, modelUsed, cacheHit, partialData } })` on success
    - Audit: `createAuditLog({ action: "INTELLIGENCE_FAILED", userId, metadata: { symbol, error } })` on failure
    → verify: `npx tsc --noEmit`

14. **Create `lib/__tests__/intelligence.test.ts`** — cache hit, force refresh, partial failures, quota exhaustion, parse failure retry, version increment, all-adapters-fail
    → verify: `npm run test -- --testPathPatterns intelligence`

---

### Phase 4: API Routes + MCP + Startup Restore

15. **Create `app/api/company/[symbol]/intelligence/route.ts`** — GET (with `?force=1`) + POST endpoints:
    - Auth: `const session = await auth(); if (!session?.user?.id) return 401;`
    - Zod validation on symbol param (alphanumeric + dots, max 20 chars)
    - Audit: `createAuditLog({ action: "INTELLIGENCE_REQUESTED", userId: Number(session.user.id), metadata: { symbol, force, cacheHit } })`
    - Rate-limited (10 req/min per IP for unauth, 20 req/min per user for auth)
    - Returns IntelligenceReport or 202 (generating) or 503 (quota) or 401 (unauth)
    → verify: `npx tsc --noEmit` + `curl localhost:3000/api/company/RELIANCE/intelligence` returns 401 (no session cookie)

16. **Add `getInvestmentIntelligence` MCP function** to `app/api/mcp/route.ts` — symbol param, 3600s cache, added to union/list/descriptions/schemas/POST+GET switches
    → verify: `npx tsc --noEmit`

17. **Add `restoreIntelligenceCacheFromDB()` call** to `instrumentation.ts` — called after `startWorker()` and `startCronDaemon()`, bulk-loads all non-expired intelligence entries into in-memory NodeCache at server startup so there's no cold-start penalty
    → verify: `npx tsc --noEmit`

---

### Phase 5: UI Components

18. **Create `app/components/intelligence/IntelligenceButton.tsx`** — "use client", 5 states:
    - `unauthenticated`: gray pill "Sign in for AI Analysis" (no click action)
    - `idle` (no cache): gray pill "AI Analysis" with sparkle icon → click POST
    - `loading` (generating): pulsing sky-blue badge "Analyzing..." → disabled
    - `ready` (cache hit): green pill "AI Analysis ✓" → click expand/collapse
    - `failed`: amber pill "Analysis unavailable" → click retry POST
    → verify: `npx tsc --noEmit`

19. **Create `app/components/intelligence/sections/` components** — all 12 section components: VerdictCard, FairValueGauge, TechnicalSummary, FundamentalInsights, ValuationView, NewsCatalystList, ShareholdingTrend, CorporateActionsSummary, RiskCatalystMatrix, ScenarioAnalysis, ExecutiveSummary (each "use client", receives data props, handles null/missing gracefully)
    → verify: `npx tsc --noEmit`

20. **Create `app/components/intelligence/IntelligencePanel.tsx`** — expandable panel with smooth height animation, renders all sections, skeleton per-section loading, dark theme consistent with existing company page
    → verify: `npx tsc --noEmit`

21. **Wire into `app/company/[ticker]/page.tsx`** — add IntelligenceButton + IntelligencePanel below StockQuoteHeader, above NSEStockChart; panel only renders when analysis data is available
    → verify: `npx tsc --noEmit`

---

### Phase 6: Full Test Pass + Live Verification

22. **Run full test suite** — `npm run test` (all pass, zero regressions)
    → verify: 58+ suites, 800+ pass, 4 skip

23. **Run tsc** — `npx tsc --noEmit` (0 new errors, baseline 46)
    → verify: 46 errors (unchanged)

24. **Run lint** — `npm run lint` (no warnings)
    → verify: clean

25. **Live-verify on :3000** — start dev server, login, navigate to company page, verify button states, generate analysis, verify all sections render, check responsive 375/768/1440, check 0 console errors
    → verify: Playwright or manual walkthrough

---

### Phase 7: Documentation

25. **Update AGENTS.md** — version row for v3.18.0
26. **Update `.agents/changelog/versions-v3.md`** — detail entry
27. **Update TODO.md** — feature row marked complete
28. **Update Primer.md** — current project status
29. **Update agent-memory.md** — activity log entry
30. **Create session memory** — `decisions.md` + `flow.md` in `.agents/sessions/`

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| computeATR known OHLC | `technical-analysis.test.ts` | ATR calculation correctness |
| computeATR empty bars | `technical-analysis.test.ts` | Edge case: no data |
| findSupportResistance pivot points | `technical-analysis.test.ts` | S/R detection |
| findSupportResistance insufficient data | `technical-analysis.test.ts` | Edge case: <5 bars |
| Quote adapter normalizes data | `adapters.test.ts` | NSE → QuoteData mapping |
| All adapters return null on failure | `adapters.test.ts` | Error tolerance |
| Cache hit returns valid data | `intelligenceCache.test.ts` | TTL-based cache |
| Cache miss returns null | `intelligenceCache.test.ts` | Missing/expired entry |
| Prompt includes all sections | `intelligence-prompt.test.ts` | Prompt completeness |
| Parser extracts JSON from fences | `intelligence-prompt.test.ts` | JSON extraction |
| Parser returns null on bad input | `intelligence-prompt.test.ts` | Error handling |
| Orchestrator uses cache | `intelligence.test.ts` | Cache-first flow |
| Orchestrator force bypasses cache | `intelligence.test.ts` | Force refresh |
| Orchestrator handles quota exhaustion | `intelligence.test.ts` | Quota guard |
| Orchestrator retries parse failure | `intelligence.test.ts` | Retry logic |
| Partial adapter failure is tolerated | `intelligence.test.ts` | Graceful degradation |
| Orchestrator logs audit on success | `intelligence.test.ts` | Audit trail (userId + symbol) |
| Orchestrator logs audit on failure | `intelligence.test.ts` | Failure audit trail |
| API returns 401 without session | API route test | Auth enforcement |
| API returns 200 with valid session | API route test | Auth bypass when authenticated |

### E2E Tests (If time permits)

| Test | What It Verifies |
|------|------------------|
| Button shows "Sign in" when unauthenticated | Auth state rendering |
| Button renders on company page when authenticated | Component wiring |
| Click idle → loading → ready | State transitions |
| Panel expands with sections | Content rendering |
| Cached data loads on revisit | Cache persistence |
| Mobile (375px) no overflow | Responsive |

---

## Verification Checklist

```bash
# Type checking
npx tsc --noEmit                    # 0 new errors (baseline: 46)

# Tests
npm run test                        # All pass (800+)
npm run lint                        # No warnings

# Prisma
npx prisma validate                 # Schema valid
npx prisma generate                 # Client regenerated

# Build (optional)
npm run quickbuild                  # Production build succeeds
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| NSE API rate limit on parallel adapters | Use existing `getOrFetchNseData` cache + 200ms delay between sequential calls if needed | No |
| AI response quality variance | Structured JSON prompt + retry once with simplified prompt | No |
| Free-tier quota exhaustion (50 req/day) | `isQuotaExhausted()` guard + serve cached data + error message | No |
| Partial data leads to weak analysis | AI prompt explicitly handles null sections, acknowledges gaps | No |
| Large prompt exceeds context window | Cap adapter outputs (top 5 peers, last 20 announcements, last 4 quarters) | No |
| DB migration on prod | Use `migrate diff --to-schema` + `db execute` pattern (no `_prisma_migrations` ledger on local) | No |

---

## Documentation Checklist

- [ ] **AGENTS.md** — version row for v3.18.0
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.md` detail + index update
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (if pattern/bug discovered)
- [ ] **Session memory** — `decisions.md` + `flow.md`

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated
