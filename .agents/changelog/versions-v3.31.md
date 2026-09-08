# v3.31.0 — SQLite-first NSE read architecture + low-frequency Prisma sync (Plan 09)

- **Date**: Sep 09 2026
- **Branch**: `fix/v3.29.1-header-watchlist` (on top of committed v3.30.0 `1bb4142` + `8af65cc`)
- **Status**: Code + tests committed (`9303bd7`→`653b617`, 9 commits); doc commit pending user
- **Spec/Plan**: `.agents/specs/09-sqlite-first-read-architecture.md` DRAFT; `.agents/plans/09-sqlite-first-read-architecture.md` DRAFT-REV3

## User directive (confirmed)

Plan rev-v3 (a) monthly 200K ops/mo window + (b) Prisma calls restricted to 3 moments (boot hydration, 6h push, hourly ops-write) are the primary constraints this release addresses. Rev-v3 (c) query_cache + (d) db-health monthly-ops window are **deferred** (not implemented — recorded in plan only). "Continue if you have next steps" — no push/merge/deploy without separate explicit approval.

## Root causes found

1. **isLeader Promise truthy bug (production)** — `doPushSqliteToPrisma` had `if (!isLeader("sqlite-sync")) return null;` — `isLeader()` returns a `Promise` (always truthy), so the leader gate never fired and every instance wrote the full outbox. Fixed to `if (!(await isLeader("sqlite-sync"))) return { skipped: true }`. Found during Phase 4 implementation.

2. **SCHEMA_SQL stray `;` in `--` comments** (root cause of v3.30.0 noise) — sql.js treats `;` inside SQL comments as a statement terminator → `near "Prisma": syntax error` on every boot. Comments converted to `/* */` blocks in the Phase 1 commit.

## Design — per phase

### Phase 1 — sync_history ledger + schema comment fix (`9303bd7`)

- `lib/sqlite.ts` SCHEMA_SQL: `sync_history` table (`direction`, `trigger`, `leaderGated`, `rowsSynced`, `durationMs`, `error?`); SCHEMA_SQL comment-`;` fix (converting `--` comments to `/* */`).
- NEW `recordSyncHistory(db, { direction, trigger, leaderGated, rowsSynced, durationMs, error? })` — INSERT + prune-100 oldest (PRAGMA-guarded).
- `syncFromPrisma()`: `recordSyncHistory({ direction: "prisma_to_sqlite", ... })` after success AND in the catch block.
- `getHealthStatus()`: `recentSyncs` = `SELECT ... ORDER BY id DESC LIMIT 10` (try/catch → falls back to `state.syncHistory`).
- `lib/__tests__/sqlite.test.ts`: +2 (sync_history insert + prune-100).
- **File stats**: `lib/sqlite.ts` +170, `lib/__tests__/sqlite.test.ts` +108.

### Phase 2 — Boot hydration on EVERY instance (`d9bda6b`)

- `syncFromPrisma(opts?)` gains `reason?: "boot" | "probe" | "admin"`, `skipReconcile?: boolean`, `leaderBypass?: boolean`, `force?: boolean`.
- Boot path: `initSqliteBackup()` → `syncFromPrisma({ reason: "boot", skipReconcile: true, leaderBypass: true })`.
- `leaderBypass` = skip leader gate on boot (every instance pulls); `skipReconcile` = skip SQLite→Prisma push (boot is pull-only). Reconcile runs only on probe/admin/force ticks.
- `instrumentation.ts`: unchanged (fire-and-forget `initSqliteBackup()` — catch is fine).
- `lib/__tests__/sqlite.test.ts`: +1 (boot opts passed to syncFromPrisma).
- **File stats**: `lib/sqlite.ts` +64, `lib/__tests__/sqlite.test.ts` +69.

### Phase 3 — NSE rate guard single-flight + throttle + burst cooldown (`56ee538`)

- **NEW `lib/services/nseRateGuard.ts`** (pure, zero DB, globalThis maps):
  - `withSingleFlight<T>(key, fn)` — deduplicates in-flight NSE calls per `method+path`.
  - `withThrottle<T>(key, { minIntervalMs }, fn)` — enforces minimum interval between calls to the same endpoint.
  - `isNseCooldownActive()` + `recordNseFailure()` — burst cooldown: ≥5 failures (403/419/429) within 60s → 60s cooldown (returns stale-cache marker instead of hitting NSE).
  - `getNseRateGuardStatus()` for db-health monitoring.
- `lib/nse-client.ts` `nseFetch()`: wrapped with single-flight per `method+path`, 1s min-interval default, cooldown fail-fast.
- `lib/market-cache.ts` `getOrFetchNseData()`: guard runs before fetch (SWR already present).
- Backtest chain + historical sync: keep 200ms inter-symbol delay; guard applies per symbol.
- **NEW `lib/__tests__/nseRateGuard.test.ts`**: 6 tests (single-flight dedup, throttle, cooldown trigger, status shape, recovery after cooldown, failure recording).
- **File stats**: `lib/services/nseRateGuard.ts` +189 (NEW), `lib/__tests__/nseRateGuard.test.ts` +191 (NEW), `lib/market-cache.ts` +24, `lib/nse-client.ts` +25.

### Phase 4 — `_sync_outbox` + 6h SQLite→Prisma push engine (`a681a48`)

- `lib/sqlite.ts` SCHEMA_SQL: `_sync_outbox` table + `idx_sync_outbox_table` index.
- NEW `recordSyncOutbox(db, tableName, rowId, op = "upsert")` — INSERT outbox row; no-op when mirror not ready.
- NEW `getOutboxPending(db)` — `SELECT tableName, COUNT(*) ... GROUP BY tableName`; zero-Prisma.
- NEW `pushSqliteToPrisma(db, { reason?, leaderGate? })`:
  - Leader gate now **awaited** (fixing the isLeader Promise truthy bug — `if (!(await isLeader("sqlite-sync"))) return { skipped: true }`).
  - Drain: grouped latest-op-wins per `(tableName, rowId)` → delete old ops, keep latest.
  - Per-table chunk 200 sinks via `lib/sqlitePushSinks.ts`; per-table success → delete drained outbox rows; failure → retain + `recordSyncHistory({ error })`.
  - After drain: `await reconcileControlToPrisma()`.
  - `recordSyncHistory({ direction: "sqlite_to_prisma", trigger: reason, rows, durationMs })`.
- **NEW `lib/sqlitePushSinks.ts`**: per-table row → Prisma create/update/delete payload mappers; `daily_price` sink uses `$executeRawUnsafe ON CONFLICT (ticker,"tradeDate") DO UPDATE`; `corporate_action` raw upsert `ON CONFLICT (symbol,"actionType","exDate") DO UPDATE`.
- Probe tick: `syncFromPrisma()` 6h tick pivots from PULL to `pushSqliteToPrisma({ reason: "probe" })` PUSH (the corrected v3.26.0 direction).
- `lib/__tests__/sqlite.test.ts`: +10 (guard-order: not-ready / breaker-OPEN / not-leader → null; outbox insert/grouped-latest-op-wins/delete-survival; daily_price marker dedupe; drain-clear; failure-retain; probe-tick-push).
- **File stats**: `lib/sqlite.ts` +204, `lib/sqlitePushSinks.ts` +259 (NEW), `lib/__tests__/sqlite.test.ts` +264.

### Phase 5 — NSE captures SQLite+outbox only, auto-promote off (`f7e56b5`)

- `instrumentation.ts`: removed `startNsePromoteFlush` from the `@/lib/sqlite` import + call.
- `lib/services/worker/worker-service.ts`: removed 2× `flushNseToPrisma()` calls (stock sync + corp-actions sync); `cacheSymbol`/`cacheCorporateActions` writes kept.
- `lib/services/historicalPriceSyncService.ts`: removed end-of-task promote try/catch; `cacheDailyPriceBars` kept.
- `lib/sqlite.ts`: `startNsePromoteFlush` env-gated (`NSE_PROMOTE_ENABLED === "1"` to start; default no-op handle); functions stay exported (reused by push engine).
- `lib/__tests__/instrumentation.test.ts`: +1 assertion (`expect(sqlite.startNsePromoteFlush).not.toHaveBeenCalled()`).
- Grep confirms zero `flushNseToPrisma()` / `startNsePromoteFlush()` call sites outside `lib/sqlite.ts` exports.

### Phase 6 — Jobs write SQLite-first: recs / swing / perf (`ae44431` + `63736f5` + `0013dae`)

Three-step phase (3 commits):

**Step 1–2 (`ae44431`)**: mirror schema parity — existing `daily_recommendation_run`/`daily_recommendation_stock` tables re-checked vs Prisma model (v3.13+ metadata fields); extended via idempotent ALTERs. SCHEMA_SQL additions: `recommendation_tracker`, `recommendation_status_history`, `recommendation_archive`, `swing_analysis_job`, `swing_signal`.

**Step 3 (`63736f5`)**: write-through helpers + push sinks — NEW `lib/sqlite.ts` `SqliteFallback` methods: `insertDailyRecommendationRun`, `upsertDailyRecommendationStock`, `upsertRecommendationTracker`, `appendRecommendationStatusHistory`, `insertRecommendationArchive`, `upsertSwingAnalysisJob`, `upsertSwingSignal`. Each INSERT/REPLACE mirror row + `recordSyncOutbox`; row IDs stay client-side UUIDs.

**Steps 4–5 (`0013dae`)**: pipeline swap — reads re-based on memory → SQLite mirror → Prisma fallback:
  - `dailyRecommendationService.ts`: mirror-first job writes (run/stock/tracker upserts, delete-on-failure, AI-patch via full-row upsert); read path returns cached → SQLite → Prisma.
  - `swingRecommendationService.ts`: job/signal claim/update/retry/supersede via mirrored `status`/`attemptCount`.
  - `recommendationPerformanceService.ts`: archive write-through + perf status writes → mirror helpers.
  - `lib/__tests__/dailyRecommendationService.test.ts`: re-pointed run/stock/tracker/delete/failure/perf assertions to mirror helpers.
  - `lib/__tests__/swingRecommendationService.test.ts`: mirror-factory retrofit.

Verification (Phase 6): **daily 34/34**; swing **52/52**; targeted batch (swing + perf + sqlite + daemon-sqlite-first + nseRateGuard + instrumentation) **145/145**; `npx tsc --noEmit` **46 = exact baseline, 0 new**.

### Phase 7 — Admin long-lived datasets SQLite-first (`a2bffd9`)

- `lib/sqlite.ts` +7 `SqliteFallback` helpers: `deleteCorporateAction` (SELECT natural key → DELETE → outbox natural-key delete → boolean), `upsertAnnouncement` (returns id), `deleteAnnouncement`, `upsertAlert` (id = `row.id ?? randomUUID()`), `deleteAlert`, `upsertTransaction` (ticker uppercased), `deleteTransaction`.
- Table names: `admin_announcement`, `alert` (NOT `admin_alert`), `transaction`, `corporate_action` (mirror exists).
- 4 admin routes flipped mirror-first with Prisma fallback (`if (sqlite)`):
  - `app/api/admin/announcements/route.ts` (reads + writes)
  - `app/api/admin/corporate-actions/route.ts` (check-then-insert natural-key dedupe `symbol|actionType|exDateKey`)
  - `app/api/admin/alerts/route.ts` (reads + writes)
  - `app/api/admin/holdings/route.ts` (reads + writes)
  - Co-writer tasks (alert lifecycle evaluator, announcement broadcast) stay Prisma write-through.
- `lib/sqlitePushSinks.ts` +66: admin-table sink mappers.
- Mock executor: added `DELETE ... WHERE <col> = ?` equality branch (previously fell to whole-table wipe).
- Test-only AUTOINCREMENT simulation in `corporate_action` delete test (`sqlModule.__getStore()` patched).
- `lib/__tests__/sqlite.test.ts`: +4 (announcement upsert/replace + outbox; alert round-trip + delete; transaction round-trip + filters + uppercased ticker + delete; corporate_action delete by natural key).
- **Verification (Phase 7)**: sqlite.test.ts **57/57**; full suite **1093 pass / 4 skip / 2 fail** (2 = pre-existing `intelligence.test.ts` async cache-flake); `npx tsc --noEmit` **46 = exact baseline, 0 new**.

### Phase 8 — db-health wiring + push engine opts + derived counts + hot-route headers (`653b617`)

- `lib/sqlite.ts`: `pushSqliteToPrisma(opts?)` gains `leaderGate?: boolean` (default `true`; admin push uses `false`). NEW `DERIVED_COUNT_TABLES` list, `hasSyncHistoryTable()`, `getOutboxPending()`, `getSqliteDerivedCounts()` (SELECT COUNT per table). Both `recordSyncHistory` sites record `trigger` + `leaderGated`.
- `app/api/admin/db-health/route.ts`: GET spreads `sqlite` (outbox + derived + sync history + health); POST gains `"push_to_prisma"` action → `pushSqliteToPrisma({ reason: "admin", leaderGate: false })` + audit `ADMIN_DB_SYNC` resource `sqlite-push` (403-guarded).
- `app/admin/utils/db-health/page.tsx`: Outbox card (per-table pending + lastAt), Derived-counts card, "Push SQLite → Prisma now" button (`triggerPush` / `pushing` state), Direction/Trigger columns on Run History, footer notes.
- `app/admin/utils/nse-sync/page.tsx`: amber "syncs write SQLite; Prisma updates at 6h push" paragraph.
- Hot-route header comments documenting read chain (memory → SQLite → NSE/Prisma): `app/api/recommendations/route.ts`, `app/api/recommendations/swing/route.ts`, `app/api/screener/chartink/route.ts`, `app/api/corporate-actions/combined/route.ts`, `app/api/nse/indexes/route.ts`.
- `lib/__tests__/sqlite.test.ts`: +11 (hasSyncHistoryTable pre/post-init; getOutboxPending shapes; derived counts shapes; admin push as non-leader succeeds + records trigger/leaderGated; empty-outbox admin push; leader-gated default push returns empty).
- **Verification (Phase 8)**: sqlite.test.ts **68/68** (11 new); `npx tsc --noEmit` **46 = exact baseline, 0 new**.

## Verification — full gate

| Gate | Result | Notes |
|------|--------|-------|
| `npx tsc --noEmit` | **46 = exact baseline, 0 new** | All errors pre-existing (test-only, Prisma mock typing) |
| `npx jest sqlite` | **68/68** | +11 new Phase 8 tests (was 57 at end of Phase 7) |
| `npm run test` (full) | **1105 pass / 4 skip / 1 fail** | 1 fail = documented pre-existing `lib/__tests__/intelligence.test.ts` async cache-flake; excluding it: 82 suites, 0 new failures |
| NSE single-flight | Confirmed | `lib/nse-client.ts` runs through `withSingleFlight` per method+path |
| Probe pivot | Confirmed | 6h tick runs `pushSqliteToPrisma({reason:"probe"})` PUSH (not PULL) |

## Deferred (not implemented — plan rev-v3 (c)/(d))

- **NEW `query_cache`** — recently-fetched top-query results stored in SQLite so repeat reads never touch Prisma. Captured in plan spec only.
- **db-health monthly ops window** — "Total Ops (Monthly Window)" + "Recent 7 Days" read/write/cached/hit/miss/total persisted daily in SQLite. Captured in plan spec only.

## Files Created/Modified

| File | Change |
|------|--------|
| `lib/services/nseRateGuard.ts` | **NEW** — single-flight/throttle/burst-cooldown (zero DB, globalThis maps) |
| `lib/sqlitePushSinks.ts` | **NEW** — per-table row → Prisma payload mappers; `daily_price`/`corporate_action` raw upsert SQL; admin table sinks |
| `lib/sqlite.ts` | `sync_history` + `_sync_outbox` tables; `recordSyncHistory`; `recordSyncOutbox`; `getOutboxPending`; `pushSqliteToPrisma` (grouped-latest-op-wins, chunk-200 sinks, leader-gated, `leaderGate` param); `DERIVED_COUNT_TABLES`; `getSqliteDerivedCounts()`; boot hydration opts (`leaderBypass`/`skipReconcile`/`force`/`reason`); 7 admin + 7 job mirror write-through helpers; `touchControlMirror`; `startNsePromoteFlush` env-gated; SCHEMA_SQL comment-`;` fix |
| `lib/market-cache.ts` | Wire `nseRateGuard` before fetch |
| `lib/nse-client.ts` | Wire `nseRateGuard` single-flight + cooldown fail-fast into `nseFetch()` |
| `instrumentation.ts` | Remove `startNsePromoteFlush` call |
| `lib/services/worker/worker-service.ts` | Remove 2× `flushNseToPrisma()` (stock + corp-actions sync) |
| `lib/services/historicalPriceSyncService.ts` | Remove end-of-task promote (keep SQLite cache writes) |
| `lib/services/dailyRecommendationService.ts` | Reads re-based: memory → SQLite mirror → Prisma; writes via mirror write-through helpers |
| `lib/services/swingRecommendationService.ts` | Same (job/signal claim/update/retry/supersede via mirror status/attemptCount) |
| `lib/services/recommendationPerformanceService.ts` | Archive + tracker status writes via mirror helpers |
| `app/api/admin/db-health/route.ts` | GET: `syncHistoryTable`, `outboxPending`, `derivedCounts`, persisted `recentSyncs`; POST: `"push_to_prisma"` action + audit |
| `app/admin/utils/db-health/page.tsx` | Outbox card, Derived-counts card, "Push to Prisma" button, Direction/Trigger columns on Run History |
| `app/admin/utils/nse-sync/page.tsx` | Amber SQLite-only messaging paragraph |
| `app/api/admin/announcements/route.ts` | Reads/writes via sqlite mirror helpers + outbox |
| `app/api/admin/corporate-actions/route.ts` | Same (natural-key dedupe on insert) |
| `app/api/admin/alerts/route.ts` | Same |
| `app/api/admin/holdings/route.ts` | Same |
| 5 hot-route header comments | `recommendations`, `recommendations/swing`, `screener/chartink`, `corporate-actions/combined`, `nse/indexes` — SQLite-first read chain documented |
| `lib/__tests__/nseRateGuard.test.ts` | **NEW** — 6 tests |
| `lib/__tests__/sqlite.test.ts` | +11 new Phase 8 tests (68/68 total) |
| `lib/__tests__/instrumentation.test.ts` | +1 assertion (`startNsePromoteFlush` not called) |
| `lib/__tests__/dailyRecommendationService.test.ts` | Re-pointed to mirror write-through helpers |
| `lib/__tests__/swingRecommendationService.test.ts` | Mirror-factory retrofit |
| `app/api/openapi/route.ts` | db-health admin route is **NOT documented** (pre-existing gap — follow-up only) |

## Lessons (new)

1. **isLeader Promise truthy gate** — A function returning `Promise<boolean>` used without `await` in an `if (!fn())` guard is always truthy. Always `await` async calls before boolean logic. Found during Phase 4 outbox drain implementation; the leader gate `if (!isLeader("sqlite-sync")) return null;` silently never fired.

2. **SQL comment semicolons in sql.js** — sql.js's `exec()` splits on `;` BEFORE comment stripping. A stray `;` inside a `--` comment breaks statement parsing. Use `/* */` block comments in multi-statement SQL strings.

3. **mirror-first write-through testing** — Prisma mock factories must include the new named exports (`withAccelerateCache` stubs) or tests silently pass with `undefined` methods. Use `structuredClone` for draft objects (JSON.parse loses Date types; plain spread shallow-copies).

---

## Pre-existing gaps carried forward

- db-health admin route (`/api/admin/db-health`) is NOT listed in `app/api/openapi/route.ts`. Follow-up: add GET/POST schemas to OpenAPI.
- Spec branch note: spec head still says branch `feat/sqlite-first-read-architecture` (stale — actual branch is `fix/v3.29.1-header-watchlist`). Fix in spec Status line.
- Plan rev-v3 items (c) query_cache and (d) monthly ops window are deferred — not implemented in this release.
