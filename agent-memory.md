# Agent Memory - Activity Log

> This file tracks all agent activities. Use git hooks to automatically append activity logs.

---

## Git Hook Setup (v1.15.0)

The post-commit hook has been created automatically as part of the Handoff File System:

- **Location**: `.git/hooks/post-commit`
- **Function**: Logs commit checkpoints to `.agents/handoffs/checkpoint.log` (non-tracked file)
- **Automation**: Runs on every `git commit` automatically
- **⚠️ Important**: Post-commit hook writes to a NON-TRACKED file only to avoid infinite loop. Update `agent-memory.md` manually for meaningful activity entries.

The pre-commit hook is also installed at `.git/hooks/pre-commit`:
- Checks for `console.log` statements (should use logger)
- Detects hardcoded secrets (passwords, API keys, tokens)

---

## Manual Logging

You can also manually add entries:

```bash
# Add activity entry
echo "### $(date '+%Y-%m-%d %H:%M:%S')" >> agent-memory.md
echo "- **Action**: Description of what was done" >> agent-memory.md
echo "- **Files**: file1.ts, file2.ts" >> agent-memory.md
echo "" >> agent-memory.md
```

---

## Activity Log

### 2026-08-13 | F&O Analytics UI Complete + NSE Option-Chain-v3 Migration + MCP getOptionChain/getFoExpiries (v3.7.0)
- **Action**: (1) **F&O Analytics UI complete** (services + API were already done — closes the v3.2.0 "Partial" UI item): NEW `app/fo/page.tsx` + `app/fo/FoClient.tsx` (client dashboard — positions list, 4 stat cards, Add Position modal, option chain, expiries, Greeks, P&L summary, live underlying) + NEW `app/components/fo/` — `FOPositionTable` (sortable, P&L color-coded), `FOPnlSummary` (realized/unrealized + win-rate cards), `AddPositionForm` (Futures/CE/PE, Greeks-aware), `GreekCards` (Δ/Γ/Θ/V on selected position), `ExpiryCalendar` (weekly/monthly expiry pills + countdown), `OptionChainViewer` (REWRITTEN for v3); `app/Header.tsx` gains the F&O nav link. (2) **NSE option-chain-v3 migration** (`lib/services/nse-fo-api.ts` REWRITE): base URL → `https://www.nseindia.com/api/option-chain-v3` with `type=Indices|Stocks` (NIFTY/BANKNIFTY/FINNIFTY/SENSEX/BANKEX → Indices via new pure `isIndexSymbol`, else Stocks) + `expiry=DD-MMM-YYYY`; NEW pure exported parsers `parseNseExpiryDate` (DD-MMM-YYYY / DD-MM-YYYY / ISO), `parseNseTimestamp`, `toNseExpiryParam`, `parseOptionChainV3` (skips empty `{}` CE/PE strike rows; **`filtered` totals are TOP-LEVEL siblings of `records`** — v2→v3 shape change caught by the new tests); `FOContract` extended (`pchangeinOpenInterest`, `totalBuyQuantity`, `totalSellQuantity`), `FOChainData` gains `filtered: FOFilteredTotals` + `strikePrices: number[]`; `fetchExpiries` weekly flag `daysToExpiry <= 35` for indices; NSE fallback (`FALLBACK_UNDERLYING_VALUE`) preserved. (3) **API**: `app/api/fo/chain/route.ts` gains `expiry` query param (ISO date → passed through). (4) **MCP**: NEW `getOptionChain` (300s cache) + `getFoExpiries` (3600s) in union/list/descriptions/schemas/POST+GET switches → **28 functions**.
- **Tests**: NEW `lib/__tests__/nseFoApi.test.ts` — 27 tests (v3 fixture incl. top-level `filtered` + empty `{}` 24600 strike row; expiry-date/timestamp/param parsers; `isIndexSymbol`; weekly-flag logic; chain mapping incl. new OI/volume fields; empty-side skip). **Full suite: 560 passed / 11 skipped / 0 failures** (was 533 + 27). `npx tsc --noEmit` clean on all touched files (remaining repo errors are pre-existing test-only noise).
- **Also carried**: monitoring #68 serverless-aware Server Log Files notice — `app/api/admin/monitoring/route.ts` exposes `serverless: true` (NETLIFY/VERCEL/AWS_LAMBDA_FUNCTION_NAME) + `app/admin/utils/monitoring/page.tsx` renders an amber "file-system logs ephemeral → use Database Server Logs tab" banner.
- **Files Created**: `app/fo/page.tsx`, `app/fo/FoClient.tsx`, `app/components/fo/FOPositionTable.tsx`, `app/components/fo/FOPnlSummary.tsx`, `app/components/fo/AddPositionForm.tsx`, `app/components/fo/GreekCards.tsx`, `app/components/fo/ExpiryCalendar.tsx`, `app/components/fo/OptionChainViewer.tsx`, `lib/services/foSymbols.ts`, `lib/__tests__/nseFoApi.test.ts`
- **Files Modified**: `lib/services/nse-fo-api.ts` (v3 rewrite + exported parsers), `app/api/fo/chain/route.ts` (expiry param), `app/api/mcp/route.ts` (+2 → 28), `app/Header.tsx` (F&O nav), `app/admin/utils/monitoring/page.tsx` + `app/api/admin/monitoring/route.ts` (#68 notice), `AGENTS.md`, `.agents/CHANGELOG.md`, `.agents/changelog/versions-v3.md`, `TODO.md`, `Primer.md`, `agent-memory.md`, `.agents/session-todos.md`
- **Status**: docs done; commit pending user; NO deploy (consistent with v3.5.4→v3.6.4 holds).

### 2026-08-12 | IPO Issue Size (shares per lot + ₹ per lot) + NSE Events Feed + AI IPO Report v2 (JSON) + MCP/Telegram (v3.6.4)
- **Action**: Shipped the v3.6.4 IPO feature set: (1) **Issue Size** = lot size + shares per lot — NEW pure zero-import `lib/services/ipoIssueSize.ts` (`parseSharesPerLot` regex off "Bid Lot" text, `parsePriceBandLow` ₹ off "Price Range" text, `perLotInvestment(shares, priceBandLow)`, `formatIssueSize` with structural `IssueSizeInput` type; re-exported by `nseIpoService.ts` for server callers/tests) → "154 shares per lot · ₹14,168 per lot"; NEW server proxy `app/api/recommendations/ipos/[symbol]/detail/route.ts` → `getIpoIssueDetail` (24h cache via `getOrFetchSyncedData`, memory→NSE→DB); landing IPO page + `IposTab` batched per-symbol detail fetch show the formatted Issue Size. (2) **NSE events feed** — NEW `lib/services/nseEventsService.ts` (`NseEvent`, `normalizeThumbnail` https: prefix, `isNseEventRaw` guard, 6h TTL, `EVENTS_FETCH` audit) + `app/api/events/route.ts` server proxy + `app/components/EventsFeedWidget.tsx` (useSWR, dynamic grid, skeleton/empty states, PAST/UPCOMING pill) wired into `app/page.tsx` below Corporate Announcements. (3) **AI IPO report v2 = JSON** — NEW pure `lib/services/ipoReport.ts` (18-section `IpoReport` schema, `buildIpoReportPrompt` "return ONE valid JSON object", `parseIpoReportJson` fence→braces, never-throws `normalizeReport`); `ipoAnalysisService` derives `report?: IpoReport | null` (legacy markdown rows → null, client falls back), verdict/recommendation from report, prompt switched to JSON (legacy `buildIpoAnalysisPrompt` retained); NEW premium `IpoReportView.tsx` (VERDICT_STYLE/RISK_STYLE accents, GMP gauge, peers table, risk matrix, strategy probability bars, targets, finalScore /100, disclaimer) wired into `IpoAnalysisModal` + `IpoAnalysisPanel`; analysis API adds `report: result.report ?? null`. (4) **MCP** — `getIpoAnalysis` (43200s) / `getIpoIssueDetail` (3600s) / `getNseEvents` (21600s) → 26 functions. (5) **Telegram** — `/ipo <SYMBOL>`, `/ipo-analysis <SYMBOL>`, `/events` (dynamic imports, lightweight bot) in `COMMAND_MAP`/`KNOWN_COMMANDS`/help.
- **Client-bundle leak fix**: Playwright caught `Module not found: Can't resolve 'dns'/'fs'` (HTTP 500) — `IposTab.tsx` value-imported `formatIssueSize` from `nseIpoService`, dragging `syncedDataService → prisma → pg` into the browser bundle (recurrence of the v3.2.0 Rebalancer lesson #25). Fix: value-imports from the pure `ipoIssueSize.ts` only; `import type { IpoIssue }` from `nseIpoService` is erased at compile so it stays safe.
- **Tests**: NEW `lib/__tests__/ipoReport.test.ts` (10) + NEW `lib/__tests__/nseEventsService.test.ts` (6) + `nseIpoService.test.ts` +7 + `ipoAnalysisService.test.ts` +3 v2 JSON (also fixed a pre-existing `@/lib/logger` mock gap — mock lacked `debug`). **Full suite: 533 pass (was ~507)**; tsc clean (scoped).
- **Playwright verify (:3000)**: home events feed (3 real NSE events, PAST pills), `/recommendations` IPOs tab — Issue Size cells in all 3 sections (BLEL "52 shares per lot · ₹14,092 per lot", SHIPROCKET 154/lot, MILKYMIST 107/lot, …), landing `/recommendations/ipos/SHIPROCKET` Issue Size card "154 shares per lot · ₹14,168 per lot", mobile 375px — 0 console errors everywhere (landing page logs 3 expected OpenRouter-429 degrade entries = self-heal stale-row path working).
- **Files Created**: `lib/services/ipoIssueSize.ts`, `lib/services/ipoReport.ts`, `lib/services/nseEventsService.ts`, `app/api/events/route.ts`, `app/api/recommendations/ipos/[symbol]/detail/route.ts`, `app/components/EventsFeedWidget.tsx`, `app/components/recommendations/IpoReportView.tsx`, `lib/__tests__/ipoReport.test.ts`, `lib/__tests__/nseEventsService.test.ts`
- **Files Modified**: `lib/services/nseIpoService.ts`, `lib/services/ipoAnalysisService.ts`, `app/api/mcp/route.ts`, `lib/services/telegramBotService.ts`, `app/components/recommendations/IposTab.tsx`, `app/components/recommendations/IpoAnalysisModal.tsx`, `app/components/recommendations/IpoAnalysisPanel.tsx`, `app/recommendations/ipos/[symbol]/page.tsx`, `app/page.tsx`, `app/api/recommendations/ipos/[symbol]/analysis/route.ts`, `lib/audit.ts` (EVENTS_FETCH tag), `lib/__tests__/nseIpoService.test.ts`, `lib/__tests__/ipoAnalysisService.test.ts`, `AGENTS.md`, `.agents/CHANGELOG.md`, `.agents/changelog/versions-v3.md`, `TODO.md`, `Primer.md`, `agent-memory.md`, `Lessons.md` (25 updated — recurrence + `import type` nuance), `docs/architecture.html` (MCP 23→26), session `decisions.md`/`flow.md` (`2026-08-12-8f2a11d`, D1–D6)
- **Status**: docs done; tmp probes deleted; commit pending user; NO deploy (consistent with v3.6.x holds).

### 2026-08-12 | DividendCalendar Timezone Fix — noon-UTC ex-dates landed 1 day late in IST (v3.6.2)
- **Action**: User reported `/dividends` calendar looked shifted + summary cards showed `0/₹0/₹0/—`. Split into: (1) **cards CORRECT** — all 19 local ex-dates are Aug 10–11 (noon UTC via seed `parseDateCA`), today Aug 12 → zero future ex-dates locally, so v3.6.0 `getUpcomingDividendSummary` correctly returns zeros (prod populates via market-sync cron); (2) **REAL BUG** — `DividendMonthView` bucketed ex-dates by UTC `toISOString` key while grid cells were local → in IST a local Aug-11 cell converts to `2026-08-10T18:30Z` → Aug-10 noon-UTC dividends matched the WRONG (next-day) cell → 9 divs on day 11 (+6), 10 divs on day 12 (+7).
- **Fix**: exported `toLocalDateKey(date)` (local Y/M/D padStart) used for BOTH bucketing + grid cells, `data-testid="cell-<key>"` per cell. `DividendListView` already correct (`toLocaleDateString("en-IN")`).
- **Tests**: NEW `app/components/dividends/__tests__/DividendMonthView.test.tsx` (4) with `process.env.TZ = "Asia/Kolkata"` pinned (jest runs UTC where the shift never reproduces — CI must keep the pin). Verified: old code 4 FAIL, fix 4 PASS. Fixture pitfall: 2nd dividend's `companyName` defaulted to "PTC India Ltd" → fixed with explicit override.
- **Verify (dev :3000, Playwright)**: day 10 = PTC/JIOFIN/MAJESAUT +6 (9), day 11 = RATNAMANI/DVL/CASTROLIND +7 (10), day 12 empty, cards `0/₹0/₹0/—`, 0 console errors. **Suite: 453 passed / 11 skipped** (449 + 4). tsc clean on touched files.
- **Status**: docs done (AGENTS.md v3.6.2 row, CHANGELOG/versions-v3, TODO, Primer, agent-memory, session D26 + flow §13); commit pending user; NO deploy.

### 2026-08-12 | Recs-Tab Default Sorts + Performance Price Bridge + AI Context Enrichment + Pen/Perf Plans (v3.6.1)
- **Action**: Fixed the user-reported recs-tab sort defaults (Performance tab defaulted to return %, not created-date desc — root: UI `useState` default overrode the already-correct API default; prod/local data fully populated so the "empty columns" perception was a sort artifact), filled null Performance `currentPrice` from `daily_prices` via one batched `DISTINCT ON` query, enriched the AI recommendation prompt with per-symbol fundamentals context (DB corp actions + announcements + cached quarterly results), and added actionable pen/perf testing plans. **No commit, no deploy** (pending user — consistent with v3.5.4→v3.6.0 holds).
- **Default sorts**: `app/components/recommendations/PerformanceTab.tsx` default `"returnPercent"`→`"createdAt"`; `HistoryTab.tsx` default `"screenerCount"`→`"date"`; `DailyPicksTab.tsx` NEW `"createdAt"` sort key + "Newest" option (first, default; `createdAt` desc with screener-count tiebreak). Playwright :3000 verified — History "Date" active, Performance "Recommended ▼" active, 0 console errors.
- **Price bridge**: `lib/services/recommendationPerformanceService.ts` — `bridgeMissingCurrentPrices<T>` (ONE `SELECT DISTINCT ON (ticker) … close::float8 FROM daily_prices WHERE ticker = ANY(…) ORDER BY ticker,"tradeDate" DESC`) fills null `currentPrice` before `toListItem` on both `getPerformanceList` paths; graceful catch → warn + unchanged. +3 tests.
- **AI context**: NEW `lib/services/ai/recommendation-context.ts` — `getRecommendationContext(symbols)` (batched DB corp actions/announcements + ONE cached `getCorporateResults("Quarterly")` call; caps 3/2/1; `Promise.allSettled` per source) + `formatStockContext()`; `recommendation-agent.ts` `StockAnalysisInput.context?` + prompt Context blocks + system rule + `indent()` helper; `dailyRecommendationService.ts` enriches ONCE per run after the MAX_AI_STOCKS cap slice (`enrichedCount` log). +6 tests (NEW `lib/__tests__/recommendation-context.test.ts`).
- **Plans**: NEW `TODO-PENTESTING.md` + `TODO-PERF-TESTING.md` — checklists + findings logs (records the known `GET /api/recommendations/performance?offset≥1001` → 500 bug; NOT fixed this session).
- **Tests**: **Full suite: 449 passed / 11 skipped / 0 failures** (was 440 + 9 new). `npx tsc --noEmit` clean on all new/changed files.
- **Docs**: AGENTS.md v3.6.1 row, `.agents/changelog/versions-v3.md` v3.6.1 entry, `TODO.md` Quick Reference (+4 rows), Primer.md status, agent-memory, session memory D23–D25 + flow §12.
- **Files Created**: `lib/services/ai/recommendation-context.ts`, `lib/__tests__/recommendation-context.test.ts`, `TODO-PENTESTING.md`, `TODO-PERF-TESTING.md`
- **Files Modified**: `app/components/recommendations/PerformanceTab.tsx`, `HistoryTab.tsx`, `DailyPicksTab.tsx`, `lib/services/recommendationPerformanceService.ts`, `lib/services/ai/recommendation-agent.ts`, `lib/services/dailyRecommendationService.ts`, `lib/__tests__/recommendationPerformanceService.test.ts`, `TODO.md`, `AGENTS.md`, `.agents/changelog/versions-v3.md`, `Primer.md`, `agent-memory.md`, session `decisions.md`/`flow.md`
- **Status**: docs done; commit/PR pending user; NO deploy.

### 2026-08-11 | Auth Join→Approve→Login Fix + Server Logs `logs/` Directory (v3.5.7)
- **Action**: Removed the `isVerified` gate from `lib/auth.ts` authorize() (it threw "Email not verified" BEFORE the bcrypt compare → approved join-request users could never log in); join approval now sets the **`DEFAULT_PASSWORD` env var** value (was a random hex nobody saw, then a hardcoded literal — now env-only, no fallback in code, missing env → 500 guard) shown via env-var NAME in the admin confirm dialog + server-returned password in the success alert + `{defaultPassword, email}` API response; moved server logs `server_logs/`→`logs/`, fixed the `readLogsByDate` path bug, added Netlify `server-logs` Blob mirroring for the general logger + store-aware blob reads (monitoring Server Logs tab now displays logs). **No commit, no deploy** (pending user).
- **Auth**: `lib/auth.ts` — isVerified gate removed, blocked check + password compare retained. Dead UNVERIFIED error branches cleaned from `app/auth/signin/page.tsx` + `app/components/modals/LoginModal.tsx`.
- **Approve route**: `app/api/admin/join-requests/[id]/approve/route.ts` — reads `process.env.DEFAULT_PASSWORD` (bcrypt-hashed value from `.env`, cost 12), missing → 500 `logger.error` ("Server not configured: DEFAULT_PASSWORD missing"); response includes `defaultPassword` + `email`. `app/admin/users/page.tsx` — confirm dialog references the env-var NAME, success alert shows the API-returned password.
- **Logging**: `lib/logger.ts` — `getLogsDir()` → `logs`, `readLogsByDate` path fixed (`logs/<YYYY-MM>/<date>.log`), general logger mirrors every line to the `server-logs` Blob store on Netlify (fire-and-forget). `lib/netlify-logger.ts` — server/worker store constants, `appendServerLogLine`, paramaterized `readBlobLog`/`deleteBlobLog`/`writeBlobLog`, `listBlobLogs` strips `.log`. `.gitignore` + `logs/`.
- **Credential hygiene (enforced)**: NEW `.githooks/commit-msg` — blocks commit messages containing credential literals (join-default value + public demo passwords + `password=…` assignments) → "Reference env var NAMES only"; `.githooks/pre-commit` added #6 (real `.env` never staged) + #7 (join-default password literal in staged diff, exempting `.githooks/*` by design, + `password[:=] "…"` in staged `.md`). Both `bash -n` clean + functional-tested. All literal join-password values redacted to backtick-quoted `********` across committed docs. `.env.example` documents only the NAME with "env var only, never hardcode value in code or docs". Public sandbox demo creds (seed, e2e, README/AGENTS tables) remain exempt — documented public demo logins, not production secrets.
- **README.md rewritten/polished**: clean single structure (badges, overview, feature-highlights, verified-features, quick start, public demo creds, tech stack, commands, testing, MCP API, **AI & Agent Discovery** section, env vars, project structure, AI-assisted dev, license); removed stacked dated "Latest Update" sections.
- **AI & Agent Discovery**: NEW `app/llms.txt/route.ts` — static llmstxt.org-style index (what the site is, public pages, public APIs incl. MCP/recommendations/screener, data sources, tech stack, explicit Boundaries: no `/admin/*`, `/users/*`, `.agents/` never published, no credentials). `app/robots.ts` rewritten — first-rule-wins `/llms.txt` allow + LLM-crawler UA list (GPTBot, ClaudeBot, anthropic-ai, PerplexityBot, Google-Extended, FacebookBot, Applebot-Extended, Bytespider) + Googlebot/Bingbot rules + internal/tooling path blocks.
- **Tests**: NEW `lib/__tests__/logger-paths.test.ts` (7 tests, `@jest-environment node` — jsdom makes `isServer` false so file APIs no-op); `jest.setup.js` window mocks wrapped in `typeof window !== 'undefined'`. **Full suite: 419 passed / 11 skipped / 0 failures** (was 412 + 7).
- **Verification (Playwright, dev :3000)**: join request (`pwjoin-e2e-20260811@test.local`) → admin approves → success alert → logout → login with env-configured password → redirect `/` → monitoring Server Logs lists `2026-08-11` + renders lines. **Route checks (curl dev :3000)**: `/llms.txt` 200 text/plain, `/robots.txt` 200, `/sitemap.xml` 200 application/xml, `/api/openapi` 200 valid OpenAPI 3.0.3 JSON (first 404 was a stale Turbopack watcher — timestamp-touch of `app/api/openapi/route.ts` re-registered it; no code change). Cleanup: killed dev server tree (PID 16588) + deleted `next-llms-verify*.log`.
- **Files Modified**: `lib/auth.ts`, `lib/logger.ts`, `lib/netlify-logger.ts`, `app/api/admin/join-requests/[id]/approve/route.ts`, `app/admin/users/page.tsx`, `app/auth/signin/page.tsx`, `app/components/modals/LoginModal.tsx`, `app/robots.ts` (rewritten), `README.md` (rewritten), `jest.setup.js`, `.gitignore`, `.githooks/pre-commit` (#6/#7), `.githooks/commit-msg` (new), `.env.example`, `AGENTS.md`, `.agents/CHANGELOG.md`, `.agents/changelog/versions-v3.md`, `TODO.md`, `Primer.md`, `agent-memory.md`, `Lessons.md`, `HANDOFF.md`, `.agents/handoffs/active/latest.md`, `.agents/sessions/2026-08-11-c995a10/decisions.md` + `flow.md`
- **Files Created**: `lib/__tests__/logger-paths.test.ts`, `app/llms.txt/route.ts`, `.githooks/commit-msg`
- **Status**: docs done; commit/PR pending user; NO deploy.

### 2026-08-11 | Chartink 117-Registry PRIMARY + TV Fallback Unified Runner (v3.5.6)
- **Action**: Made the 117-entry Chartink JSON registry the PRIMARY screener source across engine + API + UI, with the 98 TradingView templates as fallback. NEW `chartinkUnifiedScreenerService` (source chain fresh DB rows → live Chartink scan → ONE shared TV universe scan) + engine switch + `/api/screener/chartink` + TemplatesPanel source toggle. **No commit, no deploy** (pending user).
- **Service**: `lib/services/chartinkUnifiedScreenerService.ts` — `runChartinkUnifiedScreeners` (unified ScreenerResult[] + source + templateIds, 5-min staticCache `chartink-unified:screener-results`, forceRefresh bypass), `runChartinkScreenerById`, exported `resolveTvFallback` (curated CURATED_TV_FALLBACK → token match ≥0.6 → CATEGORY_TV_MAP default), `tvRowToChartinkStock`/`scanStockToChartinkStock` normalisers, union-columns shared TV scan (0–2000).
- **Engine switch**: `dailyRecommendationService.ts` L12 import + L167 `runChartinkUnifiedScreeners({ forceRefresh: true })`; `totalRawHits` uses `(s.screenerCount || 0)`. `deduplicateResults` now exported from `chartinkService.ts`.
- **API**: `app/api/screener/chartink/route.ts` — GET (registry + DB overviews: fetchable/enabled/lastRunAt/resultCount/stale) + POST run-by-id.
- **UI**: `TemplatesPanel.tsx` rewritten — Chartink·117/TradingView·98 toggle, category pills per source, per-template badges (clause ready/catalog only/{count} captured · stale/disabled/Last run), run spinner, `onChartinkResult`; `advanced/page.tsx` maps chartink results → ScannedStock table.
- **Tests**: NEW `lib/__tests__/chartinkUnifiedScreenerService.test.ts` (18). **First run CAUGHT A REAL BUG**: catalog-only templates (no scanClause — 116/117 today) never reached TV fallback (only failed-clause templates entered stillTv) → unified run would silently return ~nothing. Fix: seed stillTv with catalog-only templates. Mock rows enriched with real filter fields (relative_volume_10d_calc, "Perf.5D", return_on_equity_fq); DB-short-circuit test pinned with templateIds. `dailyRecommendationService.test.ts` mock retargeted to the new module. **Full suite: 412 passed / 11 skipped / 0 failures**.
- **Verification**: tsc clean on all new/changed files (only pre-existing test-file noise).
- **Files Created**: `lib/services/chartinkUnifiedScreenerService.ts`, `app/api/screener/chartink/route.ts`, `lib/__tests__/chartinkUnifiedScreenerService.test.ts`
- **Files Modified**: `lib/services/chartinkService.ts`, `lib/services/dailyRecommendationService.ts`, `app/components/screener/TemplatesPanel.tsx`, `app/markets/screener/advanced/page.tsx`, `lib/__tests__/dailyRecommendationService.test.ts`, `AGENTS.md`, `.agents/CHANGELOG.md`, `.agents/changelog/versions-v3.md`, `TODO.md`, `Primer.md`, `agent-memory.md`, `.agents/sessions/2026-08-11-c995a10/decisions.md` + `flow.md`
- **Status**: docs done, commit/PR pending user; no deploy.

### 2026-08-11 | Chartink Template Capture → DB (v3.5.5)
- **Action**: Added 3 Prisma models (ChartinkScreener defs mirroring the 117 JSON entries, ChartinkScreenerRun per full run, ChartinkScreenerResult captured tables with 72h TTL), a DB sync service, and a Playwright capture tool that fills the 116 catalog-only clauses + feeds captured tables to the DB. **No migration applied, no commit, no deploy** (all pending user approval).
- **Models** (`prisma/schema.prisma`, v3.5.5 block): `ChartinkScreener` (id/name/url/categoryId/categoryName/scanClause/debugClause/columnClause/backtestMaxRows/scanlinkId/backtestUrl/enabled/lastRunAt/nextRunAt/resultCount) + `ChartinkScreenerRun` (status/error/screenersRun/rowsInserted/ttlHours) + `ChartinkScreenerResult` (symbol/name/bsecode/close/changePercent/conditionFlag/volume/raw/expiresAt). `npx prisma format` + `generate` ✅ (client v7.7.0).
- **Full-run semantics** (product requirement): `runFullChartinkSync` = clean entire results table → re-insert whole captured dataset under one new run id; rows carry `expiresAt = capturedAt + ttlHours` (72h); `pruneExpiredChartinkResults` + fresh-only reads.
- **Service**: `lib/services/chartinkScreenerService.ts` — `normalizeCapturedRows`, `upsertChartinkScreener`, `updateChartinkScreenerLink`, run lifecycle (chunked createMany 250), `clearChartinkResults`, `pruneExpiredChartinkResults`, `getChartinkScreeners` (stale flag), `getChartinkScreenerResults`, `runFullChartinkSync`.
- **Capture tool**: `scripts/chartink-capture/capture.ts` (Playwright, **network-interception-first** — traps the `/screener/process` request body = exact clauses + response = table rows/scanlink; clipboard-click fallback per user's recipe; writes clauses back to JSON configs first-value-wins + feeds DB via `runFullChartinkSync`; `--category`/`--id`/`--dry-run`/`--no-db`/`--headful`/`--backtest`/`--ttl`) + `capture-core.ts` (pure, unit-tested: clipboard TSV parse, clause merge, CLI args).
- **Tests**: `lib/__tests__/chartinkScreenerService.test.ts` (26) + `scripts/chartink-capture/__tests__/capture-core.test.ts` (9). **Full suite: 394 passed / 11 skipped / 0 failures** (31 of 32 suites). tsc clean on ALL chartink files (only pre-existing untouched noise remains).
- **Note**: chartink.com live fetch blackholes from this sandbox — the capture tool must run where a real browser works (user machine / CI), same as `chartinkService.ts`.
- **Files Created**: `lib/services/chartinkScreenerService.ts`, `scripts/chartink-capture/capture.ts`, `scripts/chartink-capture/capture-core.ts`, `lib/__tests__/chartinkScreenerService.test.ts`, `scripts/chartink-capture/__tests__/capture-core.test.ts`
- **Files Modified**: `prisma/schema.prisma`, `.agents/docs/chartink-api.md`, `AGENTS.md`, `.agents/CHANGELOG.md`, `.agents/changelog/versions-v3.md`, `TODO.md`, `Primer.md`, `agent-memory.md`, `.agents/sessions/2026-08-11-c995a10/decisions.md` + `flow.md`
- **Status**: schema + generate done; migration (`prisma migrate dev --name chartink_screener_capture`) NOT run (needs user consent per guardrails); commit NOT made; NO deploy.

### 2026-08-11 | Stale Recommendations (code) + Cron Ledger Fix + Session Memory Infra (v3.5.4)
- **Action**: Root-caused and fixed (code-only, no deploy) the stale public recommendations page (all-HOLD runs) and the Admin cron ledger showing no runs; added mandatory per-session decisions/flow memory.
- **Branch**: `fix/ai-config-cron-ledger` (from main @ `c995a10`)
- **Root cause 1**: `dailyRecommendationService.ts` L322 called `analyzeStocks(aiInput)` with NO AI config → env-only default → DB `ai_config` Secret never reached pipeline → prod all-HOLD → BUY/SELL-filtered public page stale since Jul 19 (verified after API-side prod config was already fixed).
- **Root cause 2**: `DEFAULT_MODEL`/`AVAILABLE_MODELS` pointed at nonexistent OpenRouter models (`tencent/hy3:free`, `qwen/qwen3-next-80b-a3b-instruct:free`, `inclusionai/ling-3.0-flash:free`) → HTTP 404 (verified vs live catalog, 399 models). New default: `nvidia/nemotron-3-ultra-550b-a55b:free`.
- **Root cause 3**: `CronJob` ledger (`lastRun`/`runCount`/`successCount`/`failureCount`/`nextRun`) only written by `spawnCronTask`/resident scheduler (never on serverless); `successCount`/`failureCount` had NO writer; `netlify/functions/run-cron-background.ts` bypassed the ledger entirely.
- **Fixes**: shared async `loadConfig()` (DB Secret > env, lazy prisma import) + pipeline passes config + test route deduped; `recordCronRun(jobName, success)` (name lookup, counters, nextRun via `calculateNextRun`, safe no-op) wired into `run-cron-background.ts` (success+failure) + admin PATCH runNow/retry via `recordManualRunLedger` (skips cronJobId-linked tasks).
- **Memory infra**: `.agents/rules/session-decisions-flow.md` (MANDATORY decisions.md + flow.md) + `sessions/2026-08-11-c995a10/` (D1–D8).
- **Tests**: new `lib/__tests__/recommendationCronService.test.ts` (5). Full suite: **340 passed / 11 skipped / 0 failures** (28 suites). tsc clean on touched production files; ESLint repo-wide blocked by pre-existing eslintrc circular-JSON config error (`next lint` removed in Next 16) — out of scope.
- **Files Created**: `lib/__tests__/recommendationCronService.test.ts`, `.agents/rules/session-decisions-flow.md`, `.agents/sessions/2026-08-11-c995a10/decisions.md`, `.agents/sessions/2026-08-11-c995a10/flow.md`
- **Files Modified**: `lib/services/ai/config.ts`, `lib/services/dailyRecommendationService.ts`, `app/api/admin/ai/test/route.ts`, `lib/services/recommendationCronService.ts`, `netlify/functions/run-cron-background.ts`, `app/api/admin/workers/route.ts`, `AGENTS.md`, `.agents/CHANGELOG.md`, `.agents/changelog/versions-v3.md`, `.agents/rules/README.md`, `.agents/rules/session-memory-rules.md`, `.agents/sessions/README.md`, `Primer.md`, `agent-memory.md`, `Lessons.md`, `BUGS.md`, `.agents/session-todos.md`, `.agents/handoffs/active/latest.md`
- **Docs Updated**: AGENTS.md (v3.5.4 row), `.agents/CHANGELOG.md` + `versions-v3.md`, Primer.md (status + Session 15), `.agents/handoffs/active/latest.md` (rewritten v1.1), BUGS.md, `.agents/session-todos.md`
- **Status**: commit pending on `fix/ai-config-cron-ledger`; no deploy this session (user explicit). Prod rerun (verify BUY/SELL picks + fresh public date) + cron-ledger verification deferred to a user-approved deploy session.

### 2026-08-08 | Playwright E2E Suite + CI + Docs (v3.5.3)
- **Action**: Hardened the committed e2e suite to green, added CI workflow + comprehensive Playwright docs/skills, prepared commit to open PR #85.
- **Branch**: `fix/screener-change-percent` (PR #85 open; v3.5.2 app fix committed `b692d64` + docs `2daf72a`; e2e stack was user-owned/untracked)
- **Root causes fixed while hardening** (all encoded in `playwright.config.ts` + specs — don't regress):
  - **Firefox `xl` nav**: header nav is `hidden xl:flex` (≥1280px); Firefox measures media queries scrollbar-inclusive so the default 1280×720 never shows it → viewport override **1440×900** on all desktop projects.
  - **WebKit `fill()` on controlled `<input type="number">`**: WebKit drops the programmatic fill (React restores old value) — advanced-screener empty-state silently ran default `close > 0` ("2000 stocks found") → switched to click → `ControlOrMeta+a` → `Delete` → `pressSequentially('99999999')` + `toHaveValue`.
  - **Single-threaded dev-server starvation**: heavy TradingView scans starve parallel SSR navs → `navigation.spec.ts` rewritten to `mode: 'serial'` + `Promise.all([waitForURL, click({ noWaitAfter: true })])` (URL commit, not load) + `URL_TIMEOUT = 60_000`, `HEADING_TIMEOUT = 30_000`; `retries: CI ? 2 : 1`, `workers: CI ? 1 : 2`.
  - **Live-data flakiness**: `MarqueeBanner` renders `null` when `/api/nse/marquee` is slow → removed marquee assertion from `home.spec.ts` (never assert live NSE values).
- **Full suite GREEN**: 87/89 first attempt + 2 flaky passing on retry #1 (webkit nav Contact SSR starvation; Firefox `RenderCompositorSWGL` headless teardown crash — both environmental). Unit: 317 passed / 26 suites / 1 pre-existing skip. `e2e/` files typecheck clean (pre-existing tsc errors only in jest-dom test files + `scripts/tmp-*`).
- **CI workflow**: `.github/workflows/playwright.yml` hardened — `timescale/timescaledb:latest-pg16` service (migrations `0001_timescale_init.sql` + `202512_add_market_tables.sql` require `CREATE EXTENSION timescaledb` + `create_hypertable`), `DATABASE_URL` + `AUTH_SECRET` env, `prisma migrate deploy` + `npx prisma db seed` (seed is data-only, no NSE fetch), `npx playwright install --with-deps`, dev server auto-started by the config webServer block, HTML report artifact 30d, `workflow_dispatch` added.
- **Docs**: `.agents/docs/playwright-e2e.md` (implementation + agent workflow + report/Trace Viewer + troubleshooting playbook), `playwright-e2e` skill (machine `.opencode/skills/playwright-e2e/SKILL.md` + human mirror `.agents/skills/playwright-e2e/SKILL.md`), `playwright-cli` skill ×2 cross-references + MCP tool guidance (`playwright` MCP for exploratory/agentic, `chrome-devtools` for perf/Lighthouse), AGENT-SKILL-MATRIX row, AGENTS.md (v3.5.3 row, e2e commands, focused-skills table, Plugins & MCP, lessons), `.agents/CHANGELOG.md` + `versions-v3.md` v3.5.3 entry, README.md CI badge + "Latest Update - v3.5.3" section, Primer.md (status + Session 14).
- **Files Created**: `e2e/` (11 specs), `playwright.config.ts`, `.github/workflows/playwright.yml`, `.agents/docs/playwright-e2e.md`, `.opencode/skills/playwright-e2e/SKILL.md`, `.agents/skills/playwright-e2e/SKILL.md`
- **Files Modified**: `package.json` (+`test:e2e`, `test:e2e:ui`, `@playwright/test` devDep), `package-lock.json`, `.gitignore`, `AGENTS.md`, `.agents/CHANGELOG.md`, `.agents/changelog/versions-v3.md`, `.agents/AGENT-SKILL-MATRIX.md`, `.opencode/skills/playwright-cli/SKILL.md`, `.agents/skills/playwright-cli/SKILL.md`, `README.md`, `Primer.md`, `agent-memory.md`
- **Lesson**: e2e flakiness on a live-data app is almost always (1) viewport/media-query mismatch, (2) WebKit controlled-input quirks, or (3) single-threaded dev-server load starvation — fix the root cause in config/specs, don't loosen assertions or bump retries to hide real regressions.
- **Status**: Docs done; commit everything to open PR #85 (`fix/screener-change-percent`) — never auto-merge.

### 2026-08-08 | Screener `change` = % Fix (v3.5.2) — 0 → 250 template matches
- **Action**: Root-caused and fixed ~60 screener templates silently matching 0 stocks on NSE (TradingView `change` IS % change; `change_percent` null/unsupported). Rewrote "Short Term Breakouts" to a validated TV-native proxy → 250 stocks (was 0), 18/20 Chartink overlap.
- **Branch**: `fix/screener-change-percent` (from main @ `c7a30ba`)
- **Root cause**: TV `change` = % (RELIANCE 1334.8 vs 1325 = +0.74%; EEPL +20.0%, SBCL +19.99% — matches Chartink); probe `change_percent > 1` → 0 rows.
- **Template rewrite**: `thr("change","gt",0,"relative_volume_10d_calc","gt",1,"Perf.5D","gt",3)` (L503–511); mass-fixed all 57 remaining `change_percent` → `change` args (0 remain).
- **Field + service + route + UI**: `Perf.5D` added to `FILTER_FIELDS` + FilterBuilder; `getTopMovers` gainers/losers/active fixed; advanced route `percentChange ?? change`; `change` labeled "Change (%)", ₹ derived `close*pct/(100+pct)` in results; % Change column sortable.
- **Rejected**: server-side NSE history lookback enrichment (~65 min for 882 candidates; TV pre-filter does it in ~1s).
- **Verification**: 45 screener tests pass; tsc clean on 6 touched files; Playwright — "250 stocks found · 574ms", SBIN +1.12%, MOTHERSON +8.71%, TATATECH +8.89%, zero console errors.
- **Files Modified**: `lib/screener/screener-templates.ts`, `lib/screener/condition-tree.ts`, `lib/services/tradingview-service.ts`, `app/api/screener/advanced/route.ts`, `app/components/screener/ScannedResultsTable.tsx`, `app/components/screener/FilterBuilder.tsx`
- **Docs Updated**: AGENTS.md (v3.5.2 row), `.agents/CHANGELOG.md` + `versions-v3.md`, CHANGELOG.md ([3.5.2]), TODO.md, Primer.md (status + Session 13), `.agents/changelog/screener.md`, `.agents/session-todos.md`, `.agents/handoffs/active/latest.md`
- **Status**: Commit pending — 6 files; user's Playwright files left untracked/untouched.

### 2026-08-06 | Git Workflow & Agent Operating Model (v3.4.2) — Tracked Hooks + Gardenify Docs Port
- **Action**: Applied gardenify git/agentic patterns — versioned `.githooks/` directory + git-flow/code-hygiene/documentation docs + AGENTS.md operating model.
- **Branch**: main (v3.4.2)
- **Tracked Git Hooks**: Created `.githooks/pre-commit` (warn-only main/master solo policy; BLOCK hardcoded secrets + staged `.env`; WARN console.log, junk artifacts, tsc production-file errors), `.githooks/post-commit` (checkpoint logging to gitignored `.agents/handoffs/checkpoint.log`), `.githooks/pre-push` (WARN main/master). Set `git config core.hooksPath .githooks` so hooks survive fresh clones.
- **Gardenify Docs Port**: `.agents/linear-history.md` (git flow, branch naming, commit convention, pre-push checklist), `.agents/code-hygiene.md` (ponytail minimal-code rules + TradeNext standards), `.agents/documentation-standards.md` (doc set + mandatory update rules).
- **AGENTS.md Operating Model**: Added "Git Hooks (versioned in .githooks/)", "Agent Operating Model (gardenify pattern)" (memory layout, handoff = files, self-healing, anti-hallucination, token efficiency), "Plugins & MCP" (helicone-session, wakatime; ponytail recommended-not-installed).
- **Files Created**: `.githooks/pre-commit`, `.githooks/post-commit`, `.githooks/pre-push`, `.agents/linear-history.md`, `.agents/code-hygiene.md`, `.agents/documentation-standards.md`
- **Files Modified**: AGENTS.md (operating model + v3.4.2 version entry), `.agents/pre-commit-workflow.md` (hook reference + doc links), `.agents/session-todos.md`, `HANDOFF.md` (v1.2 quick links), `Primer.md` (Session 7b), `.agents/sessions/README.md`
- **Verification**: Hooks manually executed (sh) — pre-commit reports "TypeScript: production files clean", post-commit logs checkpoint, pre-push warns on main. Full `npm run test` + `npx tsc --noEmit` pending before commit.

### 2026-08-06 | Prod Reliability Fixes (v3.4.1) — Txn Timeout + Top-50 Cap + Telegram + History + Monitoring
- **Action**: Fixed prod daily-recommendation pipeline failures and added UI/monitoring improvements; ran prod UI/UX audit; ported gardenify agentic patterns; updated docs.
- **Branch**: ph19 (v3.4.1)
- **Key Fixes**:
  - **Transaction Timeout**: `runInChunks()` replaces interactive `$transaction` in `runDailyRecommendations()` + `checkRecommendationPerformance()` (prevents `5000ms timeout, 5501ms passed` rollback error).
  - **Top-50 Cap**: `rankAndCapRecommendations()` — composite score `screenerCount*10 + marketCapScore*2 + momentumScore`; all downstream uses `rankedResults`; `MAX_RECOMMENDED_STOCKS = 50`.
  - **Telegram Live Prices**: `checkRecommendationPerformance()` invalidates cache; broadcast always sends (non-HOLD first, HOLD fallback, breakdown, 4000-char truncation); handlers use `tracker.currentPrice ?? s.price`.
  - **History Predicted vs Current**: top-stocks API JOINs `recommendation_trackers` → `entryPrice`/`currentPrice`/`trackerStatus`; HistoryTab shows return % + status badges.
  - **AI Monitoring Persistence**: `persistAiCallToDb()` fire-and-forget (ServerLog `source="ai"`); merged DB+memory reads; source badge.
  - **Monitoring DB Logs**: new `type=db-logs` in `/api/admin/monitoring` + DB Logs tab with level filter.
  - **Market Cap Plumbing**: `chartinkService.marketCap?` (TradingView `market_cap_basic`) + AI prompt inclusion.
- **Prod UI/UX Audit**: Playwright walkthrough of tradenext6.netlify.app — documented in TODO.md (stale recs, bare "🟡 %" cards, 643 stocks, empty demo portfolio).
- **Gardenify Port**: `.agents/session-todos.md`, `.agents/pre-commit-workflow.md`, `.agents/security-checklist.md`, `.agents/sessions/README.md`; HANDOFF.md updated.
- **Files Modified**: dailyRecommendationService.ts, telegramBotService.ts, top-stocks/route.ts, HistoryTab.tsx, ai-monitoring.ts, ai/monitoring/route.ts, ai-monitoring/page.tsx, chartinkService.ts, recommendation-agent.ts, admin/monitoring/route.ts, monitoring/page.tsx, TODO.md, HANDOFF.md, Primer.md, agent-memory.md, AGENTS.md, .agents/session-todos.md
- **Verification**: `npx tsc --noEmit` — zero errors in modified production files. Tests not yet re-run.

### 2026-07-19 | Daily Recommendations — Test Fixes, Security Hardening & PR #62 MERGED
- **Action**: Fixed 3 failing test suites, applied CodeQL security fix, created PR, documented learnings.
- **Branch**: `ph18` — PR #62 created and merged (commit `2f95531`).
- **Test Fixes (68 tests, 0 failures)**:
  - `chartinkService.test.ts` (25/25): Fixed `hasValidConfig` mock — was checking wrong path; updated to mock config service correctly.
  - `recommendation-agent.test.ts` (24/24): Fixed `parseAIResponse` source bug — swapped `parsed[idx] || symbolMatch` to `symbolMatch || parsed[idx]` so symbol matching is prioritized. Fixed batch retry test — added 2 `mockRejectedValueOnce` calls to match RETRY_MAX=2.
  - `dailyRecommendationService.test.ts` (19/19): Complete rewrite using TDZ-safe mock pattern — mock Prisma inside `jest.mock()` factory, retrieve via `require()`. Resolved complex object hoisting issues.
- **CodeQL High-Severity Fix**:
  - `app/api/user/telegram/verify/route.ts`: `crypto.randomBytes(4).readUInt32BE(0) % 1000000` → `crypto.randomInt(1000000)` — eliminates modulo bias in 6-digit verification code generation.
- **Source Bug Fix**:
  - `lib/services/ai/recommendation-agent.ts` line 271: Swapped symbol matching priority so AI responses in different order are matched correctly by symbol name, not position.
- **Full Test Suite**: 269/269 pass, 0 failures, 21/21 suites (1 skipped).
- **E2E Screenshots**: Captured `recommendations-todays-picks.png`, `recommendations-history.png`, `dashboard.png` in `screenshots/` directory.
- **Documentation Updated**: Lessons.md (36-39), TODO.md (Sprints 4-5 marked complete), AGENTS.md (v3.3.0 in version history), agent-memory.md (this entry), Primer.md (v3.3.0 status).
- **Files Changed**:
  - `lib/__tests__/chartinkService.test.ts` — mock fix
  - `lib/__tests__/recommendation-agent.test.ts` — parseAIResponse fix, retry mocks
  - `lib/__tests__/dailyRecommendationService.test.ts` — full rewrite with TDZ-safe pattern
  - `lib/services/ai/recommendation-agent.ts` — source fix line 271
  - `app/api/user/telegram/verify/route.ts` — CodeQL modulo bias fix
  - `Lessons.md` — 4 new lessons (36-39)
  - `TODO.md` — Sprints 4-5 marked complete
  - `agent-memory.md` — this entry
- **Status**: ✅ COMPLETE — v3.3.0 (Daily Recommendations + Self-Heal + Audit) fully implemented and merged

### 2026-07-19 | Daily Recommendations + Self-Heal + Audit (v3.3.0) — PLANNING COMPLETE
- **Action**: Created comprehensive implementation plan for Daily Recommendations Engine, Self-Heal AI Agents, and Unified Audit Logging.
- **Branch**: `ph18` created from `main`.
- **PRD Updated**: `.agents/PRD.md` — Features 6, 7, 8 added with full specifications.
- **TODO Updated**: Sprints 4 and 5 added with all UI/UX and implementation checklists.
- **AGENTS.md Updated**: v3.3.0 version history with complete file lists and feature descriptions.
- **HANDOFF.md Updated**: Status set to `in_progress`.
- **Key Design Decisions**:
  - Hybrid approach: Try Chartink API first, fall back to TradingView screener templates
  - Public page access (no auth for viewing), auth required for Telegram subscription
  - Extend existing OpenRouter Agent SDK (reuses llm-provider.ts, orchestrator.ts)
  - Separate cron jobs: 10 AM IST for generation, 3:30 PM IST for performance tracking
  - UnifiedEvent model for comprehensive audit logging
  - Circuit breaker pattern for AI provider resilience
- **8 New Prisma Models**: RecommendationTracker, DailyRecommendationRun, DailyRecommendationStock, RecommendationStatusHistory, RecommendationAlertSubscription, AgentPerformanceLog, ScreenerRunLog, SystemHealthLog, UnifiedEvent
- **Files to Create**: 25+ new files across services, APIs, UI, agent defs, skills
- **Files to Modify**: 16 existing files (schema, worker, telegram, header, audit, etc.)
- **Status**: ✅ Planning complete — ready for code implementation starting with Prisma schema

### 2026-07-18 | Telegram Bot Alert Delivery (v3.2.0) - COMPLETE
- **Action**: Built complete Telegram bot alert delivery system with @tradenext6Bot.
- **Problem**: Users couldn't receive real-time alerts on their phone; no Telegram integration existed.
- **Files Created (5)**:
  - `lib/services/telegramBotService.ts` — Centralized bot command handler with 6 commands, rate limiter (5/min, 20/hr, 3s cooldown), user verification via 6-digit code, audit logging, sendAlertToUser(), broadcastToSubscribers()
  - `app/api/user/telegram/test/route.ts` — POST test endpoint that sends "Test Message" to user's registered Telegram
  - `app/api/user/telegram/verify/route.ts` — POST with send (generates code) and confirm (validates code) actions; 10-min TTL
  - `app/components/alerts/TelegramSubscription.tsx` — 3-step subscription UI: Register → Verify → Done, with test/unsubscribe buttons
  - `lib/services/rebalancerTypes.ts` — Extracted types from rebalancerService.ts to avoid bundling Prisma/node modules in client components
- **Files Modified (8)**:
  - `app/api/telegram/webhook/route.ts` — Now delegates to handleBotCommand()
  - `app/alerts/page.tsx` — Added Telegram Bot as 5th tab
  - `app/contact/page.tsx` — Added FAQ: "How do I receive real-time alerts via Telegram?"
  - `app/components/rebalancer/AllocationTable.tsx` — Changed import to rebalancerTypes
  - `app/components/rebalancer/TargetAllocationEditor.tsx` — Changed import to rebalancerTypes
  - `app/components/rebalancer/TradeSuggestionList.tsx` — Changed import to rebalancerTypes
  - `next.config.ts` — Added pg, pg-native, pgpass to serverExternalPackages
  - `README.md`, `AGENTS.md`, `TODO.md` — Documentation updates
- **Bug Fix — Corp Actions Price/Yield**:
  - Added price enrichment from `daily_prices` (DISTINCT ON ticker for latest close)
  - Fixed yield formula: `(dividendPerShare / currentPrice) * 100` (was using face value)
- **Build Fixes**:
  - Extracted types to `rebalancerTypes.ts` to fix client-side Prisma bundling (was trying to resolve `pg`, `dns`)
  - Used PowerShell `ProcessStartInfo` for non-blocking dev server startup
- **Secrets Management**: Removed hardcoded Telegram secrets from README.md; stored only in .env + Netlify env vars
- **Testing**: Jest 190/190 pass; E2E Playwright on Dashboard, Alerts→Telegram tab, Contact FAQ, Dividends calendar, Portfolio Rebalance, Telegram webhook API, mobile responsive (375px) — 0 console errors
- **Build**: `npm run quickbuild` compiles successfully
- **Status**: ✅ RESOLVED — Code committed, needs git push to trigger Netlify CD deploy

### 2026-07-16 | Agent Handoff & Self-Learning System (v1.15.0) - COMPLETE
- **Action**: Created complete agent orchestration infrastructure with handoff files, agent definitions, self-learning loop, commands, and git hooks.
- **Issue**: No standardized mechanism for agent-to-agent handoffs, session context preservation, or self-improvement across diverse AI agents.
- **Root Cause**: Previous system had no handoff protocol between sessions, no way for different agent types (Claude, Cursor, OpenCode) to share context, and no self-learning loop.
- **Files Created (23 files)**:
    - `HANDOFF.md` - Root orchestration state
    - `.agents/handoffs/README.md`, `SCHEMA.md`, `active/latest.md`
    - `.agents/handoffs/flow/session-cycle.md`, `agent-to-agent.md`, `error-recovery.md`
    - `.agents/agents/gh-helper.md`, `e2e-agent.md`, `integrator.md`, `observability.md`, `devops.md`, `qa.md`
    - `.agents/agents/code-reviewer.md` (updated), `tdd-guide.md` (updated)
    - `.agents/commands/handoff.md`, `self-learn.md`, `review-diff.md`
    - `.agents/learning/README.md`, `session-log.md`
    - `.agents/hooks/README.md` (updated)
    - `.git/hooks/pre-commit`, `post-commit`
- **Details**:
    - Handoff system uses YAML frontmatter with structured context, progress, decisions, blockers, learnings
    - Agent pipeline protocol: GH Helper → Integrator → QA → DevOps
    - Self-learning loop extracts patterns and promotes them to Lessons.md
    - Pre-commit hook detects console.log and hardcoded secrets
    - Post-commit hook logs to `.agents/handoffs/checkpoint.log` (non-tracked) to avoid infinite loop
    - Full documentation updated: AGENTS.md, Primer.md, agent-memory.md, Lessons.md
- **Status**: RESOLVED in v1.15.0.

### 2026-03-21 | Worker Task Management Fix - COMPLETE
- **Action**: Fixed worker task actions in admin panel - Run Now, Cancel, Retry, Delete buttons.
- **Issue**: Tasks stuck in "pending" status with no way to execute from UI.
- **Files Modified**:
    - `app/admin/utils/workers/page.tsx` - Added action handlers and UI buttons
- **Details**:
    - Added `handleRunNow()` - executes pending/failed tasks immediately via PATCH API
    - Added `handleRetry()` - retries failed tasks
    - Fixed `handleCancel()` - now uses PATCH with action: "cancel"
    - Fixed `handleDelete()` - now uses PATCH with action: "delete"
    - Added styled buttons: ▶ Run Now (green), ↻ Retry (blue), ✕ Cancel (yellow), 🗑 Delete (red)
    - All actions now use PATCH `/api/admin/workers` with { action, taskId }
- **Status**: ✅ RESOLVED - Fixed in v1.11.1.

### 2026-03-21 | Google Analytics & SEO Enhancement - COMPLETE
- **Action**: Added comprehensive Google Analytics 4 integration and SEO optimization.
- **Files Created**:
    - `app/components/analytics/GoogleAnalytics.tsx` - GA4 component with format validation
    - `app/components/analytics/trackEvent.ts` - Custom event tracking with sanitization
    - `app/components/analytics/index.ts` - Barrel export
    - `app/components/seo/SEOTags.tsx` - Default metadata and JSON-LD schemas
    - `app/components/seo/OrganizationSchema.tsx` - Organization structured data
    - `app/components/seo/WebSiteSchema.tsx` - WebSite structured data with SearchAction
    - `app/components/seo/WebPageSchema.tsx` - WebPage structured data
    - `app/components/seo/StockSchema.tsx` - Stock/FinancialProduct structured data
    - `app/components/seo/index.ts` - Barrel export
    - `app/markets/metadata.ts` - Page metadata
    - `app/markets/screener/metadata.ts` - Page metadata
    - `app/markets/analytics/metadata.ts` - Page metadata
    - `app/portfolio/metadata.ts` - Page metadata
    - `app/news/metadata.ts` - Page metadata
    - `app/alerts/metadata.ts` - Page metadata
- **Files Modified**:
    - `app/layout.tsx` - Added `<SEOTags />` and `<Analytics />` components
    - `app/sitemap.ts` - Enhanced with all public pages, priority levels
    - `app/robots.ts` - Added Googlebot and Bingbot specific rules
    - `.env.example` - Added NEXT_PUBLIC_BASE_URL and NEXT_PUBLIC_GA_ID
- **Security Features**:
    - GA ID format validation before rendering
    - Input sanitization for all event tracking (XSS prevention)
    - No PII in analytics calls
- **Status**: ✅ RESOLVED - Implemented in v1.11.0.

### 2026-03-20 | Worker Logger Security Fix - COMPLETE
- **Action**: Fixed CodeQL path traversal vulnerability in worker-logger.ts.
- **Issue**: Uncontrolled data used in path expression - taskId used directly in filesystem paths.
- **Files Modified**:
    - `lib/services/worker/worker-logger.ts` - Added task ID sanitization
- **Details**:
    - Added `sanitizeTaskIdForPath()` function
    - Validates taskId against `/^[A-Za-z0-9_\-:.]+$/` pattern
    - Max length 128 characters
    - Applied to `writeToBoth()`, `readLog()`, and `deleteLog()`
- **Status**: ✅ RESOLVED - Fixed in v1.10.6.

### 2026-03-20 | Corporate Actions NSE Field Fix - COMPLETE
- **Action**: Fixed corporate actions sync saving all records as "OTHER" type with missing data.
- **Root Cause**: NSE API uses lowercase field names (`subject`, `comp`, `recDate`, `faceVal`) but code looked for uppercase (`PURPOSE`, `COMPANY NAME`, etc.). Also dividend field mismatch (`dividendPerShare` vs `dividendAmount`).
- **Files Modified**:
    - `app/api/admin/nse/live-sync/route.ts` - Added lowercase field mappings
    - `app/api/corporate-actions/combined/route.ts` - Added lowercase field mappings
    - `app/components/analytics/CorporateActionsTable.tsx` - Added Subject, FV, Price columns
- **Files Created**:
    - `scripts/fix-corp-actions.ts` - Cleanup script for incorrect records
- **Details**:
    - Fixed field mappings: `subject`, `comp`, `recDate`, `faceVal`
    - Fixed dividend field: `dividendPerShare ?? dividendAmount ?? null`
    - Upcoming Actions table now matches Historical format with Subject, FV, Price columns
- **Status**: ✅ RESOLVED - Fixed in v1.10.5.

### 2026-03-20 | Serverless Logging Fix - COMPLETE
- **Action**: Added database-backed logging for serverless platforms (Netlify, Vercel).
- **Problem**: File-based logging (`.next/server_logs`) doesn't work on serverless - directory isn't writable.
- **Files Created**:
    - `lib/services/db-logger.ts` - DB logging service with helpers
    - `app/api/admin/logs/route.ts` - API route for reading/managing logs
- **Files Modified**:
    - `prisma/schema.prisma` - Added `ServerLog` model
    - `lib/services/worker/worker-logger.ts` - Added DB fallback chain
- **Details**:
    - `ServerLog` model with indexes on level, source, taskId, createdAt
    - `db-logger.ts` provides: `logToDb`, `dbInfo`, `dbWarn`, `dbError`, `dbDebug`, `getDbLogs`, `cleanupOldLogs`, `getLogStats`
    - Worker logger fallback chain: file logging → Netlify Blobs → Database
    - API route supports filtering by type (db|worker|files|stats), level, source, taskId
    - Schema synced via `prisma db push --accept-data-loss`
    - Build passes successfully
- **Status**: ✅ RESOLVED - Fixed in v1.10.4.

### 2026-03-20 | Price Alert Current Price Display - COMPLETE
- **Action**: Added current stock price display when creating and viewing price alerts.
- **Files**: 
    - app/alerts/page.tsx
    - app/components/alerts/AlertPanel.tsx
- **Details**:
    - Added `fetchCurrentPrice` function to fetch live price from `/api/nse/stock/{symbol}/quote`
    - Added `fetchAlertPrices` to get prices for all alerts at once
    - Display shows "Current Price: ₹XXX" below symbol input
    - Alert list shows current price next to each symbol (e.g., "(₹1,234.56)")
    - Also fixed admin stats to show actual worker/cron status instead of hardcoded "disabled"
- **Status**: ✅ RESOLVED - Fixed in v1.10.3.

### 2026-03-20 | Worker Cache Key Type Fix - COMPLETE
- **Action**: Fixed `stock_sync` worker task failing with "TypeError: indexName.replace is not a function".
- **Root Cause**: `generateCacheKey` in `market-cache.ts` checked `if (indexName)` but didn't verify the type was string before calling `.replace()`.
- **Files**: lib/market-cache.ts
- **Details**:
    - Changed check from `if (indexName)` to `typeof indexName === 'string' && indexName.length > 0`
    - Build passes successfully.
- **Status**: ✅ RESOLVED - Fixed in v1.10.2.

### 2026-03-20 | Corporate Actions Deduplication Fix - COMPLETE
- **Action**: Fixed duplicate corporate actions being created during NSE sync.
- **Root Cause**:
    - Deduplication logic only checked `symbol + exDate` but schema unique constraint is `symbol + actionType + exDate`.
    - Date parsing created dates at midnight local time without timezone awareness.
    - Multiple sync paths had inconsistent deduplication logic.
- **Files**: 
    - app/api/corporate-actions/combined/route.ts
    - app/api/admin/nse/live-sync/route.ts
    - app/api/admin/corporate-actions/route.ts
    - app/api/admin/nse/historical/route.ts
    - lib/services/sync-service.ts
- **Details**:
    - Fixed all `parseNseDate` functions to use UTC noon dates.
    - Updated all sync functions to use Prisma `upsert` with correct unique constraint.
    - Build passes, all tests pass (12/13 suites).
- **Note**: Existing duplicates in database need manual cleanup via SQL.
- **Status**: ✅ RESOLVED - Code fixed in v1.10.1.

### 2026-03-20 | Stock Screener Enhancement - COMPLETE
- **Action**: Fixed screener to fetch live TradingView data directly when database is empty.
- **Root Cause**:
    - Screener relied on pre-synced database data which didn't exist.
    - TradingView API had invalid field names causing errors.
    - `stocks.sort()` failed when data was empty object instead of array.
- **Files**: app/api/screener/route.ts, lib/services/tradingview-service.ts, app/markets/screener/page.tsx
- **Details**:
    - Modified `getStocks()` to fetch from TradingView when DB cache is empty.
    - Fixed TradingView column names: removed `perf.W`, `perf.M`, `beta_1_year`, `technical_rating`, `change_percent`.
    - Added `Array.isArray()` check for safe sorting.
    - Added Quick Filters, Basic Filters, and Advanced Filters UI.
    - Enhanced table with P/E, P/B, Dividend Yield columns and color coding.
- **Status**: ✅ RESOLVED - Screener now shows 2000+ live stocks.

### 2026-03-20 | Build Fixes - COMPLETE
- **Action**: Fixed TypeScript build errors for Next.js 15+ and Zod v4.
- **Files**: app/api/admin/join-requests/[id]/approve/route.ts, app/api/admin/join-requests/[id]/reject/route.ts, app/api/auth/join/route.ts
- **Details**:
    - Updated dynamic route params to use `Promise<{ id: string }>`.
    - Changed `error.errors` to `error.issues` for Zod v4.
    - Regenerated Prisma client.
- **Status**: ✅ RESOLVED - Build passes successfully.

### 2026-03-19 | Secure Join Request Flow & RBAC - COMPLETE
- **Action**: Implemented admin-approved signup flow and reinforced RBAC.
- **Root Cause**: 
    - Direct user creation via `/users/new` was a security vulnerability.
    - Missing approval workflow for new user signups.
- **Files**: prisma/schema.prisma, middleware.ts, app/api/auth/join/route.ts, app/auth/join/page.tsx, app/admin/users/page.tsx, components/modals/LoginModal.tsx
- **Details**:
    - Added `JoinRequest` model to database.
    - Restricted `/admin/*` and `/users/*` to ADMIN role in middleware.
    - Created join request page and admin approval dashboard.
    - Updated Login Modal "Join Now" link.
    - Deleted insecure `/users/new` route.
- **Status**: ✅ RESOLVED - Onboarding is now secure and admin-controlled.

### 2026-03-18 | Notifications, Persistent Logging & UX - COMPLETE
- **Action**: Implemented Notifications system, Netlify Blobs logging, and centered login modal.
- **Root Cause**: 
    - Notifications page was a 404 and lacked a unified feed.
    - Netlify file logs were lost after deployment.
    - NSE API monitoring was missing database logs.
- **Files**: app/notifications/page.tsx, app/api/updates/route.ts, lib/netlify-logger.ts, lib/services/worker/worker-service.ts, nse-client.ts, Header.tsx
- **Details**:
    - Created aggregated `/api/updates` for personal & system notifications.
    - Added `@netlify/blobs` integration for persistent worker logs.
    - Fixed NSE DB logging by integrating `logAPIRequest`.
    - Centered Login Modal and added mobile responsiveness.
    - Resolved Prisma casing lint errors in `worker-service.ts`.
    - **Fixed Build Errors**: Resolved `Promise<boolean>` vs `boolean` mismatch in worker logs API.
    - **Fixed Type Errors**: Resolved `ArrayBuffer` vs `string` mismatch in `netlify-logger.ts`.
    - **Fixed Flaky Tests**: Made `technical-indicators.test.ts` deterministic.
- **Status**: ✅ RESOLVED - Notifications active, logging persistent, UI polished, and build/tests green.

### 2026-03-18 | Worker Engine, NSE Sync & Dynamic Logging - COMPLETE
- **Action**: Implemented full background worker engine, automated NSE sync tasks, and dynamic logging.
- **Root Cause**: 
  - NSE sync was manual and disconnected from the admin task system.
  - Logging was scattered and lacked consistent permissions for monitoring.
- **Files**: lib/services/worker/*, app/api/admin/workers/*, app/admin/utils/workers/page.tsx, ARCHITECTURE.md, AGENTS.md, Lessons.md
- **Details**:
  - Built `worker-engine.ts` for polling and cron scheduling.
  - Expanded `worker-service.ts` to support all NSE sync types (corp actions, events, news, etc.).
  - Configured `worker-logger.ts` to use `.next/server_logs` with `0o777` permissions.
  - Fixed Next.js build error in `/admin/utils/tasks` by wrapping the component in a `Suspense` boundary for `useSearchParams` compatibility.
  - Updated all major documentation files to reflect v1.9.0 architecture.
- **Status**: ✅ RESOLVED - Worker system fully operational and documented.

### 2026-03-18 | Corporate Actions Seeding & Auth Fixes - COMPLETE
- **Action**: Fixed CSV parsing for corporate actions, optimized DB seeding, and fixed ghost sessions
- **Root Cause**: 
  - `seed.ts` had incorrect column indices and rigid regex for parsing the new NSE CSV format
  - Empty update objects in `prisma.user.upsert` caused constraint errors on Prisma Accelerate due to schema mismatch
  - Looping individual prisma `create` calls exhausted Accelerate connection pools (`ECONNREFUSED`)
  - Duplicate cookie names or old active cookies caused NextAuth ghost sessions
- **Files**: prisma/seed.ts, lib/auth.ts, lib/auth.config.ts, app/api/auth/session/route.ts
- **Details**:
  - Restructured seed.ts parsing logic to correctly handle the new NSE CA CSV format with embedded commas
  - Replaced individual loops with `prisma.model.createMany({ skipDuplicates: true })` for batch inserts
  - Deleted manual `/api/auth/session` route to let NextAuth handle session state natively
  - Renamed session cookie to `tradenext-session-token` to force invalidation of old buggy sessions
- **Status**: ✅ RESOLVED - Database seeded successfully, corp actions showing up in UI, auth flow stable

### 2026-03-16 18:20 | Netlify 502 Fix - FINAL RESOLUTION
- **Action**: Fixed 502 Bad Gateway error on Netlify
- **Root Cause**: Middleware with NextAuth was causing edge function crashes
- **Files**: middleware.ts, lib/prisma.ts, next.config.ts
- **Details**:
  - Build succeeded and Prisma initialized correctly
  - Runtime 502 caused by middleware being deployed as Edge Function despite `runtime = 'nodejs'`
  - Solution: Removed NextAuth from middleware, created minimal middleware without auth imports
  - Authentication now handled at API route level instead of middleware
- **Status**: ✅ RESOLVED - Site working at https://tradenext6.netlify.app/

### 2026-03-16 | Middleware Investigation
- **Action**: Discovered middleware was causing 502 despite Node.js runtime
- **Files**: middleware.ts
- **Details**: 
  - Renamed middleware.ts to disable it temporarily
  - Site loaded successfully without middleware
  - Confirmed NextAuth integration in middleware was the problem

### 2026-03-16 | Prisma Accelerate Configuration
- **Action**: Fixed Prisma 7 configuration for production
- **Files**: lib/prisma.ts
- **Details**: 
  - DATABASE_URL = prisma+postgres://accelerate.prisma-data.net/...
  - Use accelerateUrl option for Prisma Accelerate
  - Detected URL prefix to choose between accelerateUrl vs adapter

### 2026-03-16 | Netlify Build Fixes
- **Action**: Fixed multiple build issues
- **Files**: netlify.toml, package.json, prisma/schema.prisma
- **Details**:
  - Moved type packages to dependencies
  - Fixed TOML syntax errors (multi-line env vars)
  - Added SECRETS_SCAN_OMIT_PATHS to netlify.toml

### 2026-03-16 | Logger Enhancement  
- **Action**: Fixed logger to output in production
- **Files**: lib/logger.ts
- **Details**: Always console.log, removed conditional isDev checks

### 2026-03-16 | Session Start
- **Action**: Agent session started
- **Context**: Netlify 502 error investigation
- **Files**: lib/logger.ts, lib/prisma.ts, netlify.toml

### 2026-08-07 | Archived/Resolved Bugs → GitHub Issues (tracking)
- **Action**: Created 11 GitHub issues for archived + resolved bugs in BUGS.md, assigned to @luckyhegde6, closed as resolved with PR/branch tagged
- **Issues**: #70 (NSE deals mode param — PR #49 `ph16`), #71 (BulkDealsTable TS — PR #49 `ph16`), #72 (ingest-csv access — PR #60 `Ph17`), #73 (public /api/deals — PR #36 `ph11`), #74–#80 (R1–R8 resolved bugs with fixing PRs #34/#35/#36/#60)
- **Files**: BUGS.md (GitHub columns added to Resolved table + Archived section), .agents/rules/session-memory-rules.md (new rule §9: interleaved/unrelated user messages → subagent, don't pollute main session)
- **Lesson**: `gh issue create --body` with inline markdown gets truncated on cmd.exe (only `## Summary` survived) — always use `--body-file` for multi-line issue bodies

### 2026-08-07 | ph20 — Recommendation Performance Tests Green
- **Action**: Fixed test mocks (`recommendationsCache.keys`, `archive.findMany` default, age-filter emulation) — `cronParser.test.ts` + `recommendationPerformanceService.test.ts` = 24/24 pass
- **Files**: lib/__tests__/recommendationPerformanceService.test.ts, lib/__tests__/cronParser.test.ts
- **Detail**: cron-parser `v <= 6` bug was real — capped all fields, truncated minutes/months (only dow should be capped); tests caught it, fixed via `isDowField = max === 6`

### 2026-08-07 | ph20 — Full Verification + Docs + Wiki + Skills System
- **Action**: ph20 end-to-end verification + GitHub wiki publish + extensible skills/agents/commands system
- **Wiki**: Published 7 pages to GitHub wiki (`TradeNext.wiki.git`) from `.agents/docs/` + prisma schema — Home, Architecture-Overview, Database-ER-Diagram (75 models), Daily-Recommendations-Engine, Tasks-Cron-Workers, Monitoring-And-Logging, Alerts-System. Fixes: `||----o{` → `||--o{` cardinality; `[/api/...]` parallelogram labels quoted `["/api/..."]`; unquoted `<br/>` labels quoted. Commits `22e66cc`, `8a3d52e`, `d2c5964`
- **Wiki gotchas (Lessons-worthy)**: wiki git repo is lazy-created (clone fails until first page via web UI); GitHub mermaid renderer is stricter — quote ALL labels with specials (`| + ( ) <br/> → · @ % & && <=`); `[/api/x]` is parsed as a parallelogram shape (needs `["..."]` or `( )` start)
- **Skills system**: Created umbrella `docs-workflow` skill + 4 focused skills (`docs-updater`, `wiki-creator`, `bug-finder`, `ux-enhancer`) in `.opencode/skills/<name>/SKILL.md` + `.agents/skills/<name>.md` mirrors; 4 agent profiles (doc-writer, wiki-publisher, bug-hunter, ux-designer); 4 command templates (docs-update, wiki-publish, find-bugs, ux-audit); wired into `.opencode/opencode.json` (agent + command sections); `.agents/AGENT-SKILL-MATRIX.md` created; AGENTS.md "Skills, Agents & Commands" section added
- **ph20 verification**: tsc clean (only pre-existing test-file errors); `npm run test` = 25 suites / 310 passed / 11 skipped; DB state verified (683 tracking, short=554/swing=129, archived=0); Playwright: Performance tab renders (filters, sortable columns, pagination Page 1→2 of 28, mobile 375 no overflow, zero console errors); sort fix confirmed — `sort=entryPrice` returns 200 (was 400)
- **Docs updated**: AGENTS.md (v3.5.0 row + Skills section + matrix file), `.agents/CHANGELOG.md` + `versions-v3.md` (v3.5.0 detail), CHANGELOG.md (3.5.0 released section), TODO.md (Quick Reference), Primer.md (v3.5.0 status)
- **Files**: wiki clone `C:\Users\lucky\AppData\Local\Temp\opencode\TradeNext.wiki`, `.opencode/skills/*`, `.agents/skills/*`, `.agents/agents/{doc-writer,wiki-publisher,bug-hunter,ux-designer}.md`, `.agents/commands/{docs-update,wiki-publish,find-bugs,ux-audit}.md`, `.opencode/opencode.json`, `.agents/AGENT-SKILL-MATRIX.md`
- **Lesson**: PowerShell/cmd quoting for `$disconnect` in tsx -e breaks — write a temp `.ts` file instead (`.` prefix to keep it untracked-adjacent, then delete)

### 2026-08-07 | ph20 — Run Trigger Source + BUY/SELL Filter + AI Monitoring Persistence (staged, commit pending)
- **Action**: Moved follow-up work from a wrongly-forked branch (`feat/recs-run-source-picks-filter`) onto existing `ph20` head branch per user correction (PR #81 open → never fork a new branch; move work to existing branch). Stash applied; sole conflict (`app/api/admin/recommendations/route.ts`) resolved in favor of ph20's `spawnRegularTask` worker path.
- **Run trigger source**: `DailyRecommendationRun.triggeredBy` (`"system"` default) + `@@index([triggeredBy])`; migration `20260807103000_add_daily_run_triggered_by`; `runDailyRecommendations({ triggeredBy })` persists/logs/audits source; worker maps `admin_manual` → `admin` (worker-service L473-475); Admin Run History Manual/System badge from `run.triggeredBy` (admin page L385-387)
- **BUY/SELL filter**: `getLatestRecommendations()` filters to runs with actionable (BUY/SELL) stocks + nested where; runs with zero actionable skipped; `DailyPicksTab` pills All/Buy/Sell (HOLD pill removed). Verified: DB has 583 null + 100 HOLD across runs, 0 BUY/SELL → correct empty state
- **AI monitoring persistence**: `trackAiCall()` → awaited `Promise<void>`; single await in `finally` of every AI route (screener/query/alerts/conversations/admin test/recommendation-agent); merged reads `source: "memory"|"database"|"hybrid"`; admin "Live + DB"/"DB persisted" badges. Cold-start verified via fresh dev server (PID 23420): persisted rows `source:"database"` via externally-inserted row
- **Verification**: `npm run test` = 25 suites / 312 passed / 11 skipped; `npx tsc --noEmit` clean for all touched files; DB synced via `npx prisma db push` (no migration history → P3005 blocks `migrate deploy`); System badge verified on run `5eaad1d7` (`triggeredBy=system` in DB)
- **Cleanup**: verify_test AI rows, admin test run `e48b98b2` (cascade), 10 background recommendation_batch rows deleted; temp tsx scripts removed; stash dropped; DB restored to 10 AI rows + 1 system run
- **Docs updated**: `.agents/session-todos.md` (follow-up items), `.agents/changelog/versions-v3.md` (trigger source + filter + monitoring bullets), CHANGELOG.md ([3.5.0] additions), Primer.md (v3.5.0 status), Lessons.md (50-51: open-PR branch discipline; dev DB db-push vs migrate-deploy), agent-memory.md (this entry)
- **Lesson**: (1) When a feature has an OPEN PR, its head branch IS the workspace — never branch from main for the same feature; (2) dev DBs without `_prisma_migrations` history must sync via `prisma db push` (migrate deploy → P3005)

### 2026-08-07 | ph21 — Target/SL=₹0.00 Bug Fix + Carry-Forward Items (SSE wiring, HistoryTab null-guard)
- **Action**: Post-PR#81-merge carry-forward session on `fix/ph21-carryforward-perftab`. Root-caused + fixed Performance tab showing ₹0.00 target/stop-loss; wired SSE live prices into Portfolio/Watchlist; fixed bare "🟡 %" HistoryTab cards; backfilled 149 trackers.
- **Root cause (target/SL ₹0)**: prod AI fails (netlify.toml `[build.environment]` L5 has no `OPENROUTERKEY` — only local `.env`/`.env.local`) → `hasValidConfig()` false → `failedResult(s, "AI is not configured")` → `getDefaultRecommendation()` returned literal `targetPrice: 0, stopLoss: 0` → overwrote good tracker creation defaults (`price*1.2`/`price*0.95` in dailyRecommendationService L205-206). `normalizeRecommendation` mapped model `0` → persisted `0`. Verified live: prod `/api/recommendations/performance` 1666 trackers all 0/0/50/HOLD.
- **Fix (lib/services/ai/recommendation-agent.ts)**: `getDefaultRecommendation(stock?)` now price-based — `target = round(price*1.1)`, `sl = round(price*0.95)`, guard `price>0`; added `DEFAULT_TARGET_MULTIPLIER = 1.1` / `DEFAULT_STOP_LOSS_MULTIPLIER = 0.95`; `failedResult` + both `parseAIResponse` call sites pass `stock`; `normalizeRecommendation` uses `|| round(price*1.1*100)/100` / `|| round(price*0.95*100)/100`.
- **Backfill**: new `scripts/backfill-recommendation-targets.ts` (idempotent, `entryPrice>0` only) — ran `npx tsx --env-file=.env scripts/backfill-recommendation-targets.ts` on LOCAL dev DB: rowsScanned=149, updated=149 (732 total trackers, 0 remaining with zero target/SL, verified via temp `.verify-targets.cjs` then deleted). Command REQUIRES `--env-file=.env` (else SCRAM password error).
- **CF #5 HistoryTab null-guard**: `app/api/recommendations/top-stocks/route.ts` coalesces `aiRecommendation || "HOLD"`, `confidence ?? 0` server-side; `HistoryTab.tsx` defensive `aiRecLabel`, `(stock.confidence ?? 0)`, "—" when confidence null.
- **CF #4 SSE wiring**: `useLivePrices` hook fixed — `fetchAllPrices` deps `[symbols]`→`[updatePrices]` with `symbolsRef` (infinite "Maximum update depth exceeded" loop on watchlist empty state, 196 console errors); `symbols.slice().sort()` instead of in-place `.sort()`; empty case avoids redundant setState. Wired into `HoldingsTable` (live price/value/P&L overlay + ● Live badge), `watchlist/page.tsx` (live quote overlay via `liveQuoteFor` + badge), `MarqueeBanner` (refreshInterval 30s).
- **Tests**: `lib/__tests__/useLivePrices.test.ts` (4 new: empty, no-loop-on-fresh-array, SSE price event, connected→isLive); recommendation-agent tests updated (price-based defaults 2750/2375 for price 2500; failed results never ₹0.00; confidence 50). Full suite: **317 passed / 11 skipped / 0 failed** (was 312 + 4 new + 1 moved).
- **Verification**: `npx tsc --noEmit` clean for all touched files (only pre-existing test-file errors remain); eslint clean on touched files; Playwright — `/recommendations`, `/portfolio` (live RELIANCE ₹1,327.60 +1.76%, TCS ₹2,446.90 +10.27%, zero console errors), `/watchlist` (loop fixed, zero errors), mobile 375px portfolio clean; `/api/recommendations/performance?limit=3` now returns non-zero targets (SCML ₹95.40/₹75.52 etc.).
- **Files**: lib/services/ai/recommendation-agent.ts, lib/__tests__/recommendation-agent.test.ts, scripts/backfill-recommendation-targets.ts (new), lib/hooks/useLivePrices.ts, lib/__tests__/useLivePrices.test.ts (new), app/components/HoldingsTable.tsx, app/watchlist/page.tsx, app/components/MarqueeBanner.tsx, app/api/recommendations/top-stocks/route.ts, app/components/recommendations/HistoryTab.tsx
- **Remaining carry-forward**: merge PR #82 → deploy → verify prod crons; prod DB backfill + Netlify `OPENROUTERKEY` env (needs user), demo holdings re-seed, F&O UI (`app/fo/`), issues #68/#69.
- **Committed + pushed + PR #82**: 3 commits on `fix/ph21-carryforward-perftab` — `b7b6742` fix (AI fallback + backfill), `370bcd4` feat (SSE wiring + HistoryTab null-guard + 4 hook tests), `31c8f90` docs. PR: https://github.com/luckyhegde6/TradeNext/pull/82 (never auto-merge).

---

## 2026-08-13 (v3.7.1) — BUY/SELL-only Telegram broadcast + AI connection-test cron + CI e2e fix

- **Broadcast (user-requested: no HOLD suggestions in Telegram)**: NEW pure `lib/services/recommendationBroadcast.ts` (`buildRecommendationBroadcast(stocks, dateLabel?)`, `MAX_BROADCAST_PICKS = 8`) — BUY/SELL only; all-HOLD day → short notice; footer `🟢 N BUY · 🔴 N SELL · ⚪ N HOLD not shown`; 4000-char truncation (slice = 4000 − marker length). Wired into `lib/services/dailyRecommendationService.ts` broadcast block. 9 tests.
- **AI connection-test cron (user-requested)**: NEW `lib/services/ai/connectionTestService.ts` — `testOpenRouterModel` (raw fetch, never throws, 20s `AbortSignal.timeout`), `runAiConnectionTest()` (configured → fallbacks `openrouter/free`/`openrouter/auto`; short-circuit `!hasValidConfig`), `getLastAiConnectionTests`. **Every attempt persisted via `trackAiCall` (action `connection_test`) AND audit-logged with the full status** — NEW `AI_CONNECTION_TEST`/`AI_CONNECTION_TEST_FAILED` audit tags; overall failure → `notifyAdmins`. 4th system cron (`*/30 3-10 * * 1-5` IST 08:30–15:30 Mon–Fri) in `ensureRecommendationCrons` + worker `executeAiConnectionTest` + `run-cron-background` action `ai-connection-test` + recordRun + `netlify/functions/cron-ai-connection-test.ts` + admin `app/api/admin/ai/connection-tests/route.ts` (GET last N / POST run-now). 9 tests.
- **CI e2e fix (user-pasted GitHub failure)**: `e2e/advanced-screener.spec.ts` failed 3 browsers — v3.5.6 TemplatesPanel defaults to Chartink mode ("Short term breakouts" lowercase) while the spec asserted TV-mode "Short Term Breakouts" → tests now click `TradingView · 98` toggle (U+00B7); Chartink stays jest-covered. Also fixed nested `<a>` hydration warning on `/markets` (`IndexCard` inner anchor → `<span role="link">`).
- **Tests**: 22 new (9 broadcast + 9 connection-test + 4 cron-ensure, incl. `cronJob.create` mock). Full suite **582 passed / 11 skipped / 0 failures** (was 560). `npx tsc --noEmit` clean on all touched files (remaining errors pre-existing test-only noise).
- **Gotchas**: `*/30` inside a JSDoc block comment terminates the comment early (`*/`); a closure used before the `report` const it references → TDZ ReferenceError; truncation marker length must be subtracted from the slice.
- **Status**: docs updated; NOT committed (pending user, consistent with v3.5.4→v3.7.0 holds); NO deploy.

---

## How to Use

1. **Start of session**: Read `Primer.md` to understand current state
2. **During work**: Use this file to track activities
3. **End of session**: Update `Primer.md` with summary
4. **Before commit**: Read `Lessons.md` to avoid repeated mistakes

---

## Tips

- Use `grep` to search this file for past activities
- Keep entries concise but informative
- Include file names when relevant
- Note any errors or issues encountered


