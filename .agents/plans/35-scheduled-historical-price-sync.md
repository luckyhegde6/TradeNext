# Plan 35 — Scheduled Historical Price Sync (Swing indicators "—" gap)

Spec: `.agents/specs/35-scheduled-historical-price-sync.md` · Branch: `fix/swing-indicators-daily-prices-gap` (from `main` `9a44878`)

**Status: IMPLEMENTED + VERIFIED** (v3.54.0). Two deviations from the draft, both noted inline:
(1) the mirror bar read must use the `NSE:<SYMBOL>` key (the draft used a bare symbol — see W-4),
(2) the `getSwingSignalSymbols` tests live in `sqliteMirror.test.ts` (real sql.js) rather than `sqlite.test.ts` (mocked runtime) — stronger coverage, same contract.

## W-1: System cron registration (`lib/services/recommendationCronService.ts`)

- [x] Add `HISTORICAL_PRICE_SYNC_CRON_NAME` + `HISTORICAL_PRICE_SYNC_CRON_EXPR = "45 10 * * 1-5"` exports.
- [x] Add the 5th entry to `SYSTEM_JOB_NAME_BY_TASK_TYPE` (→ `historical_price_sync`).
- [x] Add the 5th definition to the `ensureRecommendationCrons()` array with `dryRun: false`; the create + self-heal paths now write a per-def `defConfig` (`{ systemManaged, timezone, dryRun: false }`) and the drift check compares every config key, so a row that lost `dryRun:false` is rewritten.
- [x] Doc-comment update ("all four system jobs" → five; adds the Historical Price Sync bullet).

## W-2: Scope + defaults (`lib/services/historicalPriceSyncService.ts`)

- [x] `DEFAULT_MAX_SYMBOLS` 50 → 200; `DEFAULT_DAYS` 180 → 60 (180 stays reachable via an explicit `days`).
- [x] `resolveSyncScope`: default branch = NIFTY 50 ∪ `getSwingSignalSymbols()` (lazy `@/lib/sqlite` import), deduped, capped; both sources degrade to [].
- [x] File-top docstring + `DEFAULT_MAX_SYMBOLS` comment updated with the ops math (~42 chunked statements/day at the cap).

## W-3: New mirror read (`lib/sqlite.ts`)

- [x] `getSwingSignalSymbols(limit)` on the `SqliteFallback` interface + implementation (`SELECT DISTINCT UPPER(symbol) … LIMIT`), never throws, `recordSqliteRead` instrumented, limit clamped 1…2000.

## W-4: Swing fallback fetch (`lib/services/swingRecommendationService.ts`)

- [x] Refactor `fetchRecentCloses`: keep the Prisma batch read in try/catch; on throw OR per-symbol <2 bars → fill from the mirror via `getSqlitePriceRange` + `computeIndicatorsFromSeries`.
- [x] **DEFECT CAUGHT BEFORE COMMIT**: the draft read `getSqlitePriceRange(symbol)` while every mirror write is keyed `NSE:<SYMBOL>` (`cacheDailyPriceBars` callers in `historicalPriceSyncService` + `backtestDataService`) — the fallback returned zero bars for every symbol. Now reads `NSE:${SYMBOL}`; regression-guarded by the "NSE:<SYMBOL> key" test.
- [x] Call-site + file-header comments updated.

## W-5: Tests

- [x] `recommendationCronService.test.ts`: 5-cron creation with `dryRun:false`, config-drift self-heal, create-when-absent, idempotent — `ensured` counts moved 4 → 5.
- [x] `historicalPriceSyncService.test.ts`: scope union/dedup/cap, NIFTY-failure still syncs swing symbols, null-mirror tolerance, `DEFAULT_DAYS = 60`, explicit-wins unchanged.
- [x] `sqliteMirror.test.ts` (real sql.js): `getSwingSignalSymbols` distinct + upper-cased, limit clamp, [] when the mirror is cold.
- [x] `swingRecommendationService.test.ts`: Prisma full coverage → mirror never read; Prisma throws → mirror serves (asserts the `NSE:` key); Prisma miss → mirror serves.

## W-6: Verify + docs

- [x] `check-tsc-baseline` → total 46 (delta +0), prod 0 (delta +0).
- [x] Targeted Jest → 4 suites / **117 pass**.
- [x] Full `npm run test` → see changelog gates line.
- [x] ESLint on the 8 changed files → **0 errors** (pre-existing warnings only).
- [ ] Live verify (dev + Docker): start dev → confirm the "Historical Price Sync (System)" row → run the task once (`dryRun:false`, small scope) → `daily_prices` growth → swing `analyze=true` once → numeric indicators. **Deferred** — no local Postgres/Timescale instance in this session; the cron registration is covered by unit tests and self-heals on the next prod boot.
- [x] Docs: `.agents/changelog/versions-v3.54.md` + CHANGELOG index + versions-index + Primer + agent-memory + session-todos + handoff + Lesson 168. **AGENTS.md row DEFERRED** (Lesson 142 — the v3.53.0 row on the Spec 36 branch already consumes the per-file budget; a second row would push the file past 32,768 B after both merge).

## Rollout / notes

- No migration; the cron row is created idempotently by `ensureRecommendationCrons()` on the next boot of any instance (local + prod).
- Prod needs ONE manual `historical_price_sync` run with a wide scope (admin Workers page) to backfill history fully; the daily 16:15 IST cron keeps it fresh afterwards.
