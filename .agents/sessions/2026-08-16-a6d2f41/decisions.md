# Session Decisions — 2026-08-16 (v3.12.0)

Branch: `fix/swing-async-analysis` | Commit: pending (user-approved PR merge → Netlify rebuild)

## D1 — Request-time split: Swing AI analysis runs off the request path (A)

**Decision**: `getSwingRecommendations({analyze:true})` returns the fast screener feed instantly with
`analysisStatus:"pending"` and kicks `runSwingAnalysisInBackground()` — a module-guarded fire-and-forget
(`swingAnalysisInFlight` promise dedupes concurrent tab/refresh/force requests; `flushSwingAnalysis()` test
hook) that runs the 4 AI batches, patches `analysis`/`analysisError`, computes the honest
`analysisStatusAfterBatch`, persists swing trackers (non-fatal), audits START/COMPLETE|FAILED + RUN_COMPLETE,
and re-sets the SAME cache key with the final 30-min payload. The pending payload self-expires at a short
`SWING_PENDING_TTL` (10 min) so a dead process degrades to failed state, never hangs the tab.
**Why**: prod `GET /api/recommendations/swing` ran the FULL pipeline synchronously (34 Chartink templates +
AI analysis 38–52s/batch) → Netlify's 30s request wall killed the tab forever (`Duration: 30000 ms` mid-batch-3).
**Not chosen**: reducing batch size / parallelism to fit under 30s (real AI calls are 38–53s EACH — impossible);
raising Netlify's limit (not controllable); streaming partial analysis (cache key collision + UI complexity).

## D2 — Perf-check live-price fallback bridges missing `daily_prices` rows (B)

**Decision**: `checkRecommendationPerformance` collects trackers with no `daily_prices` rows (cap 50,
`MAX_LIVE_FALLBACK_SYMBOLS`) and bridges them via `getStockQuote` in chunked 10-batch `Promise.allSettled`
(`quote?.lastPrice ?? quote?.closePrice`), never throwing. Stage logs added in `runDailyRecommendations`.
**Why**: prod perf run had 130 tracking trackers but only 8 had `daily_prices` rows → Current/Return % blank.
**Not chosen**: widening the backfill window per-tracker (NSE data availability is the wall for 15 symbols —
Lesson 79) or querying NSE serially (too slow inside the perf run).

## D3 — Prod `daily_prices` backfill: explicit `--symbols` from a consumer-coverage query (C)

**Decision**: 3 user-approved passes — (1) default scope `--days 120`: 300 scoped / 246 fetched / 15,226 bars;
coverage check then showed 107/130 tracking trackers still missing (default scope = NIFTY 50 ∪ **30-day**
trackers ∪ live screener — misses July-era trackers); (2) explicit `--symbols` from
`SELECT DISTINCT ticker FROM "RecommendationTracker" WHERE status='tracking' AND NOT EXISTS (SELECT 1 FROM
daily_prices …)`: 85 fetched / 5,596 bars; (3) explicit `--symbols` for the 22 remaining: 7 fetched / 373 bars.
**Total 21,195 bars, 0 errors** → coverage 8 → **115/130 (88%)**, prod 37,387 rows / 602 tickers.
**Why**: "0 errors" ≠ solved — coverage must be measured against the consumers that read the data.
**Not chosen**: re-running the default scope with bigger numbers (scope, not window, was the gap).

## D4 — NSE 200-with-empty-data = data availability, NOT a bug; cover at consumption (D)

**Decision**: 15 stragglers (BAGMANE.RR, SIGACHI, DIGIKORE, ALPEXSOLAR, ELGNZ, GSMFOILS, JAINIK, UCL, BEACON,
MAHICKRA, SUNLITE, VHLTD, CURRENT, TUNWAL, NEUEON) return HTTP 200 with EMPTY data from `historicalOR`
(probed SIGACHI/DIGIKORE/BAGMANE.RR/UCL, ~180-day window, EQ filter). No retry-loop; the D2 live-price
fallback covers them at check time. Diagnosed via temp probe script, deleted after.

## D5 — Heartbeat-aware worker reaper: fail-safe `{0,0}` on liveness-lookup failure (E)

**Decision**: `reapStaleWorkerTasks` fails safe to `{0,0}` when the liveness lookup (workerStatus heartbeat)
errors — a transient DB error must NEVER sweep RUNNING tasks to `failed`; swallowing a sweep is strictly
safer than a false one. Also added the missing worker-status liveness filter so only genuinely-dead workers'
tasks are reaped.

## D6 — Prisma per-query timeout via `$extends` + `Promise.race` (F)

**Decision**: `lib/prisma.ts` gains `$extends({query:{$allOperations}})` that races every query against a
default 120s timeout (`QUERY_TIMEOUT_MS` env) with `.finally(clearTimeout)` — a hung query can't wedge a run
forever (prod probes showed 30s+ slow queries during recs/perf runs). Client API preserved (`$queryRawUnsafe`
etc. still work through the extension).

## D7 — worker-logger `resolveLogsDir()` — tmpdir fallback for read-only FS (G)

**Decision**: NEW exported memoized `resolveLogsDir()`: `cwd/.next/server_logs` (writable) →
`os.tmpdir()/tradenext-logs` → `""` (DB-only), wired into the 5 worker-logger sites + worker-engine startup —
Netlify's read-only FS can no longer crash file logging.

## D8 — Error serialization everywhere pino would drop it (H)

**Decision**: `error instanceof Error ? error.message : String(error)` in worker-engine.ts + cron-daemon.ts —
pino drops non-enumerable Error props (prod logs showed `error={}`). No silent catches left in these paths.

## D9 — Verdicts are pipeline-only at runtime (I)

**Decision**: verified (read + grep) that `DailyRecommendationStock` verdict writes happen only inside the
run pipeline scoped to the run's `id` (guarded admin route + manual `sync-local-to-prod.ts` are the only
other writers); read-only everywhere else. No code change needed.

## D10 — No commit/deploy without user go-ahead (consistent holds)

**Decision**: code + tests + docs complete; commit, push, and PR creation are pending explicit user approval
("implement everything" ≠ "commit"). Prod deploy only after the user merges the PR → Netlify rebuild.
