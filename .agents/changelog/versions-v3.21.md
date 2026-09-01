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

---

# v3.21.1 — DB Health ops visibility: SQLite ops-counter persistence + Total Operations/Plan Usage UI + sql.js WASM fix

> **Date**: Sep 02 2026 · **Branch**: `main` (direct, no branch) · **Suite**: 920 pass / 4 skip (+3 vs 917) · **tsc**: 46 = baseline (0 production errors)

## Problem

Two live-site/perspective gaps on the DB Health dashboard (`/admin/utils/db-health`):

1. **"SQLite Not Ready" on the live site** — the SQLite backup layer (v3.19.1–v3.19.2) showed Not Ready because `sql.js` is a **native/WebAssembly module**: its `sql-wasm.wasm` asset was never located. `initSqlJs()` without a `locateFile` resolver cannot find the WASM binary at runtime (bundler attempts may 404 / throw), so `initSqliteBackup()` never completed → the whole SQLite fallback layer (recs/corp-actions/screener fallback chains + recovery probe) was silently dead on Netlify.
2. **IO-count gap** — Prisma dashboard shows an authoritative "Total Operations" count (every read+writes through the Accelerate proxy, against the 10K ops/day plan limit), while the app's in-memory `dbOpsCounter` (v3.19.0/v3.20.2) resets to zero on **every deploy** and only counts what the process itself saw. The numbers diverged (dashboard 5,071 vs in-memory few hundred), so the dashboard under-reported or confused. User approved the **"Display + persist"** approach: show the authoritative Total Operations + Plan Usage in the app AND persist the in-memory counter so it survives deploys.

## Solution

**(1) WASM fix** — `next.config.ts` adds `'sql.js'` to `serverExternalPackages` (native/WASM module must be excluded from webpack bundling) and `lib/sqlite.ts` gains `resolveSqlWasm(file)` — searches `node_modules/sql.js/dist` then `public/`, defaulting to `sql-wasm.wasm` — wired into `initSqlJs({ locateFile: resolveSqlWasm })`. Netlify ships node_modules at runtime and publishes `public/`, so the WASM resolves correctly in both local and prod.

**(2) Ops-counter persistence** — the in-memory counter now snapshots to the SQLite `_backup_meta` table every 60 seconds and restores on boot:

- `lib/prisma.ts` exports `getIstDayKey` (the existing `todayKey` IST-day-key function) — single source of truth shared with sqlite so both layers agree on the "day" boundary used for auto-reset.
- `lib/sqlite.ts`: `persistOpsCounter()` (reads/writes JSON → `_backup_meta` key `ops_counter`, tagged with the IST day key), `restoreOpsCounter()` (reads back, **ignores any snapshot from a different IST day** — counter must reset each day, not replay yesterday's counts, and merges with `Math.max` so a newer snapshot never *reduces* the restored count), `startOpsCounterPersistence()` (60s interval on globalThis state — same singleton pattern as `lib/prisma.ts`/`lib/cache.ts`, so instrumentation and routes share one instance), `stopOpsCounterPersistence()` (test hook). Restore runs at init (before first sync) and again after the initial `syncFromPrisma()`; `instrumentation.ts` boots the 60s timer after the price-flush timer.
- `/api/admin/db-health` GET now returns `totalOperations` / `planLimit` (env `DB_PLAN_LIMIT_OPS`, default **10,000**) / `planOperationsRemaining` on the ops block, and calls `sqlite.persistOpsCounter()` on every GET (read-only dashboard keeps the snapshot fresh); the POST sync handler persists after `syncFromPrisma()`.
- **UI** (`db-health/page.tsx`): stat grid grows to **6 cards** — new "Total Ops Today" (reads+writes sum) with threshold colors (>90% red, >70% amber); new **"Plan Operations Usage"** bar below the write-budget bar — reads vs writes stacked against the plan limit with remaining count and an italic footnote ("Prisma dashboard authoritative · counter restored from SQLite snapshot · resets on deploy"); new **"Plan Ops {n}% Used"** amber warning badge when usage > 80%.

**(3) Test-infra mock fixes** (`lib/__tests__/sqlite.test.ts`) — the sql.js mock needed two real-semantics fixes before the new tests could pass:

- `exec()` now projects **only the requested SELECT columns** (real sql.js returns just `value` for `SELECT value FROM …`; the mock returned all columns and `LIMIT 1` picked the wrong row).
- The INSERT handler implements **`INSERT OR REPLACE`** semantics (drop existing rows whose first column = PK) — without it, a second persist to the same key *duplicated* rows and `LIMIT 1` returned the stale first one, breaking the roundtrip.

## Files Modified

| File | Change |
|------|--------|
| `next.config.ts` | `serverExternalPackages` += `'sql.js'` (native/WASM module excluded from webpack) |
| `lib/prisma.ts` | `export const getIstDayKey = todayKey;` — shared IST-day-key source |
| `lib/sqlite.ts` | `resolveSqlWasm(file)` + `initSqlJs({ locateFile })`; `persistOpsCounter()` / `restoreOpsCounter()` (`_backup_meta` key `ops_counter`, IST-day guard, `Math.max` merge); `startOpsCounterPersistence()` (60s, globalThis state) / `stopOpsCounterPersistence()`; restore at init + after initial sync; `SqliteFallback` + `HealthStatus.prisma` extended; `getHealthStatus()` computes `totalOperations`/`planLimit`/`planOperationsRemaining` |
| `instrumentation.ts` | boots `startOpsCounterPersistence()` after the daily-price-flush timer |
| `app/api/admin/db-health/route.ts` | uses `getIstDayKey`; GET ops block adds `totalOperations`/`planLimit`/`planOperationsRemaining` + persists counter; POST sync persists after `syncFromPrisma()` |
| `app/admin/utils/db-health/page.tsx` | 6-card stat grid with "Total Ops Today"; "Plan Operations Usage" bar (reads vs writes vs plan + remaining + footnote); "Plan Ops n% Used" badge > 80% |
| `lib/__tests__/sqlite.test.ts` | mock fixes (`getIstDayKey`, `exec()` column projection, `INSERT OR REPLACE`) + 3 new tests (health totals, persist/restore roundtrip, persist no-throw) |

## Key Design Decisions

1. **`Math.max` merge on restore**: a newer snapshot must never *reduce* the counter (deploys can race a persist tick), but an **IST-day boundary mismatch discards the snapshot entirely** — the counter must reset each day, not replay yesterday's usage.
2. **Persist on every GET** of the health route: the dashboard is the primary consumer, so reading it keeps the snapshot warm without a separate writer.
3. **`getIstDayKey` exported from prisma**: one source of truth for "which IST day is it" — sqlite and the ops counter can't disagree on the reset boundary.
4. **serverExternalPackages, not just locateFile**: even with a locateFile, webpack's static analysis can choke on sql.js's runtime `createRequire`/WASM loading; excluding it from the server bundle is the documented fix for native/WASM deps in Next.js.

## Verification

- `npx jest --testPathPatterns="sqlite.test"` → **20/20** (was 17).
- Full `npx jest` → **920 pass / 4 skip** (+3 vs 917 baseline; 4 skips = pre-existing client-cache IndexedDB tests).
- `npx tsc --noEmit` → **46 errors, ALL pre-existing** test-file typing noise; **0 new production errors**.
- (Deploy verification pending — commit not yet made; live Netlify check after user deploys.)
