# v3.26.0 — Prod-Failure Triage: P2002 false-errors + Plan-Limit Breaker False-Trip + "a is not iterable" Market Sync

- **Date**: Sep 03 2026
- **Branch**: `main` (production incident triage, on top of v3.25.0)
- **Status**: Code + docs complete; commit pending user

## Summary

Triage of three production failure signatures surfaced from the **DB Errors panel**, **deploy logs**, and
**admin Tasks panel**: (1) benign `WorkerStatus create` P2002 leader-election races recorded as DB faults;
(2) the plan-limit circuit breaker **freezing the whole app on transient `fetch failed`** network blips
(v3.24.0 false-positive recurring — the biggest prod issue); and (3) **"a is not iterable"** in the scheduled
`Daily Market Sync (System)` cron (the `market_data` case, failed 2/9 + 3/9). Plus the user-directive 12h→6h
sync cadence with a full reconcile on **every** probe tick.

## Files Changed

| File | Change |
|------|--------|
| `lib/prisma.ts` | (1) NEW `isBenignUniqueConflict(err)` — `$allOperations` catch SKIPS `recordDbError` for code `P2002`; (2) plan-limit breaker now trips ONLY on `isPlanLimitHoldError` (removed `isDbUnavailableError` from the trip condition + import) |
| `lib/services/worker/worker-service.ts` | (3) `executeMarketDataSync` iterable/empty guard on `getIndexStocks` result |
| `lib/sqlite.ts` | (4) `PROBE_INTERVAL_MS` 12h→6h + periodic full `syncFromPrisma()` (→`reconcileControlToPrisma`) on every available tick + stale "12h" comment updates |
| `lib/services/swingRecommendationService.ts` | (4) "12h recovery sync" comment → "6h" |
| `app/api/corporate-actions/combined/route.ts` | (4) "12h recovery sync" comment → "6h" |
| `app/api/recommendations/route.ts` | (4) "12h recovery sync" comment → "6h" |
| `lib/__tests__/db-utils.test.ts` | (5) NEW breaker-trip regression: transient network errors degrade but never trip the plan-limit breaker |

## Implementation Detail

### Fix 1 — P2002 false-error reporting (`lib/prisma.ts`)

The DB Errors panel showed `3× WorkerStatus create P2002` today. **Root cause**: the v3.22.0 leader-election
"create-or-stand-by" in `lib/services/leader.ts` — on a cold-start burst (10+ Netlify instances visible in
logs) every instance contends for the same `leader-<role>` workerId; the loser of each `workerStatus.create`
throws P2002, which the caller handles gracefully by standing down. But `$allOperations`' catch recorded every
one as a **DB health fault** (inflating the `other` bucket and the DB Errors panel on every multi-instance restart).

- NEW module-level `isBenignUniqueConflict(err)` — `error.code === "P2002"`.
- The `$allOperations` `.catch` now **skips `recordDbError`** for benign P2002 — `recordDbError(model, op, err)` is
  wrapped in `if (!isBenignUniqueConflict(err))`. The error still **propagates to the caller unchanged**; only the
  diagnostic recording is skipped.

### Fix 2 — Plan-limit breaker false-trip (critical) (`lib/prisma.ts`)

The breaker opened on **any** `isDbUnavailableError(err)`. Prod logs showed a transient connection blip
(17:00:34 `fetch failed`) on an otherwise healthy DB tripping the breaker → 17:04:36 "Plan limit circuit breaker
open" → repeated 17:28/17:29 → cascading "Swing analysis processor crashed" + "Cron daemon resync deferred"
with **zero Prisma access for the 5-min cooldown**. This is the v3.24.0 false-positive recurring.

Critically, while open, `$allOperations` **rejects everything before any query runs** — so the documented
"half-open probe" (`if (typeof g.__planLimitOpenAt === "number") closePlanLimitBreaker()`) is **unreachable
dead code**: nothing can close the breaker until `PLAN_LIMIT_COOLDOWN_MS` (5 min) elapses.

- The trip condition is now **ONLY `isPlanLimitHoldError(err)`** — P6003 / "hold on your account" /
  "planLimitReached" / query timeout (`PrismaQueryTimeoutError`) — which is the real signal the breaker exists
  to catch.
- Transient comms errors (`fetch failed`, DNS, TLS, ECONNRESET, P1001, Bad Gateway…) still make
  `isDbUnavailableError` true → per-query graceful degradation (worker backoff + cached/empty fallbacks) — but
  they **no longer freeze the global breaker**.
- Removed the now-unused `isDbUnavailableError` import.

### Fix 3 — "a is not iterable" Daily Market Sync (`lib/services/worker/worker-service.ts`)

`executeMarketDataSync` (the `market_data` case behind `Daily Market Sync (System)` + `historical_sync` +
`market_data_fetch`) did `for (const stock of getIndexStocks(indexName))` with **no null/iterable guard**.
`getIndexStocks` (`lib/index-service.ts`) **returns `null`** on (a) an empty/invalid `indexName` or (b) an NSE
fetch error (lines 783/809). A `null` return makes `for...of` throw `TypeError: null is not iterable`, which
webpack minifies to **"a is not iterable"** — matching the prod `Daily Market Sync` failures 2/9 + 3/9 at 01:01.

- Added, mirroring the proven `executeStockSync` guard:
  ```ts
  if (!Array.isArray(stocks) || stocks.length === 0) {
    throw new Error("No stocks fetched from NSE (market data sync)");
  }
  ```
- Now the failure is a clear, actionable error (reaped/failed with a readable `error` message) instead of a
  cryptic `TypeError`.

### Change 4 — 12h→6h sync cadence + every-tick reconcile (`lib/sqlite.ts`) (user directive)

- `PROBE_INTERVAL_MS` **12h → 6h**.
- The periodic probe previously called `syncFromPrisma()` (→ `reconcileControlToPrisma`, the **only** Prisma
  control-plane write) **only on the down→up transition**. On a continuously-healthy DB the reconcile ran only
  at boot. NEW: the probe runs a full `syncFromPrisma()` on **EVERY available tick**, so the SQLite→Prisma
  control-plane reconcile actually reaches Prisma **every 6h** even on a healthy DB (per "write to prisma only
  during the sync job"). `syncFromPrisma()` is itself leader + breaker + syncing guarded, so calling it
  unconditionally is safe.
- Updated the stale "12h" comments to 6h in `lib/sqlite.ts` + `lib/services/swingRecommendationService.ts` +
  `app/api/corporate-actions/combined/route.ts` + `app/api/recommendations/route.ts`. `IPO_ANALYSIS_CACHE_TTL_SECONDS`
  (12h **cache** TTL in `lib/services/ipoAnalysisService.ts`) left unchanged — it's a data-freshness cache, not a
  Prisma sync cadence.

## Tests

`lib/__tests__/db-utils.test.ts` — NEW regression (in the "plan-limit circuit breaker" describe):
**"isPlanLimitHoldError does NOT match transient network/connection errors"** — for each transient error
(`fetch failed`/UND_ERR_CONNECT_TIMEOUT, ECONNREFUSED, "Connection refused", P1001 "Can't reach database
server", real Accelerate query-engine message, "Bad Gateway"): `isDbUnavailableError(err) === true` (graceful
degradation still engages) **but** `isPlanLimitHoldError(err) === false` (the breaker must NOT trip). Plus a
benign P2002 case: **both** predicates false (not an outage, not a hold).

Direct unit tests were NOT added for `executeMarketDataSync` / `startRecoveryProbe` (worker-service.ts has no
existing test harness and would require heavy dependency mocking; the guard mirrors the already-proven
`executeStockSync` pattern, and the probe is private with a real `setInterval`). The change is guarded by the
db-utils breaker regression + tsc + the existing targeted suites.

## Verification

- Targeted jest: **db-utils 24 + daemon-sqlite-first + dbOpTiering + leader 58 pass**; **sqlite 34 pass**.
- `npx tsc --noEmit` = **46 = exact baseline** (0 new production errors).
- No schema change → no migration.

## Docs

- AGENTS.md version table row (v3.26.0), `.agents/CHANGELOG.md` index entry, `.agents/changelog/versions-v3.26.md`
  (this file), TODO.md row, `@Primer.md`, `@agent-memory.md`, `@Lessons.md` (Lesson — breaker false-trip on
  connection blips + nullable NSE iterable guard).

## ⚠️ Before commit

- On `main`, uncommitted. Review `git diff` before committing (per repo discipline, agents do NOT auto-commit/
  push/deploy — commit pending user approval).
