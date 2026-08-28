# Implementation Plan — Stock Analysis Skill: Professional Equity Research Decision Engine

> Generated from spec: `.agents/specs/03-stock-analysis-skill.md`

## Spec Reference

- **Spec**: `.agents/specs/03-stock-analysis-skill.md`
- **Branch**: `feat/stock-analysis-skill` (off `main`; user merges PR so Netlify rebuilds)
- **Created**: 2026-08-28

---

## Implementation Steps

> Ordered, atomic, independently verifiable.

### Phase 1: Types (no DB)

1. **Expand `IntelligenceAnalysis` + add new types** in `lib/services/intelligenceTypes.ts`
   (`Verdict` 8-level enum, `EvidenceLabel`, `MarketPhase`, `EvidencePoint`, `ManagementDna`,
   `ValuationZones`, `RiskItem`, `ContrarianView`, `PortfolioAction`, expanded `IntelligenceAnalysis`)
   → verify: `npx tsc --noEmit` (0 new errors beyond baseline 57)

### Phase 2: Document helper (server-only, no dep)

2. **Create `lib/services/document/normalize.ts`** — `normalizeDocumentText(content, maxLen=50_000): string`
   (trim, collapse whitespace, truncate + `…[truncated]`, empty → `""`), `import "server-only"`
   → verify: `npx tsc --noEmit`

### Phase 3: Prompt + Parser (backward compatible)

3. **Add `buildStockAnalysisPrompt(input, docs?)` + `parseStockAnalysisResponse(raw)`** in
   `lib/services/ai/intelligence-prompt.ts` (6 pillars, evidence labels, data-gap honesty, 8-verdict contract,
   conviction /10, zones, scenario, contrarian, portfolio action, invalidation; documents appended as
   secondary-unverified sections; parser normalizes to expanded `IntelligenceAnalysis`, never throws,
   null-coalesces/backward-compatible)
   → verify: `npm run test` (existing `intelligence-prompt.test.ts` 18 still pass via kept wrappers)

### Phase 4: Orchestrator

4. **Modify `lib/services/ai/intelligence.ts`** — accept `documents?: { annualReport?: string; concall?: string }`
   in `IntelligenceOptions`; normalize via `normalizeDocumentText`; pass to prompt; set `conviction` + 8-level
   `verdict` in audit metadata; populate `dataGaps` when adapters null
   → verify: `npx tsc --noEmit`

### Phase 5: Adapters best-effort enrichment

5. **Modify `lib/services/intelligence/adapters.ts`** — `fetchTechnicalsData`: compute `sma200` when ≥200 bars
   available (200-day fetch, fall back to 90d); ensure shareholding/peers/news return null never-throw
   → verify: `npx tsc --noEmit`

### Phase 6: API route

6. **Modify `app/api/company/[ticker]/intelligence/route.ts`** — POST body Zod: optional
   `{ force?: boolean, documents?: { annualReport?: string; concall?: string } }` with size caps (~50KB each);
   pass documents to orchestrator; audit metadata `hasDocuments`
   → verify: `curl` POST with/without documents returns 200 + expanded report; oversized doc → 400; unauth → 401

### Phase 7: UI components

7. **`VerdictCard.tsx`** — map 8 verdicts → distinct color/emoji + conviction /10 bar
8. **`IntelligencePanel.tsx`** — compose new memo sections; null-coalesce legacy reports
9. **New sections**: `ManagementDnaSection`, `ValuationZonesSection`, `ContrarianSection`,
   `PortfolioActionSection`, `DataGapsBanner`
10. **`CompanyIntelligence.tsx`** — optional document text inputs → POST body
    → verify: `npx tsc --noEmit`; Playwright renders on company page; 375/768/1440 + dark/light; 0 console errors

### Phase 8: Tests

11. **Write `lib/__tests__/stock-analysis-prompt.test.ts`** (~20) → verify: pass
12. **Write `lib/__tests__/stock-analysis-service.test.ts`** (~8) → verify: pass
13. **Write `lib/__tests__/document-normalize.test.ts`** (~5) → verify: pass
14. Extend `intelligence-prompt.test.ts` + `intelligence.test.ts` for new shape → verify: all pass
    → full: `npm run test` 883/4 + new, 0 regressions

### Phase 9: Docs

15. `AGENTS.md` row, `.agents/changelog/versions-v3.21.md`, `.agents/CHANGELOG.md` index, root `CHANGELOG.md`,
    `TODO.md`, `Primer.md`, `agent-memory.md`, `Lessons.md` (likely one lesson), `session-todos.md`,
    `handoffs/active/latest.md`

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Prompt has 6 pillars + 8-verdict contract + evidence labels + data-gap instruction | `stock-analysis-prompt.test.ts` | Prompt completeness |
| With documents → doc sections appended; without → absent | `stock-analysis-prompt.test.ts` | Document handling |
| Parser: full JSON, markdown fence, braces, missing→defaults+dataGaps, all 8 verdicts, malformed→null | `stock-analysis-prompt.test.ts` | Parser robustness |
| Backward compat: legacy 3-verdict JSON → valid 8-level verdict | `stock-analysis-prompt.test.ts` | Migration safety |
| Orchestrator passes docs to prompt; conviction+verdict in audit; dataGaps on null adapters; cache hit skips prompt | `stock-analysis-service.test.ts` | Orchestration |
| normalize (whitespace, truncate+marker, empty→"", server-only guard) | `document-normalize.test.ts` | Text helper |
| Existing `intelligence-prompt.test.ts` (18) + `intelligence.test.ts` (10) still pass | — | No regression |

### Integration Tests

| Test | What It Verifies |
|------|------------------|
| POST with documents → 200 + expanded report | Route wiring |
| POST oversized documents → 400 | Validation |
| POST unauth → 401 | Auth |

### E2E Tests (`e2e/`)

| Test | What It Verifies |
|------|------------------|
| Company page intelligence renders expanded memo (8-verdict card, conviction, zones, management DNA) | Rendering |
| Data-gaps banner shows when dataGaps present | Honesty UI |
| Document chip shows when documents provided | Document UI |

---

## Verification Checklist

```bash
npx tsc --noEmit          # 0 new errors (baseline 57)
npm run test              # 883/4 + new, all pass
npm run lint              # no warnings
npm run test:e2e          # (if adding e2e) suite passes
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| 8-verdict prompt may return HOLD-like "balanced" answers | Prompt forbids diplomatic verdicts; must follow evidence | No |
| Larger prompt (documents up to 50KB each) may hit token/context limits | Cap docs; truncate with marker; free models tolerant | No |
| Sma200 needs ≥200 bars; many symbols have fewer | Enrich only when available; else data gap | No |
| MarkItDown PDF conversion | Explicitly deferred — raw-text only | Yes |
| Backward compat with existing cached 3-verdict reports | Null-coalesce in parser + UI | No |
| Free text model may not consistently emit all 12 sections | Parser fills defaults + appends dataGaps | No |

---

## Documentation Checklist

- [x] `AGENTS.md` — version row (in Phase 9)
- [x] `CHANGELOG` — `versions-v3.21.md` (Phase 9)
- [x] `TODO.md` — quick-reference row (Phase 9)
- [x] `Primer.md` — status (Phase 9)
- [x] `agent-memory.md` — activity (Phase 9)
- [x] `Lessons.md` — lesson if pattern found (Phase 9)
- [x] Session memory — `decisions.md` + `flow.md` (created)
- [x] `session-todos.md` — updated (Phase 9)
- [x] `handoffs/active/latest.md` — resume context (Phase 9)

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets
5. Documentation updated per checklist
6. Engineering checklist (`.agents/rules/checklist.md`) validated
