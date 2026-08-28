# decisions.md — Stock Analysis Skill (equity research decision engine)

Date: 2026-08-28. Branch: `feat/plan-limit-resilience` (work will branch off for the feature).

## Context
User provided a comprehensive "Professional Equity Research & Investment Analysis" framework
(8-verdict institutional memo, 6 pillars, evidence discipline, bull/base/bear, contrarian test,
conviction /10, entry/fair/overvaluation zones, portfolio action, JSON response, frontend).
Repo already has v3.18.0 "AI Investment Intelligence" pipeline (GET/POST /api/company/[ticker]/intelligence,
NSE adapters, cache, CompanyIntelligence UI, 3-verdict BUY/HOLD/SELL analysis).

## Decisions (user-confirmed via question tool)
1. **Deep upgrade of existing intelligence** — extend IntelligenceAnalysis + prompt + adapters + UI
   in place. Reuse cache, endpoint, company-page wiring. NO duplicate pipeline.
2. **Design for manual/secondary sources** for documents (annual reports + concalls): pipeline ACCEPTS
   pre-extracted/pasted .md/.txt (user pastes content) parsed via MarkItDown if PDF; live NSE scraping
   best-effort fallback-first; missing material recorded as data gaps. Do NOT build anti-bot bypass.
3. **Text-technicals only** — no chart screenshot/vision. Reuse computed indicators (EMA/SMA/RSI/MACD/ATR,
   support/resistance) from NSE daily bars in existing TechnicalsData adapter.
4. **Full decision-engine JSON + UI** — 12-section memo, 8 verdicts, conviction /10, zones, thesis-invalidation,
   portfolio action, structured JSON + render in company page.
5. **Raw-text ingestion only — NO MarkItDown / NO new dependency.** User pastes .md/.txt; PDF conversion is
   OUT of scope (recorded as data gap). Simplifies the spec: `lib/services/document/normalize.ts` is a pure
   server-only normalize/truncate helper instead of a MarkItDown shell wrapper.

## Reasoning
- Reuse avoids duplicating adapters/cache/endpoint/UI; keeps one coherent system.
- Hosted Netlify cannot bypass NSE/Screener/Tijori anti-bot; manual/secondary = reliable. Matches user's
  own caveat ("treat inaccessible material as a data gap").
- Free text model chain cannot do vision; computed indicators already exist and are reliable.
- User explicitly wants full decision-engine output rendered in UI.

## Open / to confirm in spec
- Branch name for feature work (recommend: `feat/stock-analysis-skill` off main or off current branch).
- Whether user-pasted document text is stored (DB) or session-only in-memory. Recommend in-memory
  (no schema change) — pass as `documentText` to the analysis; keep DB persistence.
- Exact 8-verdict enum + map to existing confidence (keep 0-100 confidence AND add conviction /10).
