# TradeNext — Database Migration Ledger

> Running bookkeeping document for every Prisma migration in this repo: **what** it
> created/changed, **when**, and **why** (the decision behind it). Kept alongside the
> schema (`prisma/schema.prisma`) and migration folder (`prisma/migrations/`) as the
> human-readable "decision log" for the schema.
>
> This is a **living document** — every new migration MUST get a row here with its
> decision, models, TTL/cleanup policy, and rollback note, before the migration is
> committed.

---

## How to apply migrations

| Environment | Command | Notes |
|-------------|---------|-------|
| CI / Netlify build | `npx prisma migrate deploy` | Runs all pending migrations in `prisma/migrations/` in order. This is what the remote deploys. |
| Fresh local dev | `npx prisma migrate dev --name <name>` | Creates + applies a new migration from schema drift. |
| Existing local dev (db-pushed DB) | `npx prisma db push` | This dev DB was built with `db push` (no migration history applied). `migrate dev` will refuse to continue without a destructive reset — **never reset local**. Per Prisma Guardrails: `migrate reset --force` / `db drop` are BLOCKED for AI agents; STOP → INFORM → EXPLAIN → VERIFY → WAIT. |
| Validate a migration offline | `prisma migrate diff` against a temp shadow DB | See "Verification workflow" below. |

### Verification workflow (used for the chartink migration, 2026-08-11)

For a new migration, generate the SQL delta **without touching any real database**:

```bash
# 1. Snapshot the pre-change schema (git show HEAD:prisma/schema.prisma → temp file,
#    or strip the newly added models from the current schema).

# 2. Generate the SQL delta:
npx prisma migrate diff \
  --from-schema <temp-old-schema.prisma> \
  --to-schema prisma/schema.prisma \
  --script > new_migration.sql

# 3. Create the migration folder (timestamp AFTER the latest one in prisma/migrations/):
mkdir prisma/migrations/<YYYYMMDDHHMMSS>_<name>
copy new_migration.sql prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql

# 4. Prove the FULL history replays from scratch on a throwaway DB (this is what
#    `migrate deploy` does on prod, so the test must be identical):
docker exec tradenext-db-1 psql -U postgres -c "DROP DATABASE IF EXISTS tradenext_shadow;" -c "CREATE DATABASE tradenext_shadow;"
set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tradenext_shadow&& npx prisma migrate deploy

# 5. Confirm the new tables exist, then drop the scratch DB:
docker exec tradenext-db-1 psql -U postgres -d tradenext_shadow -c "\dt chartink*"
docker exec tradenext-db-1 psql -U postgres -c "DROP DATABASE IF EXISTS tradenext_shadow;"
```

> ⚠️ The local dev DB (`tradenext`) is kept in **db-push state** — tables exist but no
> migration history is recorded, so `prisma migrate dev` reports drift and demands a
> reset. That is expected. Never reset it. Migrations are validated against the shadow
> DB instead, and applied to real non-local environments via `migrate deploy`.

---

## Migration history (newest → oldest)

| Migration | Date | What it created / changed | Decision (why) |
|-----------|------|---------------------------|----------------|
| `20260811103000_add_chartink_screener_models` | 2026-08-11 (v3.5.5) | `ChartinkScreener`, `ChartinkScreenerRun`, `ChartinkScreenerResult` (maps: `chartink_screeners`, `chartink_screener_runs`, `chartink_screener_results`) + 8 indexes + 2 FKs (result→run, result→screener, both `ON DELETE CASCADE`) | Three models to persist the **117-entry Chartink template registry** and its captured scan tables: (1) `ChartinkScreener` mirrors the JSON configs so definitions live ONCE in DB (source of truth for the unified runner) instead of only in code; `id` = the JSON id (e.g. `fundamental.profit-jump-by-200`) for stable joins; `scanClause`/`debugClause`/`columnClause`/`backtestMaxRows`/`scanlinkId`/`backtestUrl` preserved for live scan + capture playback. (2) `ChartinkScreenerRun` is one full sync (clean-table → re-insert whole dataset) tracking status/counts/TTL. (3) `ChartinkScreenerResult` stores the captured row per (run, screener) with `expiresAt` = `capturedAt + ttlHours` (**72h TTL** — matches the fresh/stale read policy; stale rows are pruned). **Backfill:** none — definitions are upserted at runtime by `chartinkScreenerService.upsertChartinkScreener()`, so an empty table is correct; the 117 entries seed on first run. **Rollback:** `DROP TABLE` the three tables loses only captured scan snapshots (regenerable via capture tool `scripts/chartink-capture/capture.ts` / live Chartink scan). **Verification:** delta generated via `migrate diff` (old schema snapshot → current), full 32-migration replay on `tradenext_shadow` scratch DB passed. |
| `20260807103000_add_recommendation_archive` | 2026-08-07 (v3.5.0) | `RecommendationArchive` snapshot table + `DailyRecommendationStock.trackerId` (SetNull) | Performance tracking lifecycle (`tracking → target_achieved/stop_loss_hit → archived` after 360d) needs a **frozen snapshot** so a recommendation's record at archive time can't be mutated by later price changes; `trackerId SetNull` keeps the daily-stock row valid after archiving so history views still resolve. **Note:** same timestamp as the next migration — must stay ordered after it in the folder. |
| `20260807103000_add_daily_run_triggered_by` | 2026-08-07 (v3.5.0) | `DailyRecommendationRun.triggeredBy` (`system`/`admin`), `status` index, `runDate` index | Distinguish **scheduled** perf runs (10:00 IST cron, idempotent) from **manual** admin triggers (runNow) so Run History can show Manual/System badges and avoid double-counting in the cron ledger. |
| `20260719081430_ph18_daily_recommendations` | 2026-07-19 (v3.3.0) | Phase-18: `DailyRecommendationRun`, `DailyRecommendationStock`, `RecommendationTracker`, `RecommendationStatusHistory`, `RecommendationSubscription`, `RecommendationAlertSubscription` + indexes | Whole daily-recommendations subsystem: one row per generated run, one row per (run, symbol), a long-lived tracker per (symbol, createdAt) for performance measurement, status history audit, and Telegram/user subscriptions. Unique `(runId, symbol)` prevents duplicate stocks per run; unique `(symbol, createdAt)` makes the tracker idempotent across re-runs. |
| `20260314004508_add_user_sessions` | 2026-03-14 (v1.8.0) | `UserSession` model + session-token unique index + FK to User | Server-side session tracking for auth security (httpOnly cookies, invalidation, admin session management). |
| `20260314003005_add_security_monitoring` | 2026-03-14 (v1.8.0) | Security/monitoring tables (rate limits, audit logs, anomaly alerts layer) | Rate-limit enforcement + audit trail + anomaly detection for the security hardening pass. |
| `20260314002044_add_market_cache` | 2026-03-14 | `MarketCache` model (`cacheKey` unique, `dataType`, `nextSyncAt` indexes) | DB-backed market-data cache tier for serverless (memory → DB → NSE chain) so cold Netlify instances don't hammer NSE. |
| `20260314000242_add_task_categories` | 2026-03-14 (v1.7.0) | `WorkerTask.taskCategory` + indexes | Task categorization for the worker engine (data-sync vs analysis vs alert tasks). |
| `20260312235715_add_tasks_workers_cron_screener` | 2026-03-13 (v1.7.0) | `WorkerTask`, `WorkerStatus`, `TaskEvent`, `CronJob`, `ScanConfig`/`ScanResult`/`ScanResultItem`, `ScreenerConfig`/`ScreenerResult`/`ScreenerRunLog` | Background worker engine + cron config + advanced screener persistence (saved screens, results, run logs) — the task queue backbone of the app. |
| `20260312210333_add_indexname_to_announcements` | 2026-03-12 | Announcement `indexName` (rename/rebuild of earlier attempts — see the three `20260224/20260225/20260305` predecessors) | Corporate announcements needed an index-name column; multiple re-attempts were consolidated. |
| `20260311144500_add_ratelimit_model` | 2026-03-11 | Rate-limit/config models | API rate limiting (per user/endpoint, flagging). |
| `20260311143500_add_missing_tables` | 2026-03-11 | Catch-all missing tables | Brought the schema in line with models that had accumulated without migrations during early dev. |
| `20260310172116_add_corporate_actions_fields` | 2026-03-10 (v1.4.0) | Corporate-action fields (yield, sorting, filtering support) | Enhanced corp actions display (dividend yield %, filters, pagination). |
| `20260306211636_add_deal_tables` | 2026-03-06 | `BlockDeals`, `BulkDeals` + indexes | NSE block/bulk deal data ingestion. |
| `20260305214709_add_indexname_to_announcements` | 2026-03-05 | Announcement `indexName` (third attempt) | See `20260312210333` row. |
| `20260304080552_add_symbol_table` | 2026-03-04 | `Symbol` model (unique `symbol`, `companyName` index) | Central stock list for screener/search/autocomplete (~2,000 NSE symbols). |
| `20260301153000_fix_audit_logs` | 2026-03-01 | Audit-log table fixes | Audit logging schema corrections. |
| `20260301152552_add_notifications` | 2026-03-01 | `Notification` model | In-app notifications (system + user-targeted). |
| `20260301150146_add_watchlist_and_subscriptions` | 2026-03-01 | `Watchlist`, `WatchlistItem` (unique `(watchlistId, symbol)`) | Watchlist feature. |
| `20260226231528_add_recommendations_alerts_audit` | 2026-02-26 | Early recommendation/alert/audit tables | Stock recommendations + user alerts + audit logging (v1.1.x era). |
| `20260225225407_add_indexname_to_announcements` | 2026-02-25 | Announcement `indexName` (second attempt) | See `20260312210333` row. |
| `20260224231207_add_indexname_to_announcements` | 2026-02-24 | Announcement `indexName` (first attempt) | See `20260312210333` row. |
| `20251223143745_add_indexname_to_announcements` | 2025-12-23 | Announcement `indexName` (initial) | See `20260312210333` row. |
| `20251223100848_add_user_verification` | 2025-12-23 | `User.verificationToken`/verification fields | Email verification flow (later superseded — login no longer gates on verification, v3.5.7). |
| `20251207015846_add_tradenext_models` | 2025-12-07 | Core models batch | Early model additions (portfolio/transaction/user era). |
| `20251206225256_add_index_quote` | 2025-12-06 | `IndexQuote` (unique `indexName`) | Per-index quote caching. |
| `20251205235039_add_corporate_announcement` | 2025-12-05 | `CorporateAnnouncement` (+ `broadcastDateTime` index) | Corporate announcements tab. |
| `20251205230433_add_index_models` | 2025-12-05 | `Index`, `IndexPoint`, `IndexHeatmapItem`, `IndexClose`, `IndexWeight` (+ indexes) | Index charts, closes, heatmap, weights (NIFTY-50 composition etc.). |
| `20251205212101_add_market_models` | 2025-12-05 | Market snapshot models (`MarketSnapshot`, `StockSnapshot`, `DailyPrice` era, `FundTransaction`, `Post`) | Market data caching + snapshots. |
| `20251205115927_add_tradenext_models` | 2025-12-05 | Earlier core model batch (superseded additions) | Iterative early schema build-out. |
| `20251202200928_add_tradenext_models` | 2025-12-02 | First core model batch (portfolio/transactions/users) | Initial application schema. |
| `20250214152453_init` | 2025-02-14 | TimescaleDB init (hypertables) | Enable TimescaleDB for time-series market data (daily prices, index points). |

> **Non-sequential / raw SQL migrations** also present: `0001_timescale_init.sql`, `202512_add_market_tables.sql`, `20260311143500_add_missing_tables.sql` — hand-written SQL migrations (not Prisma-generated), applied the same way by `migrate deploy`. Keep them in the ledger when you modify their tables.

---

## Schema-change decision checklist (before writing any migration)

1. **Models first** — edit `prisma/schema.prisma`; keep table names explicit with `@@map` (camelCase model → snake_case table, matching the raw-SQL convention used elsewhere in this repo).
2. **TTL/cleanup policy** — if the data is a capture/snapshot/cache (chartink results, backtest_history, market_cache, stock_snapshots…), define `expiresAt`/prune logic IN THE SAME change as the model, and record the TTL here.
3. **Indexes** — add `@@index` for every column you'll query/filter/sort on (never index raw JSON). The chartink models carry 8 indexes for exactly this reason.
4. **FK behavior** — parent-child relations: pick `onDelete` deliberately (chartink results `CASCADE` on run/screener delete so pruning a run cleans its rows; `DailyRecommendationStock.trackerId` is `SetNull` so history survives archival).
5. **Backfill** — call it out explicitly if the new tables start populated (usually they don't — runtime upserts handle it, e.g. chartink definitions).
6. **Rollback note** — one line on what dropping the migration's tables costs (all chartink drops are regenerable).
7. **Verification** — replay the FULL history on a scratch DB (see workflow above) before committing; a broken migration anywhere in the chain blocks every future deploy.

---

## Current schema at a glance

Models grouped by subsystem (see `prisma/schema.prisma` for authoritative field definitions):

- **Auth/Users**: `User`, `UserSession`, `JoinRequest`, `VerificationToken` (via user fields)
- **Portfolio**: `Portfolio`, `Transaction`, `FundTransaction`, `RebalancerConfig`
- **Market data**: `Symbol`, `StockSnapshot`, `DailyPrice` (hypertable), `MarketSnapshot`, `Index`, `IndexPoint`, `IndexQuote`, `IndexClose`, `IndexWeight`, `IndexHeatmapItem`, `MarketCache`
- **Corporate actions & news**: `CorporateAction`, `CorporateAnnouncement`, `BlockDeal`, `BulkDeal`, `InsiderTrading`, `ShortSelling`, `FinancialScore`/`FinancialResult`, `Fundamental`
- **Screener**: `ScreenerConfig`, `ScreenerResult`, `ScreenerRunLog`, `ScanConfig`/`ScanResult`/`ScanResultItem` (legacy), **`ChartinkScreener`/`ChartinkScreenerRun`/`ChartinkScreenerResult` (v3.5.5)**
- **Recommendations**: `DailyRecommendationRun`, `DailyRecommendationStock`, `RecommendationTracker`, `RecommendationStatusHistory`, `RecommendationArchive`, `RecommendationSubscription`, `RecommendationAlertSubscription`, `DailyScreenerSync`
- **Alerts**: `AlertRule`, `AlertChannel`, `AlertEvent`, `DeliveryLog`, `UserAlert`, `Secret`
- **Workers/tasks/cron**: `CronJob`, `WorkerTask`, `WorkerStatus`, `TaskEvent`
- **Monitoring/logging**: `UnifiedEvent`, `SystemHealthLog`, `AnomalyAlert`, `AuditLog`, `ServerLog`, `ApiRequestLog`, `AgentPerformanceLog`
- **AI**: `AiConversation`, `AiAnalysis`, `AiInsight`, `AiRateLimit`
- **F&O**: `FoPosition`
- **Misc**: `Notification`, `Watchlist`/`WatchlistItem`, `RateLimit`/`RateLimitConfig`, `AdminAnnouncement`, `Post`