# v3.54.0 — Scheduled historical price sync (Swing indicator "—" data gap) + mirror-bar fallback

> Status: **CODE + TESTS + GATES + DOCS DONE — COMMIT PENDING USER (D9)**. Push / merge / deploy are **user actions only**.
> Spec: `.agents/specs/35-scheduled-historical-price-sync.md` · Plan: `.agents/plans/35-scheduled-historical-price-sync.md`.
> Branch: `fix/swing-indicators-daily-prices-gap` (from `main` `9a44878`).
> Diff: **8 modified** source/test files + 1 new spec + 1 new plan. **No Prisma schema change → no migration.** No new package, no route change, no UI change.

---

## 1. Overview

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | Every Swing card renders `20d Mom — / 10d Mom — / 20d Vol — / vs 20d High —` (user-reported on prod) | The v3.10.0 `historical_price_sync` worker task was **never scheduled** — `cron_jobs` held only the other 4 system jobs, so nothing ever backfilled `daily_prices` | 5th system cron `Historical Price Sync (System)` at `45 10 * * 1-5` = **16:15 IST Mon–Fri**, after NSE publishes EOD bars |
| 2 | Only NIFTY-50 symbols could ever get bars | `resolveSyncScope` default was deliberately narrowed to NIFTY 50 (v3.10.0 plan-limit ops), leaving ~150 non-NIFTY swing flaggers permanently bare | Scope = **NIFTY 50 ∪ recent swing-flag symbols** (from the zero-Prisma SQLite mirror), capped 200; window `DEFAULT_DAYS 180 → 60` (≈41 bars, enough for the 20-bar indicators) |
| 3 | A single `daily_prices` read failure blanked **every** card's indicators | `fetchRecentCloses` had one `$queryRaw`; any throw → empty map → all indicators `null` | Per-symbol gap fill: Prisma batch first, then the SQLite mirror (`getSqlitePriceRange`) for symbols with <2 bars |

---

## 2. Cron registration (`lib/services/recommendationCronService.ts`)

| Const | Value |
|---|---|
| `HISTORICAL_PRICE_SYNC_CRON_NAME` | `"Historical Price Sync (System)"` |
| `HISTORICAL_PRICE_SYNC_CRON_EXPR` | `"45 10 * * 1-5"` → 16:15 IST, Mon–Fri |
| `SYSTEM_JOB_NAME_BY_TASK_TYPE` | + `historical_price_sync` → the name (wires `recordSystemRunOutcome` counters) |

- Definition appended to the `ensureRecommendationCrons()` array with **`config: { dryRun: false }`**.
- The persisted config is now built **per definition**: `defConfig = { systemManaged: true, timezone, ...(def.config ?? {}) }` — written on create **and** on the self-heal path, so a row that lost `dryRun:false` is rewritten (config drift is compared key-by-key, not just the two standard keys).
- **Why `dryRun:false` matters**: `spawnDueCronJob` passes `job.config` straight through as the task payload, and `executeHistoricalPriceSync` reads `payload.dryRun` — defaulting to `true` for manual runs. Without the flag the cron would spawn a scheduler that fetches and writes **nothing**.
- Degraded mode unchanged: `historical_price_sync` is `degradedSafe:false` in `degradedTaskRegistry`, so while degraded the spawn is skipped (no Prisma writes).
- File header docstring: "four system jobs" → five, with the new bullet.

---

## 3. Scope + defaults (`lib/services/historicalPriceSyncService.ts`)

```ts
const DEFAULT_DAYS = 60;          // was 180
const DEFAULT_MAX_SYMBOLS = 200;  // was 50 ("NIFTY 50 only")
```

`resolveSyncScope()` default branch (explicit `symbols` still wins, unchanged):

1. NIFTY 50 from `index-service` (1 Prisma read; failure → `[]`),
2. ∪ `getSwingSignalSymbols()` — SWING flaggers from the SQLite mirror (**zero Prisma ops**; lazy `import("@/lib/sqlite")`),
3. dedupe (upper-case) → cap at `maxSymbols`.

**Ops budget at the cap**: ~200 symbols × ~41 bars ÷ chunk 200 ≈ **42 upsert statements/day** + 1 scope read + 200 NSE GETs (~40 s at the existing 200 ms delay) — inside the plan-limit discipline. The stale "NIFTY 50 only (~3–6K ops/day)" docstring note is replaced with this math.

---

## 4. New mirror read (`lib/sqlite.ts`)

```ts
getSwingSignalSymbols(limit = 300): string[]
```

`SELECT DISTINCT UPPER(symbol) FROM swing_signal … ORDER BY symbol ASC LIMIT ?` — synchronous, **never throws** (`[]` when the mirror is cold), `recordSqliteRead`-instrumented, limit clamped to 1…2000. Declared on the `SqliteFallback` interface beside its siblings. Generic by design: the caller applies the sync-scope cap.

---

## 5. Swing indicator fallback (`lib/services/swingRecommendationService.ts`)

`fetchRecentCloses` is now two-stage instead of all-or-nothing:

1. Prisma batch (`ROW_NUMBER()` over the newest 25 bars/symbol) — same SQL, same shape; the aggregate `catch` now **falls through** instead of returning an empty map.
2. Symbols with `< 2` bars: read the SQLite mirror and compute from those closes when ≥2 are usable (last 25).

**Defect caught before commit:** the first draft read `getSqlitePriceRange(symbol.toUpperCase())`, but **every mirror OHLCV write is keyed `NSE:<SYMBOL>`** (`cacheDailyPriceBars` callers in `historicalPriceSyncService` and `backtestDataService`). The bare-symbol read matched nothing, so the "fallback" would always return zero bars — i.e. the fix would have shipped doing nothing. Now reads `` `NSE:${symbol.toUpperCase()}` `` and a regression test asserts the exact key (`toHaveBeenCalledWith("NSE:RELIANCE")`).

The mirror is populated by this same daily sync, so bar coverage grows every trading day; Prisma stays preferred whenever it has data (zero extra SQLite work).

---

## 6. Tests

| Suite | Added / changed |
|-------|-----------------|
| `lib/__tests__/recommendationCronService.test.ts` | 5-cron creation (`ensured` 4 → 5), `dryRun:false` config persisted, config-drift self-heal rewrites a row missing the flag, create-when-absent, second call idempotent |
| `lib/__tests__/historicalPriceSyncService.test.ts` | Scope = NIFTY 50 ∪ mirror symbols (deduped, capped); NIFTY failure still syncs swing symbols; `null` mirror tolerated; `DEFAULT_DAYS = 60` range math; explicit `symbols` still wins |
| `lib/__tests__/sqliteMirror.test.ts` | `getSwingSignalSymbols` under **real sql.js**: distinct + upper-cased, limit clamp, `[]` on a cold mirror |
| `lib/__tests__/swingRecommendationService.test.ts` | New indicator-source describe: Prisma full coverage → **mirror never read**; Prisma throws → mirror serves (asserts the `NSE:` key); Prisma returns no rows → mirror serves |

Gates: `check-tsc-baseline` → **total 46 (delta +0), prod 0 (delta +0)** · targeted Jest **4 suites / 117 passed** · full `npm run test` → **138/138 suites · 2110 passed / 4 skipped / 0 failed** · ESLint on the 8 changed files **0 errors** (pre-existing warnings only).

---

## 7. Verification

- `node scripts/dev-checks/check-tsc-baseline.mjs` → `total 46 (baseline 46, delta +0)` / `prod 0`.
- Targeted: `npx jest swingRecommendationService historicalPriceSyncService recommendationCronService sqliteMirror` → **117/117 pass**.
- Full: `npm run test` → **138/138 suites · 2110 passed / 4 skipped / 0 failed** (105 s).
- ESLint on the 8 changed files → **0 errors** (23 pre-existing warnings: `no-explicit-any` / unused `_A`).
- **Live verify deferred**: no local Postgres/Timescale instance was available in this session, so the "row appears → run task → `daily_prices` grows → swing shows numeric indicators" walkthrough is unchecked. The cron row is created idempotently by `ensureRecommendationCrons()` on the next boot of any instance (local **and** prod), and registration + payload wiring are covered by unit tests.

## 8. Rollout notes

- **No migration.** The cron row is created by the existing idempotent by-name upsert on the next boot.
- **Prod needs one manual catch-up**: trigger `historical_price_sync` once from the admin Workers page with a wide scope (or wait for the first 16:15 IST tick) to backfill history; the daily cron keeps it fresh afterwards. Manual triggers still default to `dryRun:true` — pass `dryRun:false` to write.
- If the mirror is cold on first boot, the scope is NIFTY 50 only for that run (graceful degradation), and swing symbols join as the mirror fills.
