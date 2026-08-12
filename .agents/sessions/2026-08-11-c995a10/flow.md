# Session 2026-08-11-c995a10 — Execution Flow

> Where execution actually travels this session: entry points, call order, and which parts of the codebase changed.

---

## 1. What broke (prod symptom)

```
/recommendations (public)  →  "Last updated: 19/7/2026"    ← stale for 3+ weeks
```

## 2. Root-cause trace (the actual execution path)

```
Admin Run Now (/admin/recommendations/daily)
  └─ POST /api/admin/recommendations { action: "run_now" }
      └─ lib/services/worker/task-orchestrator.ts — spawnRegularTask()
          └─ WorkerTask (pending → running → completed)
              └─ lib/services/worker/worker-service.ts — executeTask("recommendations")
                  └─ lib/services/dailyRecommendationService.ts — runDailyRecommendations()
                      ├─ chartinkService.runDailyScreeners()      → 1055 raw hits, 3/7 screeners ok
                      ├─ rankAndCapRecommendations()              → top-50 cap (MAX_AI_STOCKS)
                      ├─ circuitBreaker.call(() => analyzeStocks(aiInput))   ← LINE 322
                      │    └─ ai/recommendation-agent.ts — analyzeStocks()
                      │         → analyzeBatch() → directPrompt(prompt, config)
                      │              └─ ai/llm-provider.ts — fetch(openrouter.ai/api/v1/chat/completions)
                      │                   ↓ model resolves to: process.env.AI_MODEL || DEFAULT_MODEL
                      │                   → "tencent/hy3:free"  ← DOES NOT EXIST on OpenRouter → HTTP 404
                      │                   → directPrompt returns "AI request failed (HTTP 404)..."
                      │                   → parseAIResponse() fails → getDefaultRecommendation()
                      │                   → HOLD / 50 ("AI analysis unavailable — defaulting to HOLD")
                      └─ public getLatestRecommendations() filters stocks: { some: actionable }
                           → all-HOLD run → filtered out → falls back to Jul 19 run
```

**The two defects:**

| # | Defect | Location |
|---|--------|----------|
| A | Pipeline calls `analyzeStocks(aiInput)` WITHOUT config → env-only `getDefaultConfig()`; DB `ai_config` Secret (admin's model choice) never reached the run | `dailyRecommendationService.ts:322` |
| B | `DEFAULT_MODEL`/`AVAILABLE_MODELS` point at models that don't exist on OpenRouter (`tencent/hy3:free`, `qwen3-next-80b`) | `lib/services/ai/config.ts` |

## 3. Code changed this session

| File | Change | Why |
|------|--------|-----|
| `lib/services/ai/config.ts` | `DEFAULT_MODEL` → `nvidia/nemotron-3-ultra-550b-a55b:free`; refreshed `AVAILABLE_MODELS` to live-catalog-verified free models; added async `loadConfig()` (DB `ai_config` Secret + env fallback, lazy Prisma import) | Fix defect B (D4); add the single-source config loader (D3) |
| `lib/services/dailyRecommendationService.ts` | Imported `loadConfig`; `analyzeStocks(aiInput, aiConfig)` — DB-aware config now reaches the pipeline | Fix defect A (D3) |
| `app/api/admin/ai/test/route.ts` | Removed private `loadConfig()`, uses shared one from `lib/services/ai/config.ts` | Consistency (D3) |
| `lib/services/recommendationCronService.ts` | Added `recordCronRun(jobName, success)` + `RecordCronRunResult` — sets `lastRun`, `runCount+1`, `successCount`/`failureCount+1`, advances `nextRun` via `calculateNextRun`; finds job by name; safe no-op when missing | Fix cron ledger showing no runs (D8) |
| `netlify/functions/run-cron-background.ts` | Calls `recordCronRun(...)` after successful pipeline AND in the error branch (both actions) | Wire the real scheduled path into the ledger (D8) |
| `app/api/admin/workers/route.ts` | Added `recordManualRunLedger(task, result)` helper; called after `executeTask` in PATCH runNow + retry; skips tasks WITH `cronJobId` (already counted at spawn by `spawnCronTask`) | Manual admin runs update the ledger; no double-count (D8) |
| `lib/__tests__/recommendationCronService.test.ts` | NEW — 5 tests for `recordCronRun` (success/failure/missing job/prisma find error/prisma update error) | Regression guard (D8) |
| `.agents/rules/session-decisions-flow.md` | NEW — mandatory rule for per-session decisions/flow logs | User-requested memory infra (D7) |
| `.agents/sessions/2026-08-11-c995a10/{decisions,flow}.md` | NEW — this session's live decision + execution logs | User-requested memory infra (D7) |
| `.agents/sessions/README.md`, `.agents/rules/session-memory-rules.md`, `.agents/rules/README.md`, `AGENTS.md` | Folder-based session archive docs | D7 |

## 4. What is verified so far

- Live OpenRouter catalog: `tencent/hy3:free` ❌, `qwen/qwen3-next-80b-a3b-instruct:free` ❌, `nemotron-3-ultra:free` ✅, `openrouter/free` ✅, `cohere/north-mini-code:free` ✅ (curl to `/api/v1/models` with the prod key).
- Prod AI test with `nvidia/nemotron-3-ultra-550b-a55b:free`: **HTTP 200, response "4"** (rt ~1s).
- Prod run after config fix: completed, 50 stocks, `aiProcessed: 50` — but STILL all HOLD (proves defect A is code-side, not config-side).
- Prod worker task `44b81408…` executed synchronously via `PATCH /api/admin/workers { action: "runNow" }` (serverless has no resident poll engine).
- **Cron ledger issue (D8):** `GET /api/admin/cron` on prod → both system jobs `lastRun: null, runCount: 0, successCount: 0, failureCount: 0`, `nextRun` stale (Aug 10). Root cause: ledger only written by `spawnCronTask`/resident scheduler, never by the real (Netlify scheduled-function) execution path.
- **Verification (D8):** `npx tsc --noEmit` clean on all touched files (incl. `netlify/functions/run-cron-background.ts` — covered by `**/*.ts` in tsconfig); 5 new `recordCronRun` tests pass; 41 related tests (recs + performance + cronParser) pass. ESLint blocked repo-wide by pre-existing eslintrc circular-config error (`next lint` removed in Next 16, flat config jacks on legacy validator) — out of scope.

## 5. Verification matrix for the fix (definition of done)

| Check | Command / action | Pass |
|-------|------------------|------|
| Typecheck | `npx tsc --noEmit` | all clean |
| Tests | `npm run test` (recommendation-agent, dailyRecommendationService, new loadConfig tests) | green |
| Lint | `npm run lint` | clean |
| Prod AI test | `POST /api/admin/ai/test` | 200 + real content |
| Prod run | `PATCH /api/admin/workers action=runNow` | BUY/SELL picks present (not all HOLD) |
| Public page | `/recommendations` | fresh "Last updated" ≥ Aug 10 + actionable stocks |

## 6. Execution order this session (for replay)

1. Prod verify #69 (sessions) → #68 (monitoring) → v3.5.2 screener — all PASSED (earlier in session).
2. Stale-recs investigation → traced to model 404 (config plumbing).
3. Refresh model catalog knowledge (curl) → `tencent/hy3:free` doesn't exist.
4. Fix prod DB config → model now `nemotron-3-ultra` (test 200).
5. Trigger + run recs on prod → still all-HOLD → proved defect A.
6. Implement code fixes in `config.ts` + `dailyRecommendationService.ts` (D3/D4).
7. Session-memory infra (D7) — rule file + this decisions/flow pair.
8. **Cron ledger fix (D8):** user reported `/admin/utils/cron` shows no runs; verified prod API → zeroed ledger; root-caused to missing writer in real execution path; implemented `recordCronRun` + wiring (`run-cron-background.ts`, PATCH runNow/retry) + 5 tests; tsc clean; 41 tests green. **User chose: NO deploy.**
9. Commit + PR (next — pending user trigger; follow `.agents/linear-history.md`, pre-commit workflow, SSH push).

## 7. Chartink template capture → DB (v3.5.5) — execution order

1. **Schema (D9):** added `ChartinkScreener` / `ChartinkScreenerRun` / `ChartinkScreenerResult` to `prisma/schema.prisma` (after `UnifiedEvent`, v3.5.5 block); `npx prisma format` + `npx prisma generate` ✅ (client v7.7.0; delegates verified present in `node_modules/.prisma/client/index.d.ts`).
2. **Service (D9):** `lib/services/chartinkScreenerService.ts` —
   - `normalizeCapturedRows` (wire aliases → `ChartinkCapturedRow`, drops empty nsecode)
   - `upsertChartinkScreener` / `updateChartinkScreenerLink` (definition mirror + scanlink/backtestUrl)
   - `startChartinkRun` / `insertChartinkRunResults` (chunked createMany 250, per-row `expiresAt = capturedAt + ttlHours`) / `completeChartinkTemplateRun` (lastRunAt/nextRunAt/resultCount + link) / `failChartinkRun` / `completeChartinkRun`
   - `clearChartinkResults` (deleteMany {}) / `pruneExpiredChartinkResults` (expiresAt < now)
   - `getChartinkScreeners` (stale = never run or nextRunAt ≤ now) / `getChartinkScreenerResults` (fresh-only unless includeStale)
   - `runFullChartinkSync` — clean → insert-all under one run → complete; fails → `failChartinkRun` + rethrow
3. **Capture tool (D10):** `scripts/chartink-capture/capture-core.ts` (parseClipboardTable TSV → wire aliases; mergeCapturedClause first-value-wins; parseArgs/listValue) + `scripts/chartink-capture/capture.ts` (Playwright: per-page request/response interception of `/screener/process` + `/backtest/process`, clipboard fallback via "Copy group to clipboard"/"Copy table", optional `--backtest` link follow; writes JSON configs + feeds DB via `runFullChartinkSync`; `--category`/`--id`/`--dry-run`/`--no-db`/`--headful`/`--ttl`).
4. **Tests (D9/D10):** `lib/__tests__/chartinkScreenerService.test.ts` (26) + `scripts/chartink-capture/__tests__/capture-core.test.ts` (9) — **35/35 pass**; full suite **394 pass, 0 fail** (was 340 + 19 earlier chartink + 35 new).
5. **Docs:** `.agents/docs/chartink-api.md` (capture + DB sync sections), `AGENTS.md` (v3.5.5 row), `.agents/CHANGELOG.md`, `TODO.md`, this decisions/flow pair.
6. **Pending user:** approve `prisma migrate dev` + commit on new branch (NO deploy this session — consistent with v3.5.4 hold).

## 8. Chartink 117-registry PRIMARY + TV fallback (v3.5.6) — execution order

1. **Requirement (D11):** user decreed Chartink 117 JSON entry templates are the PRIMARY source across engine/API/UI; TradingView 98 = fallback. Engine must run ALL registry templates, source chain per template: fresh DB captured rows → live Chartink scan (has scanClause) → TV fallback.
2. **Service (D11):** `lib/services/chartinkUnifiedScreenerService.ts` — `runChartinkUnifiedScreeners({forceRefresh?, templateIds?, categoryId?, tvFallbackLimit?})` → `UnifiedScreenerResult[]` (ScreenerResult + `source` + `templateIds`), 5-min `staticCache` `chartink-unified:screener-results`; `runChartinkScreenerById(templateId)` for the API/UI single runs; exported `resolveTvFallback` (curated `CURATED_TV_FALLBACK` id→name → `nameMatchScore` tokens ≥0.6 → `CATEGORY_TV_MAP` category default by popularity); `tvRowToChartinkStock` (NSE: strip, TV `change` = pChange), `scanStockToChartinkStock`; dedup via exported `deduplicateResults`, source attribution first-wins (db > live > tv).
3. **Engine switch (D11):** `dailyRecommendationService.ts` L12 imports `runChartinkUnifiedScreeners` from `./chartinkUnifiedScreenerService` (type `ScreenerResult` stays from `./chartinkService`); L167 calls `runChartinkUnifiedScreeners({ forceRefresh: true })`; `totalRawHits` reduce hardened `(s.screenerCount || 0)`.
4. **API (D11):** NEW `app/api/screener/chartink/route.ts` — GET `{categories, templates}` merging registry + `getChartinkScreeners()` overviews (id/name/url/categoryId/categoryName/fetchable/enabled/lastRunAt/nextRunAt/resultCount/stale); POST `{templateId, forceRefresh?, limit?}` → `{template, source, stocks:[{symbol,name,close,changePercent,volume}], count, executionMs}`.
5. **UI (D11):** `TemplatesPanel.tsx` rewritten — Chartink·117 / TradingView·98 source toggle (default Chartink), category pills keyed on chartink categoryIds with label map, per-template badges ("clause ready"/"catalog only", "{count} captured · stale", "disabled", "Last run:"), per-template run spinner, `onChartinkResult` prop; `app/markets/screener/advanced/page.tsx` maps ChartinkRunResult stocks → `ScannedStock` (change/change_percent/percentChange + `_chartinkSource`/`_chartinkTemplate`), clears sortBy.
6. **Tests (D11/D12):** NEW `lib/__tests__/chartinkUnifiedScreenerService.test.ts` — 18 tests: resolveTvFallback (5: curated STB/strong-stocks, name-token Profit Jump, bearish category default, unknown→null), runChartinkUnifiedScreeners (8: DB rows short-circuit w/o network, db>live preference, live fallback for clause templates, ONE shared TV scan, dedup+templateIds merge, cache hit, forceRefresh, templateIds filter), runChartinkScreenerById (5: throw unknown, DB first, live, TV after live failure, catalog-only TV). **Run 1 FAILED 3 — caught real bug D12** (catalog-only templates never reached TV fallback; mock rows too thin for real filterGroups); fixed service stage-2 seeding + richer mock rows (relative_volume_10d_calc, "Perf.5D", return_on_equity_fq) + `templateIds` pin on the DB-short-circuit test. 18/18 green.
7. **Mock retarget (D11):** `dailyRecommendationService.test.ts` — `jest.mock("@/lib/services/chartinkService")` → `jest.mock("@/lib/services/chartinkUnifiedScreenerService")` exposing `runChartinkUnifiedScreeners` (same args/return shape); all 21 pass.
8. **Pending user:** docs (AGENTS.md version row, CHANGELOG, TODO, Primer, agent-memory) + commit/PR on new branch — NO deploy (consistent with v3.5.4/v3.5.5 holds).

## 9. Auth flow fix (join → approve → login) + server logs (v3.5.7 prep) — execution order

1. **Auth gate (D13):** removed the `!isVerified` → "Email not verified" throw from `lib/auth.ts` authorize() (kept blocked check; bcrypt compare is now the single gate).
2. **Dead UI branches (D13):** deleted the `res.error === "Email not verified"` → `setError("UNVERIFIED")` paths in `app/auth/signin/page.tsx` + `app/components/modals/LoginModal.tsx` (renderError simplified; Link retained — still used by "Join Now").
3. **Default password (D14 → D16 env-only):** approve route `crypto.randomBytes(8)` temp password → fixed `DEFAULT_PASSWORD = "********"` bcrypt-hashed → **final: `process.env.DEFAULT_PASSWORD` (no literal in repo; missing env → 500 `logger.error` guard)**; `[EMAIL MOCK]` shows the default; API returns `{success, userId, defaultPassword, email}`; removed now-unused `crypto` import. Admin users page: confirm dialog references the `DEFAULT_PASSWORD` env NAME, success alert shows the API-returned password.
4. **Logging (D15):**
   - `lib/logger.ts` — `getLogsDir()` `server_logs` → `logs`; fixed `readLogsByDate` (`date.substring(0,7)` + `logs/<YYYY-MM>/<YYYY-MM-DD>.log`; was `logs/<YYYY>/<YYYYMM>/...` → always missed); `writeToFile` mirrors each line to `server-logs` blob store on Netlify (date-keyed, fire-and-forget); `readLogFile`/`deleteLogFile` blob branches pass `server-logs` when the key ends with `.log` (server-log mirror) else default `worker-logs`.
   - `lib/netlify-logger.ts` — `getBlobStore(storeName)` parameterized; `appendServerLogLine(dateKey, entry)` (server-logs store); `readBlobLog`/`deleteBlobLog`/`writeBlobLog` take store arg; `listBlobLogs` strips `.log` from dates.
   - `.gitignore` — added `logs/`.
5. **Tests (D15):** NEW `lib/__tests__/logger-paths.test.ts` (7 tests, `@jest-environment node` since jsdom env makes `isServer` false and skipped file writes). `jest.setup.js` — wrapped `window`-dependent mocks (matchMedia/localStorage/indexedDB) in `typeof window !== 'undefined'` so node-env test files survive. Full suite **419 passed, 11 skipped** (was 412 + 7 new).
6. **Verification (Playwright, dev server on :3000):**
   - Join request submitted at `/auth/join` (`pwjoin-e2e-20260811@test.local`) ✓
   - Admin `/admin/users` → Join Requests tab shows 1 pending ✓
   - Approve → confirm dialog text: "…the default password will be: ********…" ✓; success alert: "Default password: ******** (for pwjoin-e2e-20260811@test.local)" ✓
   - Sign out → login as that email with `********` → redirected to `/`, header shows "Playwright E2E Join User" (user role) ✓ — before the fix this threw "Email not verified"
   - Admin monitoring → Server Logs tab → lists `2026-08-11` (40 KB) from `logs/` dir; View shows lines incl. "Join request approved … userId=8" and "Auth: Login successful, email=pwjoin-e2e-20260811@test.local, userId=8" ✓
   - Cleanup: killed dev server PID 29216 (port 3000, started this session); removed `.playwright-mcp/` + `next-dev.log`.
7. **Pending user:** docs final pass (AGENTS.md v3.5.7 row, CHANGELOG, TODO, Primer, agent-memory, Lessons + D16 flow/decisions update) + commit/PR on new branch — NO deploy.

## 10. Credential hygiene + AI/agent discovery (D16) — execution order

1. **Env-var password:** `app/api/admin/join-requests/[id]/approve/route.ts` — `const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD ?? ""` + 500 guard (`logger.error("Server not configured: DEFAULT_PASSWORD missing")`); `.env` (gitignored) carries the bcrypt-hashed value; `.env.example` placeholder (NAME only, "never hardcode the value in code or docs" comment). Admin UI confirm references the env NAME; success alert uses `data.defaultPassword || '(not returned)'`.
2. **Redaction sweep:** all literal join-password occurrences in committed docs → backtick-quoted `********` (AGENTS.md, `.agents/CHANGELOG.md`, `versions-v3.md`, `.gitignore` comment, TODO.md, Primer.md, HANDOFF.md, latest.md, session decisions D14 example). Verified: `git grep` for the join-default literal → no tracked-file hits; only the hook files' own block-list literal matches (exempted in pre-commit #7).
3. **Hooks (enforcement):** NEW `.githooks/commit-msg` (blocks credential literals — join-default value + public demo passwords + `password=…` assignments — in messages → "Reference env var NAMES only"); `.githooks/pre-commit` — #6 real `.env` never staged + #7 join-default literal in staged diff (exempting `.githooks/*` by design) + `password[:=] "…"` in staged `.md`; both `bash -n` clean + functional-tested via scratch-file (blocked a test commit that staged a literal).
4. **README rewrite:** single clean structure (badges, overview, feature highlights, verified features, quick start, public demo creds, tech stack, commands, testing, MCP API, **AI & Agent Discovery**, env vars, project structure, AI-assisted dev, license). Public sandbox demo creds table retained (sanctioned central reference; Netlify omit-list covers those files).
5. **Discovery routes:** NEW `app/llms.txt/route.ts` (static llmstxt.org-style index — what/why, public pages, public APIs incl. MCP/recommendations/screener, data sources, tech stack, explicit **Boundaries** — no `/admin/*` `/users/*`, `.agents/` never published, no credentials, repo-docs pointer); `app/robots.ts` rewritten (first-rule `/llms.txt` allow for `*`, LLM-crawler UA list, Googlebot/Bingbot rules, internal/tooling path blocks `/.agents/` `/docs/` `/*.md` `/*.log`).
6. **Verification (dev :3000, detached Start-Process via npm.cmd — PID 16588, child 28100):** `curl` → `/llms.txt` 200 text/plain ✓, `/robots.txt` 200 ✓, `/sitemap.xml` 200 application/xml ✓, `/api/openapi` 200 OpenAPI 3.0.3 JSON ✓ (**first 404 = stale Turbopack watcher** — timestamp-touch of `app/api/openapi/route.ts` re-registered the route; no code change. Lesson: new/changed API routes may 404 once on a hot dev server; touch the file or restart). Cleanup: `taskkill /PID 16588 /T /F` + child tree → PORT_FREE; deleted `next-llms-verify*.log`.
7. **Pending user:** commit v3.5.7 (auth+logs+hygiene+discovery) on a new branch (or bundle with v3.5.5/3.5.6 chartink work per user decision) → PR (ask first) — NO deploy.
## 11. Chartink DB migration (v3.5.5) + migration-ledger doc — execution order

1. **`migrate dev` refused (D17):** `npx prisma migrate dev --name add_chartink_screener_models` detected the local dev DB out of sync with migration history (db-push state: tables exist, no history) and demanded a full destructive reset. **No reset** — STOP per Prisma Guardrails + consent rules.
2. **Safe SQL generation:** snapshot pre-chartink schema (lines 1–1574 of `prisma/schema.prisma`) → temp file; `npx prisma migrate diff --from-schema <old> --to-schema prisma/schema.prisma --script` → exactly the 3 chartink tables + 8 indexes + 2 FKs (86 lines). CLI traps: `--shadow-database-url` flag doesn't exist in this Prisma version; `--from-migrations` requires a shadow DB configured in `prisma.config.ts` (not added persistently — kept the temp-file diff approach instead).
3. **Migration folder:** `prisma/migrations/20260811103000_add_chartink_screener_models/migration.sql` (timestamp after latest `20260807103000`).
4. **Full-history replay proof:** created scratch DB `tradenext_shadow` (docker postgres `tradenext-db-1`); `set DATABASE_URL=...tradenext_shadow&& npx prisma migrate deploy` → ALL 32 migrations applied cleanly incl. the chartink one (identical to prod `migrate deploy`); `\dt chartink*` confirmed 3 tables on shadow; local `tradenext` DB already had the tables (db-push); **dropped `tradenext_shadow`**. No real data touched.
5. **Ledger doc (D17):** NEW `.agents/docs/db-migrations.md` — running bookkeeping of every migration (newest→oldest: name, date, what/why/decision), apply + offline-verification workflow (shadow-DB replay), schema-change decision checklist (models/TTL/indexes/FK/backfill/rollback/verification), current-schema-at-a-glance. Wired into `.agents/docs/README.md` index (+ missing `chartink-api.md` row) and AGENTS.md `.agents/docs/` row.
6. **Backfill:** NONE — chartink definitions upsert at runtime via `chartinkScreenerService.upsertChartinkScreener()`; empty tables are correct on first deploy.
7. **Verified clean:** `git status` shows migration + ledger + index edits only (plus session memory below).
8. **Pending user:** commit migration + ledger; then prod diagnosis tasks (daily market sync not running + recommendations page zeroed dividend stats).

## 12. v3.6.1 — recs-tab default sort + currentPrice bridge + AI context enrichment (execution order)

**Objective:** apply the user-approved follow-up (no deploy): default sort = created-date desc across recs tabs; make Performance "Current"/"Return %" never show "—"; enrich AI prompt with fundamentals; add pen/perf TODO plans.

1. **Prod/local data audit (D18):** verified via API + local-DB probe (`scripts/tmp-probe-perf.ts`, deleted before commit) that prod (1691 trackers) and local (732) have ZERO empty Entry/Current rows actual data — the "empty columns" perception is a **default-sort artifact** (PerformanceTab defaulted to `returnPercent`, and `currentPrice` null shows "—" until the 4PM perf-check cron writes it). Scope = sort defaults + price bridge only.
2. **Default sorts (D19):**
   - `app/components/recommendations/PerformanceTab.tsx` L85: `useState("returnPercent")` → `"createdAt"` (desc is already the sortOrder default). Verified live: "Recommended ▼" active header.
   - `app/components/recommendations/HistoryTab.tsx` L49: `useState("screenerCount")` → `"date"` (date desc sort already existed). Verified live: "Date" active sort pill.
   - `app/components/recommendations/DailyPicksTab.tsx`: added `"createdAt"` to `SortKey` + a NEW "Newest" sort option (first in list, default state) — `(new Date(b.createdAt||0) - new Date(a.createdAt||0)) || screenerCount tiebreak` (same-run picks share createdAt, so the tiebreak preserves ranking order).
3. **currentPrice bridge (D19):** `lib/services/recommendationPerformanceService.ts` — new `bridgeMissingCurrentPrices<T>`: ONE batched `SELECT DISTINCT ON (ticker) ticker, close::float8 FROM daily_prices WHERE ticker = ANY(...) ORDER BY ticker, "tradeDate" DESC` fills rows where `currentPrice == null` (mirrors the corp-action enrichment + perf-check cron query pattern). No N+1 (single query per list); wired into BOTH `getPerformanceList` paths (returnPercent JS-sort path + normal paginated path) BEFORE `toListItem` so `returnPercent` is computed from the bridged price; graceful catch → warn + return rows unchanged.
4. **AI context (D20):** NEW `lib/services/ai/recommendation-context.ts` —
   - `getRecommendationContext(symbols)` → `Record<symbol, StockContext>`: corp actions (DB `CorporateAction`, batched `symbol IN`, order exDate desc, `MAX_ACTIONS_PER_SYMBOL = 3`) + announcements (DB `CorporateAnnouncement`, batched, `MAX_ANNOUNCEMENTS_PER_SYMBOL = 2`) + financial results (ONE cached `getCorporateResults("Quarterly")` call for the whole batch — already 1h staticCache inside index-service; `MAX_RESULTS_PER_SYMBOL = 1`). All three `Promise.allSettled` — per-source failure drops only that source, never throws.
   - `formatStockContext(symbol, ctx)` → compact prompt block (action lines with ex-date/ratio; announcement subject + date; quarterly revenue/netProfit in ₹ Cr + YoY/QoQ).
   - `recommendation-agent.ts`: `StockAnalysisInput.context?: StockContext`; `buildAnalysisPrompt` appends an indented **Context:** block per stock + SYSTEM_PROMPT gains the rule "weigh fundamental context alongside technical data; mention in reasoning when relevant"; new `indent()` helper.
   - `dailyRecommendationService.ts`: `getRecommendationContext(aiInput.map(s => s.symbol))` ONCE per run (after the MAX_AI_STOCKS cap slice), attaches `entry.context = ctx` when present, `enrichedCount` log; context failure never blocks the pipeline (empty map = no-op).
5. **Pen/perf plans (D21):** NEW `TODO-PENTESTING.md` (attack-surface inventory, auth/session, RBAC, injection, secrets, NSE/SSRF, serverless hardening, Playwright manual tests, findings log — records the known `GET /api/recommendations/performance?offset=1500` → 500 bug: offsets ≥ 1001 fail) + `TODO-PERF-TESTING.md` (hot-route baselines, TimescaleDB index/EXPLAIN audit, rec-pipeline timing, Core Web Vitals, serverless throttles, findings log). TODO.md Quick Reference gets 4 new v3.6.1 rows.
6. **Tests (D20/D21):** `lib/__tests__/recommendation-context.test.ts` (6: empty-list short-circuit, batched IN + casing keys, per-symbol caps, partial-source fallback, never-throws, formatStockContext block) + `recommendationPerformanceService.test.ts` +3 (bridge fills null currentPrice + single query; no bridge call when all populated; graceful fallback on query fail) — mock gained `$queryRaw`. Recommendation-agent tests untouched, passing. **Suite: 449 pass, 11 skipped (was 440).**
7. **Verification (Playwright, dev :3000 — reused running server, did NOT start/kill):** `/recommendations` → History tab "Date" ACTIVE, Performance tab "Recommended ▼ ACTIVE-desc", 0 console errors. (Today's Picks renders the empty state locally — no fresh run today, expected.) tsc clean on all touched files (remaining tsc errors are pre-existing test-file-only noise: DataFetcher/LoadingSpinner/cache/filter-engine + userService.test.ts). 
8. **Pending user:** docs final pass + commit on new branch (or bundle with Features A/B/C + v3.5.4–v3.5.7 holds) — NO deploy. 

## 13. DividendMonthView timezone fix (post-v3.6.1 follow-up) — execution order

**Objective:** user-reported `/dividends` calendar anomaly (summary cards `0/₹0/₹0/—` while calendar showed 19 dividends). Split into data-freshness + real-bug.

1. **Root cause — cards are CORRECT (data freshness):** all local corp-action ex-dates stored at noon UTC (`prisma/seed.ts parseDateCA` `new Date(y,m,d)` → local midnight = UTC prev-day 18:30); 9 syms ex-date `2026-08-10T12:00Z`, 10 syms `2026-08-11T12:00Z`; today = Aug 12 → **zero future ex-dates locally** → `getUpcomingDividendSummary` correctly returns `upcomingCount: 0`, income ₹0 (no holdings). Verified via API: `view=upcoming` → `{upcomingCount:0,totalDividends:10}`, `view=calendar` → `{upcomingCount:0,totalDividends:19}`, `view=income` → Aug-2026 `{income:0,count:10}`. v3.6.0 wiring (route `view=upcoming` L40 + page fetch) works. Prod will populate via the v3.6.0 daily market-sync cron — no code change for the cards.
2. **REAL BUG found — calendar day misplacement (D26):** dividend bucketing used UTC key `new Date(d.exDate).toISOString().split("T")[0]` while grid cells were `new Date(year, month-1, day)` keyed via `toISOString()` — in IST (+05:30) `new Date(2026,8,11).toISOString()` = `2026-08-10T18:30Z` → key `2026-08-10`, so Aug-11-local grid cell matched Aug-10-noon-UTC dividends. Live proof pre-fix: +6 on day 11, +7 on day 12 (wrong), expected 9 on day 10 / 10 on day 11.
3. **Fix (D26):** `app/components/dividends/DividendMonthView.tsx` — exported `toLocalDateKey(date)` (local `getFullYear/getMonth/getDate` padStart → `YYYY-MM-DD`) used for BOTH dividend bucketing and grid-cell keying; added `data-testid="cell-<localDateKey>"` per cell. `DividendListView` uses `toLocaleDateString("en-IN")` (correct as-is, no change).
4. **Regression test (D26):** NEW `app/components/dividends/__tests__/DividendMonthView.test.tsx` (4 tests) with `process.env.TZ = "Asia/Kolkata"` pinned at top (jest workers run UTC by default where the shift never reproduces — critical for CI determinism). Proof: stash old component → **4 FAIL** (cells keyed `2026-08-09/…` don't exist); restore fix → **4 PASS**. Fixture pitfall: first run failed because the 2nd dividend's `companyName` still defaulted to "PTC India Ltd" → assert `RITES`/not-`PTC` on day 11 tripped; fixed by explicit `companyName` override.
5. **Verify live (Playwright, dev :3000):** day 10 = PTC/JIOFIN/MAJESAUT +6 (9 total), day 11 = RATNAMANI/DVL/CASTROLIND +7 (10 total), day 12 empty, footer "19 dividends this month", cards still `0/₹0/₹0/—` (correct — no future ex-dates locally), **0 console errors**.
6. **Suite + types:** full `npx jest` **453 pass, 11 skipped (was 449 + 4 new)**; `npx tsc --noEmit --skipLibCheck` clean on touched files (remaining errors pre-existing test-only noise: filter-engine.test.ts etc.).
7. **Pending user:** docs final pass (AGENTS.md v3.6.1 row append / CHANGELOG entry) + commit on the v3.6.1 branch — NO deploy. Note: `git stash` verification of the regression guard was done correctly (single-file stash → test → pop); a stray earlier `;` chain left `stash list`/`stash pop` unparsed in cmd — recovered via `git stash list && git stash pop`. 

## 14. v3.6.3 — Direction-aware level evaluator + Recommendations page redesign (execution order)

**Objective:** (1) fix ITC **SELL ₹279 Target ₹306.9 / Stop ₹265.05** (BUY-style levels on a SELL); (2) Recommendations page → sidebar Sections nav, IPO status sections w/ Open/Close columns + colour labels, collapsible screener lists, picks-only summary cards.

1. **Root cause (D27):** `recommendation-agent.ts` `normalizeRecommendation` falls back to direction-blind `target=price*1.1`/`stop=price*0.95` when AI returns zeros — and contradictory non-zero AI levels pass through UNCHANGED. Live-confirmed on :3000: ITC card renders Target ₹306.9 / Stop ₹265.05 (inverted SELL); NESTLEIND SELL (₹1,450 < ₹1,493.20 < ₹1,550) is a valid counter-example → model output is inconsistent, so a runtime evaluator (not a backfill-only fix) is required.
2. **NEW `lib/services/recommendationLevelEvaluator.ts` (D27):** pure `evaluateRecommendationLevels({direction, price, targetPrice?, stopLoss?})` → `{direction, targetPrice, stopLoss, valid, corrections[]}`. Invariants: BUY target>price>stop; SELL target<price<stop; HOLD tight band. Defaults (2dp): BUY 1.10×/0.95×, SELL 0.90×/1.05× (direction sign −1), HOLD 1.05×/0.95×; bounds 0.3×–3× price; `valid:false` + message per correction; price ≤ 0 → raw unvalidated.
3. **Wired (D27):** `normalizeRecommendation` routes levels through the evaluator + `logger.warn` on corrections; `dailyRecommendationService.ts` `checkRecommendationPerformance` now direction-aware (`SELL: currentPrice <= targetPrice → target_achieved`, `currentPrice >= stopLoss → stop_loss_hit`; BUY/HOLD unchanged). Placeholder tracker defaults (`price*1.2`/`0.95`, line ~1194) kept — HOLD placeholders overwritten same-run.
4. **Tests (D27):** NEW `lib/__tests__/recommendationLevelEvaluator.test.ts` (13: ITC SELL regression — target 306.9/SL 265.05 @ 279 → corrected target<279 stop>279, "contradict" message; valid BUY/SELL/HOLD accepted; zeros/missing → defaults; 10× absurd → replaced; price 0 → raw; NaN/null/2dp) + 3 agent tests (SELL correction via `analyzeStocks`, valid SELL unchanged, BUY 0/0 defaults unchanged). First targeted run: **40 passed** (16 evaluator + 24 agent); full `npx jest` **484 pass, 11 skipped** (was 471+13). `npx tsc --noEmit` clean on touched files.
5. **NEW `scripts/backfill-recommendation-levels.ts` (D27):** idempotent mirror of v3.5.1 backfill — scans trackers `entryPrice>0`, `evaluateRecommendationLevels` each, updates only when levels changed, logs old/new + corrections. PERSISTED rows (incl. ITC) still show old levels until run.
6. **UI rewrite (D28):** `app/recommendations/page.tsx` — `main` → `flex flex-col lg:flex-row gap-6`; `<aside class="lg:w-56 shrink-0"><nav class="lg:sticky lg:top-24">` "SECTIONS" vertical tabs (active = blue-tint + dot), horizontal scroll on mobile; content `flex-1 min-w-0 min-h-[400px]`; error state inside content; summary cards gated to `activeTab==="picks"`; 📈 header icon. `IposTab.tsx` rewritten: STATUS_SECTIONS [Active→"CURRENT IPOS"🟢 "Open Now" pill (emerald pulse dot), Forthcoming→"UPCOMING IPOS"🕐 amber, Closed→"RECENTLY CLOSED"⚪ gray]; columns COMPANY/SERIES/OPEN/CLOSE/PRICE/ISSUE SIZE/STATUS; section divider rows (`bg-gray-900/60`); Active rows `bg-emerald-500/[0.06] hover:[0.12]`; `Fragment` import. `RecommendationCard.tsx`: `MAX_VISIBLE_SCREENERS=3`, "N screeners ▼/▲" toggle, chips + "+N more", cyan active. `DailyPicksTab.tsx`: `md:grid-cols-2 xl:grid-cols-3`.
7. **Live verify (Playwright :3000):** desktop — sidebar SECTIONS nav, summary cards on Picks only (hidden on IPOs), IPOs tab renders Current(5)/Upcoming(1)/Closed(2) with Open/Close dates + pill styles (computed-style checked: emerald `bg-emerald-500/15`, amber `bg-amber-500/15 border-amber-500/40 text-amber-300`, gray, row `bg-emerald-500/[0.06]`), "43 screeners ▼" → click → "▲" + all 43 chips (no "+40"), 0 console errors; mobile 375px — nav `flex nowrap overflow-x auto` (7 tabs, last right edge 861px), cards render. ITC card on screen still shows ₹306.9/₹265.05 (old persisted data — backfill pending).
8. **Pending user:** run `scripts/backfill-recommendation-levels.ts` (DB write — needs consent), docs final pass (AGENTS.md v3.6.3 row + CHANGELOG + TODO), cleanup temp probes (`scripts/tmp-ipo-probe.ts`, `tmp-check-sync.ts`, `tmp-diff-ipo.ts`), commit — NO deploy. Shell env lacks DATABASE_URL (Prisma 7 adapter) — use the :3000 dev server (PID 27000) for API checks; Windows `npx jest` via `npm run test 2>&1 | findstr /C:"Tests:"`; `npx tsc --noEmit` @180s timeout ⇒ scoped `findstr` on touched paths. 
