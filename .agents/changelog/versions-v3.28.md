# v3.28.0 — SQLite-first NSE data store: mirror + read-first + write-through + instant promote

- **Date**: Sep 04 2026
- **Branch**: `v3.26.0-prod-failure-triage` (on top of v3.27.0)
- **Status**: Complete (code + verification); commit/push pending user
- **Spec**: `.agents/specs/06-sqlite-first-nse-store.md` · **Plan**: `.agents/plans/06-sqlite-first-nse-store.md`

## User directives (all confirmed)

1. **All NSE sync triggers against SQLite (not Prisma)** — every NSE-backed sync (`executeStockSync`,
   `executeCorpActionsSync`, `executeHistoricalPriceSync`, `runChartinkUnifiedScreeners`) now writes its
   result to the **local SQLite mirror first**, then instant-promotes to Prisma.
2. **All things cached** — hot reads short-circuit memory caches before SQLite/DB.
3. **Reads hit SQLite FIRST → live fetch; NOT Prisma fallback for NSE reads** — the backtest read now
   consults SQLite before any DB leg. Prisma fallback remains only for the non-read paths (performance run,
   recommendation updates, auth, cross-instance coordination, etc.).
4. **Add SQLite schema similar to Prisma + keep it updated + add indexes** — new SQLite tables mirror the
   NSE-backed Prisma models, with indexes, maintained by `syncFromPrisma` + the NSE mirrors.

## Design

**SQLite-first write-through, Prisma stays the shared truth.** Cross-instance coordination (leader locks,
atomic `updateMany` claims, reaper liveness) remains on Prisma. The SQLite mirror serves hot/cheap NSE reads
zero-Prisma; the leader-gated `promoteNseToPrisma()` engine flushes the mirror to Prisma both on a **~60s
background timer** and **at end-of-task** after each sync, so Prisma stays authoritative with no extra caller
writes.

**Ticker-key convention:** the OHLCV `daily_price` mirror is keyed **`NSE:${SYMBOL}`** — exactly matching
Prisma `daily_prices.ticker` (so the promote round-trips cleanly) and the backtest SQLite read.

## Files Changed

| File | Change |
|------|--------|
| `lib/sqlite.ts` | `SCHEMA_SQL`: NEW `symbols`, `daily_price`, `chartink_screener_result` tables + indexes; extended `corporate_action` (+8 cols) + `chartink_screener` (+5 cols); idempotent `ensureNseColumns(db)` ALTER-guard. `SqliteFallback` interface +7 methods, type-safe `createFallback` impls via local `sv()` converter. Module helpers: `cacheSymbol` (:427), `cacheDailyPriceBars` (:437), `getSqlitePriceRange` (:448), `cacheCorporateActions` (:459), `cacheChartinkResults` (:470), `getSqliteChartinkResults` (:483), `getSqliteSymbols` (:490). Promote engine: `promoteNseToPrisma()` (:2133, leader-gated, reads SQLite, chunked `createMany`), `flushNseToPrisma()` (:2166), `startNsePromoteFlush()` (:2174, 60s unref'd) / `stopNsePromoteFlush()` (:2198), `parseJsonLoose()` helper. |
| `lib/prisma.ts` | dev-gated Prisma query logger: `PRISMA_QUERY_LOG=1` (dev/local only) → `log:["query"]` at constructor (the `$extends` wrapper does not propagate `$on('query')`). Off by default — no prod/CI impact. |
| `lib/services/worker/worker-service.ts` | `executeStockSync` → `cacheSymbol` per stock (lazy `@/lib/sqlite`, non-fatal) + `flushNseToPrisma()`; `executeCorpActionsSync` → `cacheCorporateActions(mirrored)` (`(actions as any[])` cast, `parseActionPurpose`, ex/record date ISO) + `flushNseToPrisma()`. |
| `lib/services/historicalPriceSyncService.ts` | (dry-run-false) → `cacheDailyPriceBars(\`NSE:${symbol}\`, …)` mapping normalized `SecurityWiseHistoricalBar` fields (`b.date`/`b.open`/`b.high`/`b.low`/`b.close`/`b.volume`/`b.vwap`) + `flushNseToPrisma()` before result (lazy `@/lib/sqlite`, non-fatal). |
| `lib/services/backtestDataService.ts` | NEW SQLite-first read step in `getBacktestData` (after memory cache): `getSqlitePriceRange(\`NSE:${sym}\`)`, serves `source:"sqlite"` when ≥20 bars (maps `trade_date` → epoch ms), memory-caches, else falls through to DB/NSE legs. `BacktestDataResult.source` union +`"sqlite"`. NSE-fetch step now ALSO mirrors bars to SQLite via `cacheDailyPriceBars(\`NSE:${sym}\`, …)` (non-fatal). |
| `lib/services/chartinkUnifiedScreenerService.ts` | `runChartinkUnifiedScreeners` → per-run `cacheChartinkResults(run.template.id, rows)` (symbol/name/close/change_percent/volume/raw), lazy `@/lib/sqlite`, non-fatal. |
| `instrumentation.ts` | Boot `startNsePromoteFlush()` after `startWriteBehindFlush()` (leader-gated promote timer). |
| `lib/__tests__/historicalPriceSyncService.test.ts` | Mock `@/lib/sqlite` with `cacheDailyPriceBars` + `flushNseToPrisma` so the new mirror step is inert in tests. |

## Verification

- **tsc** — `npx tsc --noEmit` = **46 = exact baseline (0 new)** production errors.
- **Full suite** — `npm run test` = **995 pass / 4 skip / 2 fail** (the 2 failures are the documented
  pre-existing `intelligence.test.ts` async cache-flake, which fails run-to-run regardless of changes —
  excluding it: 71 suites / 995 pass / 4 skip / 0 fail from these changes). Zero regressions.
- **Targeted** — `backtestDataService.test.ts` 16/16, `chartinkUnifiedScreenerService.test.ts` +
  `chartinkTemplateServices.test.ts` 38/38, `historicalPriceSyncService.test.ts` 15/15, `sqlite.test.ts`,
  `daemon-sqlite-first.test.ts`, `dbOpTiering.test.ts`, `leader.test.ts` all green.
- No Prisma schema change → no migration.

## Notes / known noise

The SQLite mirror helpers kick an async `ensureSqliteBackup()` when the mirror isn't initialized yet (cold
start / unit tests), which attempts a sql.js WASM load that fails harmlessly in CI/test environments — the
`.catch(() => {})` swallows it (visible as `wasm streaming compile failed` log lines; non-fatal, does not
affect test results).

---

# v3.28.1 — SQLite partial-init self-heal + promote not-ready guard

- **Date**: Sep 04 2026
- **On top of**: v3.28.0
- **Status**: Code + tests complete; docs/commit pending user approval

## What was broken (live prod symptoms)

After the v3.28.0 deploy to `main` three prod issues surfaced:

1. Dashboard shows **"SQLite Not Ready"** (`/admin/utils/db-health` derives from `sqliteHealth.sqlite.ready`).
2. `promoteNseToPrisma … no such table: daily_price` (and `chartink_screener_result`) errors.
3. Daily recommendation jobs failing (not yet investigated — deferred until this ships).

**Root cause (single defect → both symptoms #1 + #2).** `initSqliteBackup` (`lib/sqlite.ts` :970) assigns
`state.db = db` (:976) **BEFORE** the schema loop (:979-982). If any schema statement throws, the catch
(:1016+) leaves `state.db` **non-null** (partially built — `daily_price`/`chartink_screener_result` missing)
with `ready:false`. This is deterministic and **self-perpetuating**:

- `getHealthStatus()` reports `ready:false` → dashboard "SQLite Not Ready" (#1).
- `promoteNseToPrisma`/`promoteTable` only guarded `if (!state.db …)` → a non-null partial `state.db` passed
  the guard → reading the missing NSE tables threw "no such table" (#2).
- `ensureSqliteBackup()` retry calls `initSqliteBackup`, whose line 971 `if (state.db) return` **short-circuits**
  → the partial DB + `ready:false` are **permanent** until process restart.
- `ensureNseColumns` is ALTER-only and can't create missing tables, so no self-heal existed.

## Fixes (`lib/sqlite.ts`)

1. **Init-catch reset (self-healing)** — the `initSqliteBackup` catch now resets `state.db = null`, `state.ready = false`,
   `_instance = null` so the next `ensureSqliteBackup()`/`initSqliteBackup()` call **REBUILDS from scratch**
   instead of being defeated by the `if (state.db) return` early-return.
2. **Promote not-ready guard** — `promoteNseToPrisma()` (top guard) and `promoteTable()` now require
   `!state.ready ||` in addition to the existing `!state.db` guard, so a partially-built mirror is **skipped**
   (all-zero summary, no Prisma ops, no throw) rather than erroring on the missing NSE store tables.

## Tests (`lib/__tests__/sqlite.test.ts`)

- **partial-init repair** — patches the sql.js `MockDatabase.run` prototype to throw once inside the schema
  loop (after `state.db` is assigned), then asserts the catch resets the fallback to null and the next
  `ensureSqliteBackup()` rebuilds to `ready:true`.
- **promote not-ready guard** — after `resetSqliteStateForTests()` (not-ready mirror) `promoteNseToPrisma()`
  returns the all-zero summary without throwing or touching any table.

## Verification

- **tsc** — `npx tsc --noEmit` = **46 = exact baseline (0 new)**.
- **Full suite** — `npm run test` = **998 pass / 4 skip / 1 fail** (998 = 995 baseline + 3 new; the 1 fail is the
  documented pre-existing `intelligence.test.ts` async cache-flake — it timed out in isolation, `intelligence.ts`/
  `cache.ts` untouched — excluding it: **71 suites / 998 pass / 4 skip / 0 fail from these changes**).
- **Targeted** — `sqlite.test.ts` 36/36 incl. both new, `daemon-sqlite-first`, `dbOpTiering`,
  `historicalPriceSyncService` (31 combined) all green.
- No Prisma schema change → no migration.

---

# v3.28.2 — Lost-leader engine stop (single-active-worker enforcement)

- **Date**: Sep 04 2026
- **On top of**: v3.28.1
- **Status**: Code + tests + docs complete; commit pending user approval

## Audit results (persistence paths — all verified)

| Concern | Verdict | Evidence |
|---|---|---|
| AI-call tracking persists post-analysis | ✅ | `trackAiCall` → memory ring buffer + `enqueueWriteBehind("server_log")` to SQLite (zero Prisma per call); `getPersistedAiCalls` merges Prisma-promoted + SQLite write-behind rows (v3.24.0 two-tier merge). Request handlers `await` it. |
| Recommendations persist after analysis | ✅ | Run create → `recommendationTracker.createMany` → `dailyRecommendationStock.createMany` → run.update (v3.11.1 no-fake-HOLD deleteMany intact). |
| Performance tracking persists | ✅ | Status updates + `RecommendationStatusHistory` creates + 360-day `archiveRecommendations` sweep. |
| IPO details persist | ✅ | Generate via OpenRouter → persist DB (`market_cache` ipo_analysis) + memory; cleanup + stale prune exist. |
| Swing trackers persist post-analysis | ✅ | `persistSwingTrackers` (RecommendationTracker swing rows) + `patchSwingSignalAnalysis` (SwingSignal levels) run on `analysisStatus === "done"` (non-fatal). |
| Crons synced during normal sync | ✅ | `syncFromPrisma` pulls `cron_job`; `reconcileControlToPrisma` (6h sync) pushes back `nextRun`/`lastRun`/counters + `worker_status` heartbeats + completed/failed `worker_task` statuses. |

## Defect found and fixed

**Symptom**: multiple workers executing different tasks concurrently — "only 1 worker / task is active at a time".

**Root cause**: `instrumentation.ts` `onLost` callbacks (lines 42-44, 54-56) only `logger.warn` — they never call `stopWorkerEngine()` / `stopCronDaemon()`. Combined with `acquireLeaderLock` **fail-open on DB-unavailable** (returns `true` on every instance during a DB blip, so all instances start a worker poll loop + cron daemon), when the DB recovered: only one instance kept the leader row, but the other instances' `renewLeaderLock` returned false → `onLost` fired → they logged and **kept polling forever** → N workers executing different tasks concurrently.

**Fix** (surgical — `instrumentation.ts` only):
- Worker `onLost` → call `stopWorkerEngine()` (poll timeout + heartbeat + scheduler intervals cleared)
- Cron `onLost` → call `stopCronDaemon()` (node-cron tasks destroyed + intervals cleared)
- sqlite-sync `onLost` → keep log-only (sync is gated per-run by `isLeader` at runtime; nothing long-running to stop)

Both stop functions already existed and are safe. Pruning idle `worker_status` rows is unnecessary — dead-instance rows are informational/harmless (reaper ignores stale); the multi-worker polling WAS the pruning problem.

## Tests (`lib/__tests__/instrumentation.test.ts` — NEW, 5 tests)

1. **starts worker + cron daemon when elected leader for all three roles** — `acquireLeaderLock` returns true → `startWorker` + `startCronDaemon` called, three `startLeaderHeartbeat` registrations.
2. **worker onLost → `stopWorkerEngine()` fired** — captures the `onLost` callback from `startLeaderHeartbeat("worker", cb)`, invokes it, asserts `stopWorkerEngine()` called once.
3. **cron onLost → `stopCronDaemon()` fired** — same pattern for the `cron-daemon` role.
4. **not-leader → no start** — `acquireLeaderLock` returns false for `worker` → `startWorker` not called; `stopWorkerEngine` not called.
5. **non-Node runtime → returns early** — `NEXT_RUNTIME` unset → `register()` returns before any dynamic imports; `acquireLeaderLock` not called.

## Verification

- **Targeted** — `instrumentation.test.ts` 5/5, `sqlite.test.ts` 36/36, `daemon-sqlite-first` + `dbOpTiering` + `historical` + `leader` = 85/85 total.
- **Full suite** — 1003 pass / 4 skip / 1 fail (1003 = 998 + 5 new; 1 fail = documented pre-existing `intelligence.test.ts` async cache-flake, `intelligence.ts` untouched — excluding it: **72 suites / 1003 pass / 4 skip / 0 fail**).
- **tsc** — `npx tsc --noEmit` = **46 = exact baseline (0 new)**.
- No Prisma schema change → no migration.

---

# v3.28.3 — Audit write-behind promotion fix (strip `queued_at` before Prisma `createMany`)

- **Date**: Sep 05 2026
- **On top of**: v3.28.2
- **Status**: Code + tests + docs complete; commit pending user approval (no push)

## What was broken (db-health DB Errors panel)

The db-health "Recent DB Errors" ring was full of repeating `AuditLog createMany — Unknown argument queued_at`
(≈15-min spacing). Root cause: the write-behind flush (`writeWbRowsToPrisma` → `mapWbToPrisma` in `lib/sqlite.ts`)
has a `default` branch that passes same-name wb-row columns verbatim into Prisma `auditLog.createMany`.
`queued_at` is a **SQLite wb-only bookkeeping column** (auto-added by `enqueueWriteBehind`) that does not exist on
the Prisma `AuditLog` model → every ~15-min flush threw → **audit rows never promoted** (sticky rows re-failed
every flush, promoted audit: 0 / retained: 13-ish, and the db-health DB Errors panel logged each failure).
Pre-existing since the v3.22.0 write-behind promotion model.

## Root cause (corrected from earlier suspect)

Earlier note pointed at `lib/prisma.ts`; **the fix actually lives in `lib/sqlite.ts`** — `mapWbToPrisma`
(`writeWbRowsToPrisma` ~:1629) is what shapes the promoted row set. Only `audit_log` is ever promoted —
`server_log`/`api_request` are hard-refused (SQLite-primary store) — so `queued_at` (and any future wb-only
bookkeeping column) only leaks through the audit `createMany`. The `id` passthrough is correct (client-side UUID
per wb row, idempotent via `INSERT OR REPLACE`).

## Fix (`lib/sqlite.ts`)

NEW `case "queued_at": break;` skip branch in `mapWbToPrisma` (before the `default:` branch), with a comment
noting the pre-v3.28.3 bug. Any other validated same-name column still passes through — only the wb-only
bookkeeping column is stripped.

## Test (`lib/__tests__/sqlite.test.ts` — +1 → 37)

NEW regression test **"strips SQLite-only bookkeeping columns (queued_at) from the promoted Prisma createMany
[v3.28.3]"** (inserted after the "promotes ONLY important rows" test): seeds an `audit_log` wb row, calls
`mockPrisma.auditLog.createMany.mockClear()`, flushes, then asserts: flush not skipped, `flushed.audit_log >= 1`,
**every** `createMany` data entry lacks `queued_at`, and the mapped fields arrive (action / userId / userEmail /
ipAddress / parsed metadata). Existing promotion tests only asserted call counts (not args) — why this slipped.

## Verification

- **Targeted** — `sqlite.test.ts` **37/37** green.
- **tsc** — `npx tsc --noEmit` = **46 = exact baseline (0 new)**.
- No Prisma schema change → no migration.

---

# v3.28.4 — Read-first recommendations route + edge-cache the heavy latest-run reads

- **Date**: Sep 05 2026
- **On top of**: v3.28.3
- **Status**: Code + tests + docs complete; commit/push pending user approval (no merge)
- **Branch**: `fix/v3.28.1-sqlite-self-heal`

## What was wrong (user directive + db-health signal)

Two compounding issues:

1. **Key collision (route ↔ service).** `app/api/recommendations/route.ts` wrote its serialized `responseBody`
   under the **service's** `LATEST_KEY` (`"recommendations:latest"`) with a 600s TTL. But the service's
   validated cache stores a `LatestCacheEntry` `{runId, newestRunId, data}` under that same key. Once the route
   stored its flat `{run, latestRun, stocks, timestamp}` body, the service's cross-instance fingerprint check
   read `cached.runId === undefined` on every request → **the heavy stocks-include query re-ran on EVERY
   request** (db-health "Recent DB Errors"/read-tier showed `recommendations.prisma` 14/14 huge-query misses).
2. **Fingerprint probes hit Prisma every request.** The read-first fast path is intentionally gated on the
   two index-only fingerprint probes (`findFirst` `where id`), keeping the 15-min validated cache honest across
   instances — but the heavy reads themselves had no edge caching on busy dashboards.

## Fix (user-approved "Both")

- **Route read-first fast path** (`app/api/recommendations/route.ts`):
  - NEW route-contained `ROUTE_CACHE_KEY = "recommendations:api:latest"` (DISTINCT from the service key) +
    `ROUTE_CACHE_TTL_SECONDS = 60` + typed `RouteRecommendationsCacheBody {success, stocks, timestamp}`.
  - After the plan-limit breaker block, a read-first `recommendationsCache.get(ROUTE_CACHE_KEY)` serves the
    serialized payload from memory (`servedFrom: "memory_cache"`, `recordRead("recommendations.memory", {hit:true})`,
    `logger.debug`) with **zero Prisma reads** for up to 60s — then the existing Prisma path re-stamps the key.
  - All three legacy `"recommendations:latest"` references (breaker memory fallback, response `set`, DB-error
    memory fallback) switched to the route-contained key — the service key is never touched by the route anymore.
- **Edge-cache the heavy reads** (`lib/services/dailyRecommendationService.ts`):
  - `withAccelerateCache({ ttl: 60, swr: 30 })` (v3.27.0 boundary helper from `@/lib/prisma`) wraps BOTH heavy
    `findFirst` reads in `getLatestRecommendations`: `latestRun` (stocks-include) and `newestRun` (lightweight
    select) — the two queries that actually had the 14/14 problem.
  - `T extends (args:any)=>any` on the helper cannot preserve `findFirst`+`include` payload typing (bare model
    type falls back) → added the existing `as RunWithStocks | null` cast at the `serializedStocks` usage point
    so the `.stocks` access keeps type-safety (matches the pre-existing cast at the `result` assembly).
- **Fingerprint probes stay uncached** — they are the cross-instance staleness guard; short TTL is safe because
  the 95-row query only re-runs when the fingerprint actually changed (or after 15-min cache expiry).

## Tests (`lib/__tests__/dailyRecommendationService.test.ts` — +1 → 34)

- Mock factory gains the pure `withAccelerateCache` stub (`(strategy) => (args) => ({...(args as object),
  cacheStrategy: strategy})`, pattern from `recommendationPerformanceService.test.ts:61-62`) so the service's
  named import is defined; spread preserves keys so existing `findFirst.mock.calls[0][0]?.where/select`
  assertions still pass.
- NEW regression **"v3.28.4: heavy latestRun/newestRun reads carry Accelerate cacheStrategy; fingerprint
  probes stay uncached"** — stale cache → fingerprint unchanged → refetch; asserts 4 findFirst calls, `calls[0]`
  and `calls[1]` (fingerprints) have **no** `cacheStrategy`, `calls[2]` and `calls[3]` (heavy reads) carry
  `cacheStrategy: {ttl: 60, swr: 30}`.

## Verification

- **tsc** — `npx tsc --noEmit` = **46 = exact baseline (0 new)**; zero errors in route/service/prisma/readTier.
- **Targeted** — `dailyRecommendationService.test.ts` **34/34** (+1); `readTier` + `recommendationPerformanceService`
  **25/25** green (the boundary-helper provenance suites).
- **Full suite** — **1004 pass / 4 skip / 2 fail** (2 = documented pre-existing `intelligence.test.ts` async
  cache-flake, fails run-to-run, `intelligence.ts`/`cache.ts` untouched — excluding it: **72 suites /
  1004 pass / 4 skip / 0 fail from these changes**).
- No Prisma schema change → no migration.

---

# v3.28.5 — NSE scrip-list constant (Securities available for trading — Equity)

- **Date**: Sep 05 2026
- **On top of**: v3.28.4
- **Status**: Code + tests complete; docs/commit pending user approval (no push/merge)
- **User directive**: "NSE Securities available for trading" CSV → "create a constant which gets loaded for the
  Symbol references".

## Data source found (this resolved the earlier URL blocker)

The `www.nseindia.com/static/market-data/securities-available-for-trading` page is the JS-guarded human listing —
`curl` gets a 404 HTML shell (~281 KB). The machine endpoint exists on the archives host:

**`https://archives.nseindia.com/content/equities/EQUITY_L.csv`** — HTTP 200, 181,507 B,
header `SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE`.

Dataset facts (verified by analysis): **2,570 data rows**, every row exactly 8 comma-fields, zero embedded
commas/quotes, zero duplicate SYMBOLs. Series histogram **EQ 2,288 / BE 254 / BZ 28**.

## Files Changed

| File | Change |
|------|--------|
| `scripts/fetch-nse-scrips.ts` | NEW generator — `npx tsx scripts/fetch-nse-scrips.ts --write` (dry-run default prints stats), `httpsGet` from `node:https`, UTF-8 BOM strip, ≥2000-row sanity guard, warns on malformed/duplicate rows before writing. |
| `lib/services/nseScripList.ts` | NEW generated constant (464 KB, header documents source URLs + "do not edit by hand"). Exports: `NseScrip` interface (`symbol`, `companyName`, `series`, `dateOfListing` DD-MMM-YYYY, `paidUpValue`, `marketLot`, `isin`, `faceValue`), `NSE_SCRIPS` (symbol-sorted), derived `NSE_SYMBOL_SET` + `NSE_SCRIP_BY_SYMBOL`, helpers `isNseSymbol` (case-insensitive + trim, O(1)), `getNseScrip`, `searchNseSymbols(query, limit=10)` (symbol-prefix first, then symbol/company substring, alphabetical within). |
| `lib/__tests__/nseScripList.test.ts` | NEW — **11/11**: dataset sanity (2,570 rows, unique UPPERCASE symbols, series ∈ {EQ,BE,BZ}, 8-field row shape, ISIN `^IN[0-9A-Z]{10}$` [SME scrips start `IN9`], listing date DD-MMM-YYYY), fixture spot-checks (RELIANCE/TCS/INFY/20MICRONS), Set/Record consistency, `isNseSymbol`/`getNseScrip`/`searchNseSymbols` behavior incl. case-insensitivity + prefix priority. |
| `package.json` | NEW script `"fetch:scrips": "npx tsx scripts/fetch-nse-scrips.ts"`. |

## Verification

- **tsc** — `npx tsc --noEmit` = **46 = exact baseline (0 new)**; none of the 46 are in the three new files.
- **Targeted** — `nseScripList.test.ts` **11/11** green.
- **Full suite** — unchanged from v3.28.4 baseline (1004 pass / 4 skip / 2 fail; 2 = documented pre-existing
  `intelligence.test.ts` flake) — no runtime code path changed, the constant is purely additive.
- No Prisma schema change → no migration.

## Notes / deferred

- Original v3.28.5 was kept purely additive (constant + generator + helpers only). The consumer wiring below
  landed as a follow-up increment in the same pending version.
- Sourced CSV archived at `C:\Users\lucky\AppData\Local\Temp\opencode\EQUITY_L.csv` (not committed).

---

## v3.28.5 increment — consumer wiring (backtest fall-through, symbol search merge, IPO listed flag)

- **On top of**: the v3.28.5 constant commit (all code above)
- **Status**: Code + tests complete; docs/commit pending user approval (no push/merge)
- **Why**: the user directive said the constant is "loaded for the Symbol references" — wire it into the three
  symbol-reference surfaces now instead of waiting for plans 07/08.

### Design (single source for pure logic)

NEW `lib/services/symbolReference.ts` — both consumers import from here (routes are auth/prisma-heavy, so the
pure logic is directly unit-testable):

- `mergeSymbolSuggestions(constantMatches: NseScrip[], dbMatches: {symbol; companyName?}[], limit = 15):
  {symbol; companyName}[]` — constant-first, dedupe on uppercased+trimmed symbol (constant's companyName wins),
  DB branch uppercases + trims too, result capped.
- `isBacktestSymbolAllowed(symbol: string, hasDbRecord: boolean): boolean` — `hasDbRecord || isNseSymbol(symbol)`.

### Files Changed (increment)

| File | Change |
|------|--------|
| `lib/services/symbolReference.ts` | NEW pure helpers above (≈40 lines, documented). |
| `app/api/symbols/search/route.ts` | Constant-first autocomplete: `searchNseSymbols(search, 15)` → DB `findMany`
  (contains symbol/companyName, isActive, take 15) → `mergeSymbolSuggestions(..., 15)` → merge non-empty returns
  `{symbols, source}` with source `"merged" | "constant" | "db"`. The existing NSE fallback block
  (`getIndexStocks` + `syncStocksToDatabase` + re-query) now runs ONLY when the merged result is empty.
  Response shape unchanged — both consumers (`Autocomplete.tsx` L43, `MarketAnalyticsTabs.tsx` L497) read only
  `data.symbols || []`. |
| `app/api/backtest/run/route.ts` | Hard-404 gate: existing `prisma.symbol.findUnique` record check (L76, the only
  call site in the repo) is now `if (!isBacktestSymbolAllowed(symbolUpper, Boolean(symbolRecord))) → 404`.
  A listed-but-unsynced symbol now falls through to the existing `getBacktestData` chain (SQLite → daily_prices →
  NSE fetch) instead of 404ing. |
| `lib/services/nseIpoService.ts` | `IpoIssue` gains optional `listed?: boolean`; NEW private `enrichIpoIssue(r)`
  resolves `getNseScrip(symbol.trim().toUpperCase())` → `listed: true/false` (false on empty/unknown); IPO catalog
  rows now `.filter(isIpoIssue).map(enrichIpoIssue)` — no rows dropped, series untouched. |
| `app/components/recommendations/IposTab.tsx` | "Listed" emerald pill next to the symbol when `issue.listed`
  (title "Symbol is already listed on NSE — tradeable now"). Client imports `IpoIssue` as type only → no bundle impact. |
| `lib/__tests__/symbolReference.test.ts` | NEW — 11 tests: merge semantics (constant-first, uppercase dedupe
  + trim, constant companyName wins, caps, constant-only/DB-only/empty), backtest gate truth table
  (constant+no-DB → allowed, constant+DB → allowed, unknown+no-DB → rejected, unknown+DB → allowed) + a real-dataset
  sanity check via `NSE_SCRIP_BY_SYMBOL` (RELIANCE). |
| `lib/__tests__/nseIpoService.test.ts` | MODIFIED — the pre-existing v3.6.4 suite (11: getUpcomingIpoIssues, issue-size parsers, getIpoIssueDetail) preserved + NEW `getUpcomingIpoIssues — scrip-list enrichment` describe (4): RELIANCE → `listed: true`, `NEWIPOXYZ` → `false`, `"  reliance  "` → `true` (trim + case-insensitive, `""` → false), 3-row attach `[true,false,true]` (RELIANCE/NEWIPOXYZ/TCS). Shape-exact L129 assertion updated to expect the `listed` field (SHIPROCKET genuinely in the scrip list; NACL SME not). File total **15**. |

### Verification (increment)

- **Targeted** — `symbolReference.test.ts` (11) + `nseIpoService.test.ts` (15 = 11 pre-existing v3.6.4 + 4 enrichment)
  + `nseScripList.test.ts` (11) — 37 green
- **tsc** — `npx tsc --noEmit` = **46 = exact baseline (0 new)**; none of the 46 touch the new/edited files
  (pre-existing DataFetcher/LoadingSpinner jest-dom + client-cache/enhanced-cache/validation/filter-engine/userService test typing).
- No Prisma schema change → no migration.

---
