# flow.md — Stock Analysis Skill (equity research decision engine)

Date: 2026-08-28. Branch: `feat/stock-analysis-skill` (off `main`).

## Status: PHASES 1–9 COMPLETE — verification green (915 pass / 4 skip, tsc 46 baseline); docs done (AGENTS.md, CHANGELOG ×3, TODO, Primer Session 20, agent-memory, Lessons #92/#93, versions-v3.21.md, session-todos, handoff latest.md); commit/PR pending user (no auto-commit)

## Files created
- `.agents/specs/03-stock-analysis-skill.md` — spec (approved by user)
- `.agents/plans/03-stock-analysis-skill.md` — plan (this deliverable)
- `.agents/sessions/2026-08-28-stock-analysis-skill/decisions.md`, `flow.md`

## User decisions (via question tool)
1. Deep upgrade of existing intelligence (no duplicate pipeline)
2. Manual/secondary sources for documents (raw text only; NO MarkItDown / no new dependency)
3. Text-technicals only (no chart vision)
4. Full decision-engine JSON + UI
5. Approve spec → write plan; raw-text fallback confirmed

## Execution path (Phases 1–8)
- **Phase 1**: `intelligenceTypes.ts` — `Verdict`, `EvidenceLabel`, `MarketPhase`, `EvidencePoint`, `ManagementDna`, `ValuationZones`, `RiskItem`, `ContrarianView`, `PortfolioAction` + expanded `IntelligenceAnalysis` (new fields all optional `?` so legacy cached rows + existing test literals stay type-valid; no schema migration).
- **Phase 2**: `lib/services/document/normalize.ts` — `normalizeDocumentText(content, maxLen=50_000)` (trim, collapse whitespace, `…[truncated]` marker, empty→`""`). NO `import "server-only"` (package resolves to unrelated parent path that throws; breaks Jest loader) — kept as convention-comment.
- **Phase 3**: `intelligence-prompt.ts` — legacy `buildIntelligencePrompt`/`parseIntelligenceResponse` KEPT unchanged (3-verdict collapse) so 18 legacy prompt tests pass. NEW `buildStockAnalysisPrompt(input, documents?)` + `parseStockAnalysisResponse(raw)` (8-verdict STRONG_BUY…AVOID, conviction /10, confidence /100, 6 pillars, evidence labels, valuation zones, scenario, contrarian, portfolio action, invalidation, data gaps; documents as secondary-unverified sections).
- **Phase 4**: `intelligence.ts` orchestrator — `IntelligenceOptions.documents?`, normalize, pass to prompt; audit metadata `modelUsed/verdict/conviction/confidence/hasDocuments/partialData`; retry asks 8-verdict; whitespace-only docs → `hasDocuments:false` fix.
- **Phase 5**: `adapters.ts` — `fetchTechnicalsData` fetch window 90→280 days so `sma200` best-effort when ≥250 bars.
- **Phase 6**: `app/api/company/[ticker]/intelligence/route.ts` POST — Zod `{force?, documents?: {annualReport?, concall?}}` each max 50_000; 400 invalid; audit `hasDocuments`.
- **Phase 7** (UI): `VerdictCard` rewritten (8 verdicts + conviction bar), 11 new sections (`ManagementDnaSection`, `ValuationZonesSection`, `ContrarianSection`, `PortfolioActionSection`, `DataGapsBanner`, `TechnicalStructureSection`, `FundamentalScoreSection`, `ShareholdingAnalysisSection`, `ExecutiveThesisSection`, rewritten `RiskCatalystMatrix` RiskItem[], `IntelligencePanel` rewire with legacy fallbacks + "Decision Engine" suffix), `CompanyIntelligence` doc textareas (50K cap, Clear, POST only non-empty).
- **Phase 8** (tests): `lib/__tests__/stock-analysis-prompt.test.ts` (21 — prompt structure incl. documents, 8-verdict/consec/minimal; parser full/markdown/legacy-BUY/garbage/clamp/riskFactors legacy array), `lib/__tests__/document-normalize.test.ts` (9 — non-string/blank/trim/whitespace collapse/truncate marker/custom max/never-throws), `intelligence.test.ts` +3 (documents→prompt, hasDocuments audit true, whitespace docs → false). Full suite **915 pass / 4 skip** (+32 vs 883 baseline); tsc **46 = baseline** (0 new production errors).

## Test results (Phase 8)
- `npx jest document-normalize stock-analysis-prompt intelligence-prompt intelligence --silent` → 57/57 pass.
- Full `npx jest --silent` → **66 suites, 915 pass / 4 skip**.
- `npx tsc --noEmit` → 46 errors, ALL pre-existing (test-file jest-dom noise + `scripts/test-prod-db.ts` LSP) → 0 new.

## Phase 9 (docs) — COMPLETE
- Updated: `AGENTS.md` v3.21.0 version row; `.agents/changelog/versions-v3.21.md` (created, typo fixed "kept unchanged"); `.agents/CHANGELOG.md` index + root `CHANGELOG.md` v3.21.0 row; `TODO.md` quick-reference row; `Primer.md` Current Project Status top block + Session 20 Session History entry; `agent-memory.md` activity entry; `Lessons.md` #92 (`import "server-only"` non-dependency → parent-path throw breaks Jest) + #93 (derive presence flags from normalized content, not object existence) + update-log row; `session-todos.md`; `.agents/handoffs/active/latest.md` (rewritten to this session).
- `decisions.md` + `flow.md` current for the whole feature.

## Next step (present to user)
- Present commit/PR decision (no auto-commit/push/merge). Code + tests + docs are complete; await explicit user go-ahead to commit `feat/stock-analysis-skill`.

## Audit trails to follow
- Keep `buildIntelligencePrompt`/`parseIntelligenceResponse` as wrappers so existing 18 prompt tests pass.
- `npx tsc --noEmit` baseline = 57 errors (0 new allowed; verified 46 pre-existing).
- Suite baseline = 883 pass / 4 skip (now 915/4).

