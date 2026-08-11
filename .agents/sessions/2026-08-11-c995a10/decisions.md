# Session 2026-08-11-c995a10 — Decision Log

> Every meaningful decision made while writing code this session, with the reasoning behind it.
> Format: **Decision** → *Context* → *Why this approach* → *Impact (files/packages touched)*

---

## D1. Root-cause investigation: stale Daily Recommendations on prod

**Decision:** Stop at the symptom layer and trace the full AI config resolution chain before changing anything.

- *Context:* Public `/recommendations` was stuck at "Last updated: 19/7/2026". Admin run history showed completed runs (Aug 6/7) that produced 50 stocks each — but the public page never showed them.
- *Why this approach:* The failure appeared "silent" (runs completed, `aiFailed: 0`), so a naive fix (re-run) would have repeated the same all-HOLD outcome. Traced: run result → `aiRecommendation: "HOLD", confidence: 50, reasoning: "AI analysis unavailable — defaulting to HOLD"` → `directPrompt` → HTTP 404 → model.
- *Impact:* `lib/services/dailyRecommendationService.ts`, `lib/services/ai/*`, Netlify env inspection.

## D2. Model selection was NOT the root cause — the config plumbing was

**Decision:** Treat "admin picked a bad model" as a symptom, not the cause, after the 404 persisted with the bundled default.

- *Context:* After switching the saved DB model to `tencent/hy3:free` (code default), the admin `POST /api/admin/ai/test` STILL returned `AI request failed (HTTP 404)`.
- *Why this approach:* Listing the live OpenRouter `/models` catalog proved `tencent/hy3:free` **does not exist** (it was inventing nothing — the code's `AVAILABLE_MODELS`/`DEFAULT_MODEL` were stale vs. reality). Wasted no further guesswork.
- *Impact:* Verified live catalog (`curl openrouter.ai/api/v1/models`), 399 models. Only real free+tool models retained.

## D3. `loadConfig()` shared helper — single source of truth for DB-aware AI config

**Decision:** Add a shared async `loadConfig()` to `lib/services/ai/config.ts` instead of duplicating the test-route's local copy.

- *Context:* `app/api/admin/ai/test/route.ts` had its own private `loadConfig()` reading the `ai_config` Secret; the **recommendations pipeline called `analyzeStocks(aiInput)` with NO config** (`dailyRecommendationService.ts:322`) → fell back to env-only `getDefaultConfig()` → always used `process.env.AI_MODEL || DEFAULT_MODEL` (which was `tencent/hy3:free`, a nonexistent model).
- *Why this approach:* One function = consistent behavior across test endpoint AND pipelines; keeps the DB `ai_config` Secret meaningful (admin UI model selection now actually reaches runs). Lazy `import("@/lib/prisma")` keeps `config.ts` client-safe (no top-level Prisma import).
- *Impact:* `lib/services/ai/config.ts` (added `loadConfig`), `dailyRecommendationService.ts` (wire-in, next), `app/api/admin/ai/test/route.ts` (dedupe opportunity).

## D4. Refresh `AVAILABLE_MODELS`/`DEFAULT_MODEL` against the LIVE catalog

**Decision:** Point `DEFAULT_MODEL` at a real model (`nvidia/nemotron-3-ultra-550b-a55b:free`) and swap the stale list entries for verified ones.

- *Context:* `tencent/hy3:free` (weekly-free "recommended default") and `qwen/qwen3-next-80b-a3b-instruct:free` both **404** on OpenRouter. Without this, every cold/deploy default would keep producing all-HOLD runs even after the pipeline fix.
- *Why this approach:* Verified against the actual OpenRouter model list (fetched 2026-08-11). Kept $0/free models that support `tools` + structured output, since the recommendation agent requires tool-call JSON. `nemotron-3-ultra` is the highest-quality free model currently in the catalog.
- *Impact:* `lib/services/ai/config.ts` — `DEFAULT_MODEL`, `AVAILABLE_MODELS` (removed `tencent/hy3:free`, `qwen/qwen3-next-80b-a3b-instruct:free`; added `google/gemma-4-26b-a4b-it:free`, `inclusionai/ling-3.0-tiny:free`, `cohere/north-mini-code:free`).

## D5. Fix prod config via API instead of the UI to avoid modal-dialog interference

**Decision:** Perform prod config/model mutations with `fetch()` from the Playwright page context, not by clicking the admin UI.

- *Context:* Early UI clicking accidentally opened a remove-model confirm dialog and mutated prod custom-models state (removed gems, switched saved model).
- *Why this approach:* The admin UI's confirm-dangerous dialogs intercept clicks; direct API calls (`POST /api/admin/ai/config`, `POST /api/admin/ai/custom-models`, `PATCH /api/admin/workers?action=runNow`) are deterministic and auditable.
- *Impact:* No code change; operational technique. Also restored `google/gemma-4-26b-a4b-it:free` + `google/lyria-3-pro-preview` custom models after the accidental removal.

## D6. Defer scaling — top-50 cap stays; test/prod runs share the same pipeline

**Decision:** No cap change this session. The top-50 `MAX_AI_STOCKS` cap is not the problem; all 50 stocks were HOLD because every AI batch hit the nonexistent model.

- *Context:* Aug 7 run: `totalStocks: 1055, uniqueStocks: 50, aiProcessed: 50, aiFailed: 0` — so the pipeline ran fine; every stock just got the HOLD fallback.
- *Why this approach:* Fix the true cause (config plumbing) first, then re-observe. Raising the cap without fixing the model would only burn more quota on 404s.
- *Impact:* none (no code change).

## D7. Per-session `decisions.md` + `flow.md` memory infrastructure (this session's meta-decision)

**Decision:** Establish the per-session folder memory system the user requested: `.agents/sessions/<YYYY-MM-DD-<hash>>/` containing a live `decisions.md` (every decision + reasoning: why approach / why package added-modified-removed) and `flow.md` (entry point → execution order → code touched), codified as a hard rule.

- *Context:* User asked for a durable session-and-memory record system with timestamp/hash-based folder naming, made into a rule.
- *Why this approach:* Flat archive files (`YYYY-MM-DD-<hash>.md`) captured outcomes but not the decision reasoning or execution path; the new format makes replay/review precise (decisions with reasoning; flow with call chain + file:line). Folder-per-session keeps both files colocated with a stable hash name. Rule file `.agents/rules/session-decisions-flow.md` + index updates (session-memory-rules §3, sessions/README, AGENTS.md table, rules/README) make it enforceable.
- *Impact:* Created `.agents/rules/session-decisions-flow.md` (rule), `.agents/sessions/2026-08-11-c995a10/{decisions,flow}.md` (this session), updated `.agents/sessions/README.md`, `.agents/rules/session-memory-rules.md`, `.agents/rules/README.md`, `AGENTS.md`. No runtime code.

## D8. Cron job ledger fix — record runs from the real execution paths on serverless

**Decision:** Add `recordCronRun(jobName, success)` and call it from (a) `netlify/functions/run-cron-background.ts` (scheduled runs, success + error branches) and (b) admin `PATCH /api/admin/workers` runNow/retry for tasks WITHOUT `cronJobId`.

- *Context:* User reported Admin → Utils → Cron showed "no recent runs" despite 2 jobs. Verified on prod via `/api/admin/cron`: both system jobs had `lastRun: null, runCount: 0, successCount: 0, failureCount: 0` and stale `nextRun` (Aug 10, in the past).
- *Root cause:* The `CronJob` ledger was only written by `spawnCronTask()` (task-orchestrator) and the resident worker-engine scheduler loop — neither runs on Netlify serverless. Real scheduled runs execute directly via `run-cron-background.ts → runDailyRecommendations()/checkRecommendationPerformance()` and never touched the table; admin "Run Now" used `spawnRegularTask` (no `cronJobId` link) + `executeTask`, also never touching it. `successCount`/`failureCount` had NO writer anywhere (grep-verified).
- *Why this approach:* Single ledger-writer (recordCronRun) wired into the two actual execution paths. Skip `cronJobId`-linked tasks in the PATCH route to avoid double-counting (spawnCronTask already increments at spawn). Helper locates the job by stable name (idempotent with `ensureRecommendationCrons`), never throws, safe no-op when the job is missing. `successCount`/`failureCount` finally get writers.
- *Impact:* `lib/services/recommendationCronService.ts` (+`recordCronRun` +`RecordCronRunResult`), `netlify/functions/run-cron-background.ts`, `app/api/admin/workers/route.ts`, new test `lib/__tests__/recommendationCronService.test.ts` (5 tests). Verified: `tsc` clean on touched files, 41 related tests pass. ESLint/`next lint` blocked repo-wide by pre-existing eslintrc circular-config error (Next 16 removed `next lint`) — noted, not fixed (out of scope). **User chose code-fix only, NO deploy.**

## D9. Chartink template catalog → DB schema (v3.5.5): 3 models, 72h TTL, full-run clean-and-insert

**Decision:** Add `ChartinkScreener` (definition: id/name/url/categoryId/scanClause/debugClause/columnClause/backtestMaxRows/scanlinkId/backtestUrl/enabled/lastRunAt/nextRunAt/resultCount), `ChartinkScreenerRun` (one row per full run, status/error/screenersRun/rowsInserted/ttlHours), `ChartinkScreenerResult` (captured rows: symbol/name/bsecode/close/changePercent/conditionFlag/volume/raw/expiresAt). TTL = 72h per row (`expiresAt = capturedAt + ttlHours`); the NEXT full run cleans the entire results table then re-inserts the whole captured dataset under a new run id.

- *Context:* User requested: "use all the info like url, clause, logic, backtestlink, other details for schema"; "ttl on db will be 72hrs or till next run"; "the next full run will clean the table and will re insert the whole screener data"; plus "run screener + cache + sync to db; the captured table needs to be fed to the db".
- *Why this approach:* Matches the product requirement literally — definition rows persist (source of truth stays the JSON configs; DB mirrors them), captured tables are ephemeral with a 72h freshness window, and any full run is idempotent (delete-all → insert-all under one run id). `onDelete: Cascade` on run/screener keeps cleanup simple. `expiresAt` pruning is separate maintenance (`pruneExpiredChartinkResults`) so stale rows can be dropped mid-window too.
- *Impact:* `prisma/schema.prisma` (+3 models, `@@map` snake_case, pgcrypto-free uuid defaults), `lib/services/chartinkScreenerService.ts` (upserts, run lifecycle, full sync, TTL prune, reads, `normalizeCapturedRows` reusing wire aliases), `lib/__tests__/chartinkScreenerService.test.ts` (26 tests, explicit mock-db typing — avoids the `jest.Mocked<PrismaClient>` tsc noise pattern).

## D10. Capture tool: network interception FIRST, clipboard-click recipe as fallback

**Decision:** Build `scripts/chartink-capture/` as: capture-core.ts (pure, unit-tested: clipboard-TSV parsing, clause merge, CLI args) + capture.ts (Playwright runner) that captures `/screener/process` REQUEST BODIES (exact scan_clause/debug_clause/column_clause — the page sends them on load) and RESPONSES (full table rows + scanlink) with ZERO clicks, falling back to the user's "Copy group to clipboard" / "Copy table" button recipe when interception finds nothing.

- *Context:* User's manual recipe (playwright codegen → click "Copy group to clipboard" → Ok → "Copy" → "Copy table" → Ok) was specified for the other 116 links. But the page already POSTs the clauses + returns the table via the DataTables endpoint — capturing the request/response is strictly more reliable than clipboard permissions.
- *Why this approach:* Interception needs no clipboard-read permission, no dialog handling, and returns the EXACT wire format the services already parse (no TSV re-parsing ambiguity). Clipboard fallback stays as verification/secondary path (works on pages that render results client-side without a network round-trip). JSON config write-back uses first-value-wins merge (never stomps a hand-curated clause). `--dry-run`/`--no-db` flags make it safe to trial. TTL default 72h matches the DB.
- *Impact:* `scripts/chartink-capture/capture-core.ts`, `scripts/chartink-capture/capture.ts`, `scripts/chartink-capture/__tests__/capture-core.test.ts` (9 tests). Live chartink.com fetch from THIS sandbox blackholes (documented earlier) — the tool runs where a real browser works (user's machine / CI), same as the existing `chartinkService.ts` hybrid.

## D11. Chartink 117-registry PRIMARY + TV-fallback unified runner (v3.5.6): one import swap makes the engine Chartink-first

**Decision:** Build `chartinkUnifiedScreenerService.ts` — `runChartinkUnifiedScreeners()` returns engine-compatible `ScreenerResult[]` (signature-compatible with the old `chartinkService.runDailyScreeners`) while adding `source: "chartink_db" | "chartink_live" | "tradingview"` + `templateIds` per stock. `dailyRecommendationService.ts` switches to it with a one-line import change. Source chain per template, first hit wins: (1) fresh captured DB rows (72h TTL, zero network) → (2) live `fetchChartinkScan` when the template has a scanClause → (3) ONE shared TradingView `advancedScan` universe (0–2000) filtered per-template via the resolved TV `FilterGroup` template (curated id map → token-name match ≥0.6 → category default).

- *Context:* User required Chartink (117-entry JSON registry) to BE the primary screener source across engine + API + UI, with the 98 TradingView templates as fallback — previously the engine used `runDailyScreeners` (7 legacy Chartink-ish screeners via `chartinkService`) and the registry was only a catalog. Only 1/117 templates (`fundamental.profit-jump-by-200`) has a scanClause today; the 116 remaining are catalog-only until the capture tool runs, so TV fallback (esp. the v3.5.2-validated proxies like "Short Term Breakouts") covers them deterministically.
- *Why this approach:* Single shared TV scan (union of `getRequiredColumns`) makes N catalog-only templates cost 1 TV call, not N. TV fallback resolver order (curated > name-token > category-default) pins the high-value top-loved screeners to their validated proxies. Results stay engine-compatible, so `rankAndCapRecommendations`/AI/DB code is untouched — only the producer swaps. 5-min `staticCache` (key `chartink-unified:screener-results`) with `forceRefresh` bypass keeps daily-run cost low while the cron forces refresh.
- *Impact:* NEW `lib/services/chartinkUnifiedScreenerService.ts` (`runChartinkUnifiedScreeners`, `runChartinkScreenerById`, exported `resolveTvFallback`, `CURATED_TV_FALLBACK`, `CATEGORY_TV_MAP`, `tvRowToChartinkStock`, `scanStockToChartinkStock`); `lib/services/chartinkService.ts` (`deduplicateResults` now EXPORTED — was private); `lib/services/dailyRecommendationService.ts` (L12 import + L167 `runChartinkUnifiedScreeners({ forceRefresh: true })`, hardened `totalRawHits` with `(s.screenerCount || 0)`); NEW `app/api/screener/chartink/route.ts` (GET list with DB overviews + POST run-by-id); `app/components/screener/TemplatesPanel.tsx` rewritten (Chartink·117 / TradingView·98 source toggle, chartink badges clause-ready/captured/stale/disabled, per-template run spinner, `onChartinkResult` callback); `app/markets/screener/advanced/page.tsx` (`handleChartinkResult` maps run stocks → `ScannedStock` table rows); NEW test `lib/__tests__/chartinkUnifiedScreenerService.test.ts` (18 tests); `dailyRecommendationService.test.ts` mock retargeted from `@/lib/services/chartinkService` → `@/lib/services/chartinkUnifiedScreenerService`.

## D12. Catalog-only templates MUST reach the TV fallback stage (bug the test suite caught)

**Decision:** In `runChartinkUnifiedScreeners`, seed `stillTv` with the catalog-only templates (`tvCandidates.filter(t => !t.scanClause)`) instead of only pushing clause templates that failed live fetch.

- *Context:* First run of the new test suite failed "catalog-only templates use ONE shared TV universe scan" — `advancedScan` was called once (mock) but `results.length` was 0. Debug logging showed `tvResolved` contained ONLY `fundamental.profit-jump-by-200`; the 3 catalog-only templates in the fixture vanished.
- *Why this approach:* Real bug, not test noise: the original code put ONLY failed-clause templates into `stillTv`, so any template without a scanClause (116 of 117 today!) that had no fresh DB rows was silently dropped — the unified run would return just the 1 clause template's results. Seeding catalog-only templates into `stillTv` is the correct producer chain. This is exactly the class of regression the mandatory tests are for.
- *Impact:* `lib/services/chartinkUnifiedScreenerService.ts` stage-2 seeding; the 3 TV-fallback tests now pass. Also fixed thin TV-mock rows in the test to carry the fields the resolved filterGroups actually need (`relative_volume_10d_calc`, `"Perf.5D"`, `return_on_equity_fq`) and pinned the DB-short-circuit test with `templateIds` so it stays a pure-DB test.

## D13. Auth: remove the `isVerified` gate in `authorize()` — password login must work for approved join-request users

**Decision:** Delete the `if (!(user as any).isVerified) throw new Error("Email not verified")` block from `lib/auth.ts` authorize(), keeping the blocked-account check and the bcrypt password comparison.

- *Context:* User requirement: join request → admin approves (creates the user with `isVerified: true`) → user logs in with the SAME password they set (default `********` per D14). Root cause 1: authorize() threw "Email not verified" **BEFORE** comparing passwords for `!isVerified` users, so any approved-but-unverified (or legacy) user could never log in regardless of password.
- *Why this approach:* The gate made password login impossible for the target users and dead-code branches in the SignIn UI ("UNVERIFIED" state) existed solely to handle it. Approve/verify paths already set `isVerified: true`, so the gate protected nothing — it only blocked. Removing it makes password the single auth gate, consistent with the join→approve→login flow.
- *Impact:* `lib/auth.ts`; `app/auth/signin/page.tsx` + `app/components/modals/LoginModal.tsx` (removed dead `res.error === "Email not verified"` → UNVERIFIED branches; Link imports retained — still used by "Join Now").

## D14. Auth: join-request approval uses FIXED default password `********` (bcrypt-hashed), surfaced in admin confirm/alert

**Decision:** Replace `crypto.randomBytes(8).toString('hex')` temp password in the approve route with a fixed `DEFAULT_PASSWORD = "********"`; the admin confirm dialog and success alert now display it; API response includes `defaultPassword` + `email`.

- *Context:* User requirement: "make the default password ******** and show the default password in the admin approval popup". Previously admin approved → got a random hex password they never saw after the dialog closed → the new user was locked out.
- *Why this approach:* A fixed, shareable default is the only way the admin (the only person who sees the success alert) can communicate credentials to the applicant. `********` is a memorable default matching the user's spec; bcrypt-hashed at the same cost factor (12) as before. Removing the `crypto` import (now unused) keeps tsc clean.
- *Impact:* `app/api/admin/join-requests/[id]/approve/route.ts` (DEFAULT_PASSWORD const, hash, `[EMAIL MOCK]` line, response `{defaultPassword, email}`); `app/admin/users/page.tsx` (confirm text + `alert` with `data.email` + default password).

## D15. Server logs: `logs/` folder (gitignored) + bug fixes in read path + Netlify blob mirror so monitoring actually displays them

**Decision:** (a) Local server log dir `server_logs/` → `logs/` (gitignored); (b) fix `readLogsByDate` path computation (`logs/<YYYY-MM>/<YYYY-MM-DD>.log`, was `logs/<YYYY>/<YYYYMM>/...` — never matched the write path, always returned []); (c) on Netlify, mirror every log line into the `server-logs` Netlify Blob store (date-keyed) and read/delete blob entries from that store.

- *Context:* User requirement: "fix server logs so they store to a logs/ folder under the app (gitignored) and the monitoring page fetches and displays them". Root causes verified: prod logs were invisible because the general logger wrote to per-instance ephemeral `/tmp/tradenext_logs` and NEVER to the `server-logs` blob store that `getLogFiles()` lists (only worker logs went to blobs — and into a DIFFERENT `worker-logs` store), and `readBlobLog`/`deleteBlobLog` hardcoded `worker-logs` so even blob paths resolved to the wrong store.
- *Why this approach:* `logs/` is the standard, git-ignored, app-relative location (matches existing `worker_logs/`/`server_logs/` pattern). On serverless, `/tmp` is per-instance, so the ONLY way the monitoring page (running on another instance) can show logs is shared storage — Netlify Blobs. Mirroring the general logger into `server-logs` reuses the store the UI already lists. Fire-and-forget `.catch(() => {})` keeps log writes non-blocking. `listBlobLogs` now strips `.log` so blob dates match local file dates in the UI.
- *Impact:* `lib/logger.ts` (`getLogsDir` → `logs`, `readLogsByDate` fixed, `writeToFile` mirror to blob, `readLogFile`/`deleteLogFile` store-aware), `lib/netlify-logger.ts` (parameterized store, `appendServerLogLine`, store comment), `.gitignore` (+`logs/`), NEW `lib/__tests__/logger-paths.test.ts` (7 tests, `@jest-environment node` — jsdom makes `isServer` false; `jest.setup.js` wrapped `window`-only mocks in `typeof window !== 'undefined'`).

## D16. Credential hygiene: `DEFAULT_PASSWORD` env-var-only (no literals) + git-hook enforcement + README/llms.txt/robots discovery

**Decision:** (a) Move the join default password OUT of code into `process.env.DEFAULT_PASSWORD` — no literal in repo, no code fallback, missing env → 500 `logger.error` guard; `.env` (gitignored) holds the value; `.env.example` documents only the NAME with an "env var only, never hardcode" comment; UI confirm references the env-var NAME, success alert shows API-returned value. (b) Redact ALL literal occurrences of the join password to backtick-quoted `********` across every committed doc. (c) Enforce with hooks: NEW `.githooks/commit-msg` (blocks credential literals in commit messages) + `.githooks/pre-commit` #6 (real `.env` never staged) + #7 (credential literals in staged diff / `password[:=] "…"` in staged `.md`). (d) Rewrite README.md (clean structure, AI & Agent Discovery section) + NEW `app/llms.txt/route.ts` + `app/robots.ts` rewritten for LLM crawlers.

- *Context:* User requirement: "mask or remove passwords in docs/references + enforce a rule that new credentials are env-var-only; polish README; add llms.txt + robots for LLM/agent discovery". The D14 fixed password ended up as a literal inside code AND docs — a real account credential was one commit away from git history. Public sandbox demo creds (demo123/admin123 in README/AGENTS tables, seed, e2e fallbacks) are documented public demo logins — exempt, and remain the sanctioned central reference (Netlify omit-list already covers those files).
- *Why this approach:* Env vars are the only place a per-environment secret can live without history exposure; a 500 guard makes misconfiguration loud at runtime. Hooks enforce the rule at every commit (memory/prompts don't). A static `/llms.txt` route (llmstxt.org pattern) gives LLMs/agents a safe, boundaries-documented index without exposing internals; robots LLM-UA rules + explicit `/llms.txt` allow keep crawlers on public content and off `/admin/`, `/users/`, `/.agents/` etc. Prod publish dir `.next` already guarantees repo docs never ship.
- *Impact:* `app/api/admin/join-requests/[id]/approve/route.ts` (env read + 500 guard), `app/admin/users/page.tsx` (env-var-name confirm text), `.env`/`.env.example`, `.githooks/commit-msg` (new), `.githooks/pre-commit` (#6/#7), all committed docs redacted (`AGENTS.md`, CHANGELOG, versions-v3, TODO, Primer, HANDOFF, latest.md, decision D14 example), `README.md` rewritten, NEW `app/llms.txt/route.ts`, `app/robots.ts` rewritten. Verified dev :3000: `/llms.txt` `/robots.txt` `/sitemap.xml` `/api/openapi` all 200.

## D17. Chartink migration: generate SQL offline + verify via full-history replay on a scratch DB (NEVER reset the local dev DB)

**Decision:** Create `prisma/migrations/20260811103000_add_chartink_screener_models/migration.sql` by diffing a pre-chartink schema snapshot against the current schema (`prisma migrate diff --from-schema <old> --to-schema prisma/schema.prisma --script` — exactly the 3 chartink tables + 8 indexes + 2 FKs), then prove it by replaying ALL 32 migrations onto a throwaway `tradenext_shadow` DB with `migrate deploy`. Also create a running **DB-migration ledger** (`.agents/docs/db-migrations.md`).

- *Context:* `migrate dev` on the local DB reports massive drift and demands `migrate reset` (drops ALL local data). The local dev DB is maintained in **db-push state** (tables exist, no migration history recorded), so Prisma thinks nothing is applied. A reset would destroy the local dataset that the app/tests/e2e depend on — and destructive commands are BLOCKED for AI agents without explicit user consent.
- *Why this approach:* The migration file is only SQL text — it can be authored without touching any DB. The scratch-DB replay is byte-for-byte what prod's `migrate deploy` runs, so a clean replay is the strongest possible local proof (the shadow DB was dropped after). Chartink definitions (117 entries) are upserted at runtime by `chartinkScreenerService.upsertChartinkScreener()`, so no seed/backfill is needed — empty tables are correct on first deploy.
- *Impact:* NEW `prisma/migrations/20260811103000_add_chartink_screener_models/migration.sql` (86 lines); NEW `.agents/docs/db-migrations.md` (ledger: every migration newest→oldest with decision, apply + verification workflow, schema-change checklist, schema at a glance); `.agents/docs/README.md` index (+db-migrations.md, +chartink-api.md row that was missing); AGENTS.md `.agents/docs/` row updated. Local DB untouched; scratch DB dropped.

---

## D18. Daily market-sync cron: dedicated Netlify scheduled function (`1 1 * * 1-5`) + `market-sync` background action

**Decision:** Add a new Netlify scheduled function `cron-market-sync` running `1 1 * * 1-5` (weekday mornings) that triggers a `market-sync` action in `run-cron-background.ts` executing `executeStockSync`/`executeCorpActionsSync`/`executeScreenerSync`; register a `MARKET_SYNC_CRON_NAME = "Daily Market Sync (System)"` cron entry.

- *Context:* Prod had no daily refresh of stock/corp-actions/screener data — the only crons were recommendations generation + performance. User requirement: "market sync daily cron".
- *Why this approach:* Follows the existing Netlify scheduled-function pattern (per-function `schedule` in metadata + x-cron-secret guard + action dispatch in `run-cron-background.ts`) exactly like cron-recommendations. A dedicated function keeps the schedule declarative and reuses the proven background executor.
- *Impact:* NEW `netlify/functions/cron-market-sync.ts`; `netlify/functions/run-cron-background.ts` (market-sync branch); `lib/services/worker/worker-service.ts` (exported `executeStockSync`/`executeCorpActionsSync`/`executeScreenerSync`); `lib/services/recommendationCronService.ts` (`MARKET_SYNC_CRON_NAME` + expr).

## D19. Zeroed dividend cards: summary cards must be UPCOMING, not month-scoped

**Decision:** New `getUpcomingDividendSummary(userId?)` (upcoming = this-month ex-dates, all statuses, maybeDelisted aware) fed into `/api/dividends/calendar?view=upcoming` and used as the primary source for the Recommendations Dividends tab + `/dividends` summary cards.

- *Context:* User-reported bug — Recommendations + `/dividends` pages showed `0 / ₹0 / ₹0 / —` on their summary cards. Root cause: cards were computed from month-scoped `getDividendSummary` which returns zeros for a month containing no ex-dates.
- *Why this approach:* The cards' semantic is "what's coming up this month", not "what's in the currently selected month view". A dedicated upcoming query keeps the month view unchanged while fixing the cards in both call sites (recs page + dividends page + calendar API).
- *Impact:* `lib/services/dividendCalendarService.ts` (+getUpcomingDividendSummary), `app/api/dividends/calendar/route.ts` (view=upcoming), `app/dividends/page.tsx`, `app/recommendations/page.tsx`; NEW 11-test suite.

## D20. Password reset requests: full admin-moderated mirror of JoinRequest (NEW model + migration)

**Decision:** Add `PasswordResetRequest` Prisma model (id, email NOT unique, reason?, status pending/approved/rejected, createdAt/updatedAt + `@@index([status])`/`@@index([email])`, map `password_reset_requests`), migration `20260811150000_add_password_reset_request` (generated via `migrate diff` git-HEAD→current + shadow 33-migration replay + `db push` on local + ledger row).

- *Context:* Requirement — "password reset requests for existing users so the admin can approve + give them the default password; no self-service password change (mirror JoinRequest moderation)".
- *Why this approach:* Reusing the JoinRequest pattern (moderated by admins, DEFAULT_PASSWORD env value set on approval) keeps a single approval UX and avoids a public password-change attack surface. Email is NOT unique because a user can legitimately request again later; dedup is enforced only against pending rows at creation.
- *Impact:* `prisma/schema.prisma` + migration folder + `.agents/docs/db-migrations.md` ledger row; `lib/services/userService.ts` (5 DB fns: hasPending / create / getPending / getById / updateStatus).

## D21. Reset flow security: anti-enumeration + admin-only temp password + session invalidation + notifications

**Decision:** (a) Public POST `/api/auth/password-reset` returns the SAME success message for unknown emails (no account creation; logged warn) — no user enumeration; (b) admin approve sets bcrypt-hashed `DEFAULT_PASSWORD` (500 guard if env missing) + `isVerified:true` + `invalidateUserTokens(user.id)`; the temp password is returned to the ADMIN only in the API response/alert (never in notification bodies); (c) NEW `lib/services/notificationService.ts` (`notifyAdmins`/`notifyUser` — in-app + best-effort Telegram via `sendAlertToUser` only when linked+verified, failures logged never thrown); (d) join routes get audit + welcome notify.

- *Context:* Security requirements from prior sessions (credential hygiene D16, no secrets in client D14) + user: "the admin approves and the user receives the default password; notify admins".
- *Why this approach:* Reusing `invalidateUserTokens` (sessionService) kills the requester's stale sessions on password change — critical since the old password is replaced. Telegram is best-effort delivery only (never a gate); `[EMAIL MOCK]` console.log remains. Anti-enumeration mirrors the JoinRequest design (create only for existing users, generic message otherwise).
- *Impact:* NEW `app/api/auth/password-reset/route.ts`, `app/api/admin/password-reset-requests/route.ts` + `[id]/approve|reject`; `lib/audit.ts` (+6 tags: JOIN_REQUEST_CREATED/APPROVED/REJECTED, PASSWORD_RESET_REQUESTED/APPROVED/REJECTED); join approve route (+welcome notify).

## D22. Legacy signup disabled + admin Password Resets tab + UI links (kebab wiring)

**Decision:** `/api/users/signup` → 410 (redirectTo /auth/join), `/users/new` → server redirect to /auth/join, `NewUserForm.tsx` deleted, `/users` page Create-User link → "Join / Request Access"; admin `/admin/users` gains a 3rd "Password Resets" tab (`?tab=password-resets` deep-link — used by notification links), approve/reject handlers (confirm dialog explains DEFAULT_PASSWORD + session invalidation; success alert shows the temp password); `/auth/password-reset` page + signin/LoginModal "Forgot password?" links; e2e login.spec updated.

- *Context:* After the reset flow exists, the old admin-created-user/signup paths are bypasses — keep the admin "Create User" form but kill the public self-signup surface. Notification links must land on the right tab.
- *Why this approach:* Minimal surface change — the admin Create User form stays (admin-controlled), only the public/legacy paths are hardened; deep-link via `useSearchParams` matches the existing Notification pattern.
- *Impact:* `app/api/users/signup/route.ts`, `app/users/new` (+deleted NewUserForm.tsx), `app/users/page.tsx`, `app/admin/users/page.tsx`, `app/auth/signin/page.tsx`, `app/components/modals/LoginModal.tsx`, NEW `app/auth/password-reset/page.tsx`, `e2e/login.spec.ts`.

---

## D23. Recs tabs default sort = created-date descending (Performance + Today's Picks + History)

**Decision:** Change every recommendations tab's default sort to newest-first: PerformanceTab `returnPercent` → `createdAt` (desc); HistoryTab `screenerCount` → `date` (desc); DailyPicksTab gains a NEW "Newest" sort option (`createdAt` desc, screener-count tiebreak) and it becomes the default.

- *Context:* User report — Performance tab "was not initially sorted by created date desc (defaulted to return %)". Verified: the API default sort IS `createdAt` desc (service default), but the UI's `useState("returnPercent")` overrode it. User confirmed the same default applies to Today's Picks/History. Prod + local data are actually fully populated (1691/732 trackers, 0 empty Entry/Current) — so the "empty columns" perception was a sort artifact, not missing data.
- *Why this approach:* Sort defaults belong in the UI (the API contract is already correct). For Today's Picks all stocks come from the latest run (identical `createdAt`), so `createdAt` desc is a stable no-op with a screener-count tiebreak preserving ranking — it satisfies the "same default" requirement without breaking the existing cap-priority sort. History's date option already existed and sorts desc.
- *Impact:* `app/components/recommendations/PerformanceTab.tsx`, `HistoryTab.tsx`, `DailyPicksTab.tsx`. Verified live on :3000 — History "Date" active, Performance "Recommended ▼" active, 0 console errors.

## D24. Performance current-price bridge: fill null `currentPrice` from daily_prices (no N+1)

**Decision:** Add `bridgeMissingCurrentPrices<T>` to `recommendationPerformanceService.ts` — after fetching list rows, ONE batched `SELECT DISTINCT ON (ticker) … close::float8 FROM daily_prices WHERE ticker = ANY(…) ORDER BY ticker, "tradeDate" DESC` fills rows whose `currentPrice` is null; run BEFORE `toListItem` so `returnPercent` uses the bridged price; graceful catch → warn + rows unchanged.

- *Context:* The 4PM perf-check cron updates `currentPrice` for all trackers, but a fresh tracker created before its first check (or a missed cron) shows "—" in Current and Return %. User wanted Current/Return % never blank when a price exists.
- *Why this approach:* Same `DISTINCT ON` pattern already proven in the perf-check cron (L735-740) and dividend enrichment (dividendCalendarService L263). One query for the whole page (not N per-symbol queries) honors the no-N+1 checklist rule. Bridging before `toListItem` means return % is computed consistently for bridged and non-bridged rows alike. `close::float8` cast keeps the raw-query result a plain number (as the cron path does).
- *Impact:* `lib/services/recommendationPerformanceService.ts` (+helper, wired into both `getPerformanceList` paths), `lib/__tests__/recommendationPerformanceService.test.ts` (+3 tests, prisma mock +`$queryRaw`). Suite 449 pass.

## D25. AI recommendation context enrichment: fundamentals in the prompt (batched corp actions + announcements + quarterly results)

**Decision:** NEW `lib/services/ai/recommendation-context.ts` — `getRecommendationContext(symbols)` returns per-symbol `StockContext` (corp actions + announcements from DB, quarterly results from ONE cached NSE `getCorporateResults("Quarterly")` call), each source `Promise.allSettled` with per-source caps (3/2/1) and graceful fallback (never throws). `StockAnalysisInput.context?` + `formatStockContext()` appends an indented Context block to the agent prompt; `dailyRecommendationService.ts` enriches ONCE per run after the MAX_AI_STOCKS cap slice.

- *Context:* User approving follow-up scope — "corp actions (DB), corporate announcements (DB) and financial results (NSE cached getCorporateResults) as the third source". The AI currently sees only price/momentum/screener signals; fundamentals arrive late (a stock with a tanking quarter still gets momentum-based BUY).
- *Why this approach:* All DB lookups are batched `symbol IN (...)` (no N+1); NSE results payload is fetched once per run and already 1h-cached inside `getCorporateResults` — context costs 2 DB queries + 1 cached NSE call regardless of batch size. `allSettled` means a failing source degrades gracefully (never blocks the pipeline — checklist rule). Prompt rule "weigh context alongside technicals; mention in reasoning" keeps the model honest without forcing structure changes (JSON schema unchanged).
- *Impact:* NEW `lib/services/ai/recommendation-context.ts`; `lib/services/ai/recommendation-agent.ts` (`StockAnalysisInput.context`, prompt + system rule, `indent()` helper); `lib/services/dailyRecommendationService.ts` (one enrichment call per run); NEW `lib/__tests__/recommendation-context.test.ts` (6 tests).

---

## Accidental prod mutations logged (transparency)

- UI clicks on `/admin/ai` removed custom models `google/gemma-4-26b-a4b-it:free` + `google/lyria-3-pro-preview` on prod; both restored via `POST /api/admin/ai/custom-models`.
- Saved model on prod was briefly switched during investigation; final prod DB config = `nvidia/nemotron-3-ultra-550b-a55b:free` (verified working: test returns "4").
- Env vars: `AI_MODEL` NOT set on Netlify (falls to `DEFAULT_MODEL`); `OPENROUTERKEY` configured and valid.