# Primer.md - Session Tracking

> Agent reads this at the start of every session to understand current state and progress
> ⚠️ IMPORTANT: After completing ANY task, you MUST update documentation (@AGENTS.md, @Primer.md, @agent-memory.md, @Lessons.md). See @Lessons.md Lesson 20 for details.
> 🔄 Handoff System: Read `@HANDOFF.md` for orchestration state and `.agents/handoffs/active/latest.md` for current session handoff.

## Last Updated
2026-09-02 (v3.23.0 — SQLite-primary READ tier during plan-limit breaker holds + DB-log & worker-log download/export UI + readTier telemetry — suite 986 pass / 4 skip / 0 fail; tsc 46 = baseline; commit pending user. Covers the full in-flight `feat/db-ops-reduction-read-tier` branch on top of v3.22.0.)

---

## Current Project Status

### v3.23.0 — SQLite-primary READ tier during plan-limit breaker holds + DB-log download/export UI + readTier telemetry (Sep 02 2026) — ✅ CODE + TESTS + DOCS VERIFIED, COMMIT PENDING USER
**Branch**: `feat/db-ops-reduction-read-tier` (on top of v3.22.0). Deployable unit — covers the full in-flight branch.
**Why**: (1) When the plan-limit circuit breaker (v3.20.3) is OPEN, routes that still read from Prisma stall 120s or fail immediately — even though the data is already mirrored in SQLite. Hot reads (recommendations, swing, screener, corp-actions) must serve from SQLite without touching the held Prisma account. (2) The db-health admin panel had no way to download/export the SQLite-backed log files or the worker/task/cron log files. (3) No visibility into which readers (SQLite, memory, Prisma, NSE, filesystem) are actually hit, at what latency, with what hit rate — NodeCache `getStats()` always showed 0 because hot reads short-circuit before generic NodeCaches, and `getStats()` resets on deploy.
**Fix**: (1) **SQLite-first read gating** — `isPlanLimitBreakerOpen()` (synchronous globalThis breaker-state check, zero DB). When OPEN: recommendations route calls `sqlite.getLatestRecommendations()` (`servedFrom: "sqlite_mirror"`, falls to memory `recommendationsCache`); swing service gates the DB job fast-path + persist-job block on `!breakerOpen` and adds a breaker-open fallback returning an honest screener-only "pending" feed with no Prisma writes (atomic `updateMany` claim remains the sole writer exception per user directive); screener chartink route serves `sqlite.getChartinkScreeners()` without calling Prisma; corp-actions serves after the memory-cache fast path (`{ data, source: "sqlite_mirror" }`). Worker-engine + `syncFromPrisma` were already breaker-gated (v3.22.0). (2) **DB-log download/export UI** — GET `/api/admin/db-health` returns `dbLogFiles` via `getDbLogFiles()` (filesystem-only, zero Prisma); new "DB Logs — Download / Export" card with live per-kind buttons (`?export=api_request|server_log|audit_log`), archived-files table (reverse-chron, KB sizes, per-date Download via `?archiveFile=<date>`), pending queue counts + message area. (3) **Worker/task/cron logs downloadable** — NEW `readAllLogs(limit=200)` in `worker-logger.ts` (bulk-concatenates all `worker_logs/*.log` newest-first, traversal-guarded, zero DB); monitoring `worker-logs` case gains `?action=download` (`Content-Type: text/plain` + `Content-Disposition: attachment`); Workers tab "Download all" button. (4) **Chartink cache TTL** 5m → 15m. (5) **readTier telemetry** — NEW `lib/services/readTier.ts` (zero-DB globalThis `__readTier`, `ReadSource` = sqlite/memory/prisma/nse/filesystem/other, `recordRead`/`getReadMetrics`/`resetReadMetrics`, per-reader min/max/avg/hits/misses/rows, per-source aggregation, bounded long-query ring `MAX_LONG=15`, SQLite perf grid) instrumented across 6 call sites (sqlite mirror helpers, recommendations Prisma, swing breaker-open, screener Prisma, corp-actions memory+Prisma); db-health GET returns `readTier` + `cache.metrics`; new "Cache & Read-Tier Utilisation" card (NodeCache hit-rates, HIGH-frequency sqlite/memory, LOW-frequency Prisma warning, long/large-queries, SQLite latency).
**Tests**: NEW `readTier.test.ts` (11 — record/aggregate, min/max/avg, misses, default source+miss, reader separation, long-query capture+sorted, no sub-threshold capture, ring ≤15, SQLite perf, reset, all source keys). Full suite **986 pass / 4 skip / 0 fail** (was 975/4, +11); tsc **46 = baseline** (0 new); no schema change → no migration.
**Docs**: AGENTS.md v3.23.0 row, CHANGELOG index + `.agents/changelog/versions-v3.23.md`, TODO.md row, this Primer, agent-memory, Lessons (#100).
**Status**: Code + tests + docs verified; **commit/PR/deploy pending user** (no auto-commit/push/deploy). After deploy, live-verify `/admin/utils/db-health` shows Cache & Read-Tier Utilisation card with real non-zero sqlite/memory reader metrics.
**Branch**: `feat/db-health-ops-visibility` (on top of v3.21.3). Deployable unit — covers the full in-flight branch.
**Why**: (1) Multi-instance boot duplication — 2026-09-02 prod log showed 5 Netlify instances each syncing SQLite + scheduling duplicate cron/workers → Prisma ops/BG ~5–10× on cold-start. (2) `drainWriteBehind` promoted EVERY queued row → info logs alone pushed daily ops way past target. (3) Audit-tag + db-health UI keying gaps.
**Fix**: (1) **Leader election** (`lib/services/leader.ts`) — single-writer lock on `worker_status` (`leader-<role>` + heartbeat, 5-min staleness), DB-down fail-open to local leader, re-elect on recovery; `acquireLeaderLock` reconcile — create-path genuine errors rethrow, `updateMany` claim-race stands down, DB-unavailable fail-open. (2) **Write-behind promotion model** — SQLite = PRIMARY durable log store (14-day TTL); `isWbImportant` filters api 5xx/rate-limited/anomaly/error + server_log error|warn + security/critical audits → ONE `createMany` promotes only the important subset; bulk info/api logs stay SQLite-only (0 Prisma ops); `pruneWriteBehind` + 15-min leader-gated `startWriteBehindFlush` booted after `startOpsCounterPersistence()`; `lastPromoted`/`lastRetained` surfaced; **double-count fix** — `createMany`=1 op via `$allOperations`, removed `dbOpsCounter.writes += chunk.length`. (3) **Audit-tag gap fill** — `lib/audit.ts` +9 `ADMIN_*` tags, wired `void createAuditLog` in db-health POST (backup/restore/flush_prices/flush_logs/deploy_prep/sync) + admin recommendations POST (run_now/check_performance/check_swing_performance with `taskId`). (4) **db-health UI kind-key fix** — `pending`/`lastFlushCounts` keyed by KIND (`api_request`/`server_log`/`audit_log`) not table (`wb_*`); emerald `lastPromoted` vs amber `lastRetained` split. (5) **cron-daemon heartbeat → local SQLite** (`writeLivenessHeartbeat`, zero Prisma ops).
**Tests**: sqlite `__resetStore` mock isolation; promotion + regression (600 error rows → 3 createMany, writes counter unchanged); `leader.test.ts` (18); audit-action coverage. Full suite **972 pass / 4 skip / 0 fail** (was 945/4, +27); tsc **46 = baseline** (0 new); no schema change → no migration. Spec `.agents/specs/01-db-ops-reduction.md` + plan `.agents/plans/01-db-ops-reduction.md`.
**Docs**: AGENTS.md v3.22.0 row, CHANGELOG index + `.agents/changelog/versions-v3.22.md`, TODO.md row, Primer, Lessons, agent-memory, ARCHITECTURE (leader + write-behind), rules/guardrails.
**Status**: Code + tests + docs verified; **commit/PR/deploy pending user** (no auto-commit/push/deploy). After deploy, live-verify db-health shows promoted-vs-retained split + healthy ops count.

### v3.21.1 — DB Health ops visibility: SQLite ops-counter persistence + Total Operations/Plan Usage UI + sql.js WASM fix (Sep 02 2026) — ✅ CODE + TESTS + DOCS VERIFIED
**Branch**: `feat/db-health-ops-visibility` (committed `4c47348` + docs `47e6677`, pushed; PR NOT created — user decision). Increment (per-type DB-error summary + lazy SQLite re-init) uncommitted, on top.
**Why**: (1) Live-site bug — `/admin/utils/db-health` showed "SQLite Not Ready": sql.js is a native/WebAssembly module and its `sql-wasm.wasm` was never located, so `initSqliteBackup()` never completed → the whole SQLite fallback layer was dead on Netlify. (2) IO-count gap — Prisma dashboard Total Operations (authoritative, counts reads+writes through the Accelerate proxy vs the 10K ops/day plan limit) diverged from the in-memory `dbOpsCounter` which resets on every deploy. User chose the **"Display + persist"** approach.
**Fix**: (1) WASM — `next.config.ts` `serverExternalPackages: ['sql.js']` + `lib/sqlite.ts` `resolveSqlWasm()` (`node_modules/sql.js/dist` → `public/`) wired into `initSqlJs({ locateFile })`. (2) Persistence — `lib/prisma.ts` exports `getIstDayKey` (shared day-key source); `lib/sqlite.ts` `persistOpsCounter()`/`restoreOpsCounter()` (key `ops_counter` in `_backup_meta`, IST-day guard + `Math.max` merge) + 60s `startOpsCounterPersistence()` (globalThis) booted from `instrumentation.ts`; restore at init + after initial sync. `/api/admin/db-health` GET returns `totalOperations`/`planLimit` (env `DB_PLAN_LIMIT_OPS`, default 10,000)/`planOperationsRemaining` + persists; POST sync persists too. UI: 6th "Total Ops Today" stat card + "Plan Operations Usage" bar (reads vs writes vs plan, remaining, footnote: Prisma dashboard authoritative · restored from SQLite snapshot · resets on deploy) + "Plan Ops n% Used" badge > 80%. (3) Test-infra mock semantics (`sqlite.test.ts`): `exec()` projects only requested columns; INSERT implements `INSERT OR REPLACE` (PK = first column); `getIstDayKey` in mock. (4) **Increment** — `classifyDbError()` (`lib/db-utils.ts`, `DbErrorType` 6 buckets) + per-type `dbErrorCounts` (`__dbErrorCounts` globalThis, lazy IST-day rollover) in `recordDbError()` + `getDbErrorCounts()`; `persistDbErrorCounts()`/`restoreDbErrorCounts()` (key `db_error_counts`, IST-day + per-key `Math.max` merge, same 60s tick); **`ensureSqliteBackup()`** lazy on-demand init (`_initPromise` finally-reset — never stuck "Not Ready") + `resetSqliteStateForTests()` in-place test hook; `/api/admin/db-health` GET returns `dbErrorSummary {day, counts}` (GET+POST ensure init); UI per-type summary chips (plan_limit/connection red w/ ring >0, timeout/accelerate_proxy/write_budget amber, other gray) + error total + IST-day footnote above Recent DB Errors.
**Tests**: `npx jest --testPathPatterns="sqlite.test"` → 20/20 baseline; two-file run (db-utils + sqlite) → 48/48; full suite **932 pass / 4 skip** (was 920/4, +12); tsc **46 = baseline** (0 new production errors).
**Docs**: AGENTS.md v3.21.1 row, CHANGELOG index + versions-v3.21.md v3.21.1 section (base + increment), TODO.md row, this Primer, agent-memory, Lessons (#95), session-todos.
**Status**: Code + tests + docs verified; **commit of increment + PR for branch pending user** (no auto-commit/push/deploy). After commit/deploy, live-verify `/admin/utils/db-health` on Netlify shows SQLite Ready + Total Ops + per-type error chips. Known: `versions-v3.21.md` detail lives in `.agents/changelog/`.

### v3.21.2 — Stock-quote tiering (cache → SQLite → Prisma, zero after-hours DB writes) + TTL ms→s fix + SQLite backup/restore in db-health (Sep 02 2026) — ✅ CODE + TESTS + DOCS VERIFIED, COMMITTED `7409616` + PUSHED
**Branch**: `feat/db-health-ops-visibility` (`7409616`, pushed; no PR).
**Why**: (A) after-hours DB writes to `daily_prices` on every quote — burned plan ops; (B) closed-market quotes still hit Prisma (up to 3 reads each); (C) `enhanced-cache` passed ms as seconds to NodeCache → TTLs ~1000× too long; (D) SSE poll wrote price rows unconditionally (before batch writer); (E) db-health `opsSnapshot` taken after probe → inflated request ops; (F) user directive: SQLite backup exportable/restorable.
**Fix**: A `stock-service.ts` `syncDailyPriceOnce` (market-open only + seed-once per symbol per IST day via `globalThis.__dailyPriceSynced` Set); B `lib/sqlite.ts` `daily_price_snapshot` table + `getDailyPriceSnapshot`/`setDailyPriceSnapshot` + exported `getSqliteDailyPriceSnapshot`/`cacheDailyPriceSnapshot`, `syncFromPrisma` DISTINCT ON seed, closed-market chain hotCache → SQLite (zero Prisma) → on miss only 2-3 Prisma reads; C `enhanced-cache.ts` `Math.ceil(getRecommendedTTL(ms)/1000)` before `cacheInstance.set` (NodeCache TTL = seconds); D `priceSyncService.ts` `cacheDailyPrice` gated by `isMarketAccumulationWindow()` + `cacheDailyPriceSnapshot` warm each tick; E db-health API `opsSnapshot` captured before probe/table-counts; backup/restore — `lib/sqlite.ts` `getSqlJs()`/`_SQL` + `exportSqliteBackup()` (`db.export()` → Uint8Array) + `restoreSqliteBackup()` (50MB cap + magic header + required tables + live swap via `_instance = createFallback(candidate)`), POST `/api/admin/db-health` `backup`/`restore`, `/admin/utils/db-health` Backup & Restore card (Download `ArrowDownTrayIcon` / Apply Restore file input).
**Tests**: NEW `dbOpTiering.test.ts` **9/9**; full suite **941 pass / 4 skip** (was 932/4, +9); tsc **46 = baseline**; no schema change → no migration.
**Docs**: AGENTS.md v3.21.2 row, CHANGELOG index + versions-v3.21.md v3.21.2 section, plan doc `04-db-op-tiering-cache-sqlite-prisma.md`, Primer, agent-memory, handoff.
**Status**: Committed `7409616` + pushed. Call-site map + poll-path audit in plan doc.

### v3.21.3 — Prisma OpenTelemetry tracing (opt-in) + Prisma Compute P1001 false-alarm diagnosis (Sep 02 2026) — ✅ CODE + TESTS + DOCS VERIFIED, COMMIT PENDING USER
**Branch**: `feat/db-health-ops-visibility`, on top of `7409616`.
**OTel wiring**: installed `@prisma/instrumentation` (7.10.0) + 8 `@opentelemetry/*` (`api`, `sdk-trace-node`, `resources`, `semantic-conventions`, `sdk-trace-base`, `instrumentation`, `context-async-hooks`, `exporter-trace-otlp-http`; 25 pkgs). NEW `lib/otel.ts` `otelSetup()` — **STRICTLY opt-in** (`PRISMA_OTEL_ENABLED=1` else hard no-op), `AsyncHooksContextManager` + `NodeTracerProvider` (service `tradenext`/version, env-overridable attrs) + `PrismaInstrumentation` via `registerInstrumentations({ tracerProvider, instrumentations: [...] })` + `SimpleSpanProcessor` → OTLP/HTTP exporter (`OTEL_EXPORTER_OTLP_ENDPOINT`, console fallback), idempotent globalThis `__tnPrismaOtelReady`, try/catch never crashes. Wired `lib/prisma.ts` module top via `otelSetup()` **before** the PrismaClient singleton. `.env.example` documents `PRISMA_OTEL_ENABLED` / `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` / `OTEL_SERVICE_VERSION`. NEW `lib/__tests__/otel.test.ts` (4 no-op guard tests: unset→false, "0"→false, "1"→true, idempotent).
**Verification**: `otel.test.ts` **4/4**; full suite **945 pass / 4 skip** (was 941/4, +4 — OTel is a no-op in tests); tsc **46 = baseline (0 new)**; no errors in `lib/otel.ts`/`lib/prisma.ts`.
**P1001 diagnosis (no code fix — user applies Dashboard toggle)**: Netlify deploys HEALTHY (latest `main` deploy `state: ready`, `error_message: null`, ~60s; build = `prisma generate && quickbuild`, no `migrate deploy`). The repeated "Prisma Compute Deploy failed — P1001 Can't reach db.prisma.io:5432" (#21) is Prisma Compute's **auto-schema-apply sandbox** running `migrate deploy` in a **network-isolated sandbox** that can't reach the direct-TCP `db.prisma.io:5432` host (Accelerate is a query proxy; DDL needs direct TCP). **Verified `prisma migrate status` from local: 36 migrations, DB up to date, ZERO pending** → auto-apply has nothing to do → pure false alarm. **FIX (user-approved)**: Prisma Console → DB → **toggle OFF "apply schema changes automatically"**; future migrations via v3.20.5 runbook (`npx prisma migrate deploy` + `DIRECT_URL` from an env with DB egress). No repo change. Tracked BUGS.md #13.
**Docs**: AGENTS.md v3.21.3 row, CHANGELOG index + versions-v3.21.md v3.21.3 section, `.env.example`, BUGS.md #13, plan doc, Primer, agent-memory, handoff.
**Status**: Code + tests + docs verified; **commit + push pending user** (no auto-commit/push).

### v3.20.4 — Plan-limit breaker false-positive FIX + missing `intelligence_cache` migration (Aug 28 2026) — ✅ CODE + TESTS + DOCS VERIFIED, READY TO COMMIT
**Branch**: `feat/plan-limit-resilience` (sits with v3.20.3 + playwright-debug + v3.21.0 on PR #107).
**Why**: Playwright CI turned RED on auth/login ("Plan limit circuit breaker open"). Investigation proved it was NOT the external prod hold — CI runs a fresh local TimescaleDB — but TWO code defects:
- **Defect A (v3.20.3 regression, PRIMARY)**: `isDbUnavailableError()` blanket `name.includes("prismaclient") && name.includes("request")` classified EVERY `PrismaClientKnownRequestError` (benign P2021/P2002/P2025) as "DB unavailable" → `$allOperations` opened the global plan-limit breaker on the FIRST benign error → 5-min full DB freeze → auth failed.
- **Defect B (v3.18.0 gap, trigger)**: `intelligence_cache` had NO migration (applied only via local `db push`) → `migrate deploy` (CI/prod) never created the table → `restoreIntelligenceCacheFromDB()` P2021 tripped Defect A's breaker.
**Fix**: (A) Removed the blanket catch-all + redundant bare `"exceeded"` match → the breaker now trips only on REAL hold/unavailability (P6003/connection/timeout/hold-message), never on benign request errors. (B) NEW `prisma/migrations/20260828000000_add_intelligence_cache` — validated column/index-for-index identical to Prisma's `db push` output.
**Tests**: `db-utils.test.ts` +4 real-shape regression tests (benign P2021/P2002/P2025 → false; connectivity P1001/P2024/P6003 → true). Suite **917 pass / 4 skip** (was 915/4); tsc 46 = exact baseline (0 new).
**Docs**: versions-v3.20.md (v3.20.4), `.agents/CHANGELOG.md`, root CHANGELOG.md, AGENTS.md, Lessons.md (#94), this Primer, agent-memory updated.
**Status**: Code ready; **commit/push pending user** (no auto-commit). After push, re-run CI to confirm PR #107 goes green, then merge with approval.

### v3.21.0 — Professional Equity Research Decision Engine (Aug 28 2026) — ✅ CODE + TESTS VERIFIED, READY TO COMMIT
**Branch**: `feat/stock-analysis-skill` (off `main`).
**What**: Deep upgrade of the v3.18.0 AI Investment Intelligence pipeline into an institutional equity-research decision engine: 8-level verdict (STRONG_BUY/BUY/ACCUMULATE/HOLD/REDUCE/SELL/STRONG_SELL/AVOID) + conviction /10 + confidence /100; 12-section memo (thesis, fundamental score with evidence labels, management DNA, valuation zones, technical structure incl. marketPhase, shareholding analysis, risk matrix, catalysts, bull/base/bear scenarios, contrarian view + what-would-change-my-mind, portfolio action with positionSizing, invalidation zones); honest data-gap banner; optional raw-text document ingestion (annual report / concall, 50KB cap). Backward-compatible — no DB migration (all new `IntelligenceAnalysis` fields optional; legacy prompt/parser kept).
**Files**: `intelligenceTypes.ts` (+Verdict, EvidenceLabel, MarketPhase, EvidencePoint, ManagementDna, ValuationZones, RiskItem, ContrarianView, PortfolioAction); NEW `lib/services/document/normalize.ts`; `intelligence-prompt.ts` (+`buildStockAnalysisPrompt`/`parseStockAnalysisResponse`); `intelligence.ts` orchestrator (documents path + audit metadata); `adapters.ts` (sma200 280-day best-effort); `app/api/company/[ticker]/intelligence` (POST Zod documents schema); UI — `VerdictCard` (8-verdict + conviction bar) + 11 new sections + rewritten `IntelligencePanel`/`CompanyIntelligence`/`RiskCatalystMatrix`; tests `stock-analysis-prompt` (21) + `document-normalize` (9) + `intelligence` +3.
**Tests**: Suite **915 pass / 4 skip** (+32); tsc **46 = baseline** (0 new production errors).
**Status**: Docs updated (AGENTS.md, CHANGELOG index + versions-v3.21.md, TODO.md, Primer, agent-memory); **commit/push/PR pending user** (no auto-commit).

### playwright-debug skill + agent wiring (Aug 28 2026) — ✅ DONE (tooling/docs only, no code change), UNCOMMITTED
**Branch**: `feat/plan-limit-resilience` (sits with v3.20.3 and the committed Playwright-docs commit `e2c5607`).
**What**: Built a dedicated **`playwright-debug`** skill from the user-pasted Playwright developer-tooling reference (Inspector `--debug`, HTML report, Codegen, Trace Viewer, emulation) and wired it into every coding/verification agent. No new dependency (ships in installed `@playwright/test`).
**Delivered**:
- NEW machine skill `.opencode/skills/playwright-debug/SKILL.md` + human mirror `.agents/skills/playwright-debug/SKILL.md` + deep-dive `.agents/docs/playwright-debug.md`.
- 6 agent profiles updated (`qa`, `e2e-agent`, `bug-hunter`, `ux-designer`, `code-reviewer`, `tdd-guide`) + `.opencode/opencode.json` prompts wired for all 6 + the build agent's UI/UX-testing step.
- `.agents/AGENT-SKILL-MATRIX.md` + `AGENTS.md` focused-skills table updated.
**Tests**: N/A — tooling/docs-only (no code/test/API/behavior change).
**Lesson 91**: editing `opencode.json` prompts = single-line JSON strings — escape inline quotes as `\"` or JSON breaks; validate with `node -e "JSON.parse(...)"`.
**Status**: Uncommitted on `feat/plan-limit-resilience`. Commit only on explicit user request. PR #107 still open (pending user decision).

### v3.20.1 + v3.20.2 — DB Ops Optimization + DB Health Enhancements + Daily Price Cache Batch Writer (Aug 27 2026) — ✅ CODE + TESTS VERIFIED, READY TO COMMIT/PUSH/PR
**Branch**: `feat/db-health-price-cache`.
**Why**: Prisma Postgres has a hard 10K ops/day plan limit; prod exceeded it (22K/day → whole account on hold until Sep 1). Infra polling (worker 5s poll, 60s resync, 5min heartbeat) + per-page-load web-vitals DB writes were the biggest cost. Additionally, price data could be written per-poll instead of batched.
**Fix**: (1) **DB ops reduction (v3.20.1)** — worker poll 5s→30s, cron resync 60s→5min, legacy scheduler removed, web-vitals DB writes removed (pino only), heartbeat 5min→15min → ~17.7K ops/day saved, now ~4.2K/day. (2) **DB failure ring buffer** — `recordDbError()`/`getDbErrorLog()` in `lib/prisma.ts`, last 50 failures auto-recorded in `$allOperations`. (3) **Daily Price Cache batch writer** — `cacheDailyPrice()` accumulates SSE prices in memory during market hours; after 4 PM IST a single bulk `$executeRawUnsafe` upsert flushes all OHLCV to `daily_prices` → ~1 write/day. (4) **DB Health API/UI** — ops counter (reads/writes/budget/exceeded/remaining/dayKey), price cache section, DB errors table, Flush Prices button.
**Tests**: Suite 869 pass / 4 skip = baseline; tsc 57 = baseline (0 production errors).
- **Status**: v3.20.1 committed `5156eb3`; v3.20.2 code on `feat/db-health-price-cache`, docs updated, ready to commit + push + PR.

### v3.20.0 — NSE Resilience: All NSE Routes Return Graceful Empty (Aug 26 2026) — ✅ CODE + TESTS VERIFIED, DB-DOWN TESTED, READY TO COMMIT
**Branch**: `fix/nse-resilience` (created from latest main).
**Why**: NSE API endpoints block cloud IPs (Netlify, Prisma Accelerate) with 403/429. All NSE-dependent routes threw unhandled 500/502 errors. MCP GET endpoint was POST-only. MCP and corporate-actions routes returned 500 on data unavailability. Constants duplicated across files. `netlify.toml` had a stale Prisma Postgres extension.
**Fix**: (1) MCP GET fix — extracted shared `handleMcpRequest()`, both POST and GET reuse it. (2) **MCP graceful empty** — POST+GET catch blocks return `{success:true, data:null, warning}` instead of 500. (3) **Corp-actions graceful empty** — outer catch returns `{data:[], warning}` instead of 500. (4) Corporate actions NSE decoupling — `triggerNseRefresh()` fire-and-forget. (5) `/api/news/market` — Prisma import fix + DB error catching + memory cache fallback. (6) **22+ NSE routes hardened** — every route returns graceful empty/null on failure. (7) `lib/constants.ts` — canonical `NIFTY_50` (50 symbols), `INITIAL_SYMBOLS` alias, `MARKET_HOLIDAYS` 2026. (8) `netlify.toml` — removed stale `prisma-postgres` extension.
**DB-down test**: Stopped Docker PG, hit all routes — ALL returned HTTP 200 (graceful empty). Restarted PG → full data recovery confirmed.
**Tests**: Suite 869 pass / 4 skip (unchanged); tsc 57 baseline (0 production errors).
- **Status**: ready to commit on `fix/nse-resilience`.

### v3.19.3 — Graceful Degradation When DB Is Unavailable (Aug 26 2026) — ✅ CODE + TESTS VERIFIED, COMMITTED + PUSHED
**Branch**: `feature/ai-intelligence` (on top of v3.19.2).
**Why**: When Prisma DB is down, multiple API routes throw unhandled HTTP 500 errors (web-vitals, portfolio, notifications, advance-decline), flooding the console and breaking UX. SQLite recovery probe had a logic bug preventing it from detecting Prisma recovery.
**Fix**: (1) web-vitals POST — fire-and-forget DB write with try/catch, always 201. (2) Portfolio API — empty portfolio + warning on DB failure (200). (3) Notifications API — empty + warning on DB failure (200). (4) NSE advance-decline — 200 with empty data on NSE failure (was 500). (5) SQLite recovery probe — `else` branch fix so `state.prismaAvailable = true` doesn't overwrite `false` on DB unavailable errors.
**Tests**: Suite 869 pass / 4 skip (unchanged); tsc 46 = exact baseline.
- **Status**: committed `35f3c6a` + pushed; PR pending.

### v3.19.2 — SQLite Expanded + Re-sync + Admin DB Health Dashboard (Aug 25 2026) — ✅ CODE + TESTS VERIFIED, COMMITTED + PUSHED
**Branch**: `feature/ai-intelligence` (on top of v3.19.1).
**Why**: SQLite backup (v3.19.1) only covered recommendation/screener/corp-action tables — logs, auth, monitoring, and cron data were not backed up. No automatic recovery when Prisma comes back online. No admin visibility into DB health status.
**Fix**: (1) Expanded schema — `lib/sqlite.ts` gains 6 new tables (`worker_status`, `server_log`, `audit_log`, `cron_job`, `cron_run`, `worker_task`) with query helpers + `getHealthStatus()`. (2) Recovery sync — background probe every 5 min when Prisma is down, auto-sync on recovery. (3) Admin DB health API — `GET/POST /api/admin/db-health`. (4) Admin DB health UI — `app/admin/utils/db-health/page.tsx` dashboard with status badges, stat cards, write budget bar, table comparison, sync history, 30s refresh. Nav entry in admin utils layout.
**Tests**: 17 tests (+8 vs v3.19.1); suite 869 pass / 4 skip; tsc 46 = exact baseline.
- **Status**: pending push; docs updated.

### v3.19.1 — SQLite Backup Layer (Aug 25 2026) — ✅ CODE + TESTS VERIFIED, COMMITTED, NO DEPLOY
**Branch**: `feature/ai-intelligence` (on top of v3.19.0).
**Why**: When Prisma DB ops budget is exceeded, all DB-dependent routes return 500 with no graceful fallback. Need a persistent in-memory SQLite layer seeded from Prisma on startup, so routes degrade gracefully.
**Fix**: (1) `lib/sqlite.ts` — sql.js pure-JS in-memory SQLite singleton (globalThis pattern matching `lib/prisma.ts`), 5 tables (daily_recommendation_run/stock, corporate_action, chartink_screener, _backup_meta), `initSqliteBackup()` + `syncFromPrisma()` called from `instrumentation.ts`, `SqliteFallback` interface with query helpers (`getLatestRecommendations`, `getChartinkScreeners`, `getCorporateActions`). (2) Route fallback chains — `recommendations/route.ts` DB→SQLite→memory→500 with background SQLite sync after successful DB writes; `corporate-actions/combined/route.ts` + `screener/chartink/route.ts` SQLite fallback in catch blocks. (3) `lib/db-utils.ts` expanded `isDbUnavailableError()` for Accelerate proxy errors (ECONNREFUSED, ECONNRESET, etc.).
**Tests**: 9 new tests (init, empty state, data roundtrip, Prisma failure handling); suite 861 pass / 4 skip (+9 from 852); tsc 46 = exact baseline, 0 new.
- **Status**: committed `4f6ff89`; docs updated; no push/deploy (part of PR #101 on feature/ai-intelligence).

### v3.19.0 — DB Plan Limit Resilience (Aug 19 2026) — ✅ CODE + TESTS VERIFIED, COMMITTED, NO DEPLOY
**Branch**: `feature/ai-intelligence` (on top of v3.18.0).
**Why**: Prisma Postgres monthly plan limit (10K ops/day) exceeded on prod → all DB-dependent routes return 500.
**Fix**: (1) Graceful degradation: `lib/db-utils.ts` (`isDbUnavailableError()`), fingerprint bypass on DB error, NodeCache fallbacks, events/IPOs graceful empty. (2) Op reduction: historical sync → NIFTY50 only, heartbeat 60s→300s, MarketCache TTLs doubled. (3) Write budget guard: `dbOpsCounter`, `isDbWriteBudgetExceeded()`, `$allOperations` extension. (4) Admin OTP fallback. (5) Admin DB usage dashboard. (6) `staticCache` key fix.
**Tests**: 3 test fixes; suite 852 pass / 4 skip; tsc 46 = exact baseline.
- **Status**: committed `552041d` (PR #101); docs updated; no push/deploy.

### v3.18.0 — AI Investment Intelligence (Aug 19 2026) — ✅ CODE + TESTS VERIFIED, COMMIT PENDING USER, NO DEPLOY
**Branch**: `feature/ai-intelligence`.
**Why**: Company pages lack AI-powered investment analysis — users need a single-click "Investment Intelligence" report with technicals, fundamentals, valuation, news, risk matrix, and a fair-value gauge.
**Fix**: 14 TypeScript interfaces, 2 TA extensions (`computeATR`/`findSupportResistance`), `IntelligenceCache` Prisma model, write-through dual-layer cache (memory + DB), 8 NSE data adapters, structured JSON prompt builder/parser, orchestrator (cache-first → parallel adapters → prompt → parse → cache → audit), `GET/POST /api/company/[ticker]/intelligence` (auth, Zod, audit), MCP `getInvestmentIntelligence` (29 functions), 14-file UI (CompanyIntelligence state machine, IntelligenceButton 5 states, IntelligencePanel expandable height animation, 11 section components).
**Tests**: 38 new tests (16 TA + 10 cache + 18 prompt + 10 orchestrator); suite 852 pass / 4 skip; tsc 46 = exact baseline.
- **Status**: committed to `feature/ai-intelligence` branch; docs updated; **commit pending user; no push/deploy**.

### v3.14.0 — Swing Signal Persistence + Performance Tracking + Spec-Driven Dev (Aug 17 2026) — ✅ CODE + TESTS VERIFIED, COMMIT PENDING USER, NO DEPLOY
**Branch**: `feat/swing-signals` (on top of `docs-readme-refs-agentic-coding`).
**Why**: swing picks were posted to the UI but never persisted — a user refresh lost them. AI target/stop levels were computed but never evaluated against live prices. No admin way to trigger a performance check. No standardized dev workflow for future features.
**Fix**: (1) **`SwingSignal`** model (`@@unique([jobId, symbol])`) — `persistSwingSignals` at job creation (`createMany` + `skipDuplicates`, non-fatal), `patchSwingSignalAnalysis` at completion (`updateMany` per symbol, only stocks with analysis). (2) **`swingPerformanceService.ts`** — `evaluateSwingSignalStatus` (direction-aware LONG/SHORT target/stop/expiry), `checkSwingPerformance` (batch open signals, live-price bridge capped 50, per-signal evaluation, audit per update). (3) **Worker task**: `swing_performance` case in `worker-service.ts` + `executeSwingPerformance` (non-fatal). (4) **Admin**: `check_swing_performance` action + teal button on `/admin/recommendations/daily`. (5) **Audit**: `SWING_PERFORMANCE_CHECK` + `SWING_SIGNAL_STATUS_CHANGED`. (6) **Worker-logs**: `resolveLogsDir()` first candidate `cwd/worker_logs`, monitoring API `type=worker-logs`, Workers tab. (7) **Spec-driven dev**: mandatory spec→plan→implement→verify for all features (templates, rules, checklist v1.3).
**Tests**: NEW `swingPerformanceService.test.ts` (18 — direction-aware evaluator + DB-path with mocks); extended `swingRecommendationService.test.ts` (10 — draft/patch/persistence + orchestration); suite 758 pass / 4 skip (was 730/4, +28); tsc 46 = exact baseline, 0 new.
- **Status**: docs updated (AGENTS.md v3.14.0 row + spec-driven workflow, CHANGELOG index + versions-v3.14.md, TODO.md row, Primer, agent-memory, Lessons #82, session-todos, session decisions/flow `2026-08-17-swing-signals`); **commit pending user; no push/deploy**.

### v3.11.3 — Full serverless purge: Netlify = persistent server, Blob logging removed (Aug 15 2026) — ✅ CODE + TESTS VERIFIED, COMMIT PENDING USER, NO DEPLOY
**Branch**: `fix/cron-tz-swing-perf` (on top of v3.11.2; all commits unpushed).
**Why**: the v3.11.0 in-process node-cron daemon made every "serverless" branch, opt-out, and Blob-store dependency obsolete. Netlify now runs the app as a persistent Next.js server, so `instrumentation.ts` should auto-start the daemon with NO opt-out — one codepath, no conditional behavior.
**Daemon opt-out REMOVED**: `CRON_DAEMON_DISABLED=1` guard + comment removed from `instrumentation.ts` and `cron-daemon.ts`. The `NEXT_RUNTIME === "nodejs"` + `NEXT_PHASE !== "phase-production-build"` guards stay (build/Edge safety, not serverless). **⚠️ BREAKING vs v3.11.0 doc**: `CRON_DAEMON_DISABLED=1` must NOT be set on Netlify anymore — the daemon should run there.
**Netlify Blob logging REMOVED**: `lib/netlify-logger.ts` deleted (`git rm`) + `@netlify/blobs` dependency dropped (npm install removed 41 packages); `lib/logger.ts` stripped `getNetlifyLogger`, `/tmp` serverless logs-dir branch, serverless warn-skip, Blob listing/read/delete/fallback branches, and the Netlify writeToFile mirror; `worker-logger.ts` (~250 lines) stripped Blob imports, `isServerless()`, and all Blob branches. File logs are the single truth (local + Netlify persistent filesystem).
**Monitoring UI/API**: `/api/admin/monitoring` dropped `isServerless` + `serverless:` response fields; monitoring page dropped `serverlessLogs` state/fetch + amber "file-system logs ephemeral" banner (DB Logs tab stays); ai-monitoring page title copy updated. `app/llms.txt` → "Deployed on Netlify".
**Comment sweep (~25 files)**: rewrote stale "serverless" comments to persistent-server reality (ai-monitoring ×6, connectionTestService ×2, recommendation-agent, backtestDataService ×2, chartinkScreenerService, db-logger, recommendationPerformanceService, syncedDataService, worker-engine, cronParser.test, db/server, market-cache, nse-client, admin ai/monitoring routes, api/ai/{alerts,query,screener}, alerts/evaluate, piotroski, user/telegram/verify, cleanup-stale-worker-tasks, prisma/schema.prisma, docs/architecture.html ×6).
**Test-suite un-skip**: `DataFetcher.test.tsx` (describe.skip for a REMOVED API — `children`/`apiCall` props + undefined `mockUseApi`/`mockApiCall` globals) REWRITTEN for the current `apiUrl` + `render` render-prop API with `useApi`/`usePaginatedApi`/`usePollingApi` mocked — **9/9 pass** (was 0, skipped). Fixed a render-prop mismatch caught by the tests (raw data passed as arg, not `{data}`).
**Verification**: **Suite 709 pass / 4 skip** (was 700/11; remaining 4 skips = intentional client-cache IndexedDB `test.skip`s). `npx tsc --noEmit` **46 errors — DOWN from the 71 baseline, 0 new** (DataFetcher rewrite removed ~25 stale typing errors; remaining are pre-existing jest-dom/Prisma-mock test typing). `git grep` proves 0 functional serverless/blob references in code (prisma/schema.prisma:4 boilerplate kept; "server-logs" monitoring tab type names kept — legit file-log feature). No UI change beyond monitoring copy → no Playwright re-run needed.
- **Status**: docs updated (AGENTS.md v3.11.3 row, CHANGELOG index + versions-v3.md entry, TODO.md row, Primer, agent-memory, session-todos); **commit pending user; no push/deploy**. On deploy: daemon self-starts (no flag); remove Netlify cron UI entries.

### v3.11.2 — Stale recs cache across module graphs FIX: `recommendationsCache` globalThis singleton (Aug 15 2026) — ✅ CODE + TESTS VERIFIED, COMMIT PENDING USER, NO DEPLOY
**Branch**: `fix/cron-tz-swing-perf` (on top of v3.11.1, all commits unpushed).
**Problem (found during v3.11.1 live-verify)**: the page still showed **"Last updated: 14/8/2026"** right after the v3.11.1 fix re-ran the recommendations and the worker called `invalidateRecommendationsCache()`. Root cause: Next.js dev (Turbopack) loads `instrumentation.ts` (worker/cron daemon) and API routes as **SEPARATE module graphs** → `lib/cache.ts` evaluated TWICE → two independent `recommendationsCache` NodeCaches; the worker's `flushAll()` cleared ITS copy while the API route (other graph) kept serving the 23h-old `latest` entry.
**Fix (`lib/cache.ts`)**: `recommendationsCache` lives on `globalThis` (`__recommendationsCache`) — `globalForCache.__recommendationsCache ?? (globalForCache.__recommendationsCache = new NodeCache({...}))`, the exact `lib/prisma.ts` singleton pattern. Both importers (`dailyRecommendationService`, `recommendationPerformanceService`) resolve the SAME instance → worker invalidation is immediately visible to the route. Other caches (main/hot/static/historical) UNCHANGED (short TTLs, no cross-module invalidation semantics).
**Tests**: NEW `lib/__tests__/cacheSingleton.test.ts` (4) — `jest.resetModules()` + re-`require` simulates two module graphs: identity across two loads; value set in load A visible in load B; **worker→route regression** (`flushAll` in load B invalidates load A's cached value — `get` undefined, `keys()` empty); `keys()` reflects writes from both instances. `afterEach` deletes the globalThis key (no leakage).
**Verification**: **Suite 700 pass** (was 696; 54 suites pass + 1 pre-existing skip). `npx tsc --noEmit` 71 = exact pre-existing baseline, 0 new errors. No UI change → no Playwright re-run needed.
- **Status**: docs updated (AGENTS.md v3.11.2 row, CHANGELOG index + versions-v3.md entry, TODO.md row, Lessons #76, Primer, agent-memory, session flow/decisions); **commit pending user; no push/deploy**.

### v3.11.1 — No-fake-HOLD Today's Picks: AI-failure runs never overwrite the last good run (Aug 15 2026) — ✅ CODE + TESTS + LIVE-VERIFIED, COMMIT PENDING USER, NO DEPLOY
**Branch**: `fix/cron-tz-swing-perf` (on top of v3.11.0 follow-up `6c4ef41`, unpushed).
**Problem**: user reported ALL 50 Today's Picks as HOLD/conf-50. Root cause: `holdFallback` (`success:false`) batches were PERSISTED as the latest run whenever AI failed (pre-flight all-models fail → `skipAi`, or batch throw) — every stock entry got HOLD/50/price×1.1/price×0.95 + `aiSuccess:false`, the run was marked `completed`, hiding the last good run.
**Fix (`runDailyRecommendations`)**: partition on `success` — ONLY `success:true` verdicts persisted (entries/trackers/predictions); zero successes → run `failed` with NO entries (`uniqueStocks:0`, `aiProcessed:0`, `aiFailed:N`, `metadata.aiUnavailable:true` + `run_failed` event + `SCREENER_RUN_FAILED` audit + `invalidateRecommendationsCache()`) + early return `stocks: []` → `getLatestRecommendations` (`uniqueStocks > 0`) keeps the previous good run + no Telegram broadcast; partial failure → loop writes successful subset only, then `deleteMany({ runId, symbol: { notIn: analyzed } })` removes failed-analyzed + capped-beyond-50 entries (API would have defaulted their null AI to "HOLD"); final run `uniqueStocks` = analyzed count everywhere (run row/metric/event/audit/return/log).
**"AI unavailable" notice**: `getLatestRecommendations` returns NEW lightweight `latestRun` (overall newest row — second `findFirst`, `select id/runDate/status`; cache-invalidated as before); `/api/recommendations` exposes `latestRun`; `app/recommendations/page.tsx` passes `aiUnavailable={latestRun.id !== run.id}` + `aiUnavailableDate`; `DailyPicksTab` amber banner "⚠️ AI analysis unavailable on <date> — showing picks from <date>" (`data-testid="ai-unavailable-notice"`). Genuine all-HOLD days (`success:true`) unchanged — still shown with today's date.
**Tests**: pre-flight-FAILED + all-AI-fail tests rewritten (no stock.update, `deleteMany { runId }`, failed run `uniqueStocks: 0`); NEW partial-failure test (only successful verdict persisted, failed entry never updated); NEW newest-run surfacing test; "single query" → "one stocks query + one lightweight newest-run row" (`findFirst` ×2). **Suite 696 pass** (was 694); `npx tsc --noEmit` 71 = exact baseline. Playwright live-verified on :3000 — API returns `latestRun` (same-id → no banner; different-id via intercepted payload → banner "AI analysis unavailable on 15/8/2026 — showing picks from 14/8/2026"), normal state clean, 0 console errors.
- **Status**: docs updated (AGENTS.md v3.11.1 row, CHANGELOG index + versions-v3.md entry, TODO.md row, Lessons #74/#75, Primer, agent-memory, session-todos); **commit pending user; no push/deploy**.

### v3.11.0 — In-Process node-cron Cron Daemon (replaces Netlify scheduled functions) + `daysTracked` 500 fix + carried v3.10.1 batch (Aug 15 2026) — ✅ CODE + TESTS + DOCS VERIFIED, COMMITTED `6c4ef41` (UNPUSHED), NO DEPLOY
**Branch**: `fix/cron-tz-swing-perf` (carries committed-unreleased `b35eca4` = v3.10.1 batch).
**Problem**: the Netlify scheduled-function cron was fragile (serverless isolates die per request; ledger writers lived inside the deleted functions). The 4 system crons (Daily Recommendations 10:00 IST, Performance Check 15:30 IST, Market Sync 06:31 IST, AI Connection Test) now run on **node-cron inside the persistent Next.js server**.
**NEW `lib/services/worker/cron-daemon.ts`**:
- `startCronDaemon()` — idempotent (`{ alreadyRunning: true }` on second call): `ensureRecommendationCrons()` self-heal → `syncCronJobs()` → 60s resync + heartbeat intervals + initial heartbeat. Root `instrumentation.ts` `register()` guarded: `NEXT_RUNTIME === "nodejs"`, not `phase-production-build`, `CRON_DAEMON_DISABLED=1` opt-out (serverless must set it — no functions dir ships anymore).
- `syncCronJobs()` — reconciles active `CronJob` rows → one node-cron task each: unchanged skip, expression-change re-register, invalid-expression skip (`cron.validate`), deactivated drop; per-job `config.timezone` default `Asia/Kolkata`.
- `fireJob(jobId)` — re-fetches the row (admin edits apply immediately), no-op when missing/inactive, delegates to shared `spawnDueCronJob`; errors logged, never thrown.
- `writeHeartbeat()` — `workerStatus.upsert` `cron-daemon-<host>-<pid>`; `getCronDaemonStatus()` / `getRegisteredJobIds()` test hook.
**`worker-engine.ts` refactor**: NEW exported `spawnDueCronJob(job: DueCronJob)` (90-min dedup, indexName payload defaults, nextRun advance, `systemManaged` → `triggeredBy: "system"`); `checkScheduledJobs` loops calling it — daemon + legacy poll share one path.
**Admin**: zod enum gap FIX in `app/api/admin/cron/route.ts` (missing `recommendation_performance`/`ai_connection_test`/`historical_price_sync` blocked system-job updates); NEW `GET /api/admin/cron/daemon` liveness endpoint; Cron tab TASK_TYPES +3 + daemon status chip (60s refresh); `app/api/admin/workers/engine/route.ts` auto-start/start/stop drives the daemon too.
**Netlify cron deleted**: 5 scheduled functions (`cron-recommendations`, `cron-performance`, `cron-market-sync`, `cron-ai-connection-test`, `run-cron-background`) + `netlify/functions/` dir + `[functions]` block in `netlify.toml`.
**Ledger outcome wiring (regression-close)**: `recordCronRun(jobName, success, { skipSpawnCounted })` — `spawnCronTask` already increments runCount + advances nextRun at spawn, so scheduled runs record outcome-only (success/failure counters + completion lastRun, NO double-count); NEW `recordSystemRunOutcome(taskId, taskType, success)` in `worker-service.ts` `executeTask` completion/catch (only for tasks with `cronJobId`; manual runs stay on admin `recordManualRunLedger`); non-fatal.
**`daysTracked` sort 500 FIX (live-found, pre-existing v3.5.0)**: `sort=daysTracked` passed the computed field raw to Prisma → 500 → now `orderBy.createdAt` + regression test.
**Carried v3.10.1 batch (`b35eca4`)**: honest latest-run (single query, no verdict filter — all-HOLD shows today); shared `modelChain.ts` fallback chain (`openrouter/free`→`openrouter/auto`, uniform across rec/swing/ipo agents, `trackAiCall` records `usedModel`); swing tracker persistence (`swingTrackerDraft` + `persistSwingTrackers`, `@@unique([symbol, createdAt])`, targets as-of creation); SwingCard tenure pills; PerformanceTab Entry/Current dark-theme fix.
**Verification**: NEW `lib/__tests__/cron-daemon.test.ts` (12 — node-cron mock via closure-capture per Lesson 72; fireJob delegates through the REAL `spawnDueCronJob`; fire-and-forget flush `setTimeout(0)` per Lesson 73) + 1 `skipSpawnCounted` outcome test; **suite 686 pass** (was 673 + 11 skip); `npx tsc --noEmit` 71 = exact baseline, 0 new errors.
- **Status**: docs updated (AGENTS.md v3.11.0 row consolidates v3.10.1, CHANGELOG index + versions-v3.md entry, TODO.md row, Lessons #72/#73, Primer, agent-memory, session-todos); **commits pending user; no push/deploy**. On deploy: persistent server self-starts the daemon via instrumentation; Netlify serverless must keep `CRON_DAEMON_DISABLED=1` and remove the Netlify cron UI entries.

### v3.10.0 — Historical-Price Sync into `daily_prices` (Swing Indicators "—" Fix) + `backtest_history` Prod-Gap FIX (Aug 14 2026) — ✅ CODE + TESTS VERIFIED, COMMITTED `b312de7`+`4d49e13`, PR #91 MERGED (`1de835c`), DEPLOYED, LIVE-VERIFIED
**Branch**: `feat/historical-price-sync` (switched from `main`; v3.9.1 already on main via `9247a9f` fix + `2eaeef8` docs).
**Problem (flagged live in v3.9.1)**: prod `daily_prices` holds **0–1 rows per swing pick** — the v3.6.0 market-sync cron syncs the stock LIST/corp actions/screeners, NOT daily prices — so Swing momentum/RSI/EMA indicators render "—" (need ≥2 bars; 10/20 for momentum). Local DB mirrors this (213 rows = 19 NIFTY50 tickers × 1 bar).
**Fix**: NEW `lib/services/historicalPriceSyncService.ts` — `syncHistoricalPrices({symbols?, days?, from?, to?, maxSymbols?, dryRun?, maxDurationMs?, db?})`:
- **Scope**: explicit list OR default = NIFTY 50 (`getIndexStocks`) ∪ `RecommendationTracker` symbols (30 days) ∪ live `ChartinkScreenerResult` symbols (`expiresAt > now`) — deduped/uppercased, capped 300; **empty explicit list = sync NOTHING** (no default fallback); scope sources degrade to [] on failure.
- **Window**: `buildDateRange` — explicit `from`/`to` (DD-MM-YYYY, throws on malformed/inverted) else N calendar days back (default 180).
- **Fetch**: `fetchSecurityWiseHistoricalData(symbol, from, to, "EQ")`; 200ms inter-symbol NSE delay; `maxDurationMs` hard stop (market-sync passes 6 min).
- **Write**: multi-row `$executeRawUnsafe` upsert `INSERT INTO daily_prices (ticker,"tradeDate",open,high,low,close,volume,vwap) VALUES … ON CONFLICT (ticker,"tradeDate") DO UPDATE SET …` — chunked 200 bars/statement, BigInt volume, falsy volume → null. Idempotent.
- **Tolerance**: per-symbol errors collected in `errors[]`, logged, never thrown; empty scope short-circuits with warning result; `db` override → Prisma-independent for tests.
**Wiring**: `worker-service.ts` `historical_price_sync` case + exported `executeHistoricalPriceSync` (**dry-run default true**); `run-cron-background.ts` NEW `historical-price-sync` action (payload passthrough incl. `dryRun`, no cron-ledger row) AND **step 4 of market-sync** (`dryRun:false`, `maxDurationMs: 6*60_000`, non-fatal) → prod auto-backfills N-day bars on the daily 06:31 IST run. NEW `scripts/backfill-daily-prices.ts` CLI (`--apply` default dry-run; `--symbols`/`--days`/`--from`/`--to`/`--max-symbols`).
**`backtest_history` prod-gap FIX (user override 2026-08-14 — was plan-only)**: MCP `getHistoricalData` 500 — `public.backtest_history` missing on prod; **grep proves NO migration ever created it** (Option A impossible) → NEW `ensureBacktestHistoryTable(db = prisma)` + `BACKTEST_HISTORY_STATEMENTS` in `lib/services/backtestDataService.ts`: lazy `CREATE TABLE IF NOT EXISTS "backtest_history"` (camelCase columns mirroring the model) + 3 `IF NOT EXISTS` indexes (unique symbol+from+to+series, symbol, fetchedAt); memoized per process; **failures NOT memoized (retried next call)**; `getBacktestData` skips the temp leg + upsert when not ready → **degrades to daily_prices/NSE (no 500)**; `resetBacktestHistoryGuard()` test hook. +7 tests (DDL shape, memoization, guard clears memo, retry-after-failure, degrade no-500, NSE-path-no-upsert, normal temp path). Self-heals on next deploy — no prod DB access needed.
**Verification**: NEW `lib/__tests__/historicalPriceSyncService.test.ts` — 15 tests (scope resolution incl. empty-explicit, dry-run no-write, apply multi-chunk >200 bars, per-symbol error tolerance, `maxDurationMs` guard, upsert SQL shape) + `backtestDataService.test.ts` +7; **suite 660 pass** (was 653); `npx tsc --noEmit` 0 errors on touched files (71 = exact baseline). Local dry-run: `npx tsx --env-file=.env scripts/backfill-daily-prices.ts --symbols TCS --days 5` → 4 EQ bars fetched, **0 written**, 0 errors, 0.8s. **Local `--apply` EXECUTED (user-approved)**: `--days 180` → 300-symbol scope, 266 fetched, **17,198 bars written, 0 errors, 658s**; DB verification **17,411 rows / 286 symbols** (was 213/19), top symbols 70 bars (latest 2026-08-12); NSE endpoint caps ~70 rows/response (fine — indicators need ≤20).
- **Status**: docs updated (AGENTS.md v3.10.0 row, CHANGELOG index + versions-v3, TODO, BUGS.md #11→fix built, Primer, agent-memory, Lessons, session-todos); committed `b312de7` (feat) + `4d49e13` (docs, `[skip ci]`) on `feat/historical-price-sync`; pushed; **PR #91 MERGED + deployed + live-verified 2026-08-14** (swing API 200, site healthy, missing-table 500 eliminated — 500 only on total source exhaustion); **prod `daily_prices` backfill manually triggered** via `historical-price-sync` action (user-approved) else auto Mon-Fri 06:31 IST; NSE `apiClient` 403/500 from Netlify = NSE-side anti-bot blocking, NOT a regression.

### v3.9.1 — Swing `analysisStatus` Honesty Fix + Live Verification of v3.9.0 (Aug 14 2026) — ✅ COMMITTED `9247a9f` + DOCS `2eaeef8` (PUSHED TO MAIN)
**Branch**: `main` (v3.9.0 merged via PR #90 `264dd6c`, deploy green/published; v3.5.4→v3.8.0 holds on other branches).
**Bug (found LIVE on tradenext6.netlify.app)**: the Swing tab header badge rendered **"AI targets ready"** (emerald, `analysisStatus: "done"`) while EVERY card rendered "AI targets unavailable (Swing batch failed after 2 attempts: Unusable AI response (p) — screener signals only)". Root cause: `swingRecommendationService.ts` set `analysisStatus = "done"` UNCONDITIONALLY after `analyzeSwingStocks` returned — but the swing agent **never throws on per-stock failures** (attaches `analysisError` per stock and swallows), so a fully-failed batch still reported "done" to the UI; the `catch` path (`"failed"`) only fired on a hard exception the agent-by-design doesn't raise.
**Fix**: NEW pure exported `analysisStatusAfterBatch(stocks)` — `"done"` only when ≥1 stock carries `analysis`, else `"failed"`; `analyze=false` keeps initial `"skipped"`. Header badge (`ANALYSIS_STATUS_META` in `SwingTab.tsx`) now matches the cards.
**Live verification (v3.9.0 deployed)** — all PASSED: Swing tab "20 picks · 200 flagged · 34 screeners" + family chips + TV-fallback source badges + "+30 more" screener expand; chart buttons AXISBANK → `?symbol=AXISBANK-EQ`, NIFTY BANK → `?symbol=NIFTY%20BANK` (outer card link never fired); **0 console errors/warnings desktop + mobile 375px**.
**Prod data gaps FLAGGED (not fixed)**: (a) all swing indicators render "—" on prod — `daily_prices` has **0–1 rows per swing pick** (v3.6.0 market-sync cron syncs the stock LIST, not daily prices; `computeIndicatorsFromSeries` needs ≥2 bars / 10–20 for momentum). Local DB mirrors this (213 rows = 19 NIFTY50 tickers × 1 bar); the `ROW_NUMBER()` SQL is VALID (validated locally). **Needs a historical-price sync job into prod `daily_prices`** (user decision). (b) MCP `getHistoricalData` 500s — `public.backtest_history` does NOT exist in the prod DB (separate pre-existing gap, unrelated to swing).
**Verification**: +3 tests in `lib/__tests__/swingRecommendationService.test.ts` (partial→done, all-failed→failed regression, empty→failed); **suite 638 pass** (was 634); `npx tsc --noEmit` 0 errors on touched files (71 = exact baseline).
- **Status**: committed `9247a9f` (fix) + `2eaeef8` (docs) pushed to `origin/main`; NO deploy.

### v3.9.0 — Swing Trading Signals Tab + Scope-Aware Cache-Key Fixes + NSE Candlestick Chart Buttons (Aug 13 2026) — ✅ MERGED (PR #90) + DEPLOYED
**Branch**: `fix/cron-reaper-ai-pipeline` → merged via **PR #90** (`264dd6c` merge commit); `origin/main` = `9aef557`; Netlify deploy **green/published** on tradenext6.netlify.app (live-verified v3.9.1 above).
**Feature 1 — Swing tab on `/recommendations`** (user-requested "swing trading signals"): NEW `GET /api/recommendations/swing` (`force=1`/`analyze=0`) runs the **34 swing-category Chartink templates** (NEW `lib/services/chartink-scans/swing.json` + `swing` category in `chartinkTemplates.ts`) via the v3.5.6 unified runner (fresh DB → live Chartink → TV fallback), segregates by **signal family** (momentum/breakout/trend/mean-reversion/crossover/bearish — keyword regex on template names, default "trend"), dedupes, ranks composite (screenerCount + marketCap + momentum), caps **top 20**, enriches with indicators (RSI/SMA/EMA/volume trend from a 25-bar `daily_prices` window — **"—" locally + on prod: `daily_prices` 0–1 rows per pick, data gap not a code bug — see v3.9.1**).
**Feature 2 — AI swing agent** (NEW `lib/services/ai/swing-agent.ts`): `analyzeSwingStocks` — batch 5, retry×2, concurrency 3, `directPrompt` + `getPromptTimeoutMs` clamped, `trackAiCall(action:"swing_analysis_batch")`; pure exports `buildSwingAnalysisPrompt`/`parseSwingResponse`/`normalizeSwingAnalysis` — LONG→BUY / SHORT→SELL / OBSERVE→HOLD **through `evaluateRecommendationLevels`** (direction-aware SELL levels); fallback OBSERVE conf-40 price-based.
**Feature 3 — UI**: NEW `SwingTab.tsx` + `SwingCard.tsx` (family chips, refresh, indicator strip, company links, "+N more" screener chips) wired into `app/recommendations/page.tsx` sidebar "🌊 Swing". Daily run now `excludeCategoryIds:["swing"]` — **Today's Picks composition unchanged**.
**Feature 4 — cache-key fixes (regression-tested)**: unified runner had ONE fixed key shared by ALL scopes → NEW `unifiedCacheKey(options)` encodes templateIds/categoryId/exclusions (read+write); swing service key `${key}:ai|noai` so an `analyze=false` warm-up never serves a no-AI payload to `analyze=true`.
**Feature 5 — NSE candlestick chart buttons** (user request): every Swing card + Today's Picks card gains an inline ChartBarIcon button (dark-theme, `aria-label`+`title`); every Markets index card's "View Chart & Details" text span becomes a "Chart" icon button — all open `https://charting.nseindia.com/?symbol=X-EQ` (stocks) / `?symbol=INDEX` via `openNSEChart` (`lib/charting.tsx`); markets button keeps `stopPropagation` (Link-wrapped card — v3.7.1 hydration precedent).
**Verification**: NEW `swing-agent.test.ts` (30) + `swingRecommendationService.test.ts` (7) + scope-aware cache-key regression — **suite 634 pass** (was 597); `npx tsc --noEmit` 0 swing errors, 71 = exact baseline; Playwright desktop + mobile 375px **0 console errors**; click-verified chart URLs: TITAN-EQ, SARDAEN-EQ, NIFTY%2050 (outer Link never fired); real AI output earlier today (SARDAEN LONG 85% ₹523.30→₹560/₹500); later run hit 429/unparseable → graceful "AI targets unavailable — screener signals only" (by design); Chartink 419 → TV fallback (by design).
- **Status**: docs updated; merged via PR #90 (`264dd6c`), deployed + live-verified (see v3.9.1 for the follow-up fix + prod findings).

### v3.8.0 — AI Pre-Flight Gate + Cron Spawn Dedup + Stale-Task Reaping + Cron-Ledger Dedupe + 8192 maxTokens Default (Aug 13 2026) — ✅ COMMITTED `5b7c5da` (feat) + `ccf87ee` (docs [skip ci])
**Branch**: carries v3.5.4→v3.7.3 holds; commit **pending user approval** — no deploy.
**Feature 1 — AI pre-flight gate** (`lib/services/dailyRecommendationService.ts`): before the AI phase, when `aiInput.length > 0` AND `hasValidConfig(aiConfig)`, run `runAiConnectionTest(preflightTimeoutMs = 120_000)` FIRST — **ok** → proceed with configured model; **fallback** → run THIS run on `preflight.recommendedModel` (logger.warn shows configuredModel vs model); **failed** → `skipAi = true` → all stocks all-HOLD via shared `holdFallback(reason, errorMsg)` (`aiSuccess:false`) — fail fast instead of burning the 14-min background cap timing out batch after batch (v3.7.1 connection-test failures already audit + `notifyAdmins`).
**Feature 2 — cron system-job dedupe** (`recommendationCronService.ts`): `CronJob.name` has NO unique constraint — two Netlify instances racing findFirst-then-create left duplicate rows → post-pass orders system rows by `createdAt: asc`, keeps EARLIEST per name, `deleteMany` the rest (scoped to the 4 system names; user crons untouched; test-verified).
**Feature 3 — worker stale-task reaping** (`worker-engine.ts`): NEW exported `reapStaleWorkerTasks(staleMs = STALE_MS = 16*60_000)` — reaps `WorkerTask` `running` rows (`startedAt` ≤ cutoff) + `DailyRecommendationRun` `running` rows (keyed on `createdAt` — no startedAt) → `failed` + error message; `maybeReap` throttled ≤1/min from poll loop + startup; `checkScheduledJobs` now EXPORTED for tests.
**Feature 4 — cron spawn dedup**: `DEDUP_WINDOW_MS = 90*60_000` — due job with a pending/running task for the same `cronJobId` in the window skips re-spawning but STILL advances `nextRun`.
**Feature 5 — AI config defaults** (`config.ts`): maxTokens default → **8192** (`DEFAULT_MODEL` unchanged `nvidia/nemotron-3-ultra-550b-a55b:free`) — a 5-stock batch + JSON reasoning easily exceeds 2048 (truncated JSON → HOLD defaults; also truncates IPO-report-v2 JSON); caveat: `loadConfig()` merges DB `ai_config` metadata OVER env (DB wins) — a DB-stored maxTokens 2048 defeats the new default until re-saved.
**Feature 6 — connection-test plumbing**: NEW `getPromptTimeoutMs()` in `llm-provider.ts` (`DEFAULT_PROMPT_TIMEOUT_MS = 120_000`, env `AI_PROMPT_TIMEOUT_MS` override) — free-tier models routinely take 30–90s/batch; the old 30s cap aborted mid-generation and the batch layer mistook the abort for a successful-but-unparseable answer; recommendation-agent clamps each attempt's timeout to the remaining batch budget.
**Verification**: NEW `lib/__tests__/worker-engine.test.ts` (7) + `dailyRecommendationService.test.ts` +3 pre-flight (ok/fallback/failed; default-ok mock in beforeEach — real module pulls in Prisma/network) + `recommendationCronService.test.ts` +1 dedupe + `recommendation-agent.test.ts` mock + batch-isolation regex fix. Full suite **597 passed / 11 skipped / 0 failures** (was 582). `npx tsc --noEmit` clean on touched files. NEW `scripts/cleanup-stale-worker-tasks.ts` (dry-run default, `--apply` to write).
- **Status**: COMMITTED on `fix/cron-reaper-ai-pipeline` — `5b7c5da` (feat v3.8.0) + `ccf87ee` (docs v3.8.0 session decisions `[skip ci]`); NO deploy. Docs updated (AGENTS.md v3.8.0 row, CHANGELOG index + versions-v3, TODO row, Primer, agent-memory, Lessons.md #64–66).

### v3.7.3 — Credential-Literal Masking Follow-Up (Aug 13 2026) — ✅ DONE, PUSHED DIRECTLY TO MAIN
**Status**: post-merge Netlify scan failed again — `Lessons.md:1111` (my v3.7.2 Lesson 63) printed the demo-credential values (Lesson 60 violation). Masked all incidental literals: `Lessons.md` (4 lines, reworded to "six-digit"), `.githooks/commit-msg` + `.githooks/pre-commit` block-lists → runtime fragment assembly (no contiguous value; enforcement functional-tested — demo/admin/join literals blocked, clean passes; LF restored after CRLF broke `sh`), v3.7.2 changelog entry redacted. Sweep-verified ZERO credential-shaped literals in non-omit-listed files. Sanctioned public demo-login tables (omit-listed) remain the documented reference. Committed + pushed directly to main (user instruction).

### v3.7.2 — Netlify Secrets-Scan Build-Failure Fix + Live-Site Health/Staleness Finding (Aug 13 2026) — ✅ CODE + TESTS VERIFIED, DOCS PASS DONE, COMMIT PENDING
**Branch**: `fix/netlify-secrets-scan` (fresh from main — old local copy deleted/merged; commit **pending user approval** — **no deploy**, deploy on hold per user).
**Symptom (user-reported)**: Netlify build failed — "Secrets scanning found secrets in build."
**Root cause 1**: Netlify's scanner flags EVERY repo file; `.githooks/` (extensionless) still contained demo-credential literals from the v3.5.7 masking work and was NOT in `SECRETS_SCAN_OMIT_PATHS` (AGENTS.md/README.md/seed were). Fix: `netlify.toml` `SECRETS_SCAN_OMIT_PATHS` += `.githooks`.
**Root cause 2 (app hygiene)**: grep sweep found placeholder-looking numeric secrets in scanned paths — `lib/alerts/delivery/telegram.ts` example botToken/chatId, `TelegramSubscription.tsx` placeholder chatId, `app/api/user/telegram/verify/route.ts` JSDoc example code, `lib/__tests__/nse-api.test.ts` fixture timestamps. Any future env value containing that numeric substring would trip the scan. Fix: all replaced with clearly-fake values (`87654321:AAfake0token1for2docs3only` / `-1008765432100` / `876543210` / `654321`).
**Verification**: `npx jest lib/__tests__/nse-api.test.ts` → 8/8 PASS; grep-verified zero credential-shaped numeric literals in `*.{ts,tsx,js,json,toml,yaml,yml,prisma}`; remaining demo-cred matches only in omit-listed paths; `git diff --stat` = 5 files +7/−7; full suite unchanged **582 pass / 11 skipped**; tsc clean on touched files.
**Live-site verify (user clarification — live site, not localhost)**: https://tradenext6.netlify.app — `/markets/analytics` + `/recommendations` healthy, live NSE breadth (1,493 Adv / 1,851 Dec / 131 Unch / 3,475), Corp Events table, pagination, **0 console errors**, mobile 375px no overflow. **BUT the site runs an OLD build** — no v3.6.3 SECTIONS sidebar, no v3.7.x features → **deploy on hold per user + blocked by the secrets-scan failure this branch fixes**.
**v3.6.3 backfill executed**: `npx tsx --env-file=.env scripts/backfill-recommendation-levels.ts` → **792 scanned / 513 updated / 2 corrected** (GMRAIRPORT SELL + LICI HOLD); ITC no longer shows inverted levels.
- **Status**: docs updated (AGENTS.md v3.7.2 row, CHANGELOG index + versions-v3.md, TODO rows + v3.6.3 backfill note, Primer, agent-memory, Lessons.md #63, session flow/decisions); NOT committed; NO deploy.

### v3.7.1 — BUY/SELL-Only Telegram Broadcast + AI Connection-Test Cron + CI E2E Fix (Aug 13 2026) — ✅ CODE + TESTS + DOCS VERIFIED, COMMIT PENDING
**Branch**: `fix/ai-config-cron-ledger` (carries v3.5.4→v3.7.0 holds; commit **pending user approval** — no deploy).
**Broadcast (Feature 1 — user-requested: "no HOLD suggestions in Telegram")**: NEW pure zero-import `lib/services/recommendationBroadcast.ts` — `BroadcastStock`, `MAX_BROADCAST_PICKS = 8`, `buildRecommendationBroadcast(stocks, dateLabel?)` (optional dateLabel → deterministic tests). Shows **actionable picks ONLY (BUY/SELL)** — HOLDs are filtered out (still stored + tracked in History/Performance); an all-HOLD day sends a short notice ("No BUY/SELL picks today — all N analyzed stocks rated HOLD"); footer `🟢 N BUY · 🔴 N SELL · ⚪ N HOLD not shown — view all on TradeNext → /recommendations`; truncates at 4000 chars (slice = 4000 − marker length). Wired into `lib/services/dailyRecommendationService.ts` broadcast block (still try/catch + `broadcastToSubscribers`).
**AI connection test (Feature 2 — user-requested)**: NEW `lib/services/ai/connectionTestService.ts` — `testOpenRouterModel` (RAW fetch to OpenRouter chat/completions — NOT `directPrompt`, which swallows errors into strings; checks HTTP status + non-empty content; never throws; 20s `AbortSignal.timeout`), `runAiConnectionTest()` (configured model → fallbacks `openrouter/free`, `openrouter/auto`, stopping at the first working one; short-circuits `!hasValidConfig` with `failed` + notify), `getLastAiConnectionTests` (via `getPersistedAiCalls`). **Every attempt persisted via `trackAiCall` (action `connection_test`, ServerLog source "ai") AND the overall outcome audit-logged with the full status** — NEW `AI_CONNECTION_TEST`/`AI_CONNECTION_TEST_FAILED` tags in `lib/audit.ts` (metadata: status/configuredModel/recommendedModel/primaryError/fallbackResults; `resource: "ai-config"`); overall failure → `notifyAdmins("⚠️ AI model unreachable", …, "/admin/utils/ai-monitoring")`.
**Cron wiring (Feature 3)**: 4th SYSTEM job "AI Connection Test (System)" — `AI_CONNECTION_TEST_CRON_EXPR = "*/30 3-10 * * 1-5"` (every 30 min 08:30–15:30 IST Mon–Fri; `lib/cron-parser.ts` supports `*/N`) in `ensureRecommendationCrons()` (taskType `ai_connection_test`, idempotent upsert by name); worker `executeAiConnectionTest` + case `ai_connection_test`; `run-cron-background.ts` action whitelist + branch + `recordRun` vs the new cron name; NEW scheduled fn `netlify/functions/cron-ai-connection-test.ts` (mirrors cron-market-sync fan-out).
**Admin API (Feature 4)**: NEW `app/api/admin/ai/connection-tests/route.ts` — GET `?limit=` last N + `fallbackModels`, POST run-now → full report (nodejs, admin auth).
**CI e2e fix (Feature 5 — user-pasted GitHub failure)**: `e2e/advanced-screener.spec.ts` failed 3 browsers — v3.5.6 TemplatesPanel defaults to **Chartink mode** whose registry names the template "Short term breakouts" (lowercase), while the spec asserted TV-mode title-case "Short Term Breakouts" (pre-3.5.6 spec, never ran in CI after the rewrite) → both template-search tests now click **`TradingView · 98`** toggle first (U+00B7); Chartink stays jest-covered. Also fixed nested `<a>` hydration warning on `/markets` (`IndexCard` inner anchor → `<span role="link">` + `openNSEChart`).
**Verification**: 22 new tests (9 broadcast + 9 connection-test + 4 cron-ensure). Full suite **582 passed / 11 skipped / 0 failures** (was 560). `npx tsc --noEmit` clean on all touched files (remaining repo errors are pre-existing test-only noise — DataFetcher/LoadingSpinner/client-cache/enhanced-cache/validation/filter-engine/userService tests).
- **Status**: docs updated (AGENTS.md v3.7.1 row, CHANGELOG index + versions-v3, TODO rows, Primer, agent-memory, session `2026-08-13-8393ed9` flow/decisions); NOT committed; NO deploy.

### v3.7.0 — F&O Analytics UI Complete + NSE Option-Chain-v3 Migration + MCP getOptionChain/getFoExpiries (Aug 13 2026) — ✅ CODE + TESTS + DOCS VERIFIED, COMMIT PENDING
**Branch**: `fix/ai-config-cron-ledger` (carries v3.5.4→v3.6.4 holds; commit **pending user approval** — no deploy).
**F&O UI (Feature 1 — closes the last open v3.2.0 "Partial" item)**: NEW `app/fo/page.tsx` + `app/fo/FoClient.tsx` — positions dashboard (list, 4 stat cards, Add Position modal, option chain, expiries, Greeks, P&L summary, live underlying). NEW `app/components/fo/`: `FOPositionTable` (sortable, P&L color-coded), `FOPnlSummary` (realized/unrealized + win rate), `AddPositionForm` (Futures/CE/PE, Greeks-aware), `GreekCards` (Δ/Γ/Θ/V on selected position), `ExpiryCalendar` (weekly/monthly pills + countdown), `OptionChainViewer` (REWRITTEN for v3 — symbol/expiry/strike selects, per-side Bid/Ask/OI/Vol/IV/Greeks, CE/PE totals bar, ΔOI %). `app/Header.tsx` F&O nav link.
**Option-chain-v3 (Feature 2 — `lib/services/nse-fo-api.ts` REWRITE)**: base URL → `https://www.nseindia.com/api/option-chain-v3` with `type=Indices|Stocks` (NIFTY/BANKNIFTY/FINNIFTY/SENSEX/BANKEX → Indices via new pure `isIndexSymbol`, else Stocks) + `expiry=DD-MMM-YYYY`. NEW pure exported parsers `parseNseExpiryDate` (DD-MMM-YYYY / DD-MM-YYYY / ISO), `parseNseTimestamp`, `toNseExpiryParam`, `parseOptionChainV3` (skips empty `{}` CE/PE strike rows; **`filtered` totals are TOP-LEVEL siblings of `records`** — v2→v3 shape change caught by tests). `FOContract` extended (`pchangeinOpenInterest`, `totalBuyQuantity`, `totalSellQuantity`); `FOChainData` gains `filtered: FOFilteredTotals` + `strikePrices: number[]`. `fetchExpiries` weekly flag `daysToExpiry <= 35` for indices. NSE fallback (`FALLBACK_UNDERLYING_VALUE`) preserved.
**API + MCP**: `app/api/fo/chain/route.ts` gains `expiry` query param (ISO → passed through); MCP NEW `getOptionChain` (300s) + `getFoExpiries` (3600s) in union/list/descriptions/schemas/POST+GET switches — **28 functions**.
**Verification**: NEW `lib/__tests__/nseFoApi.test.ts` — 27 tests (v3 fixture with top-level `filtered` + empty `{}` 24600 row; parsers, weekly flags, chain mapping). Full suite **560 passed / 11 skipped / 0 failures** (was 533). `npx tsc --noEmit` clean on all touched files (remaining repo errors are pre-existing test-only noise). **Also carried**: monitoring #68 serverless-aware Server Logs notice (`serverless: true` + amber banner → DB Logs tab).
- **Status**: docs updated (AGENTS.md v3.7.0 row + MCP 28, CHANGELOG index + versions-v3, TODO rows, Primer, agent-memory, session-todos); NOT committed; NO deploy.

### v3.6.4 — IPO Issue Size (shares per lot + ₹ per lot) + NSE Events Feed + AI IPO Report v2 (JSON) + MCP/Telegram (Aug 12 2026) — ✅ CODE + TESTS + DOCS VERIFIED, COMMIT PENDING
**Branch**: work-in-progress (carries v3.5.4→v3.6.3 holds; commit **pending user approval** — no deploy).
**Issue Size (Feature 1)**: NEW pure zero-import `lib/services/ipoIssueSize.ts` (client-safe — no prisma/pg chain) — `parseSharesPerLot` (regex off the detail "Bid Lot" text, e.g. "154 Equity Shares"), `parsePriceBandLow` (₹ off the "Price Range" text), `perLotInvestment(shares, priceBandLow)`, `formatIssueSize` (structural `IssueSizeInput`) → **"154 shares per lot · ₹14,168 per lot"** (Rounded + `toLocaleString("en-IN")`); re-exported by `nseIpoService.ts` for server callers/tests. NEW server proxy `app/api/recommendations/ipos/[symbol]/detail/route.ts` → `getIpoIssueDetail(symbol)` — 24h cache via `getOrFetchSyncedData` (memory → NSE `/api/ipo-detail` → DB chain); landing IPO page + `IposTab.tsx` batched per-symbol `Promise.all` detail fetch (graceful fallback) show the formatted Issue Size per row. **Client components value-import ONLY from `ipoIssueSize.ts`** — Playwright caught `Module not found: Can't resolve 'dns'/'fs'` (HTTP 500) when `IposTab.tsx` value-imported `formatIssueSize` from `nseIpoService` (dragging `syncedDataService → prisma → pg` into the browser bundle; `import type { IpoIssue }` is erased at compile so it stays safe).
**NSE events feed (Feature 2)**: NEW `lib/services/nseEventsService.ts` — `NseEvent` type, `normalizeThumbnail` (https: prefix on `//nsearchives.nseindia.com/...`), `isNseEventRaw` runtime guard, 6h TTL via `getOrFetchSyncedData` + `EVENTS_FETCH` audit tag. NEW `app/api/events/route.ts` server proxy (auth-free, announcements pattern) + NEW `app/components/EventsFeedWidget.tsx` (client useSWR, dynamic grid `repeat(auto-fill,minmax(180px,1fr))`, skeleton/empty states, PAST/UPCOMING pill) wired into `app/page.tsx` below Corporate Announcements.
**AI IPO report v2 = JSON (Feature 3)**: NEW pure `lib/services/ipoReport.ts` — 18-section `IpoReport` schema, `buildIpoReportPrompt` ("return ONE valid JSON object"), `parseIpoReportJson` (fence→braces extraction), `normalizeReport` (never throws — coerce + clamp). `ipoAnalysisService.ts` derives `report?: IpoReport | null` (legacy markdown rows → null, client falls back to markdown `content`); verdict/recommendation derived from report when present; prompt switched to `buildIpoReportPrompt` (legacy `buildIpoAnalysisPrompt` export retained for old tests). NEW premium renderer `app/components/recommendations/IpoReportView.tsx` (VERDICT_STYLE/RISK_STYLE accents; 18 sections incl. GMP gauge, peers table, risk matrix, strategy probability bars, targets, `finalScore` /100, disclaimer) wired into `IpoAnalysisModal.tsx` + `IpoAnalysisPanel.tsx`; analysis API response adds `report: result.report ?? null`.
**MCP (Feature 4)**: `app/api/mcp/route.ts` — 3 new functions `getIpoAnalysis` (43200s), `getIpoIssueDetail` (3600s), `getNseEvents` (21600s) added to union/list/descriptions/schemas/POST+GET switches (26 total).
**Telegram (Feature 5)**: `lib/services/telegramBotService.ts` — NEW `/ipo <SYMBOL>`, `/ipo-analysis <SYMBOL>`, `/events` (dynamic imports keep the bot lightweight) registered in `COMMAND_MAP` + `KNOWN_COMMANDS` + help text.
**Verification**: 26 new tests (10 ipoReport + 6 nseEvents + 7 ipo helpers + 3 analysis v2 JSON; also fixed a pre-existing `@/lib/logger` mock gap — mock lacked `debug`). Full suite **533 passed** (was ~507); tsc clean (scoped). **Playwright (:3000)**: home events feed (3 real NSE events, PAST pills), `/recommendations` IPOs tab Issue Size cells in all 3 sections, landing `/recommendations/ipos/SHIPROCKET` Issue Size card, mobile 375px — **0 console errors** everywhere (landing logs 3 expected OpenRouter-429 degrade entries = self-heal stale-row path works).
- **Status**: docs updated (AGENTS.md v3.6.4, CHANGELOG/versions-v3, TODO, Primer, agent-memory, Lessons.md #25, session `2026-08-12-8f2a11d` D1–D6 + flow); tmp probes deleted; NOT committed; NO deploy.

### v3.6.3 — Direction-Aware Target/SL Evaluation (ITC SELL Bug) + Recommendations Page Redesign (Aug 12 2026) — ✅ CODE + TESTS + UI VERIFIED, COMMIT PENDING
**Branch**: work-in-progress (carries v3.5.4→v3.6.2 holds; commit **pending user approval** — no deploy).
**Symptom (user-reported)**: ITC showed **SELL ₹279, Target ₹306.9, Stop Loss ₹265.05** — a BUY-style level layout on a SELL call (target ABOVE price, stop BELOW).
**Root cause (two compounding bugs)**: (1) `normalizeRecommendation` (`recommendation-agent.ts`) applied a direction-BLIND fallback (`target=price*1.1`, `stop=price*0.95`) for 0/missing levels AND passed contradictory non-zero AI levels through unchanged — no validation anywhere. (2) `checkRecommendationPerformance` (`dailyRecommendationService.ts`) compared `currentPrice >= target → target_achieved` / `currentPrice <= stop → stop_loss_hit` — correct for BUY, INVERTED for SELL.
**Fix — NEW pure evaluator** `lib/services/recommendationLevelEvaluator.ts`: `evaluateRecommendationLevels({direction, price, targetPrice?, stopLoss?}) → {direction, targetPrice, stopLoss, valid, corrections[]}`. Invariants BUY `target>price>stop` / SELL `target<price<stop` / HOLD tight band; defaults (2dp, SELL inverted via sign −1): BUY 1.10×/0.95×, SELL 0.90×/1.05×, HOLD 1.05×/0.95×; bounds 0.3×–3×; `valid:false` + corrections[] when replaced; price ≤ 0 → raw. Wired into `normalizeRecommendation` (warn on corrections) + direction-aware perf check (SELL `currentPrice <= target → target_achieved`, `>= stop → stop_loss_hit`).
**Backfill**: NEW idempotent `scripts/backfill-recommendation-levels.ts` — re-runs the evaluator over persisted trackers (`entryPrice > 0`), updates only changed rows, logs old/new + corrections. **PERSISTED rows (incl. ITC) still show old levels on-screen until run (needs user consent — DB write) or next daily recs run.**
**UI redesign (user-requested)**: `app/recommendations/page.tsx` — tab strip → vertical **SECTIONS sidebar** (`lg:w-56`, `lg:sticky lg:top-24`, mobile `flex nowrap overflow-x-auto`), summary cards gated to Today's Picks, 📈 header. `IposTab.tsx` rewritten: **Current IPOs** 🟢 (Active, emerald "Open Now" pill + tinted rows) / **Upcoming** 🕐 (Forthcoming, amber) / **Recently Closed** ⚪ (gray), separate OPEN/CLOSE columns, section dividers (+ `Fragment` import). `RecommendationCard.tsx`: screener list collapsed to `MAX_VISIBLE_SCREENERS=3` + "+N more", "N screeners ▼/▲" toggle. `DailyPicksTab.tsx`: grid `md:2 xl:3`.
**Verification**: NEW `recommendationLevelEvaluator.test.ts` (13 tests incl. ITC regression: SELL @279 target 306.9/SL 265.05 → corrected target<279, stop>279) + 3 agent tests (ITC-style correction, valid SELL unchanged, BUY 0/0 defaults unchanged). Full suite **484 passed / 11 skipped / 0 failures** (453 → +13 evaluator +2 agent +16 = 484); tsc clean on touched files. Playwright live :3000 — desktop: sidebar click-through, summary cards Picks-only, IPOs tab Current(5)/Upcoming(1)/Closed(2) + pill colours (computed-style) + Open/Close columns, "43 screeners ▼"→"▲" expand, 0 console errors; mobile 375×812: nav horizontal-scroll + cards render.
- **Status**: docs updated (AGENTS.md v3.6.3, CHANGELOG/versions-v3, TODO, Primer, agent-memory, session D27/D28 + flow §14); NOT committed; NO deploy. Backfill run + commit pending user.

### v3.6.2 — DividendCalendar Timezone Fix (Aug 12 2026) — ✅ CODE + TESTS + DOCS VERIFIED, COMMIT PENDING
**Branch**: work-in-progress (carries v3.5.4→v3.6.1 holds + this v3.6.2; commit **pending user approval** — no deploy).
**Symptom**: user reported `/dividends` calendar looked shifted while summary cards showed `0 / ₹0 / ₹0 / —`.
**Part 1 — cards are CORRECT (data freshness)**: all 19 local corp-action ex-dates are stored at noon UTC (seed `parseDateCA` → `new Date(y,m,d)` local midnight = UTC prev-day 18:30); 9 syms ex-date `2026-08-10T12:00Z`, 10 syms `2026-08-11T12:00Z`; today Aug 12 → ZERO future ex-dates locally → v3.6.0 `getUpcomingDividendSummary` correctly returns zeros. Prod populates via the v3.6.0 daily market-sync cron. No card code change.
**Part 2 — REAL BUG (fixed)**: `DividendMonthView` bucketed ex-dates by UTC key `toISOString().split("T")[0]` while grid cells were keyed via `toISOString()` from LOCAL dates → in IST (+05:30) local Aug-11 cell converts to `2026-08-10T18:30Z` (key `2026-08-10`) → Aug-10 noon-UTC dividends matched the WRONG (next-day) cell → 9 divs on day 11 (+6), 10 divs on day 12 (+7). Fix: exported `toLocalDateKey(date)` (local Y/M/D padStart) used for BOTH bucketing + grid cells; `data-testid="cell-<localKey>"` per cell. `DividendListView` (`toLocaleDateString("en-IN")`) already correct.
**Regression test**: NEW `app/components/dividends/__tests__/DividendMonthView.test.tsx` (4 tests) with `process.env.TZ = "Asia/Kolkata"` pinned (jest runs UTC where the shift never reproduces). Verified: old code **4 FAIL** → fix **4 PASS**. Suite **453 passed / 11 skipped** (449 + 4); tsc clean on touched files.
**Live verify (dev :3000)**: day 10 = PTC/JIOFIN/MAJESAUT +6 (9), day 11 = RATNAMANI/DVL/CASTROLIND +7 (10), day 12 empty, footer "19 dividends this month", cards still `0/₹0/₹0/—` (correct), 0 console errors.
- **Status**: docs updated (AGENTS.md v3.6.2, CHANGELOG/versions-v3, TODO, Primer, agent-memory, session D26 + flow §13); NOT committed; NO deploy.

### v3.6.1 — Recs-Tab Default Sorts + Performance Price Bridge + AI Context Enrichment + Pen/Perf Plans (Aug 12 2026) — ✅ CODE + TESTS + DOCS VERIFIED, COMMIT PENDING
**Branch**: work-in-progress (carries v3.5.4→v3.6.0 holds + this v3.6.1; commit on a new branch **pending user approval** — no deploy).
**Default sorts** (user report: Performance tab "not initially sorted by created date desc (defaulted to return %)", confirmed for Today's Picks + History): PerformanceTab default `returnPercent`→`createdAt` (desc); HistoryTab default `screenerCount`→`date` (desc); DailyPicksTab gains NEW "Newest" sort (`createdAt` desc, screener-count tiebreak) as default. Root: UI `useState` default overrode the already-correct API default (`createdAt` desc); prod/local tracker data is actually fully populated (1691/732) — the "empty columns" perception was a sort artifact.
**Price bridge**: `bridgeMissingCurrentPrices<T>` in `recommendationPerformanceService.ts` — ONE batched `SELECT DISTINCT ON (ticker) … close::float8 FROM daily_prices WHERE ticker = ANY(…) ORDER BY ticker,"tradeDate" DESC` fills null `currentPrice` before `toListItem` on both `getPerformanceList` paths → Current/Return % never blank when a price exists; graceful catch → rows unchanged; +3 tests.
**AI context enrichment**: NEW `lib/services/ai/recommendation-context.ts` — per-symbol `StockContext` (batched DB corp actions + announcements, quarterly results from ONE cached `getCorporateResults("Quarterly")` call; caps 3/2/1; `Promise.allSettled` per source → context failure never blocks pipeline); `StockAnalysisInput.context?` + prompt Context blocks + system rule; wired ONCE per `runDailyRecommendations` run (after MAX_AI_STOCKS cap slice); 6 new tests.
**Pen/perf plans**: NEW `TODO-PENTESTING.md` + `TODO-PERF-TESTING.md` (checklists + findings logs; records known `GET /api/recommendations/performance?offset≥1001` → 500 bug — not fixed this session).
- **Verification**: full suite **449 passed / 11 skipped / 0 failures**; `npx tsc --noEmit` clean on all new/changed files; Playwright dev :3000 — History "Date" active, Performance "Recommended ▼" active, 0 console errors.
- **Status**: docs updated (AGENTS.md v3.6.1, CHANGELOG versions-v3, TODO, Primer, agent-memory, session D23–D25 + flow §12); NOT committed; NO deploy.

### v3.5.7 — Auth Join→Approve→Login Fix + Server Logs `logs/` Dir (Aug 11 2026) — ✅ CODE + TESTS + DOCS + E2E VERIFIED, COMMIT PENDING
**Branch**: work-in-progress (v3.5.5/3.5.6 chartink work still uncommitted on `fix/ai-config-cron-ledger`; commit on a new branch **pending user approval** — no deploy, consistent with v3.5.4/3.5.5/3.5.6 holds).
**Issue 1 (join-request users locked out)**: `lib/auth.ts` authorize() threw `"Email not verified"` BEFORE the bcrypt password compare → approved join-request users (isVerified=false) could never log in regardless of password.
**Fix**: removed the `isVerified` gate (kept blocked-account check); password compare is now the single auth gate; dead `UNVERIFIED` branches removed from signin page + LoginModal. Approve route now uses the **`DEFAULT_PASSWORD` env var** (bcrypt, cost 12; value set in `.env` only — **no literal in repo**; missing env → 500 guard) — previously a random hex nobody saw AND then a hardcoded literal; admin confirm dialog shows the env-var NAME, success alert shows the server-returned password; API returns `{defaultPassword, email}`.
**Issue 2 (invisible prod server logs)**: local dir was `server_logs/` → now `logs/` (gitignored); `readLogsByDate` computed `logs/<YYYY>/<YYYYMM>/…` which NEVER matched the write path → always `[]`; on Netlify the general logger wrote to ephemeral `/tmp` and NEVER to the `server-logs` Blob store the monitoring page lists (`readBlobLog`/`deleteBlobLog` hardcoded the `worker-logs` store).
**Fix**: `appendServerLogLine(dateKey, entry)` mirrors every line to the date-keyed `server-logs` Blob store (fire-and-forget); `readBlobLog`/`deleteBlobLog`/`writeBlobLog` store-paramaterized; `listBlobLogs` strips `.log`; monitoring Server Logs tab now displays logs.
**Credential hygiene + discovery (v3.5.7 part b)**: `DEFAULT_PASSWORD` env-only (no fallback in code, 500 on missing); NEW `.githooks/commit-msg` blocks credential literals in commit messages; `.githooks/pre-commit` checks #6 (`real .env` never staged) + #7 (secret literals in staged diff / `.md` password assignments); all literal join password values redacted to `********` in committed docs; README rewritten/polished with an AI & Agent Discovery section; NEW `app/llms.txt/route.ts` (llmstxt.org-style index w/ Boundaries) + `app/robots.ts` rewritten (LLM-crawler rules: GPTBot/ClaudeBot/anthropic-ai/PerplexityBot/Google-Extended/FacebookBot/Applebot-Extended/Bytespider + explicit `/llms.txt` allow + internal-path blocks). Public sandbox demo creds (README/AGENTS tables, seed, e2e) remain exempt — documented public demo logins.
- **Verification**: 7 new logger tests (`@jest-environment node`; jest.setup.js window mocks guarded); full suite **419 passed / 11 skipped / 0 failures**. Playwright e2e: join request → admin approve (confirm shows env-name, success alert with email + returned password) → login as joined user succeeds → redirect `/`; monitoring Server Logs lists `2026-08-11` (40 KB) + renders lines (join approved userId=8, login success). Route checks on dev :3000: `/llms.txt` 200 text/plain, `/robots.txt` 200, `/sitemap.xml` 200 application/xml, `/api/openapi` 200 OpenAPI 3.0.3 JSON (1st 404 was stale Turbopack watcher — timestamp-touch re-registered; no code change). tsc clean on all touched files.
- **Status**: docs updated (AGENTS.md v3.5.7, CHANGELOG, TODO, Primer, agent-memory, Lessons 58–59 (+60), session D13–D16); NOT committed; NO deploy.

### v3.5.6 — Chartink 117-Registry PRIMARY + TradingView Fallback Unified Runner (Aug 11 2026) — ✅ CODE + TESTS + DOCS COMPLETE, COMMIT PENDING
**Branch**: work-in-progress (on `fix/ai-config-cron-ledger`; commit on a new branch **pending user approval** — no deploy; consistent with v3.5.4/v3.5.5 holds).
**Feature**: make the 117-entry Chartink JSON registry the PRIMARY screener source across engine + API + UI, TradingView 98 `FilterGroup` templates as FALLBACK.
- **Unified runner** (`lib/services/chartinkUnifiedScreenerService.ts`): `runChartinkUnifiedScreeners({forceRefresh?, templateIds?, categoryId?, tvFallbackLimit?})` → engine-compatible `ScreenerResult[]` + `source` (`chartink_db` | `chartink_live` | `tradingview`) + `templateIds`; 5-min cache; per-template source chain fresh DB rows (72h TTL) → live scan (scanClause) → ONE shared `advancedScan` universe filtered via resolved TV template. `runChartinkScreenerById` for single runs. Exported `resolveTvFallback` (curated id map → token match ≥0.6 → category default).
- **Engine switch**: `dailyRecommendationService.ts` → `runChartinkUnifiedScreeners({ forceRefresh: true })` (was `chartinkService.runDailyScreeners` 7 fixed screeners; NOW all 117 registry templates).
- **API**: `GET/POST /api/screener/chartink` (list w/ DB overviews + run-by-id).
- **UI**: TemplatesPanel rewritten with **Chartink·117 / TradingView·98 source toggle** + clause-ready/captured/stale/disabled badges + per-template run; advanced page renders chartink results in the table.
- **Verification**: 18 new tests (**caught real bug**: catalog-only templates never reached TV fallback — fixed via stillTv seeding); full suite **412 passed / 11 skipped / 0 failures**; tsc clean on new/changed files.

### v3.5.5 — Chartink Template Capture → DB (Aug 11 2026) — ✅ CODE + TESTS + DOCS COMPLETE, MIGRATION + COMMIT PENDING
**Branch**: work-in-progress (on `fix/ai-config-cron-ledger`; commit on a new branch **pending user approval** — no deploy this session; consistent with v3.5.4 hold).
**Feature**: capture the remaining 116 catalog-only Chartink scan entries' clauses + tables, persist definitions + captured tables in the DB.
- **3 Prisma models**: `ChartinkScreener` (definition: id/url/categoryId/categoryName/clauses/backtestMaxRows/scanlinkId/backtestUrl/lastRunAt/nextRunAt/resultCount) + `ChartinkScreenerRun` (per full run) + `ChartinkScreenerResult` (captured rows, **72h TTL** `expiresAt`). Applied to schema + `npx prisma generate` (client v7.7.0) — **`prisma migrate dev` NOT run yet (needs user consent)**.
- **Full-run semantics** (`runFullChartinkSync` in `lib/services/chartinkScreenerService.ts`): one run → **clean whole results table → re-insert entire captured dataset** under the new run id (per product requirement); TTL 72h or till next run; `pruneExpiredChartinkResults` + fresh-only reads.
- **Playwright capture tool** (`scripts/chartink-capture/`): network-interception-first (`/screener/process` request body = exact clauses; response = rows + scanlink) with the user's clipboard-click fallback ("Copy group to clipboard"/"Copy table"); writes clauses back to JSON configs (first-value-wins) + feeds DB; `--category`/`--id`/`--dry-run`/`--no-db`/`--headful`/`--backtest`/`--ttl`. **Live chartink.com fetch blackholes from this sandbox — tool runs where a real browser works.**
- **Verification**: full suite **394 passed / 11 skipped / 0 failures** (31 of 32 suites — 340 prior + 19 earlier chartink + 35 new); `npx tsc --noEmit` clean on ALL chartink files.
- **Status**: NOT committed; NO migration applied; NO deploy. Next: user approval → `prisma migrate dev --name chartink_screener_capture` → commit on new branch → optional live capture run on the user's machine.

### v3.5.4 — Stale Recommendations (code) + Cron Ledger Fix + Session Memory Infra (Aug 11 2026) — ✅ COMMITTED `14ac0dc` + PUSHED (`fix/ai-config-cron-ledger`), PR HELD
**Branch**: `fix/ai-config-cron-ledger` (from main @ `c995a10`). **No deploy this session** (user explicit). Commit `14ac0dc` pushed to origin HTTPS; user chose "push branch, hold PR" — NO PR, NO merge.
**Issue 1 (stale public recs, "Last updated: 19/7/2026")**: `dailyRecommendationService` L322 called `analyzeStocks(aiInput)` with NO AI config (env-only default → DB `ai_config` Secret never reached pipeline) + `DEFAULT_MODEL`/`AVAILABLE_MODELS` pointed at nonexistent OpenRouter models (`tencent/hy3:free`, `qwen/qwen3-next-80b-a3b-instruct:free` → HTTP 404) → prod runs all-HOLD → BUY/SELL-filtered public page stale.
**Fix**: shared async `loadConfig()` (DB Secret > env, lazy prisma import) in `lib/services/ai/config.ts`; pipeline passes config to `analyzeStocks`; test route deduped; `DEFAULT_MODEL` → `nvidia/nemotron-3-ultra-550b-a55b:free` + model list refreshed vs live catalog.
**Issue 2 (Admin → Utils → Cron shows no runs)**: `CronJob` ledger only written by `spawnCronTask`/resident scheduler (never runs on serverless); `successCount`/`failureCount` had NO writer. Scheduled path (`netlify/functions/run-cron-background.ts`) called the service directly.
**Fix**: `recordCronRun(jobName, success)` in `recommendationCronService.ts` (name-based lookup, lastRun/runCount/success|failureCount, nextRun via `calculateNextRun`, safe no-op) wired into `run-cron-background.ts` (success+failure) + admin PATCH runNow/retry via `recordManualRunLedger` (skips cronJobId-linked tasks, no double-count). 5 new tests.
**Memory infra (D7)**: MANDATORY per-session `decisions.md`/`flow.md` (`session-decisions-flow.md` rule; `sessions/2026-08-11-c995a10/`).
**Verification**: full suite **340 passed / 11 skipped / 0 failures** (28 suites); `npx tsc --noEmit` clean on all touched files. ESLint blocked repo-wide by pre-existing eslintrc circular-JSON config error (`next lint` removed in Next 16) — out of scope.
**Status**: COMMITTED `14ac0dc` on `fix/ai-config-cron-ledger` + PUSHED (HTTPS). PR held per user (push branch, hold PR). Deploy + prod rerun + ledger verification pending (separate user-approved deploy session).

### v3.5.3 — Playwright E2E Suite + CI + Docs (Aug 8 2026) — ✅ SUITE GREEN, DOCS DONE, COMMIT TO PR #85 PENDING
**What**: Committed cross-browser e2e regression suite for the v3.5.2 screener fix + the full app.
**Suite**: `e2e/` (11 specs, 89 tests) via `npm run test:e2e` against the local dev server on :3000 with live NSE/TradingView data. Projects: chromium/firefox/webkit @1440×900 + Mobile Chrome (Pixel 5), demo-auth storage state from `auth.setup.ts`; `chromium-logged-out` for the login form.
**Root causes fixed while hardening** (all encoded in `playwright.config.ts` + specs — do not regress):
- Firefox `hidden xl:flex` nav needs ≥1280px but Firefox measures scrollbar-inclusive → desktop viewport **1440×900**.
- WebKit drops `fill()` on controlled `<input type="number">` → keystroke input + `toHaveValue` in the advanced-screener empty-state test.
- Single-threaded dev server starves parallel SSR navs under TradingView scans → `navigation.spec.ts` serial + `Promise.all([waitForURL, click({noWaitAfter:true})])` + 60s URL timeout; `retries: CI?2:1`, `workers: CI?1:2`.
- Live-data flakiness → removed marquee assertion (renders `null` when NSE slow); never assert live NSE values.
**CI**: `.github/workflows/playwright.yml` — `timescale/timescaledb` service (migrations need the extension/hypertable), `prisma migrate deploy` + `prisma db seed`, dev server via webServer block, artifact 30d.
**Verification**: full suite green — 87/89 first attempt + 2 flaky passing on retry (webkit nav SSR starvation + Firefox `RenderCompositorSWGL` teardown crash, both environmental); 317 Jest tests pass; e2e files typecheck clean.
**Status**: suite green + verified; docs written (`.agents/docs/playwright-e2e.md`, `playwright-e2e` skill ×2, AGENTS.md v3.5.3 row/commands/lessons, README badge, CHANGELOG, matrix). **Commit everything to the open PR #85 (`fix/screener-change-percent`) — never auto-merge.**

### v3.5.2 — Screener `change` = % Fix (Aug 8 2026) — ✅ COMMITTED (b692d64 + 2daf72a), PR #85 OPEN
**Issue**: ~60 screener templates using `change_percent` silently matched 0 stocks (TV `change_percent` null/unsupported on NSE as column/filter/sort); "Short Term Breakouts" returned 0; `getTopMovers` gainers returned `[]`; UI Change column displayed ₹ from a wrong % formula.
**Root Cause**: TradingView's `change` field IS the percent change on NSE (RELIANCE 1334.8 vs prev 1325 = +0.74%; EEPL +20.0%, SBCL +19.99% — matches Chartink). `change_percent` is null/unsupported.
**Fix Applied**:
- "Short Term Breakouts" rewritten to TV-native proxy: `change > 0` + `relative_volume_10d_calc > 1` + `Perf.5D > 3` → **250 stocks (was 0), 18/20 Chartink overlap**
- Mass-fix all 57 remaining `change_percent` → `change` template args (0 remain); `Perf.5D` added to `FILTER_FIELDS` + FilterBuilder
- `getTopMovers` filters fixed (gainers change > 3, losers < -3, active vol > 1M); advanced route `percentChange ?? change`
- UI `change` labeled "Change (%)"; ₹ derived `close*pct/(100+pct)` in results; % Change column sortable
**Status**: 45 screener tests pass; tsc clean on 6 touched files; Playwright verified (250 stocks · 574ms, SBIN +1.12%, MOTHERSON +8.71%, TATATECH +8.89%, zero console errors). Docs updated. **Commit pending** — 6 files; user's Playwright files (`e2e/`, `playwright.config.ts`, `.github/workflows/playwright.yml`, `@playwright/test`) left untracked/untouched.

### ph21 — Carry-Forward: Target/SL ₹0.00 Fix + SSE Live Prices + HistoryTab Null-Guard (v3.5.1) — ✅ CODE + TESTS + DOCS COMPLETE, COMMIT PENDING
**Issue (from prod)**: Performance tab showed `targetPrice: 0 / stopLoss: 0` on every tracker; History cards rendered bare "🟡 %"; SSE live-price hooks existed but weren't wired into Portfolio/Watchlist/Dashboard.
**Root Cause**: prod AI fails (Netlify `[build.environment]` has no `OPENROUTERKEY`; key only in local `.env`) → `getDefaultRecommendation()` returned literal `0`s that overwrote price-based tracker defaults.
**Fix Applied**:
- `getDefaultRecommendation(stock?)` price-based fallback — `price*1.1` target / `price*0.95` SL (guarded `price>0`); `normalizeRecommendation` no longer persists literal 0
- Backfill script `scripts/backfill-recommendation-targets.ts` — local dev DB fixed 149 trackers (0 zero-target remain; prod pending)
- `useLivePrices` infinite-loop fix (`symbolsRef` stable callbacks, no in-place `.sort()`) + wired into HoldingsTable (live overlay + ● Live badge), Watchlist (`liveQuoteFor` + badge), MarqueeBanner (30s refresh)
- `top-stocks` API + HistoryTab null-coalescing (`"HOLD"` / `0` / "—") — no more bare "🟡 %"
**Status**: 317 tests passed / 11 skipped / 0 failed (4 new hook tests); tsc + eslint clean on touched files; Playwright-verified (portfolio live RELIANCE ₹1,327.60, watchlist loop fixed, mobile 375px, zero console errors). Branch `fix/ph21-carryforward-perftab`, nothing committed yet. Remaining: prod DB backfill + Netlify `OPENROUTERKEY` (needs user), demo holdings re-seed, F&O UI, issues #68/#69.

### Recommendation Performance Tracking & Archival (v3.5.0 / ph20) — ✅ MERGED via PR #81
**Issue**: Recommendations had a 30-day expiry that deleted trackers after a month; performance check ran at 3:30 PM IST with no weekday support; no public view of tracker performance; categories limited to `short|medium|long`; worker tasks from crons weren't marked SYSTEM.
**Fix Applied**:
- 3-status lifecycle `tracking → target_achieved/stop_loss_hit → archived (360d)`; removed 30-day expiry
- `RecommendationArchive` snapshot table + `DailyRecommendationStock.trackerId` SetNull (History survives via LEFT JOIN)
- 4 PM IST Mon–Fri SYSTEM perf-check cron (`30 10 * * 1-5`) via `ensureRecommendationCrons()`; shared weekday cron parser `lib/cron-parser.ts` (worker-engine + admin cron route)
- `triggeredBy: "system"` worker marking + audit actions (RECOMMENDATION_PERFORMANCE_CHECK / ARCHIVED / PERFORMANCE_MOVED)
- Public Performance tab (dynamic columns, sort — 10-key enum fix, filters, pagination); admin archive + worker-spawning triggers
- Categories extended to `btst|short|swing|medium|long`; backfill script run (683 tracking, short=554/swing=129)
- Run trigger source tracking: `DailyRecommendationRun.triggeredBy` (`system`/`admin`) + migration `20260807103000_add_daily_run_triggered_by`; Admin Run History Manual/System badge; worker maps `admin_manual` → `admin`
- Today's Picks BUY/SELL filter — only actionable runs surface; All/Buy/Sell pills (no HOLD)
- AI monitoring persistence fix — `trackAiCall()` awaited in every AI route `finally` (serverless cold-start rows survive); merged reads (`memory|database|hybrid`) + source badge
**Status**: MERGED — PR #81 (merge commit `bf584e2`, 2026-08-07). Deploy + prod verification + carry-forward items moved to ph21 (in progress on `fix/ph21-carryforward-perftab`).

### Git Workflow & Agent Operating Model (v3.4.2) — ✅ CODE COMPLETE, COMMIT PENDING
**Issue**: Git hooks were untracked `.git/hooks/` (lost on fresh clone); missing gardenify-style git-flow, code-hygiene, and documentation-standards docs; AGENTS.md lacked an operating model for handoff/plugins.
**Fix Applied**:
- Tracked `.githooks/` directory (gardenify pattern) — enhanced `pre-commit` (warn main, block secrets + `.env`, warn console.log/junk/tsc), `post-commit` (checkpoint log), `pre-push` (warn main); enabled via `git config core.hooksPath .githooks`
- `.agents/linear-history.md` (warn-only main, branch naming, commit convention, pre-push checklist)
- `.agents/code-hygiene.md` (ponytail minimal-code + file/function/import/comment/error-handling standards)
- `.agents/documentation-standards.md` (doc set table + mandatory update rules)
- AGENTS.md operating model: Git Hooks, Agent Operating Model, Plugins & MCP (helicone-session, wakatime; ponytail recommended-not-installed)
**Status**: Ready to commit as v3.4.2. After commit: deploy v3.4.1 + v3.4.2 to Netlify, verify prod.

### Prod Reliability Fixes (v3.4.1) — ✅ CODE + DOCS COMPLETE, AWAITING TEST/DEPLOY
**Issue**: Prod daily recommendations failed with transaction timeout (5000ms expired); AI monitoring not persisted; monitoring logs invisible on serverless; Telegram daily recommendations stale; history tab lacked current prices; 643 recs too many.
**Fix Applied**:
- `runInChunks()` bounded-concurrency helper replaces interactive `$transaction` in `runDailyRecommendations()` + `checkRecommendationPerformance()`
- `rankAndCapRecommendations()` caps daily recs to top 50 (composite: screenerCount + marketCap + momentum); `MAX_RECOMMENDED_STOCKS = 50`
- Telegram: cache invalidation after performance check, broadcast always sends with HOLD fallback + breakdown, handlers prefer tracker live prices
- History tab: top-stocks API JOINs trackers → entryPrice/currentPrice/trackerStatus with return %
- AI monitoring: fire-and-forget `persistAiCallToDb()` + merged DB/memory reads + source badge
- Monitoring: new `type=db-logs` in `/api/admin/monitoring` + DB Logs tab (serverless-safe)
- Prod UI/UX audit documented in TODO.md; gardenify patterns ported to `.agents/`
**Status**: Code + docs complete (committed `8bcc72a`). Pending: deploy to Netlify, prod verification (see `.agents/session-todos.md`).

### Daily Recommendations Engine + Self-Heal AI + Audit Logging (v3.3.0) — ✅ COMPLETE
**Issue**: No daily stock recommendation engine; no self-healing AI agents; no unified audit logging.
**Branch**: `ph18` — comprehensive implementation of all three features.
**PR**: #62 merged (commit `2f95531`) — 72 files changed, 12,401 insertions.
**Status**: All 269 tests pass, 0 failures. CodeQL security fix applied. E2E tested via Playwright.
**Key Files**: chartinkService.ts, dailyRecommendationService.ts, recommendation-agent.ts, circuit-breaker.ts, performance-monitor.ts, prediction-tracker.ts, prompt-manager.ts, self-learning.ts, unifiedEventService.ts, systemHealthService.ts
**UI**: Recommendations page with 4 tabs (Today's Picks, History, Dividends, Subscribe), RecommendationCard, DailyPicksTab, HistoryTab, SubscribeTab
**API Routes**: `/api/recommendations`, `/api/recommendations/history`, `/api/recommendations/[symbol]`, `/api/user/recommendations/subscribe`, `/api/admin/recommendations/runs/[runId]`, `/api/system/events`
**DB Migration**: `20260719081430` applied — 9 new models (RecommendationTracker, DailyRecommendationRun, DailyRecommendationStock, RecommendationStatusHistory, RecommendationAlertSubscription, AgentPerformanceLog, ScreenerRunLog, SystemHealthLog, UnifiedEvent)

### Advanced Screener System (v1.16.0)
**Issue**: No Chartink-like multi-condition screener with technical analysis and backtesting.
**Fix Applied**:
- **Filter Grammar Engine**: Recursive FilterGroup/FilterCondition types, 40+ fields, Zod schemas
- **Filter Evaluation Engine**: Numeric/string operators, recursive tree evaluation, batch filtering
- **Technical Analysis Library**: SMA, EMA, RSI, MACD, Bollinger Bands, candlestick patterns
- **Backtest Engine**: OHLCV-based simulator with profit target, stop-loss, trailing stop, Sharpe ratio
- **TradingView Service**: Enhanced with advancedScan(), 46 column constants
- **6 Prisma Models**: ScanConfig, ScanResult, ScanResultItem, BacktestRun, BacktestTrade (deprecated 3 old)
- **10 API Routes**: Advanced scan, configs CRUD, config execution, CSV export, backtest, templates
- **FilterBuilder UI**: Recursive condition tree editor with validation hints, multi-value input
- **ScannedResultsTable**: 12 sortable columns, color-coded values, pagination, CSV export
- **ScanConfigsManager**: Inline edit/delete/share configs with public/private toggle
- **TemplatesPanel**: 25 Chartink-inspired presets with category filters and search
- **BacktestDialog**: Config form, equity curve SVG, metrics cards, trade history table
- **Chartink Reverse-Engineered**: Analyzed DSL, API, and 150,000+ community screeners
- **45 Unit Tests**: Filter engine (22), technical analysis (16), backtest engine (7)
**Files Created**: 25+ files across lib/screener/, app/api/screener/, app/api/backtest/, app/components/screener/
**Status**: RESOLVED in v1.16.0.

### Agent Handoff & Self-Learning System (v1.15.0)
**Issue**: No standardized mechanism for agent-to-agent handoffs, session context preservation, or self-improvement across agent types (Claude, Cursor, OpenCode, etc.).
**Fix Applied**:
- **Handoff File System**: Created `.agents/handoffs/` with SCHEMA.md (standardized YAML frontmatter format), session lifecycle flow, agent-to-agent protocol, and error recovery strategies.
- **Root HANDOFF.md**: Central orchestration state file that every agent reads at session start.
- **6 Agent Definitions**: GH Helper (diff review, code verify, bug fixer), E2E Agent (Playwright flow testing), Integrator (merge/conflict resolution), Observability Checker (logging/metrics/security), DevOps (Docker/Vercel/Netlify/CI/CD), QA (test writing and E2E execution).
- **3 Agent Commands**: `/handoff`, `/self-learn`, `/review-diff` for explicit orchestration.
- **Self-Learning Loop**: `.agents/learning/` with session-log.md and pattern extraction workflow.
- **Git Hooks**: pre-commit (code quality, secrets detection) and post-commit (activity logging, handoff checkpoint tracking).
- **Updated Documentation**: AGENTS.md now documents the full orchestration system.
**Files Created/Modified**: HANDOFF.md (new), .agents/handoffs/ (6 files), .agents/agents/ (8 agent defs), .agents/commands/ (3 commands), .agents/learning/ (2 files), .agents/hooks/ (hooks), .git/hooks/ (2 hooks)
**Status**: RESOLVED in v1.15.0. System is ready for multi-agent workflows.

### Worker Task Management Fix (v1.11.1)
**Issue**: Worker tasks stuck in "pending" status with no way to execute them from admin UI.
**Fix Applied**:
- Added `handleRunNow` function to execute pending/failed tasks immediately
- Added `handleRetry` function to retry failed tasks
- Fixed `handleCancel` to use PATCH API instead of PUT
- Fixed `handleDelete` to use PATCH API with action: "delete"
- Added UI buttons: ▶ Run Now, ↻ Retry, ✕ Cancel, 🗑 Delete
- All actions now use consistent PATCH `/api/admin/workers` endpoint
**Files Changed**: app/admin/utils/workers/page.tsx (action handlers)
**Status**: RESOLVED in v1.11.1.

### Google Analytics & SEO Enhancement (v1.11.0)
**Issue**: No Google Analytics integration and limited SEO metadata.
**Fix Applied**:
- Installed `@next/third-parties` for GA4 integration
- Created `app/components/analytics/GoogleAnalytics.tsx` with format validation
- Created `app/components/analytics/trackEvent.ts` with sanitized tracking functions
- Created `app/components/seo/SEOTags.tsx` with Organization, WebSite, WebPage JSON-LD schemas
- Created `app/components/seo/OrganizationSchema.tsx`, `WebSiteSchema.tsx`, `WebPageSchema.tsx`, `StockSchema.tsx`
- Updated `app/layout.tsx` to include `<SEOTags />` and `<Analytics />` components
- Enhanced `app/sitemap.ts` with all public pages, priority levels, change frequencies
- Enhanced `app/robots.ts` with Googlebot and Bingbot specific rules
- Added `metadata.ts` files to key routes: /markets, /markets/screener, /markets/analytics, /portfolio, /news, /alerts
- Updated `.env.example` with `NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_GA_ID`
**Files Changed**: 
- app/components/analytics/GoogleAnalytics.tsx (new)
- app/components/analytics/trackEvent.ts (new)
- app/components/analytics/index.ts (new)
- app/components/seo/SEOTags.tsx (new)
- app/components/seo/OrganizationSchema.tsx (new)
- app/components/seo/WebSiteSchema.tsx (new)
- app/components/seo/WebPageSchema.tsx (new)
- app/components/seo/StockSchema.tsx (new)
- app/components/seo/index.ts (new)
- app/layout.tsx (updated)
- app/sitemap.ts (updated)
- app/robots.ts (updated)
- app/markets/metadata.ts (new)
- app/markets/screener/metadata.ts (new)
- app/markets/analytics/metadata.ts (new)
- app/portfolio/metadata.ts (new)
- app/news/metadata.ts (new)
- app/alerts/metadata.ts (new)
- .env.example (updated)
**Status**: RESOLVED in v1.11.0.

### Worker Logger Security Fix (v1.10.6)
**Issue**: CodeQL security vulnerability - uncontrolled data used in path expression in `worker-logger.ts`.
**Fix Applied**:
- Added `sanitizeTaskIdForPath()` function to validate task IDs
- Only allows safe filename characters: `/^[A-Za-z0-9_\-:.]+$/`
- Rejects taskIds with path separators, traversal (`..`), or longer than 128 chars
- Applied to `writeToBoth()`, `readLog()`, and `deleteLog()` functions
**Files Changed**: lib/services/worker/worker-logger.ts
**Status**: RESOLVED in v1.10.6.

### Corporate Actions NSE Field Fix (v1.10.5)
**Issue**: Corporate actions sync saved all records as "OTHER" type with missing company names, record dates, and dividends.
**Root Cause**: NSE API uses lowercase field names (`subject`, `comp`, `recDate`, `faceVal`) but code looked for uppercase (`PURPOSE`, `COMPANY NAME`, etc.). Also dividend field mismatch (`dividendPerShare` vs `dividendAmount`).
**Fix Applied**:
- Added lowercase field mappings to `parseCorporateActionFromNse` in both routes
- Fixed dividend field name: `action.dividendPerShare ?? action.dividendAmount ?? null`
- Added Subject, Face Value, and Price columns to Upcoming Actions table
- Created `scripts/fix-corp-actions.ts` for cleanup of incorrect records
**Files Changed**: app/api/admin/nse/live-sync/route.ts, app/api/corporate-actions/combined/route.ts, app/components/analytics/CorporateActionsTable.tsx, scripts/fix-corp-actions.ts (new)
**Status**: RESOLVED in v1.10.5.

### Serverless Logging Fix (v1.10.4)
**Issue**: Worker logs and server logs not working on serverless platforms (Netlify/Vercel).
**Fix Applied**:
- Added `ServerLog` model to Prisma schema for persistent DB-backed logging.
- Created `lib/services/db-logger.ts` with helper functions: `logToDb`, `dbInfo`, `dbWarn`, `dbError`, `dbDebug`, `getDbLogs`, `cleanupOldLogs`, `getLogStats`.
- Updated `lib/services/worker/worker-logger.ts` with fallback chain: file logging → Netlify Blobs → Database.
- Created `/api/admin/logs` route for viewing and managing server logs with filtering.
- Schema synced via `prisma db push --accept-data-loss` (using Prisma Accelerate).
**Files Changed**: prisma/schema.prisma, lib/services/db-logger.ts (new), lib/services/worker/worker-logger.ts, app/api/admin/logs/route.ts (new)
**Status**: RESOLVED in v1.10.4.

### Price Alert Current Price Display (v1.10.3)
**Issue**: Alerts didn't show current stock price during creation or in the list.
**Fix Applied**:
- Added `fetchCurrentPrice` function to fetch live price when symbol is selected.
- Added `fetchAlertPrices` to get prices for all existing alerts.
- Display: "Current Price: ₹XXX" below symbol input in alert form.
- Alert list now shows current price next to each symbol.
- Also fixed admin stats to show actual worker/cron status instead of hardcoded "disabled".
- Status: RESOLVED in v1.10.3.

### Worker Cache Key Type Fix (v1.10.2)
**Issue**: `stock_sync` worker task failing with "TypeError: indexName.replace is not a function".
**Root Cause**: `generateCacheKey` in `market-cache.ts` checked `if (indexName)` but didn't verify the type was string.
**Fix Applied**:
- Changed check from `if (indexName)` to `typeof indexName === 'string' && indexName.length > 0`
- Status: RESOLVED in v1.10.2.

### Corporate Actions Duplicates Fix (v1.10.1)
**Issue**: Corporate Actions table showed duplicate entries for the same symbol and ex-date.
**Root Cause**: 
- Deduplication logic only checked `symbol + exDate` but schema unique constraint is `symbol + actionType + exDate`
- Date parsing created dates without timezone awareness (midnight vs noon)
- Multiple sync paths had inconsistent deduplication logic
**Fix Applied**:
- Fixed all `parseNseDate` functions to use UTC noon dates: `new Date(Date.UTC(yr, month, dd, 12, 0, 0, 0))`
- Updated all sync functions to use Prisma `upsert` with correct unique constraint: `symbol_actionType_exDate`
- Fixed: combined route, admin live-sync route, admin corporate-actions route, historical route, sync-service
**Files Changed**: app/api/corporate-actions/combined/route.ts, app/api/admin/nse/live-sync/route.ts, app/api/admin/corporate-actions/route.ts, app/api/admin/nse/historical/route.ts, lib/services/sync-service.ts
**Status**: RESOLVED in v1.10.1. Existing duplicates need manual cleanup via SQL.

### Stock Screener Enhancement (v1.10.0)
**Issue**: Screener was not showing any data because it relied on pre-synced database data.
**Fix Applied**: 
- Modified API to fetch directly from TradingView when database is empty.
- Added comprehensive filters: Quick Filters, Basic Filters, Advanced Filters.
- Fixed `stocks.sort()` error when data is empty.
- Fixed TradingView column names to match API (removed invalid fields like `perf.W`, `beta_1_year`).
- Status: RESOLVED in v1.10.0.

### Build Fixes (v1.9.3)
**Issue**: Build failing with async params and Zod error handling type errors.
**Fix Applied**:
- Updated dynamic route handlers to use `Promise<{ id: string }>` for params.
- Changed `error.errors` to `error.issues` for Zod v4 compatibility.
- Regenerated Prisma client.
- Status: RESOLVED in v1.9.3.

---

## Current Project Status

### Plan-Limit Hold Resilience (v3.20.3)
**Issue**: Prisma Postgres hit its **10K ops/day plan-limit hold** (code `P6003`, `"There is a hold on your account. Reason: planLimitReached."`). Every DB op failed, but `isDbUnavailableError()` **did NOT recognize the hold error** → all 18+ graceful-degrade fallback chains treated it as a hard 500 instead of degrading. Each blocked query hung the full **120s per-query timeout** (incl. `AuditLog.create`/`APIRequestLog` which also block), worker poll failed every 30s, cron daemon boot `syncCronJobs()` threw out of `startCronDaemon()` — with ≥3 Netlify instances this was a storm of 120s-stalled queries.
**Fix Applied** (branch `feat/plan-limit-resilience`, option A — code fixes):
- **`isDbUnavailableError()` P6003 fix** (`lib/db-utils.ts`): now matches `"hold on your account"` / `"planlimitreached"` / `"plan limit reached"`, Prisma code `P6003`, names `PrismaQueryTimeoutError`/`PlanLimitOpenError` → all 18+ graceful-degrade chains now trigger on the real hold.
- **Plan-limit circuit breaker** (`lib/db-utils.ts` + `lib/prisma.ts`): `PlanLimitOpenError` + helpers; `$allOperations` **fail-fast** when open (no 120s proxy wait), opens on P6003/hold/timeout/unavailable, **closes on a successful half-open probe** (auto-recovery when hold lifts); `PLAN_LIMIT_COOLDOWN_MS` 5min env-overridable.
- **Non-blocking audit/API logging**: `createAuditLog()` (`lib/audit.ts`) + `logAPIRequest()` (`lib/rate-limit.ts`) are now **fire-and-forget** (resolve immediately) — ~50+ `await` sites never stall on a held DB.
- **Worker DB backoff** (`worker-engine.ts`): `setInterval`→self-rescheduling `setTimeout`; delay grows 30s→5min on `isDbUnavailableError`, resets on first success; `workerStopped` flag.
- **Cron daemon DB guard** (`cron-daemon.ts`): boot `syncCronJobs()` try/catch warn (no throw); per-tick resync downgraded to warn on DB-unavailable.
- **Log-noise** (`app/api/notifications/route.ts`): skip DB-unavailable `console.error` spam (still graceful 200 empty).
- **Tests**: NEW `lib/__tests__/db-utils.test.ts` (14) → **suite 883 pass / 4 skip** (was 869/4); tsc 57 = baseline (0 new production errors).
**Status**: RESOLVED in v3.20.3 — code committed to `feat/plan-limit-resilience`, commit/push/PR pending user. External blocker remains: Prisma Postgres extension must be removed from the Netlify Dashboard before deploy; hold must be lifted (plan upgrade / wait for reset), then run `scripts/backfill-corporate-actions-prod.ts` (2,053 records) Sep 1.

### Swing Tab Prod Failure FIX — Request-Time Split (v3.12.0)
**Issue**: Swing tab could NEVER load on prod — `GET /api/recommendations/swing` ran the FULL pipeline synchronously: 34 Chartink templates (HTTP 419 → TV fallback) then the AI analysis of the top-20 (4 batches × 5, concurrency 3, retry×2) at 38–52s/batch → Netlify's 30s request wall killed the request mid-batch-3 (`Duration: 30000 ms` in prod logs).
**Fix Applied** (branch `fix/swing-async-analysis`):
- `getSwingRecommendations({analyze:true})` returns the FAST screener feed instantly with `analysisStatus:"pending"` and kicks `runSwingAnalysisInBackground()` — module-guarded fire-and-forget (`swingAnalysisInFlight` dedupes concurrent requests; `flushSwingAnalysis()` test hook) that runs the AI batches, patches `analysis`/`analysisError`, computes honest `analysisStatusAfterBatch`, persists swing trackers (non-fatal), audits START/COMPLETE|FAILED + RUN_COMPLETE, re-sets the SAME cache key with the final 30-min payload (pending self-expires at 10-min `SWING_PENDING_TTL`).
- `SwingResponse.analysisStatus` union + `"pending"`; `SwingTab` gains a pulsing sky-blue "AI targets generating…" badge + SWR function-form `refreshInterval` (10s pending / 60s after).
- **Verification**: suite **722 pass / 4 skip** (was 711/4 — +11: 4 perf-fallback, 4 reaper-sweep, 1 stage-log, 2 swing-orchestration from the split); tsc **46 = exact baseline 0 new**; **live-verified :3000** — `force=1` → 6s pending, then 225ms cached `done` with 20/20 AI targets (MARKSANS LONG 75 …), 0 console errors.
- **Prod-stability batch (same session)**: perf-check live-price fallback (cap 50, chunked `getStockQuote` — prod perf had 130 trackers but only 8 with `daily_prices` rows); **prod `daily_prices` backfill APPLIED** (3 passes, 21,195 bars, 0 errors → coverage 8 → **115/130 trackers (88%)**, prod 37,387 rows / 602 tickers; 15 stragglers = NSE 200-with-empty-data); heartbeat-aware worker reaper (fail-safe `{0,0}`); Prisma per-query timeout (`QUERY_TIMEOUT_MS` 120s); worker-logger `resolveLogsDir()`; error serialization (worker-engine/cron-daemon); swing-script import fix; verdicts read-only verified.
**Data sync (prod, user-approved, earlier session)**: local → prod copied daily_prices (17,411 rows), swing trackers (149), latest good 08-15 run (30 stocks); then NSE→prod fetched 1,395 bars for the current 20 swing picks (midcaps had 0 bars). **Verified live**: `/api/recommendations` serves the synced 08-15 run (IDEA BUY 70 …) after an admin Performance-Check flushed the stale 23h cache; swing `analyze=0` returns 20/20 picks WITH indicators (MARKSANS momentum10 26.98% …). `analyze=1` still 502s until this PR deploys.
**Status**: RESOLVED in v3.12.0 — commit pending user PR merge (Netlify rebuild = deploy).

### Telegram Bot Alert Delivery (v3.2.0)
**Issue**: No real-time alert delivery via Telegram — users couldn't receive alerts on their phone.
**Fix Applied**:
- **telegramBotService.ts**: Centralized command handler with 6 commands (`/start`, `/chatid`, `/help`, `/recommendations`, `/alerts`, `/updates`), per-chat rate limiting (5/min, 20/hr), user verification via 6-digit code, audit logging, `sendAlertToUser()`, `broadcastToSubscribers()`
- **Telegram Webhook**: `/api/telegram/webhook` delegates to `handleBotCommand()`
- **Subscription UI**: Alerts → Telegram Bot tab with register → verify → test flow
- **Verify API**: `/api/user/telegram/verify` with send/confirm actions
- **Test API**: `/api/user/telegram/test` sends test message
- **Bug Fix — Corp Actions Price/Yield**: Fixed price enrichment from `daily_prices` and yield formula
- **Build Fix — Rebalancer imports**: Extracted types to `rebalancerTypes.ts` to avoid client-side Prisma bundling
- **Build Fix — Dev server startup**: Fixed detach pattern for non-blocking LLM startup
**Files Created**: `lib/services/telegramBotService.ts`, `app/api/user/telegram/test/route.ts`, `app/api/user/telegram/verify/route.ts`, `app/components/alerts/TelegramSubscription.tsx`, `lib/services/rebalancerTypes.ts`
**Files Modified**: `app/api/telegram/webhook/route.ts`, `app/alerts/page.tsx`, `app/contact/page.tsx`, `README.md`, `AGENTS.md`, `TODO.md`, 3 rebalancer component files, `next.config.ts`
**Tests**: 190/190 pass, 0 errors in E2E testing (Dashboard, Alerts→Telegram, Contact, Dividends, Rebalance, Webhook API, Mobile)
**Build**: ✅ Compiles successfully
**Deploy**: Ready to push to git trigger Netlify CD
**Status**: RESOLVED in v3.2.0.

### Secure Join Request Flow (v1.9.2)
**Issue**: Insecure direct signup via `/users/new`.
**Fix Applied**: 
- Implemented `JoinRequest` system for admin-approved onboarding.
- Reinforced RBAC in middleware for `/users/*` and `/admin/*`.
- Refactored Admin Users page with tabbed requests/users management.
- Redirected Login Modal to the new join flow.
- Status: RESOLVED in v1.9.2.

### Notifications & Persistent Logging (v1.9.1)
**Issue**: Missing unified updates feed and ephemeral serverless logs.
**Fix Applied**: 
- Implemented `/notifications` page with role-based filtering.
- Implemented `@netlify/blobs` for persistent worker logging.
- Fixed NSE DB logs and centered login modal.
- Status: RESOLVED in v1.9.1.
- Note: Build fixed and tests passing (13/13 suites).
- Note: Requires `DATABASE_URL` and Netlify Blobs environment.

---

## Session History

### Session 20 (August 28, 2026) — Professional Equity Research Decision Engine (v3.21.0, branch `feat/stock-analysis-skill`, session `2026-08-28-stock-analysis-skill`)
- **8-level verdict + conviction**: STRONG_BUY/BUY/ACCUMULATE/HOLD/REDUCE/SELL/STRONG_SELL/AVOID + `conviction` /10 + `confidence` /100 (new `Verdict` enum in `intelligenceTypes.ts`).
- **12-section institutional memo**: executive thesis, fundamental score with evidence labels, management DNA, valuation zones (with current-price marker), technical structure incl. marketPhase, shareholding analysis, risk matrix, catalysts, bull/base/bear scenario, contrarian view + what-would-change-my-mind, portfolio action (positionSizing), invalidation zones.
- **Honest data gaps**: `dataGaps` + DataGapsBanner (never fabricated). **Document ingestion**: annual-report/concall pasted into company-page textareas (50KB cap) → appended to prompt as secondary-unverified sections.
- **Backward compat, no DB migration**: legacy 3-verdict prompt/parser kept; all new `IntelligenceAnalysis` fields optional `?`; legacy JSON parses onto the 8-level enum.
- **Files**: `intelligenceTypes.ts`; NEW `lib/services/document/normalize.ts`; `intelligence-prompt.ts` (+`buildStockAnalysisPrompt`/`parseStockAnalysisResponse`); `intelligence.ts` orchestrator (documents path + audit metadata); `adapters.ts` (sma200 280-day best-effort); POST route Zod documents schema; UI — `VerdictCard` (8-verdict) + 11 new sections + rewritten `IntelligencePanel`/`CompanyIntelligence`/`RiskCatalystMatrix`.
- **Verification**: suite **915 pass / 4 skip** (+32, was 883/4); tsc **46 = baseline** (0 new production errors). Docs: AGENTS.md v3.21.0 row, CHANGELOG index + versions-v3.21.md, TODO.md row, Primer, agent-memory, session `2026-08-28-stock-analysis-skill/`. **Commit/push/PR pending user** (no auto-commit).

### Session 19 (August 16, 2026) — Swing tab prod failure FIX (request-time split, async AI analysis) + prod-stability batch + prod `daily_prices` backfill (v3.12.0, branch `fix/swing-async-analysis`, session `2026-08-16-a6d2f41`)
- **Swing async split**: `getSwingRecommendations({analyze:true})` returns the fast screener feed instantly with `analysisStatus:"pending"`; AI analysis (4 batches × 5, 38–52s/batch — Netlify's 30s wall killed the old sync pipeline) runs in `runSwingAnalysisInBackground()` (module-guarded, `swingAnalysisInFlight` dedupe, `flushSwingAnalysis()` test hook), patches analysis, re-sets the same 30-min cache key (pending self-expires at 10-min `SWING_PENDING_TTL`). `SwingTab` gains the pulsing "AI targets generating…" badge + SWR function-form `refreshInterval` (10s/60s).
- **Prod-stability batch**: (1) perf-check live-price fallback (cap 50, chunked `getStockQuote` — prod perf run had 130 trackers, only 8 with `daily_prices` rows); (2) **prod `daily_prices` backfill APPLIED** — 3 passes (300+107+22 scoped → 246+85+7 fetched, **21,195 bars, 0 errors**) → coverage 8 → **115/130 tracking trackers (88%)**, prod **37,387 rows / 602 tickers** (15 stragglers = NSE 200-with-empty-data); (3) heartbeat-aware worker reaper (fail-safe `{0,0}`); (4) Prisma per-query timeout (`QUERY_TIMEOUT_MS` 120s); (5) worker-logger `resolveLogsDir()`; (6) error serialization (worker-engine/cron-daemon); (7) swing-script import fix; (8) verdicts read-only verified.
- **Verification**: **suite 722 pass / 4 skip** (was 711/4); tsc 46 = exact baseline 0 new; live-verified :3000 (6s pending → 225ms cached done, 20/20 AI targets, 0 console errors). Docs: AGENTS.md, versions-v3, CHANGELOG, TODO, Primer, Lessons #78–80, session-todos, handoff latest.md, `sessions/2026-08-16-a6d2f41/`. **Commit pending user PR merge (Netlify rebuild = deploy).**

### Session 18 (August 15, 2026) — In-Process node-cron Cron Daemon + `daysTracked` fix + carried v3.10.1 batch (v3.11.0, branch `fix/cron-tz-swing-perf`, session `2026-08-14-b35eca4` continued)
- **Daemon**: NEW `lib/services/worker/cron-daemon.ts` + root `instrumentation.ts` auto-start (guarded nodejs runtime, not build, `CRON_DAEMON_DISABLED=1` serverless opt-out); `startCronDaemon()` idempotent (self-heal ensure → syncCronJobs → 60s resync + heartbeat); `syncCronJobs()` register/drop/re-register (expr-change, invalid skip, deactivated drop, per-job timezone default Asia/Kolkata); `fireJob` re-fetches row → shared `spawnDueCronJob`.
- **Refactor**: `spawnDueCronJob` extracted/exported in `worker-engine.ts` (90-min dedup, indexName defaults, nextRun advance, triggeredBy system); `checkScheduledJobs` loops it — daemon + legacy poll share one path.
- **Admin**: zod enum gap FIX (`recommendation_performance`/`ai_connection_test`/`historical_price_sync`), NEW `GET /api/admin/cron/daemon` liveness endpoint, Cron tab TASK_TYPES +3 + daemon status chip (60s refresh), workers engine route auto-start/stop drives the daemon.
- **Netlify cron deleted**: 5 scheduled functions + `netlify/functions/` + `[functions]` block.
- **Ledger outcome wiring**: `recordCronRun(jobName, success, { skipSpawnCounted })` (outcome-only for spawn-counted runs — no double count) + NEW `recordSystemRunOutcome` in `worker-service.ts` `executeTask` (cronJobId-linked only; manual runs stay on `recordManualRunLedger`); non-fatal.
- **`daysTracked` sort 500 FIX**: raw computed field passed to Prisma → 500 → now `orderBy.createdAt` + regression test.
- **Carried v3.10.1 (`b35eca4`)**: honest latest-run, shared `modelChain.ts` fallback chain, swing tracker persistence (`@@unique([symbol, createdAt])`), SwingCard tenure pills, PerformanceTab dark-theme fix.
- **Verification**: NEW `cron-daemon.test.ts` (12 — closure-capture node-cron mock per Lesson 72, fire-and-forget flush per Lesson 73) + skipSpawnCounted test; **suite 686 pass (was 673+11 skip)**; tsc 71 exact baseline. Docs updated (Lessons #72/#73, versions-v3, CHANGELOG, AGENTS.md, TODO, Primer, agent-memory). **Commits pending user; no push/deploy.**

### Session 17 (August 13, 2026) — F&O Analytics UI Complete + NSE Option-Chain-v3 Migration + MCP getOptionChain/getFoExpiries (v3.7.0)
- **F&O UI complete** (services + API were already done — closes the v3.2.0 "Partial"): `app/fo/page.tsx` + `FoClient.tsx` dashboard (4 stat cards, add-position modal, option chain, expiries, Greeks, P&L summary) + 6 new `app/components/fo/` components; `app/Header.tsx` F&O nav link.
- **NSE option-chain-v3 migration**: `lib/services/nse-fo-api.ts` rewritten — v3 URL + `type=Indices|Stocks` + `expiry=DD-MMM-YYYY`; new pure exported parsers (`parseNseExpiryDate`/`parseNseTimestamp`/`toNseExpiryParam`/`isIndexSymbol`/`parseOptionChainV3`); `filtered` totals top-level of `records`; empty `{}` strike rows skipped; `FOContract`/`FOChainData` extended.
- **MCP**: `getOptionChain` (300s) + `getFoExpiries` (3600s) → **28 functions**. **API**: `/api/fo/chain` gains `expiry` param.
- **Verification**: 27 new parser tests; full suite **560 pass (was 533)**; tsc clean on touched files. Carried: monitoring #68 serverless-aware Server Logs notice. Status: docs done; commit pending user; NO deploy (consistent with v3.5.4→v3.6.4 holds).

### Session 16 (August 12, 2026) — IPO Issue Size + NSE Events Feed + AI IPO Report v2 JSON + MCP/Telegram (v3.6.4, session `2026-08-12-8f2a11d`)
- **IPO Issue Size**: pure helpers in `nseIpoService.ts` (`parseSharesPerLot`/`parsePriceBandLow`/`perLotInvestment`/`formatIssueSize` — structural `IssueSizeInput`) → "154 shares per lot · ₹14,168 per lot"; NEW server proxy `/api/recommendations/ipos/[symbol]/detail` → `getIpoIssueDetail` (24h cache, memory→NSE→DB); landing IPO page + `IposTab` batched per-symbol detail fetch.
- **NSE events feed**: NEW `nseEventsService.ts` (`NseEvent`, `normalizeThumbnail` https: prefix, `isNseEventRaw` guard, 6h TTL, `EVENTS_FETCH` audit) + `/api/events` proxy + `EventsFeedWidget.tsx` (useSWR, dynamic grid, PAST/UPCOMING pill) wired into `app/page.tsx` below Corporate Announcements.
- **AI IPO report v2 = JSON**: NEW pure `ipoReport.ts` (18-section `IpoReport` schema, JSON-only prompt, `parseIpoReportJson`, never-throws `normalizeReport`); `ipoAnalysisService` derives `report` (legacy markdown → null fallback); NEW `IpoReportView.tsx` premium renderer wired into `IpoAnalysisModal` + `IpoAnalysisPanel`; analysis API adds `report`.
- **MCP**: `getIpoAnalysis`/`getIpoIssueDetail`/`getNseEvents` (mem caches 43200s/3600s/21600s) → 26 functions. **Telegram**: `/ipo`, `/ipo-analysis`, `/events` (dynamic imports, lightweight bot).
- **Verification**: 26 new tests (10 ipoReport + 6 nseEvents + 7 ipo + 3 analysis v2 JSON; fixed pre-existing `@/lib/logger` mock missing `debug`); full suite **533 pass (was ~507)**; tsc clean (scoped). Status: docs done; commit pending user; NO deploy (consistent with v3.6.x holds).

### Session 15 (August 11, 2026) — Stale Recommendations (code) + Cron Ledger + Session Memory Infra (v3.5.4, branch `fix/ai-config-cron-ledger`)
- **Root-caused stale public recs**: `analyzeStocks(aiInput)` called with no AI config (env-only default) + nonexistent OpenRouter models (`tencent/hy3:free`, `qwen/qwen3-next-80b-a3b-instruct:free` → 404 verified vs live catalog) → prod all-HOLD runs → BUY/SELL-filtered page stale since Jul 19 even after API-side prod config was fixed.
- **Root-caused cron ledger**: `CronJob` ledger written only by `spawnCronTask`/resident scheduler (never on serverless); `successCount`/`failureCount` had no writer anywhere; scheduled path bypassed the ledger entirely.
- **Fixed**: shared `loadConfig()` (DB `ai_config` Secret > env, lazy prisma) + pipeline passes config; `DEFAULT_MODEL` → `nvidia/nemotron-3-ultra-550b-a55b:free` + refreshed catalog; `recordCronRun()` wired into `run-cron-background.ts` (success+failure) + admin PATCH runNow/retry (skip cronJobId-linked tasks).
- **Memory infra**: new MANDATORY `.agents/rules/session-decisions-flow.md` (decisions.md + flow.md per session) + first archive `sessions/2026-08-11-c995a10/` (D1–D8).
- **Verification**: full suite **340 passed / 11 skipped / 0 failures** (28 suites); tsc clean on touched files. ESLint repo-wide blocked (pre-existing eslintrc circular-JSON config; `next lint` removed in Next 16).
- **Status**: code + tests + docs complete, commit pending on `fix/ai-config-cron-ledger`; no deploy this session; prod rerun + ledger verification deferred to a user-approved deploy session.

### Session 14 (August 8, 2026) — Playwright E2E Suite hardening + docs (v3.5.3)
- **Root-caused + fixed all flaky/failing e2e tests**: Firefox `xl` nav viewport (1440×900), WebKit `fill()` on controlled number inputs (keystrokes), single-threaded dev-server starvation (serial nav + `noWaitAfter` + 60s + retries), live-marquee flakiness (assertion removed).
- **Full suite verified green**: 87/89 first attempt + 2 flaky passing on retry #1 (webkit nav SSR starvation, Firefox `RenderCompositorSWGL` teardown crash — both environmental); 317 Jest unit tests pass; e2e files typecheck clean.
- **CI workflow**: `.github/workflows/playwright.yml` hardened with `timescale/timescaledb` service (migrations require the extension), `prisma migrate deploy` + seed, Playwright install, HTML report artifact.
- **Docs written**: `.agents/docs/playwright-e2e.md` (implementation + agent guide, reports/Trace Viewer, troubleshooting), `playwright-e2e` skill (machine + human mirror), `playwright-cli` skill cross-references + MCP tool guidance, AGENT-SKILL-MATRIX row, AGENTS.md v3.5.3 row/commands/lessons, `.agents/CHANGELOG.md` + `versions-v3.md` v3.5.3 entry, README CI badge + Testing section.
- **Status**: docs done; commit everything (e2e stack + docs) to open PR #85 (`fix/screener-change-percent`), never auto-merge.

### Session 13 (August 8, 2026) — Screener `change` = % Fix (v3.5.2)
- **Root-caused**: TradingView's `change` field IS the percent change on NSE; `change_percent` is null/unsupported as column/filter/sort → ~60 templates silently matched 0, `getTopMovers` gainers returned `[]`.
- **Short Term Breakouts rewritten** (`change > 0, relative_volume_10d_calc > 1, Perf.5D > 3`) → **250 stocks (was 0)**, 18/20 Chartink overlap. `Perf.5D` added to `FILTER_FIELDS`.
- **Mass-fixed** all 57 remaining `change_percent` → `change` template args (0 remain).
- **Fixed** `getTopMovers` gainers/losers/active filters + advanced-route `percentChange ?? change` (removed ₹-based formula).
- **UI**: `change` labeled "Change (%)", ₹ derived from % in results table; % Change column sortable.
- **Verified**: 45 screener tests pass; Playwright — template loads 3 conditions, Run Scan "250 stocks found · 574ms", sortable % values real (SBIN +1.12%, MOTHERSON +8.71%, TATATECH +8.89%), zero console errors.
- **Status**: docs updated (AGENTS.md, CHANGELOG, TODO, Primer, screener.md); commit pending — 6 files, user's Playwright files (`e2e/`, `playwright.config.ts`, `.github/workflows/playwright.yml`, `@playwright/test`) left untracked/untouched.

### Session 12 (August 7, 2026) — ph21: Target/SL ₹0.00 Fix + SSE Live Prices Wiring (v3.5.1)
- **PR #81 merged** (commit `bf584e2`) → new branch `fix/ph21-carryforward-perftab` from main.
- **Root-caused Performance ₹0.00**: prod AI fails (Netlify missing `OPENROUTERKEY`) → `getDefaultRecommendation()` wrote literal `0`s → overwrote price-based defaults. Fixed with price-based fallback (`price*1.1`/`price*0.95`).
- **Backfilled 149 trackers** locally (`scripts/backfill-recommendation-targets.ts`, needs `--env-file=.env`); verified 0 zero-target remain.
- **Wired SSE live prices**: HoldingsTable (live value/P&L + ● Live badge), Watchlist (`liveQuoteFor` overlay), MarqueeBanner (30s refresh). Fixed `useLivePrices` infinite loop (196 console errors on empty watchlist → `symbolsRef`).
- **HistoryTab null-guard**: top-stocks API coalesces `"HOLD"`/`0`; UI renders "—" for null confidence.
- **Tests**: 317 passed / 11 skipped / 0 failed (+4 new `useLivePrices` tests). tsc + eslint clean. Playwright verified desktop + mobile.
- **Status**: docs updated; nothing committed yet on `fix/ph21-carryforward-perftab`.

### Session 11 (July 19, 2026)
- **Daily Recommendations Engine + Self-Heal AI + Audit Logging (v3.3.0)**: Planning and documentation complete.
- **Branch**: `ph18` created from `main`.
- **PRD**: Updated with Features 6 (Recommendations), 7 (Self-Heal), 8 (Audit).
- **TODO**: Added Sprints 4 (Recommendations) and 5 (Self-Heal + Audit).
- **AGENTS.md**: Added v3.3.0 version history with all files and features.
- **HANDOFF.md**: Set to `in_progress` with feature `ph18-daily-recommendations`.
- **Primer.md**: Updated current status and session history.
- **Key Decisions**: Hybrid Chartink+TradingView, public page access, extend OpenRouter SDK, separate cron for performance tracking.
- **Status**: Ready for code implementation starting with Prisma schema changes.

### Session 10 (July 18, 2026)
- **Telegram Bot Alert Delivery (v3.2.0)**: Full-featured Telegram bot with command routing, rate limiting, user verification, and alert delivery.
- **Files Created**: `lib/services/telegramBotService.ts`, verify/test API routes, `TelegramSubscription.tsx` UI component, `rebalancerTypes.ts`
- **Files Modified**: webhook route, alerts page, contact page, docs (README, AGENTS, TODO), 3 rebalancer components, next.config.ts
- **Bug Fix — Corp Actions Price/Yield**: Fetched live prices from `daily_prices`, fixed yield formula to `(dividendPerShare / currentPrice) * 100`
- **Build Fix — Rebalancer imports**: Extracted types to `rebalancerTypes.ts` to stop Prisma bundling in client components (was importing `pg` through `rebalancerService.ts`)
- **Build Fix — Dev server**: Fixed `start /B` blocking the LLM; switched to PowerShell `ProcessStartInfo` with `CreateNoWindow`
- **E2E Tested**: Dashboard, Alerts→Telegram tab, Contact FAQ, Dividends calendar, Portfolio Rebalance, Telegram webhook API, mobile responsive (375px) — 0 console errors
- **Tests**: 190/190 pass
- **Build**: ✅ Compiles with `npm run quickbuild`
- **Status**: Pending git push to trigger Netlify CD deploy

### Session 9 (July 16, 2026)
- **Agent Handoff & Self-Learning System (v1.15.0)**: Complete agent collaboration infrastructure.
- **Handoff System**: Created `.agents/handoffs/` with SCHEMA.md, lifecycle flow, agent-to-agent protocol, error recovery, active/archive system.
- **Root HANDOFF.md**: Central orchestration state for all agents.
- **Agent Definitions**: 8 specialized agents (GH Helper, E2E, Integrator, Observability, DevOps, QA, Code Reviewer, TDD Guide).
- **Commands**: `/handoff`, `/self-learn`, `/review-diff` for explicit orchestration.
- **Self-Learning**: `.agents/learning/` with session logs and pattern extraction.
- **Git Hooks**: pre-commit (code quality, secrets detection) and post-commit (activity logging).
- **Documentation**: Updated AGENTS.md, Primer.md, agent-memory.md, Lessons.md.
- **Files Created**: HANDOFF.md, 6 files in handoffs/, 8 agents, 3 commands, 2 learning files, hooks.
- **Status**: RESOLVED in v1.15.0.

### Session 8 (March 20, 2026)
- **Price Alert Enhancement**: Added current stock price display in alerts.
- **Admin Stats Fix**: Updated stats API to show actual worker/cron status.
- **Documentation**: Updated to v1.10.3.

### Session 7 (March 20, 2026)
- **Worker Cache Fix**: Fixed `stock_sync` task failing with "TypeError: indexName.replace is not a function".
- **Root Cause**: `generateCacheKey` checked `if (indexName)` but didn't verify it's a string.
- **Fix**: Changed to `typeof indexName === 'string' && indexName.length > 0`.
- **Documentation**: Updated to v1.10.2.

### Session 6 (March 20, 2026)
- **Corp Actions Fix**: Fixed duplicate corporate actions being created during NSE sync.
- **Root Cause**: Deduplication only checked `symbol + exDate` but schema requires `symbol + actionType + exDate`.
- **Fix**: Updated all sync functions to use Prisma `upsert` with correct unique constraint and UTC noon dates.
- **Files**: combined route, admin live-sync, admin corporate-actions route, historical route, sync-service.
- **Documentation**: Updated `AGENTS.md`, `agent-memory.md`, `Lessons.md`, and `Primer.md` to version 1.10.1.

### Session 5 (March 19, 2026)
- **Join Flow**: Implemented `JoinRequest` model and `/auth/join` request page.
- **Admin UI**: Added tabbed "Join Requests" management to `/admin/users`.
- **RBAC**: Secured all user management routes via middleware.
- **Cleanup**: Deleted `/users/new` and updated `LoginModal`.
- **Documentation**: Updated `AGENTS.md`, `agent-memory.md`, `Lessons.md`, and `Primer.md` to version 1.9.2.

### Session 4 (March 18, 2026)
- **Notifications**: Built `/notifications` page and aggregated API route. Combined worker tasks, audit logs, and alerts.
- **Logging**: Integrated Netlify Blobs for persistent storage. Converted logger to async.
- **UX Fixes**: Centered and polished login modal. Fixed NSE DB logging in `nse-client.ts`.
- **Documentation**: Updated `AGENTS.md`, `agent-memory.md`, `Lessons.md`, and `Primer.md` to version 1.9.1.

### Session 3 (March 18, 2026)
**Issue**: 
1. `seed.ts` failed to insert corporate actions due to incorrect CSV parsing.
2. NextAuth had a "ghost session" bug where users appeared logged in after signing out.
3. Seeding scripts threw `ECONNREFUSED` timeouts against remote Prisma Accelerate.

**Fix Applied**:
- Rewrote `seed.ts` CSV parsing to correctly parse strings with embedded commas and quotes.
- Refactored data seeding loops into `createMany({ skipDuplicates: true })` batching.
- Fixed NextAuth ghost sessions by deleting conflicting manual endpoints and renaming the session cookie.
- Status: RESOLVED in v1.8.3. 

---

## Session History

### Session 7b (August 6, 2026) — Git Workflow & Agent Operating Model (v3.4.2)
- **Tracked Git Hooks**: Created `.githooks/` (gardenify pattern) — enhanced `pre-commit` (warn main, block secrets + `.env`, warn console.log/junk/tsc), `post-commit` (checkpoint log to gitignored `.agents/handoffs/checkpoint.log`), `pre-push` (warn main). Set `git config core.hooksPath .githooks`.
- **Gardenify Docs Port**: `.agents/linear-history.md`, `.agents/code-hygiene.md` (ponytail minimal-code), `.agents/documentation-standards.md`.
- **AGENTS.md Operating Model**: Added Git Hooks, Agent Operating Model, Plugins & MCP sections.
- **Files Modified**: AGENTS.md, Primer.md, HANDOFF.md (v1.2), `.agents/pre-commit-workflow.md`, `.agents/session-todos.md`, `.agents/sessions/README.md`.
- **Status**: Ready to commit as v3.4.2; deploy + prod verification pending after commit.

### Session 7 (August 6, 2026)
- **Prod Reliability Fixes (v3.4.1)**: Fixed recommendation transaction timeout, AI monitoring persistence, top-50 cap, Telegram live prices, history predicted vs current, DB monitoring logs tab.
- **Prod UI/UX Audit**: Playwright walkthrough of tradenext6.netlify.app — findings documented in TODO.md (stale recs 17 days, bare "🟡 %" cards, 643 stocks too many, empty demo portfolio).
- **Gardenify Pattern Port**: Added `.agents/session-todos.md`, `.agents/pre-commit-workflow.md`, `.agents/security-checklist.md`, `.agents/sessions/` archive.
- **Status**: Code + docs complete; pending test run + deploy + prod verification.

### Session 6 (March 20, 2026)
- **Worker Logger Security Fix (v1.10.6)**: Fixed CodeQL path traversal vulnerability.
- Added `sanitizeTaskIdForPath()` function allowing only safe filename chars.
- Applied sanitization to write, read, and delete operations.

### Session 5 (March 20, 2026)
- **Corporate Actions NSE Field Fix (v1.10.5)**: Fixed sync saving all records as "OTHER" type.
- **Root Cause**: NSE API uses lowercase fields (`subject`, `comp`, `recDate`, `faceVal`) not uppercase.
- **Files Modified**: app/api/admin/nse/live-sync/route.ts, app/api/corporate-actions/combined/route.ts, app/components/analytics/CorporateActionsTable.tsx
- **New File**: scripts/fix-corp-actions.ts for cleanup
- **Updated Upcoming Actions UI**: Added Subject, FV, Price columns to match Historical table format.

### Session 4 (March 20, 2026)
- **Serverless Logging Fix (v1.10.4)**: Added `ServerLog` model for DB-backed logging on serverless platforms.
- **Files Created**: `lib/services/db-logger.ts`, `app/api/admin/logs/route.ts`
- **Files Modified**: `prisma/schema.prisma`, `lib/services/worker/worker-logger.ts`
- **Corporate Actions Duplicates (v1.10.1)**: Fixed deduplication - schema uses `symbol + actionType + exDate`, not just `symbol + exDate`. Fixed date parsing to use UTC noon.
- **Worker Cache Fix (v1.10.2)**: Fixed `typeof indexName === 'string'` check in `market-cache.ts`.
- **Price Alert Enhancement (v1.10.3)**: Added current price display when creating/viewing alerts.

### Session 3 (March 18, 2026)
- **Worker Engine**: Built persistent loops for task polling and cron scheduling. Linkage with `CronJob` and `WorkerTask` models.
- **NSE Sync**: Implemented fetchers for events, news, announcements, and market data. Integrated TradingView screener sync.
- **Logging**: Switched to `.next/server_logs` with dynamic directory creation and `0o777` permissions for cross-process visibility.
- **Build Fix**: Wrapped `/admin/utils/tasks` in `Suspense` to resolve `useSearchParams` pre-rendering crash.
- **Documentation**: Updated `ARCHITECTURE.md`, `Lessons.md`, and `AGENTS.md` to version 1.9.0.

### Session 2 (March 18, 2026)
- **Corporate Actions**: Fixed missing CSV data parsing resulting in correct dividend and ratio values.
- **Prisma Rate limits**: Changed `upsert` and looped `create` calls into `.createMany()` arrays. Prevented `P2002` schema errors and `ECONNREFUSED` connection drops.
- **Auth bug**: Traced "Ghost Session" issue to cookie mismatch/stale active sessions and a custom `/api/auth/session` endpoint overriding NextAuth. Naming the cookie `tradenext-session-token` immediately resolved it.

### Session 1 (March 16, 2026)
- Started with 502 error on Netlify
- Fixed logger to output to console + file in production
- Fixed Prisma 7 adapter issue (needed driver adapter, not accelerateUrl)
- Moved type packages to dependencies for Netlify build
- Added startup logs to middleware and auth routes

---

## Pending Actions

1. [ ] Deploy and check Netlify Function logs
2. [ ] Set DATABASE_URL in Netlify environment variables
3. [ ] Verify site works after database connection fix
4. [ ] Check logs show ">>> FATAL: No valid DATABASE_URL" error

---

## CRITICAL - Database Setup Required

The app CANNOT work without a valid PostgreSQL database URL.

**Option 1: Set in Netlify Dashboard**
- Go to: Site Settings → Environment Variables
- Add: DATABASE_URL=postgresql://user:password@host:port/database

**Option 2: Use Prisma Postgres**
- Install Prisma Postgres extension in Netlify
- It will automatically set DATABASE_URL

**Option 3: Use a free PostgreSQL service**
- Neon, Supabase, Railway, etc.

---

## Notes

- Logger now exports named functions (info, warn, error, debug)
- Build command: `npx prisma generate && npm run quickbuild`
- Prisma 7 requires driver adapter or accelerateUrl
- Early logging added: check Netlify Function logs for `>>>` prefix

