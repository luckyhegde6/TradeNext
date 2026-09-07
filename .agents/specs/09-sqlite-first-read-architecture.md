# Spec 09 — SQLite-First NSE Read Architecture + Low-Frequency Prisma Sync

> **Status:** DRAFT for human approval — no code until approved.
> **Branch:** `feat/sqlite-first-read-architecture` (create from `main`)
> **Prereq:** prod WASM build fix (see §7) — SQLite cannot initialize on Netlify without it.
> **Revision (v2):** sync model corrected per user directive — **the 6h sync is SQLite → Prisma (ONE-WAY PUSH); the ONLY Prisma → SQLite flow is boot hydration.** V2 also locks four previously-open decisions: `_sync_outbox` change tracking, daily_prices push = new/changed bars only, jobs write SQLite-first, admin long-lived datasets write SQLite-first.

## 1. Problem Statement

The app currently treats Prisma/Postgres as the primary data tier for almost every read and write. Production evidence:

- **DB failures cascade into the UI** — the app degrades to 500s/empty screens or fires the global circuit breaker when Prisma/Accelerate hiccups, even though a local SQLite mirror (v3.19–v3.28) already holds most of the data.
- **NSE write-through mirrors each fetch to Prisma** (`flushNseToPrisma` at 3 call sites + a 60s `startNsePromoteFlush` timer) — high-frequency, high op-count, and pointless: Prisma is not the source of truth for NSE market data.
- **Boot hydration is leader-gated** — on multi-instance Netlify cold-start bursts only ONE instance hydrates SQLite from Prisma; the others serve stale/empty mirrors.
- **Sync history is in-memory only** (`state.syncHistory`) — empty after every restart, so the admin db-health "Recent Sync History" card lies after deploys.
- **No NSE rate discipline** — several routes and the daily market sync can burst-call NSE, risking blacklisting (we already see 403/419 from NSE on prod).

User directives (authoritative):
1. *"make my pages less reliant on the DB data and more on the NSE fetch and the SQLITE but avoid frequent calling and high frequency fetch on NSE apis to avoid getting blacklisted; Prisma as a backup and for auth and for the initial bootup; since during boot SQLITE will be empty it needs to be hydrated from PRISMA for existing data like recommendations, swing, performance, audit, worker status, AI configs and auth sessions; only low frequency data."*
2. *"the Prisma daily prices table is referred in any ways it needs to be synced during the 6hr sync"* + **"the 6h sync is from SQLITE to PRISMA not from prisma to SQLITE"** — the recurring sync is a PUSH.
3. Long-lived admin pages (announcements, corporate-actions, alerts, holdings) should be SQLite-first too — boot-hydrated, their CRUD writes to SQLite, pushed to Prisma at the 6h sync (user-facing consumers see edits within ~6h — accepted).

## 2. Goals / Non-Goals

### Goals
1. **SQLite-first read tier for derived + market data** — hot routes serve from memory → SQLite before ever touching Prisma; Prisma is a last-resort fallback for reads.
2. **NSE-fetch-first live data** — market data (quotes, indices, corp actions, screener results, daily prices) is fetched from NSE into SQLite with a **rate-limit discipline** (single-flight, min-interval throttle, stale-while-revalidate, cooldown after bursts) to avoid blacklisting.
3. **Boot hydration on EVERY instance (the only Prisma → SQLite flow)** — at `register()`/`initSqliteBackup()` each instance hydrates the empty SQLite from Prisma for the **low-frequency set**: recommendations, swing, performance trackers, audit, worker status, AI configs, auth sessions (safe columns), cron/jobs/tasks, corp actions, admin long-lived datasets (announcements, alerts, holdings). Nothing periodic ever pulls Prisma → SQLite again.
4. **6h sync = ONE-WAY SQLite → Prisma PUSH (leader-gated)** — a `_sync_outbox` drain plus the control-plane reconcile. Hourly/minute-level NSE→Prisma promote is removed. The 6h push is what keeps the Prisma `daily_prices` table (and every other Prisma consumer) fresh.
5. **Change tracking via `_sync_outbox` TABLE** — every tracked SQLite write appends `(table_name, row_id, op, at)`; the 6h push drains it into Prisma; failed pushes leave rows for idempotent retry; hard deletes survive via `op='delete'`.
6. **Jobs write SQLite-first** — the daily-recommendations / swing / performance pipelines write their results to SQLite mirrors + outbox at runtime; Prisma receives them at the 6h push.
7. **Admin long-lived datasets write SQLite-first** — announcements / corporate-actions / alerts / holdings admin CRUD writes SQLite + outbox; Prisma receives admin edits at the 6h push.
8. **Durable `sync_history` TABLE** — real table in SQLite (persists across restarts), surfaced in the db-health "Recent Sync History" card.
9. **WASM build fix** — Netlify ships `.next/sql-wasm.wasm` so SQLite initializes on prod (blocker for everything above).

### Non-Goals
- No auth rewrite — Prisma remains **authoritative** for auth/sessions; SQLite mirrors session *metadata* for display only.
- No new NSE endpoints; no new Prisma models/migrations (all new tables are SQLite-native).
- No removal of `promoteNseToPrisma`/`flushNseToPrisma` exports (6h push + admin/manual path + tests keep them callable); they're just no longer auto-invoked by the 60s timer.
- No change to the write-behind log store (v3.22.0) — audit/API/server logs stay on the existing `wb_*` → important-rows-promotion path (NOT the outbox).
- No change to the plan-limit breaker, write-budget guard, or readTier telemetry.

## 3. Architecture Overview

```
┌──────────────────────────────  ROUTES / PAGES  ─────────────────────────────┐
│   market-data routes                 derived-data routes                    │
│   (/api/nse/*, /api/dividends,       (/api/recommendations, /swing,         │
│    /api/corporate-actions,            perf, admin db-health, cron,          │
│    /api/fo/*, screener, backtest)     workers, ai-monitoring, status)       │
└──────┬──────────────────────────────────┬──────────────────────────────────┘
       │ (a) memory cache                 │ (a) memory cache
       ▼                                  ▼
   SQLite mirror (hot snapshots)     SQLite mirror (derived + admin tables)
   daily_price_snapshot/symbols/     daily_recommendation_run/stock, trackers,
   daily_price, chartink_screener    swing mirrors*, audit_log, worker_status,
   _result, corporate_action         ai_config*, user_session*, cron/run/task,
       │                              admin_announcement*, alert*, transaction*
       │ miss                         │ miss
       ▼                              ▼
   NSE API (throttled,              Prisma (LAST-RESORT fallback for reads;
   single-flight, SWR,               authoritative for auth)
   anti-blacklist discipline)             ▲
       │ write-through to SQLite          │ 6h leader PUSH (outbox drain +
       ▼                                  │ reconcileControlToPrisma) — ONE WAY
   cache (memory+SQLite)             SQLite ─────────────────────────────────┘
   + recordSyncOutbox()              (boot: Prisma ──► SQLite, every instance,
   (daily_price per-symbol            the ONLY pull, before serving)
    markers, corp actions, …)
```

**Data ownership (write paths — sync direction is QUIETLY CORRECTED):**
| Data class | Source of truth | Read path | Write path |
|---|---|---|---|
| Live market (quote/chart/indices/corp actions/screener) | NSE | memory → SQLite → NSE | NSE fetch → SQLite cache (outbox for push-eligible) |
| Daily prices / snapshots | NSE → SQLite | memory → SQLite → (miss) Prisma | NSE → `cacheDailyPrice*` → SQLite + outbox (new/changed bars) → **6h push** → Prisma |
| Recommendations / swing / performance | **SQLite** (jobs write SQLite-first) | memory → SQLite mirror → Prisma fallback | **jobs write SQLite + outbox → 6h push** → Prisma |
| Admin long-lived (announcements / corp-actions / alerts / holdings) | **SQLite** (admin CRUD SQLite-first) | SQLite mirror (boot hydrated) | **admin CRUD writes SQLite + outbox → 6h push** → Prisma |
| Audit / worker / cron / tasks | SQLite (write-behind + control plane) | SQLite mirror → Prisma fallback | write-behind (important rows promoted at drain) + `reconcileControlToPrisma` push at 6h |
| AI config | Prisma (`ai_config`) | SQLite mirror (non-secret cols) | Prisma (config edits); mirrored at boot only (`is_set` flag — no key value) |
| Auth/sessions | **Prisma (authoritative)** | Prisma always for validation; SQLite mirrors safe metadata | Prisma only |
| Write-behind logs (API/server/audit) | SQLite `wb_*` | SQLite only (14d TTL) | write-behind; important rows promoted at drain |

## 4. Behaviours

### 4.1 Boot hydration (EVERY instance — the ONLY Prisma → SQLite flow)
`initSqliteBackup()` already calls `await syncFromPrisma().catch(...)` at L1004 — but that path is **leader-gated inside `syncFromPrisma`**, so only one instance hydrates. Change:

```ts
// lib/sqlite.ts initSqliteBackup():
await syncFromPrisma({ reason: "boot", skipReconcile: true, leaderBypass: true }).catch(log)
```
- NEW `syncFromPrisma` opts: `{ reason?: "boot" | "probe" | "admin"; skipReconcile?: boolean; leaderBypass?: boolean; force?: boolean }`.
  - `skipReconcile: true` for boot — the SQLite→Prisma control-plane push stays **single-writer** (only at the 6h leader probe / admin force), so a cold-start burst of N instances can't race writes.
  - `leaderBypass: true` for boot — every instance hydrates its OWN mirror (pulls are read-only on Prisma).
  - The **breaker gate stays**: if Prisma is unavailable at boot, hydration degrades gracefully (log + `sync_history` error row, retry at next 6h probe). A held Prisma never cascades a boot failure (`opts.boot` semantics, not bare `force:true`).
- Boot pulls the low-frequency set **and** the 4 admin long-lived datasets (Table in §4.9). `daily_price` full table is NOT boot-pulled (high-frequency market data — it fills from NSE captures); only `daily_price_snapshot` (recent rows) is seeded for the closed-market read chain.

### 4.2 `sync_history` TABLE (durable)
New table in SCHEMA_SQL:
```sql
CREATE TABLE IF NOT EXISTS sync_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  direction TEXT NOT NULL,          -- 'prisma_to_sqlite' (boot only) | 'sqlite_to_prisma' (6h push / admin push)
  trigger TEXT NOT NULL,            -- 'boot' | 'probe' | 'admin'
  leader_gated INTEGER NOT NULL DEFAULT 1,
  rows_synced INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
```
- `syncFromPrisma` (boot pull, success + failure), `pushSqliteToPrisma` (6h push + admin force-push), and `reconcileControlToPrisma` each INSERT a row.
- Prune to last 100 rows (`DELETE FROM sync_history WHERE id NOT IN (SELECT id FROM sync_history ORDER BY id DESC LIMIT 100)`).
- `getHealthStatus()` reads `recentSyncs` FROM the table (desc, limit 10) instead of `state.syncHistory` — persists across restarts; `state.syncHistory` retained only as an in-memory fallback while the table init is pending.

### 4.3 NSE anti-blacklist discipline (new)
New `lib/services/nseRateGuard.ts` (memory-only, no DB):
- **Single-flight per endpoint key** — concurrent identical NSE requests share one in-flight promise (`nseInflight: Map<string, Promise<unknown>>`), applied inside `nseFetch`/`getOrFetchNseData`.
- **Min-interval throttle** — per-endpoint-key minimum spacing (`lastCallAt` map; skip interval: quote 1s, chart 5s, historical 250ms, index 2s, corp actions 30s, marquee 30s). Overrides (dev) via `NSE_THROTTLE_MS` env map.
- **Stale-while-revalidate** — hot reads serve the SQLite/memory snapshot immediately while a background refresh re-fetches NSE (already the pattern in `enhancedCache.getWithCache`; extend to SQLite snapshot reads).
- **Burst cooldown** — after ≥5 NSE 403/419/429 responses within 60s, back off 60s and serve SQLite/stale only (existing 403/419 handling stays).
- **Boot stagger** — historical-price sync keeps its 200ms inter-symbol delay; market-sync step 4 keeps the 6-min budget.
- Wired into `nseFetch` (client) + `lib/nse-api.ts` fetchers + `getBacktestData` chain (no behaviour change when limits not exceeded).

### 4.4 `_sync_outbox` TABLE + 6h PUSH engine (SQLite → Prisma, ONE-WAY)
New table in SCHEMA_SQL:
```sql
CREATE TABLE IF NOT EXISTS _sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,          -- SQLite mirror table name (sink mapping §4.6)
  row_id TEXT NOT NULL,              -- SQLite mirror row id (client UUID / 'NSE:<SYMBOL>' marker / etc.)
  op TEXT NOT NULL DEFAULT 'upsert', -- 'upsert' | 'delete'
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_table ON _sync_outbox(table_name);
```
- **Record helper** `recordSyncOutbox(db, tableName, rowId, op = "upsert")` — no-op when the mirror db isn't ready; INSERT row. Called by every tracked SQLite write helper (cache helpers, job write-through helpers, admin CRUD helpers).
- **Hard deletes are safe**: the outbox row (op='delete') survives the mirror-row deletion, so the 6h push issues the corresponding Prisma `deleteMany`.
- **Push engine** `pushSqliteToPrisma(db, { reason, leaderGate = true })`:
  1. Leader gate unless `leaderGate:false` (admin force) — `isLeader("sqlite-sync")`.
  2. Drain: `SELECT table_name, row_id, op, MAX(id) FROM _sync_outbox GROUP BY table_name, row_id` — latest op wins (upsert after delete = upsert).
  3. Per table with a sink mapping (§4.6): read mirror rows for the collected ids, translate via the per-table sink mapper, write to Prisma **chunked (chunk 200)** — `upsert`/`createMany(skipDuplicates)`/raw `ON CONFLICT`/`deleteMany` per the mapping.
  4. Per-table success → `DELETE FROM _sync_outbox WHERE table_name = ? AND row_id IN (…)`. Any failure → keep rows, record `sync_history` with error, retry next cycle (idempotent retries — Prisma upserts are idempotent).
  5. After the drain: `reconcileControlToPrisma()` (existing control-plane push).
  6. `recordSyncHistory(direction: "sqlite_to_prisma", trigger: reason, rows, durationMs, error?)`.
- **daily_price bulk-volume guard**: per-symbol marker rows (`row_id: "NSE:<SYMBOL>"`) instead of per-bar rows during historical backfills — the sink re-reads ALL bars for that symbol and rewrites them chunked (`ON CONFLICT (ticker,"tradeDate") DO UPDATE`, reusing the backfill SQL shape). Keeps the outbox ~O(symbols) not O(bars) (~300 rows not ~75K during a 300×250 backfill).

### 4.5 NSE captures → SQLite + outbox (replaces auto-promote)
- Remove the auto-promote timer + mirror calls:
  - `instrumentation.ts`: remove `startNsePromoteFlush` import (L21) + call (L108).
  - `worker-service.ts` L209, L343 + `historicalPriceSyncService.ts` L262: delete the `flushNseToPrisma()` write-mirror calls.
  - Keep `startNsePromoteFlush`/`stopNsePromoteFlush` exported (or guard behind `NSE_PROMOTE_ENABLED=1`, default off) for the manual path; `promoteNseToPrisma` stays exported and is reused by the 6h push/manual admin (`promote`/`cache` + `recordSyncOutbox`).
- Every existing SQLite capture helper gains a `recordSyncOutbox` append:
  - `cacheSymbol(symbol)` → outbox `('symbols', id, 'upsert')`
  - `cacheDailyPriceBars('NSE:'+symbol, bars)` → outbox `('daily_price', 'NSE:<SYMBOL>', 'upsert')` (marker, not per-bar)
  - `cacheCorporateActions(rows)` → outbox per row `('corporate_action', id, 'upsert')`
  - `cacheChartinkResults(templateId, rows)` → outbox per row `('chartink_screener_result', id, 'upsert')`
- Prisma `daily_prices` stays fresh for ALL its readers (backtestDataService, analyticsService, prediction-tracker, swing indicators, perf bridges, corp-action yield, dividend calendar, stock-service, portfolio history) via the 6h push — per the "referred in any ways it needs to be synced during the 6hr sync" directive.
- `promoteNseToPrisma()` reads SQLite for ALL captured datasets and writes Prisma chunked — it IS the 6h push body for the NSE-captured tables (reused, not deleted).

### 4.6 Push sink mapping (per SQLite table → Prisma model)
| SQLite table | Prisma model | Strategy |
|---|---|---|
| `symbols` | `Symbol` | raw upsert `ON CONFLICT (symbol) DO UPDATE` |
| `daily_price` | `DailyPrice` | marker → re-read bars → chunked raw upsert `ON CONFLICT (ticker,"tradeDate") DO UPDATE` (reuse backfill SQL) |
| `corporate_action` | `CorporateAction` | chunked raw upsert `ON CONFLICT (symbol,"actionType","exDate") DO UPDATE` (unique `@@unique([symbol, actionType, exDate])`) |
| `chartink_screener_result` | `ChartinkScreenerResult` | chunked `createMany skipDuplicates` |
| `daily_recommendation_run` | `DailyRecommendationRun` | chunked upsert by id (`createMany skipDuplicates` + `update`), id passthrough |
| `daily_recommendation_stock` | `DailyRecommendationStock` | chunked `createMany skipDuplicates` + `update` by id |
| `recommendation_tracker` | `RecommendationTracker` | chunked upsert by id (+ `ON CONFLICT` if an alternate unique exists — verify) |
| `recommendation_status_history` | `RecommendationStatusHistory` | `createMany` (append-only), id passthrough |
| `recommendation_archive` | `RecommendationArchive` | `createMany skipDuplicates`, id passthrough |
| `swing_analysis_job` | `SwingAnalysisJob` | upsert by id |
| `swing_signal` | `SwingSignal` | upsert by id (unique `@@unique([jobId, symbol])` — verify) |
| `admin_announcement` | `AdminAnnouncement` | upsert by id; delete → `deleteMany` |
| `alert` | `Alert` | upsert by id; delete → `deleteMany` |
| `transaction` | `Transaction` | upsert by id; delete → `deleteMany` |
> Sink mappers are thin column translators (snake→camel, reusing the `mapWbToPrisma` pattern); per-table try/catch — a table failure never blocks other tables.

### 4.7 Jobs write SQLite-first (recs / swing / perf)
Replace the Prisma writes in the three pipelines with SQLite write-through helpers + `recordSyncOutbox`:
- `dailyRecommendationService` — principal call sites (from grep): L154 run create, L241 tracker createMany, L260 tracker updateMany, L292 stock createMany, L308 run update, L526/527/698/709/817 run/stock cleanup + updates, L628/648 stock update / tracker updateMany, L1034/1049 tracker update + status-history create, L1467/1478 tracker update/create.
- `swingRecommendationService` — L337/349 tracker createMany/updateMany, L468/492 swingSignal createMany/updateMany, L660/787/854/862/967/1054 swingAnalysisJob claim/update/retry/exhaust/supersede/create.
- `recommendationPerformanceService` — L355 recommendationArchive create + tracker updates.
- New write-through helpers on `SqliteFallback`: `insertDailyRecommendationRun(row)`, `upsertDailyRecommendationStock(row)`, `upsertTracker(row)`, `appendStatusHistory(row)`, `upsertSwingAnalysisJob(row)`, `upsertSwingSignal(row)`, `insertRecommendationArchive(row)` — each INSERT/REPLACE mirrored rows + `recordSyncOutbox(table, id)`. Row ids are client-side UUIDs (matches the audit write-behind id passthrough precedent — idempotent pushes).
- Reads: `recommendationsCache` (memory) → SQLite mirror (now fresh, since jobs write it) → Prisma fallback. The API route's fingerprint/staleness check re-bases on the local SQLite mirror + memory cache (Prisma is 6h-behind by design).
- **Known tradeoff (accepted):** with SQLite-first writes, a multi-instance deployment sees job results immediately only on the instance that wrote them; other instances serve from their mirrors (freshened at boot) + memory cache until the 6h push. Recorded as a Risk (§10) with a publish-on-write mitigation option (Phase-9 follow-up, not in this scope).

### 4.8 Admin long-lived datasets write SQLite-first
- Boot hydrates `admin_announcement`, `corporate_action` (mirror already exists + `cacheCorporateActions`), `alert`, `transaction` (holdings) from Prisma (§4.9 — `transaction` volume cap: hydrate rows needed for admin display; confirm cap during implementation).
- Admin CRUD routes (announcements, corporate-actions, alerts, holdings) flip to SQLite-first helpers + `recordSyncOutbox`:
  - Reads: SQLite mirror (boot-hydrated + admin edits) — zero Prisma on the admin page hot path.
  - Writes (create/update/delete): SQLite mirror + outbox → Prisma via 6h push (delete → `op='delete'`).
- Co-writer tasks that touch the same Prisma tables (alert lifecycle evaluator, announcement broadcast task) remain Prisma write-through; same-row overlap with a queued admin outbox row resolves admin-wins at push (rare, acceptable).
- User-facing consumers (portfolio for holdings, alerts page) reflect admin edits within ~6h — user-accepted tradeoff.

### 4.9 NEW SQLite mirror tables (boot hydration set)
SCHEMA_SQL additions (all `CREATE TABLE IF NOT EXISTS`, non-destructive — **no Prisma migration**):
| Table | Prisma source | Columns (mirrored) | Why |
|---|---|---|---|
| `swing_analysis_job` | `SwingAnalysisJob` | id, symbol?, status, startedAt, completedAt, attemptCount, error, supersededBy | Swing tab survives without Prisma |
| `swing_signal` | `SwingSignal` | id, symbol, direction, entryPrice, target, stopLoss, status, createdAt | Swing performance cards |
| `recommendation_tracker` | `RecommendationTracker` | id, symbol, status, entryPrice, targetPrice, stopLoss, currentPrice, returnPercent, createdAt | Performance tab |
| `recommendation_status_history` | `RecommendationStatusHistory` | id, trackerId, fromStatus, toStatus, createdAt | Tracking audit trail |
| `recommendation_archive` | `RecommendationArchive` | id, trackerId, snapshot, archivedAt | Archive tab |
| `ai_config` | `AiConfig` (Secret) | id, key, **value masked** (`isSet` boolean only), category, updatedAt | AI monitoring shows configured models; **API key value NEVER mirrored to SQLite** |
| `user_session` | `UserSession` | id, userId, email?, createdAt, expiresAt, lastActiveAt, userAgent | Admin sessions list offline; **token/hash NEVER mirrored — Prisma authoritative for validation** |
| `admin_announcement` | `AdminAnnouncement` | id, title, body, category, active, createdAt, updatedAt | Admin announcements page offline |
| `alert` | `Alert` | id, userId, symbol, condition, type, active, createdAt | Admin alerts page offline |
| `transaction` | `Transaction` | id, userId, symbol, type, quantity, price, tradeDate, createdAt | Admin holdings page offline (cap per §4.8) |
| `_sync_outbox` | — (SQLite-native) | id, tableName, rowId, op, at | Change queue for the 6h push |

Update `syncFromPrisma()` to pull these (each wrapped in per-table try/catch like existing tables; missing Prisma table → skip, not fail). `reconcileControlToPrisma` unchanged (worker_status/cron/task push only).

### 4.10 Read-path verification (SQLite-first fallbacks)
Ensure the hot routes already falling back to SQLite stay correct and document the chain in each route's header comment:
- `/api/recommendations` (memory → sqlite → Prisma), `/api/corporate-actions/combined` (sqlite_mirror), `/api/screener/chartink` (sqlite), swing (`getSqliteSwingRecommendations`-style or job mirror), backtest (`getSqlitePriceRange`).
- NEW read helper `getSqliteDerived()` in `lib/sqlite.ts` returning `{ swingJobs, swingSignals, trackers, statusHistory, archives, aiConfigSet, sessionsMeta, adminAnnouncements, alerts, transactions }` for the admin/monitoring + swing/perf routes so they never call Prisma on the hot path.

## 5. API Changes
- `GET /api/admin/db-health` — `sqlite.recentSyncs` now sourced from the `sync_history` TABLE (persisted), plus `sqlite.syncHistoryTable: boolean` (ready flag) and NEW `sqlite.outboxPending` (per-table outbox row counts, zero-Prisma).
- `POST /api/admin/db-health` — NEW action `"push_to_prisma"` (admin-force 6h push: outbox drain + reconcile, `reason:"admin"`, `leaderGate:false`); existing `"sync_sqlite"` becomes a **pull** (boot-style) action and records `sync_history` with `trigger:"admin"`; `"deploy_prep"` unchanged; backup/restore/flush_prices/flush_logs/probe_prisma unchanged.
- Admin CRUD APIs (announcements, corporate-actions, alerts, holdings): unchanged contracts, now SQLite-backed.
- No other public API changes.

## 6. UI Changes
- `app/admin/utils/db-health/page.tsx` — "Recent Sync History" card gains `trigger`/`direction`/`leaderGated`/`durationMs` columns + "persisted across restarts" note; NEW small **Outbox pending** summary (per-table counts + "Push to Prisma" button); note on the daily-price flush card that Prisma updates come via the 6h push.
- `app/admin/utils/nse-sync` — messaging: syncs write SQLite; Prisma receives data at the 6h push (or manual db-health push).

## 7. WASM Build Fix (prerequisite)
- `netlify.toml` build stays `npx prisma generate && npm run quickbuild`; **`quickbuild` changes from** `node scripts/copy-sql-wasm.mjs && next build` **to** `node scripts/copy-sql-wasm.mjs && next build && node scripts/copy-sql-wasm-netlify.mjs` (the Netlify script writes `public/sql-wasm.wasm` → `.next/sql-wasm.wasm`, and `publish=".next"` ships it).
- `build` (migrations + build) likewise appends the Netlify copy step.
- Local dev unchanged (`copy-sql-wasm.mjs` → `public/` already works; `resolveSqlWasm` checks `.next` first, then `public`, then `node_modules`).
- Verify: prod /admin/utils/db-health shows SQLite **Ready** + hydrated table counts.

## 8. Security Review
- `ai_config` mirror stores **`isSet` flag only** — API key value stays Prisma-only (in-memory SQLite is same-process but never log/export it).
- `user_session` mirror excludes token/hash/refreshToken; Prisma remains authoritative for `auth()` validation; mirror serves admin display only.
- `_sync_outbox` carries only `table_name + row_id + op` — **no payload data**, nothing sensitive.
- Sink mappers never log row payloads beyond the existing pattern; push failures log table + error only.
- `sync_history` is UI-facing — no secrets, no PII beyond existing tables.
- No new client-exposed endpoints; admin-only surfaces unchanged.

## 9. Tests
- `lib/__tests__/sqlite.test.ts`: +8 — `_sync_outbox` insert + grouped-latest-op-wins read; outbox drain clears only successful tables; `op='delete'` survives mirror-row deletion; `daily_price` marker dedupes per symbol; `pushSqliteToPrisma` success path (mock prisma sink calls); failure retains outbox rows (retry-safe); `sync_history` insert on boot pull (success) + error row on failure; prune-100.
- `lib/__tests__/daemon-sqlite-first.test.ts`: +2 — boot passes `{reason:"boot", skipReconcile:true, leaderBypass:true}`; 6h probe calls `pushSqliteToPrisma` (push) NOT `syncFromPrisma` (pull).
- `lib/__tests__/nseRateGuard.test.ts`: NEW (6) — single-flight dedupe; min-interval throttle; burst cooldown after 5×403; SWR returns stale while refreshing; reset; config overrides.
- `lib/__tests__/instrumentation.test.ts`: mock update — `startNsePromoteFlush` removed from the `@/lib/sqlite` mock + assert never called.
- `lib/__tests__/dailyRecommendationService.test.ts` / `swingRecommendationService.test.ts` / `recommendationPerformanceService.test.ts`: re-point the Prisma mocks to the SQLite write-through helpers + outbox (`sqlite.upsertTracker` etc. called, `prisma.recommendationTracker.*` not called); result-shape assertions unchanged.
- Admin CRUD tests (announcements/corporate-actions/alerts/holdings routes): reads from sqlite mirror helper; writes hit helper + `recordSyncOutbox`.
- tsc: **46 = exact baseline (0 new)**; full suite green; no schema change → **no Prisma migration** (SQLite-only tables via `CREATE TABLE IF NOT EXISTS`).

## 10. Rollout / Verification / Risks
1. Branch `feat/sqlite-first-read-architecture` from `main`.
2. Implement in this order: WASM fix → `sync_history` table + recording → boot-hydration opts → nseRateGuard → `_sync_outbox` + push engine → NSE capture outbox + remove auto-promote → job SQLite-first mirrors → admin datasets → db-health UI/push action → read-helper wiring.
3. Verify locally (:3000): SQLite Ready; Recent Sync History shows boot rows (direction `prisma_to_sqlite`) and push rows (direction `sqlite_to_prisma`); restart server → history persists; POST `push_to_prisma` → Prisma `daily_prices`/recs/admin rows updated; `GET /api/recommendations`, `/swing`, `/performance`, db-health all serve with 0 Prisma calls on their hot paths (readTier counters); outbox row counts drop to 0 after a successful push.
4. Full Jest suite + tsc 46 baseline + targeted suites.
5. Playwright: db-health page, recommendations, swing, performance, markets — desktop + mobile 375px, 0 console errors.
6. User approves → commit → user merges PR → Netlify rebuild (WASM fix ships) → verify prod SQLite Ready + hydrated + a 6h push lands Prisma data.

**Risks / Open Questions (for the human approval):**
- **R1 Multi-instance freshness for job results (accepted tradeoff):** SQLite-first job writes are locally fresh; other instances' mirrors refresh at boot + memory cache until the 6h push. Mitigation option (publish-on-write for job rows) is a Phase-9 follow-up if production runs multi-instance writing jobs.
- **R2 `daily_price` marker rewrite volume:** each 6h push rewrites the full bar history of marked symbols (idempotent; chunked). Fine for the current dataset sizes; revisit if captures explode.
- **R3 Admin outbox vs co-writer overlap:** alert lifecycle evaluator / announcement broadcast tasks keep Prisma write-through; a same-row admin outbox push wins (rare).
- **R4 `transaction` boot-hydration volume:** cap the mirrored rows to what admin holdings displays (confirm exactly which view during implementation).
- **Q1 Boot vs breaker:** recommended `leaderBypass + skipReconcile` (every instance pulls; breaker respected) rather than bare `force:true`.
- **Q2 AI-config mirroring:** value-masked `is_set` only — confirm the API key never lands in SQLite (security).
- **Q3 Session mirroring:** metadata-only; Prisma stays authoritative for validation (spec §8).
- **Q4 `.next` pruning:** verify `sql-wasm.wasm` survives the Netlify build on the first deploy after Phase 0.