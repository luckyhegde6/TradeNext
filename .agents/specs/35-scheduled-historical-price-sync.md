# Spec 35 — Scheduled Historical Price Sync (Swing indicators "—" data gap)

## 1. Overview

**What**: Auto-register a 5th system cron (`historical_price_sync`, "Historical Price Sync (System)", 16:15 IST Mon–Fri) so `daily_prices` gets a daily EOD backfill; widen the default sync scope from NIFTY 50-only to **NIFTY 50 ∪ recent Swing-signal symbols** (capped 200, sourced from the zero-Prisma SQLite mirror); reduce the default window from 180 to 60 calendar days (≈41 bars — enough for momentum20/volatility20/20d-high); and give the Swing indicator fetch a SQLite-mirror fallback when the Prisma read fails or misses a symbol.

**Why** (verified 2026-11-01):
- **No cron exists** — local DB `cron_jobs` has only the 4 other system crons; `historical_price_sync` (v3.10.0) was built as a manually-triggerable worker type but was never scheduled. Local `daily_prices`: **20 rows / 5 symbols** (Sep 2026) — nothing since.
- Consequence: every Swing card renders `20d Mom — / 10d Mom — / 20d Vol — / vs 20d High —` (user-reported on prod), and the AI `missing-context` warnings flood the analysis prompt. The fallback analysis (PR #151) also degrades: with `momentum20`/`volatility20` null, direction can only use `changePercent` and levels fall back to base sizes.
- `resolveSyncScope` default was deliberately narrowed to NIFTY 50 (v3.10.0, plan-limit ops ~3–6K/day too high), but that leaves the ~150 non-NIFTY swing flaggers permanently without bars.

**Scope**:
- IN: cron definition + registration (`recommendationCronService.ts`), scope resolution + defaults (`historicalPriceSyncService.ts`), one new zero-Prisma mirror read (`getSwingSignalSymbols` in `lib/sqlite.ts`), Swing `fetchRecentCloses` SQLite fallback (`swingRecommendationService.ts`), tests.
- OUT: no migration, no schema change, no new packages, no UI changes, no backfill-script changes beyond what the defaults affect (`scripts/backfill-daily-prices.ts` keeps passing explicit args), no historical_price_sync executor changes.

**Depends on**: v3.10.0 historical price sync service; v3.28.0 SQLite mirror (`cacheDailyPriceBars` + `getDailyPriceRange`); PR #151 fallback analysis (beneficiary).

## 2. Routes

None modified. The sync stays a worker task (`historical_price_sync`, already dispatchable) — this feature only schedules it and widens its default scope.

## 3. Database Schema

None. `daily_prices`, `cron_jobs`, mirror `swing_signal`/mirror bars tables all exist.

## 4. Design

### A. System cron registration (`lib/services/recommendationCronService.ts`)

Add the 5th definition to `ensureRecommendationCrons()` (same idempotent by-name upsert + self-heal + config-drift rewrite used by the existing 4):

| Const | Value | Notes |
|---|---|---|
| `HISTORICAL_PRICE_SYNC_CRON_NAME` | `"Historical Price Sync (System)"` | stable name |
| `HISTORICAL_PRICE_SYNC_CRON_EXPR` | `"45 10 * * 1-5"` | 16:15 IST Mon–Fri, after NSE close publishes EOD bars |
| `SYSTEM_JOB_NAME_BY_TASK_TYPE` | + `historical_price_sync` → name | wires `recordSystemRunOutcome` counters |

- Description: "System-managed daily NSE EOD backfill into daily_prices — swing momentum indicators source (16:15 IST, Mon-Fri)".
- Default cron `config`: `{ systemManaged: true, timezone: SYSTEM_CRON_TIMEZONE, dryRun: false }`. `spawnDueCronJob` passes `job.config → payload`, and `executeHistoricalPriceSync` reads `payload.dryRun` — so the scheduled run WRITES (manual admin runs without config keep dry-run defaulting true — unchanged behavior).
- Degraded mode: `historical_price_sync` is `degradedSafe:false` (already correct in the registry) — in degraded mode the spawn enqueue is skipped, so no writes while degraded. No change.

### B. Scope + defaults (`lib/services/historicalPriceSyncService.ts`)

`resolveSyncScope` default (no explicit symbols) becomes:

1. NIFTY 50 from `index-service` (existing 1 Prisma read; degrade to []).
2. ∪ distinct symbols from the NEW mirror read `getSwingSignalSymbols()` (zero Prisma).
3. Dedupe → cap at `maxSymbols` (unchanged param).

Constants:
| Const | Old | New | Rationale |
|---|---|---|---|
| `DEFAULT_MAX_SYMBOLS` | 50 | 200 | NIFTY 50 + recent swing flaggers |
| `DEFAULT_DAYS` | 180 | 60 | ≈41 trading bars ≥ 20-bar requirements; ~3× fewer upsert rows than 180 |
| `DEFAULT_FETCH_DELAY_MS` | 200 | 200 | unchanged |

Ops budget at cap: ~200 symbols × 41 bars ÷ chunk 200 ≈ **42 write statements/day** + 1 scope read + 1 per-symbol NSE GET (~40s total at 200ms delay) — well within the plan-limit discipline. The NIFTY-50-only ~500-ops/day note in the service docstring is updated.

### C. New mirror read (`lib/sqlite.ts`)

`getSwingSignalSymbols(limit = 300): string[]` — `SELECT DISTINCT symbol FROM swing_signal ORDER BY symbol ASC` (synchronous, never throws; returns [] when mirror not ready). Exported on the `SqliteFallback` interface like its siblings. Cap applied by the CALLER (`resolveSyncScope`) — mirror read stays generic.

### D. Swing indicator fetch fallback (`lib/services/swingRecommendationService.ts`)

`fetchRecentCloses` currently: one Prisma `$queryRaw` over `daily_prices`; ANY failure → catch → empty map → **every** card loses indicators. Change to per-symbol resolution:

1. Try Prisma batch read (unchanged SQL, unchanged shape) — keep its aggregate catch but now fall through to step 2 instead of returning an empty map.
2. For symbols with missing/partial (<2 bars) data: read `getSqlitePriceRange(symbol)` closes and compute indicators from that series when it yields ≥2 bars (`computeIndicatorsFromSeries` is already exported/pure).
- Zero Prisma ops in the fallback path (sqlite reads are recorded but free by design).
- Comment updated: the mirror is populated by the same daily sync (via `cacheDailyPriceBars`), so bar coverage grows daily.

## 5. Tests (`lib/__tests__/`)

1. `recommendationCronService.test.ts` — ensure creates the 5th job with the right name/expr/config (dryRun:false), self-heals drift, idempotent on second call.
2. `historicalPriceSyncService.test.ts` —
   - scope = NIFTY 50 ∪ mirror symbols, deduped, capped at `maxSymbols`;
   - `DEFAULT_DAYS = 60` (date-range math);
   - explicit `symbols` wins over the default scope (empty explicit → sync nothing, unchanged);
   - cron-config payload path `dryRun:false` → writes happen (existing per-symbol tests mostly cover; add one asserting the worker-service default dryRun=true for manual runs is untouched).
3. `sqlite.test.ts` — `getSwingSignalSymbols`: distinct symbols, [] when no db, [] on error.
4. `swingRecommendationService.test.ts` — `fetchRecentCloses` serves SQLite bars when the Prisma read throws; serves SQLite bars when Prisma returns nothing for a symbol; keeps Prisma results when both have data (Prisma wins).

## 6. Verification Gates

- `npx tsc --noEmit` — prod 0 (46-baseline all `__tests__/`).
- Targeted Jest suites green → then `npm run test` full suite.
- `npm run lint` on changed files — 0 errors.
- Live verify (dev + Docker): start dev → ensure-crons creates "Historical Price Sync (System)" row → trigger the task once (admin Workers or API) with `dryRun:false` limited symbols → confirm `daily_prices` row growth → run swing `analyze=true` once → cards show numeric `20d Mom/20d Vol` and analysis no longer logs missing-context warnings → confirm fallback targets when AI unavailable.

## 7. Risks

| Risk | Mitigation |
|---|---|
| NSE historical endpoint rate-limits (419/429) | 200ms inter-symbol delay + per-symbol error tolerance (existing) |
| Plan-limit ops growth | 60-day window + chunked writes ≈ 42 ops/day; capped 200 symbols |
| Cron runs while a stale-catchup window repeats | standard spawn dedup (90-min window) already applies |
| Mirror bars stale after abstention | indicators prefer Prisma when available; mirror is additive only |
