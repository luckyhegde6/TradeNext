# Plan 09 — SQLite-First NSE Read Architecture + Low-Frequency Prisma Sync

> **Status:** ✅ COMPLETE — implemented on branch `fix/v3.29.1-header-watchlist`, code + tests committed `9303bd7`→`653b617` (9 commits). Verification: sqlite.test.ts **68/68** (11 new P8), full **1105 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake), tsc **46 = exact baseline (0 new)**, no migration. **Deferred (plan rev-v3 c/d)**: `query_cache` + db-health monthly-ops window NOT implemented (follow-up). Doc commit pending user.
> **Spec:** `.agents/specs/09-sqlite-first-read-architecture.md`
> **Revision (v2):** sync direction corrected — **6h = ONE-WAY SQLite → Prisma PUSH via `_sync_outbox`; the ONLY Prisma → SQLite flow is boot hydration.** Locks: outbox tracking, daily_price new/changed-bars push, jobs SQLite-first, admin datasets SQLite-first.
> **Revision (v3, 2026-09-07 user directives):** (a) **Plan limit is now MONTHLY — 200K ops/mo resetting on the 2nd** (Prisma dashboard authoritative; was 10K/day model). (b) **Prisma calls ALLOWED ONLY at 3 moments: boot hydration, 6h SQLite→Prisma push, and ONE hourly ops-usage write (hour+day granularity). Zero Prisma between.** (c) **NEW SQLite `query_cache`** — recently-fetched top-query results stored in SQLite so repeat reads never touch Prisma. (d) **db-health gains "Total Ops (Monthly Window)" + "Recent 7 Days"** (read/write/cached/hit/miss/total) persisted daily in SQLite. New phases 4b + 4c; Phase 8 extended.

## Execution Order (each step verified before the next)

### Phase 0 — Prod WASM build fix (prerequisite)
1. `package.json`:
   - `"quickbuild": "node scripts/copy-sql-wasm.mjs && next build && node scripts/copy-sql-wasm-netlify.mjs"`
   - `"build": "prisma generate && node scripts/copy-sql-wasm.mjs && next build && node scripts/copy-sql-wasm-netlify.mjs"`
2. Verify `scripts/copy-sql-wasm-netlify.mjs` exists (confirmed) and writes `public/sql-wasm.wasm` → `.next/sql-wasm.wasm`.
3. Verify: `npm run quickbuild` exits 0 and `.next/sql-wasm.wasm` exists locally.
> **Note:** Netlify `publish=".next"` — confirm `.next/sql-wasm.wasm` survives (Next 16 may prune unknown assets on some builds; if so, recheck on the first deploy — spec Q4).

### Phase 1 — `sync_history` TABLE (durable history)
1. `lib/sqlite.ts` SCHEMA_SQL: add `sync_history` table (columns per spec §4.2).
2. Add `recordSyncHistory(db, { direction, trigger, leaderGated, rowsSynced, durationMs, error? })` helper (PRAGMA-guarded like other helpers; INSERT + prune-100). Direction values: `'prisma_to_sqlite'` (boot) | `'sqlite_to_prisma'` (6h push / admin push).
3. `syncFromPrisma()`: after success AND in the catch, `recordSyncHistory({ direction:"prisma_to_sqlite", trigger: opts.reason })`.
4. `pushSqliteToPrisma()` (Phase 4) + `reconcileControlToPrisma()`: record `direction:"sqlite_to_prisma"` rows.
5. `getHealthStatus()`: `recentSyncs` = SELECT from `sync_history ORDER BY id DESC LIMIT 10` (try/catch → fall back to `state.syncHistory`).
6. `getSqliteFallback().getHealthStatus` type: `recentSyncs` items gain optional `trigger/direction/leaderGated/durationMs` fields (keep `at/rowsSynced/error`).
7. **Tests:** `sqlite.test.ts` +2 (boot-pull insert + error row + prune-100 per spec §9).

### Phase 2 — Boot hydration on EVERY instance (the only Prisma → SQLite flow)
1. `syncFromPrisma(opts?: { reason?: "boot"|"probe"|"admin"; skipReconcile?: boolean; leaderBypass?: boolean; force?: boolean })`:
   - **New logic:** `const isBoot = opts?.reason === "boot"`. Leader gate applies only when `!leaderBypass && !force`. Reconcile (SQLite→Prisma push) runs only when `!skipReconcile` (i.e., probe/admin/force, never boot). Breaker gate ALWAYS applies to `leaderBypass` pulls (a held Prisma → graceful catch + sync_history error row, retry at 6h probe).
2. `initSqliteBackup()` L1004: `await syncFromPrisma({ reason: "boot", skipReconcile: true, leaderBypass: true })`.
3. `instrumentation.ts`: no change (already calls `initSqliteBackup()`); confirm `register()` waits or fire-and-forget is fine (current: fire-and-forget catch — keep).
4. **Tests:** `daemon-sqlite-first.test.ts` +1 (boot opts passed), spec §9.

### Phase 3 — NSE rate guard (`lib/services/nseRateGuard.ts`)
1. NEW file (zero DB, memory-only maps on globalThis like other singletons):
   - `nseInflight: Map<string, Promise<unknown>>` — `withSingleFlight(key, fn)`.
   - `nseLastCall: Map<string, number>` — `withThrottle(key, { minIntervalMs })`.
   - `nseFailureWindow: number[]` — burst cooldown: ≥5 failures (403/419/429) in 60s → `isNseCooldownActive()` true for 60s; `recordNseFailure()`.
   - `getNseRateGuardStatus()` for db-health/monitoring (optional).
2. Wire:
   - `lib/nse-client.ts` `nseFetch()` — wrap in single-flight per `method+path`, min-interval 1s default, fail-fast when cooldown active (return stale-cache marker instead of hitting NSE).
   - `lib/nse-api.ts` fetchers — historical 250ms, chart 5s, index 2s (known-call-sites get explicit keys).
   - `lib/market-cache.ts` `getOrFetchNseData()` — SWR already present; ensure guard runs before fetch.
   - `getBacktestData` chain + historical sync — keep 200ms inter-symbol delay; guard applies per symbol.
3. **Tests:** NEW `nseRateGuard.test.ts` (6, spec §9). Mock `@/lib/nse-client` usage unaffected (guard is best-effort wrapper).

### Phase 4 — `_sync_outbox` TABLE + 6h PUSH engine (SQLite → Prisma)
1. SCHEMA_SQL: add `_sync_outbox` table + `idx_sync_outbox_table` index (spec §4.4).
2. Add `recordSyncOutbox(db, tableName, rowId, op = "upsert")` helper (no-op when mirror not ready; INSERT row).
3. Add `getOutboxPending(db)` → `{ tableName → count }` (GROUP BY, zero-Prisma).
4. Add exported `pushSqliteToPrisma(db, { reason = "probe", leaderGate = true })`:
   - if `leaderGate && !(await isLeader("sqlite-sync"))` return `{ skipped: true }`.
   - Drain grouped latest-op-wins (spec §4.4 step 2).
   - Per-table sinks (spec §4.6) with chunk 200; per-table success → delete drained outbox rows; failure → keep + `recordSyncHistory` error.
   - After drain: `await reconcileControlToPrisma()`.
   - `recordSyncHistory({ direction:"sqlite_to_prisma", trigger: reason, rows, durationMs })`.
5. Sink mappers: NEW `lib/sqlitePushSinks.ts` (pure, per-table row → Prisma create/update/delete payload; column translators reusing the `mapWbToPrisma` pattern). `daily_price` sink reuses the backfill `$executeRawUnsafe ON CONFLICT (ticker,"tradeDate") DO UPDATE` SQL shape; `corporate_action` raw upsert `ON CONFLICT (symbol,"actionType","exDate") DO UPDATE`.
6. Wire the 6h probe: `lib/sqlite.ts` `PROBE_INTERVAL_MS` tick + down→up recovery transition from `syncFromPrisma()` PULL → `pushSqliteToPrisma({ reason:"probe" })` PUSH (this is the corrected direction — replaces the v3.26.0 "pull every tick" behaviour).
7. **Tests:** `sqlite.test.ts` +6 (outbox insert/grouped-latest/delete-survival/daily_price-marker dedupe/drain-clear/failure-retain), spec §9.

### Phase 5 — NSE captures → SQLite + outbox (remove auto-promote)
1. `instrumentation.ts`: remove `startNsePromoteFlush` from the `@/lib/sqlite` import (L21) and the call (L108).
2. `worker-service.ts` L209 + L343, `historicalPriceSyncService.ts` L262: delete the `flushNseToPrisma()` call lines (keep `cacheDailyPrice*` / `cacheChartinkResults` writes to SQLite).
3. `lib/sqlite.ts`: keep `promoteNseToPrisma`/`flushNseToPrisma`/`startNsePromoteFlush`/`stopNsePromoteFlush` exported; guard `startNsePromoteFlush`'s timer behind `process.env.NSE_PROMOTE_ENABLED === "1"` (default off); `promoteNseToPrisma` reused by the push engine for the NSE-captured tables.
4. Outbox appends in the capture helpers (spec §4.5): `cacheSymbol`, `cacheDailyPriceBars` (per-symbol marker), `cacheCorporateActions` (per row), `cacheChartinkResults` (per row).
5. `instrumentation.test.ts`: remove `startNsePromoteFlush: jest.fn()` from the `@/lib/sqlite` mock (or keep + assert not called) — update mock + add assertion `expect(sqlite.startNsePromoteFlush).not.toHaveBeenCalled()`.

### Phase 6 — Jobs write SQLite-first (recs / swing / perf)
1. Mirror parity validation: existing `daily_recommendation_run`/`daily_recommendation_stock` tables (v3.19) re-checked against the current Prisma model columns (v3.13+ metadata fields) — extend via idempotent `ensureXColumns`-style ALTERs if missing.
2. SCHEMA_SQL additions: `recommendation_tracker`, `recommendation_status_history`, `recommendation_archive`, `swing_analysis_job`, `swing_signal` (spec §4.9).
3. New write-through helpers on `SqliteFallback` (spec §4.7): `insertDailyRecommendationRun`, `upsertDailyRecommendationStock`, `upsertRecommendationTracker`, `appendRecommendationStatusHistory`, `insertRecommendationArchive`, `upsertSwingAnalysisJob`, `upsertSwingSignal` — each INSERT/REPLACE mirror row + `recordSyncOutbox`. Row ids stay client-side UUIDs (id passthrough precedent).
4. Swap pipelines (keep result shapes identical; tests re-pointed):
   - `dailyRecommendationService.ts`: L154/241/260/292/308/526/527/628/648/698/709/817/1034/1049/1467/1478 → write-through helpers.
   - `swingRecommendationService.ts`: L337/349/468/492/660/787/854/862/967/1054 → helpers (claim/update/retry/exhaust/supersede semantics preserved via mirrored `status`/`attemptCount`).
   - `recommendationPerformanceService.ts`: L355 archive + tracker updates → helpers.
   - `getLatestRecommendations`/swing/perf reads: re-base fingerprint/read paths on `recommendationsCache` → SQLite mirror → Prisma (Prisma is 6h-behind by design — spec §4.7).
5. **Tests:** re-point the 3 pipeline suites' mocks to sqlite helpers + outbox (assert `prisma.recommendationTracker.*` etc. NOT called); add read-path mirror tests.

### Phase 7 — Admin long-lived datasets SQLite-first (announcements / corp-actions / alerts / holdings)
1. SCHEMA_SQL additions: `admin_announcement`, `alert`, `transaction` (± `corporate_action` mirror exists) (spec §4.9).
2. `syncFromPrisma` boot pulls: add the 4 admin tables to the per-table try/catch loop (`transaction` capped to the admin-holdings display scope — confirm exact view during implementation, spec R4).
3. New `SqliteFallback` CRUD helpers: `listAdminAnnouncements/getAdminAnnouncement/upsertAdminAnnouncement/deleteAdminAnnouncement`, `listAlerts/upsertAlert/deleteAlert`, `listTransactions/upsertTransaction/deleteTransaction` — write helpers append `recordSyncOutbox` (`op:'delete'` for deletes).
4. Flip admin CRUD routes to the helpers:
   - `app/api/admin/announcements/route.ts` (reads + writes)
   - `app/api/admin/corporate-actions/route.ts` (reads + writes)
   - `app/api/admin/alerts/route.ts` (reads + writes)
   - `app/api/admin/holdings/route.ts` (reads + writes)
   - Co-writer tasks (alert lifecycle evaluator, announcement broadcast) stay Prisma write-through (spec R3).
5. `getSqliteDerived()` (spec §4.10) returns the admin + derived tables for admin-page reads: `{ swingJobs, swingSignals, trackers, statusHistory, archives, aiConfigSet, sessionsMeta, adminAnnouncements, alerts, transactions }`.
6. **Tests:** admin CRUD route tests read from mirror helpers + assert outbox appends; sqlite roundtrips for `admin_announcement`/`alert`/`transaction`.

### Phase 8 — db-health UI + push action + read-helper wiring
1. `app/api/admin/db-health/route.ts` GET: include `sqlite.syncHistoryTable` (bool), `sqlite.outboxPending` (per-table counts), `sqlite.derivedCounts` (rows per new table, zero-Prisma read) + render persisted `recentSyncs`. POST: NEW `"push_to_prisma"` action (`reason:"admin"`, `leaderGate:false`) → runs `pushSqliteToPrisma`; `"sync_sqlite"` stays a pull with `trigger:"admin"`.
2. `app/admin/utils/db-health/page.tsx`:
   - Recent Sync History card: add `trigger`/`direction`/`leaderGated`/`durationMs` columns + "persisted across restarts" note.
   - NEW **Outbox pending** section (per-table chips + "Push to Prisma" button feeding `push_to_prisma`).
   - Note on Cached-Prices card: Prisma `daily_prices` updates arrive via the 6h push / manual push.
3. `app/admin/utils/nse-sync`: messaging that syncs write SQLite; Prisma updates at 6h push (or manual db-health push).
4. Header comments on the hot routes updated to document the read chain (memory → SQLite → NSE/Prisma) — documentation only.

### Phase 9 — Verification (full gate)
1. `npx tsc --noEmit` → **46 = exact baseline (0 new production errors)**.
2. `npm run test` full suite (targeted: sqlite, daemon-sqlite-first, nseRateGuard, instrumentation, dailyRecommendationService, swingRecommendationService, recommendationPerformanceService, admin CRUD) → all green.
3. Local live-verify (:3000 via `npm run local`):
   - db-health: SQLite Ready; Recent Sync History shows **boot** rows (`prisma_to_sqlite`) + **push** rows (`sqlite_to_prisma`); restart server → history persists.
   - Outbox: run a market sync → outbox pending > 0 (`daily_price` per-symbol markers); POST `push_to_prisma` → Prisma `daily_prices` updated, outbox counts → 0.
   - `/api/recommendations`, `/api/recommendations/swing`, `/api/admin/db-health`: `readTier` shows sqlite/memory hits, zero Prisma on hot path.
   - NSE rate guard visible (db-health or logs): single-flight/throttle counters increment.
4. Playwright: db-health, recommendations, swing, markets, admin announcements/alerts/holdings pages — desktop + mobile 375px, 0 console errors.
5. **Docs:** AGENTS.md row (v3.30.0), CHANGELOG entry, TODO row, Primer, agent-memory, Lessons (new lesson: NSE blacklisting + SQLite-first read discipline + 6h push-only model), visual explainer HTML (already updated), spec/plan final status.

## Risks / Open Questions (spec §10 — for the human approval)
- **R1 Multi-instance freshness for job results (accepted):** SQLite-first job writes are fresh only on the writing instance; others serve mirrors (boot-hydrated) + memory cache until the 6h push. Mitigation (publish-on-write for job rows) = Phase-9 follow-up if needed.
- **R2 `daily_price` marker rewrite volume:** 6h push rewrites the full bar history of marked symbols (idempotent, chunked) — fine at current sizes.
- **R3 Admin outbox vs co-writer overlap:** alert lifecycle evaluator / announcement broadcast stay Prisma write-through; same-row admin outbox push wins (rare).
- **R4 `transaction` boot-hydration volume:** cap to the admin-holdings display scope (confirm during implementation).
- **Q1 Boot vs breaker:** `leaderBypass + skipReconcile` on boot (every instance pulls; breaker respected) — NOT bare `force:true`.
- **Q2 AI-config mirroring:** value-masked `is_set` flag only (never the API key in SQLite).
- **Q3 Session mirroring:** metadata-only; Prisma authoritative for validation.
- **Q4 `.next` asset pruning:** verify `sql-wasm.wasm` survives the Netlify build on the first deploy after Phase 0.

## Files Touched
| File | Change |
|---|---|
| `package.json` | quickbuild/build append `copy-sql-wasm-netlify.mjs` |
| `lib/sqlite.ts` | `sync_history` + `_sync_outbox` tables; `recordSyncHistory`; `recordSyncOutbox`; `getOutboxPending`; `pushSqliteToPrisma` (drain → sinks → reconcile); probe pivot push-only; boot opts (`leaderBypass`/`skipReconcile`); job + admin mirror tables + write-through helpers; `getSqliteDerived()`; capture outbox appends; `startNsePromoteFlush` env-gated; `recentSyncs` from table |
| `lib/sqlitePushSinks.ts` | NEW — per-table row → Prisma payload mappers (snake→camel, reuse `mapWbToPrisma` pattern) + daily_price/corporate_action raw upsert SQL shapes |
| `lib/services/nseRateGuard.ts` | NEW — single-flight/throttle/cooldown |
| `lib/nse-client.ts`, `lib/nse-api.ts`, `lib/market-cache.ts` | wire rate guard |
| `instrumentation.ts` | remove `startNsePromoteFlush` call |
| `worker-service.ts`, `historicalPriceSyncService.ts` | remove `flushNseToPrisma()` calls (keep SQLite captures) |
| `lib/services/dailyRecommendationService.ts` | Prisma writes → sqlite write-through helpers + outbox; read paths re-based on memory → mirror → Prisma |
| `lib/services/swingRecommendationService.ts` | same (jobs/signals/trackers) |
| `lib/services/recommendationPerformanceService.ts` | same (archive + tracker updates) |
| `app/api/admin/announcements/route.ts`, `corporate-actions/route.ts`, `alerts/route.ts`, `holdings/route.ts` | reads/writes → sqlite mirror helpers + outbox |
| `app/api/admin/db-health/route.ts` | `syncHistoryTable`, `outboxPending`, `derivedCounts`, persisted recentSyncs, POST `push_to_prisma` |
| `app/admin/utils/db-health/page.tsx` | history card columns + persisted note + Outbox pending section + Push button |
| `app/admin/utils/nse-sync` | SQLite-only messaging |
| `app/api/recommendations/swing/route.ts`, ai-monitoring, admin users | wire `getSqliteDerived()` |
| Tests | sqlite +8, daemon-sqlite-first +2, nseRateGuard new 6, instrumentation update, 3 pipeline suites re-pointed, admin CRUD mirror tests |
| Docs | AGENTS.md, CHANGELOG, TODO, Primer, agent-memory, Lessons, visual explainer HTML, spec/plan |

## Verification Commands
```bash
npx tsc --noEmit
npm run test
npm run local             # then Playwright/live checks
npm run quickbuild        # after Phase 0 — verify .next/sql-wasm.wasm
```