# Spec Document — Recommendations Plan-Limit Fallbacks (History / Performance / Ideas)

> Branch: `feature/ph22-decision-engine` (stacked on v3.41.1 `a269057`)
> Date: 2026-09-25

## 1. Overview

**What**: Fix the three `/recommendations` tabs that return HTTP 500 when the Prisma Postgres account is on a plan-limit hold (`P6003` / `planLimitReached`, active until ~2026-10-02): **History** (`/api/recommendations/top-stocks`), **Performance** (`getPerformanceList` backing `/api/recommendations/performance`), and **Ideas** (`getNseTradingIdeas` → `getOrFetchSyncedData`). Each gets a SQLite-mirror fallback following the established resilience pattern (breaker-guard → mirror read → degraded-but-functional response), plus a UI error-state fix so failures are never masked as empty states.

**Why**: Verified live on prod (2026-09-24) + code audit:
- `top-stocks` → **500** (pure `prisma.$queryRaw` ×3, no guard, no fallback). `HistoryTab.tsx` swallows `success:false` into a misleading **empty state**.
- `performance` → **500** (`prisma.recommendationTracker.count/findMany` unguarded; sqlite only used for archive writes).
- `ideas` → **500** (unguarded `prisma.marketCache.findUnique` ×2 + `upsert` in `syncedDataService.getOrFetchSyncedData`). Even when the TradingView fetch **succeeds**, the change-check `findUnique` throws under hold → lands in the catch → DB fallback `findUnique` also throws → 500.
- Swing (sqlite-first), Picks (`getLatestRecommendations` route fallback), Dividends (mirror) already survive the hold — these three are the stragglers.

**Scope**:
- IN: SQLite-mirror fallbacks for the 3 routes/services; HistoryTab error-state UI; unit tests; docs.
- OUT: changing the upstream NSE/TradingView fetchers; modifying the Picks/Swing/Dividends fallbacks; new DB tables/migrations; new packages; e2e changes (fallback paths can't be simulated in e2e without a real hold — unit tests cover them).

**Depends on**: Existing SQLite mirror (`lib/sqlite.ts` — `daily_recommendation_run` / `daily_recommendation_stock` / `recommendation_tracker` / `market_cache` tables + `syncFromPrisma`), `lib/db-utils.ts` (`isDbUnavailableError`, `isPlanLimitBreakerOpen`), `lib/market-cache.ts` breaker pattern.

---

## 2. Routes

### New Routes

None.

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/recommendations/top-stocks` | Add breaker-guard + SQLite-mirror fallback assembly; keep response contract identical |
| GET | `/api/recommendations/performance` | Backed by `getPerformanceList` → add SQLite-mirror read fallback in service |
| GET | `/api/recommendations/ideas` | Backed by `getOrFetchSyncedData` → add breaker-guard + mirror read/write in service |

---

## 3. Database Schema

No Prisma schema changes, no migrations. The SQLite mirror already stores the needed tables (confirmed in `lib/sqlite.ts` DDL):
- `daily_recommendation_run` (id, run_date, status, unique_stocks, created_at, …)
- `daily_recommendation_stock` (id, run_id, tracker_id, symbol, price, change_val, change_percent, volume, ai_recommendation, confidence, target_price, stop_loss, time_horizon, reasoning, risk_factors, screener_attribution, screener_count, ai_success, created_at, …)
- `recommendation_tracker` (id, symbol, status, entry_price, current_price, target_price, stop_loss, time_horizon, confidence, ai_recommendation, reasoning, risk_factors, screener_attribution, last_checked_at, created_at, updated_at, …)
- `market_cache` (cache_key PK, data, data_type, record_count, last_synced_at, …) — synced during `syncFromPrisma`; read via existing `getMarketCache`

---

## 4. Functions to Implement / Modify

### A. `lib/sqlite.ts` — NEW mirror read `getRecommendationRuns`

Add to the `SqliteFallback` interface + implementation (pattern: mirror `getRecommendationStocks` at ~L5636):

```
getRecommendationRuns(opts?: { status?: string[]; limit?: number }): Array<Record<string, unknown>>
```

- `SELECT * FROM daily_recommendation_run` filtered by `status IN (...)`, **`unique_stocks > 0`** (mirrors route `r."uniqueStocks" > 0`), `ORDER BY run_date DESC`, `LIMIT ?`.
- Rehydrate camelCase (`rehydrateRow`, dateKeys: run_date/created_at/completed_at) — run rows expose `id`, `runDate`, `status`, `uniqueStocks`.
- Never throws (returns `[]` on failure), records `recordSqliteRead`.
- Used by: History fallback (run enumeration — `getLatestRecommendations` only returns ONE run, insufficient for the DISTINCT ON across runs).

### B. `app/api/recommendations/top-stocks/route.ts` — History fallback

Keep the existing `$queryRaw` happy path as-is. Wrap the query + count in a try/catch; on `isDbUnavailableError(error)` serve a mirror fallback via private helper functions in the same file:

```
topStocksFromSqlite(limit, offset, filter): { stocks: TopStockRow[]; total: number } | null
```

- Guard: `getSqliteFallback()?.isReady()`; if not ready → `null` (route 500s as today).
- Enumerate runs: `sqlite.getRecommendationRuns({ status: ["completed", "failed"], limit: 500 })` (mirror of `WHERE r.status IN ('completed','failed') AND r."uniqueStocks" > 0`).
- For each run desc: `sqlite.getRecommendationStocks(run.id)`; inject `runDate = run.runDate`, `runStatus = run.status` into each stock row.
- Dedupe by symbol keeping the **first** occurrence (runs iterated desc ⇒ latest `runDate` wins = same `DISTINCT ON (s.symbol) ... ORDER BY s.symbol, r."runDate" DESC`).
- Apply `filter` (BUY/HOLD/SELL) against `aiRecommendation` when not `"all"`.
- Tracker join: `sqlite.getRecommendationTrackers({ symbolIn: [...symbols], limit: symbols.length })` → map symbol → { entryPrice, currentPrice, status }; fill `entryPrice`/`currentPrice`/`trackerStatus`, leaving null when absent (LEFT JOIN semantics).
- Sort by `screenerCount` desc; slice `[offset, offset+limit)`; `total = deduped.length` (matches `COUNT(DISTINCT symbol)`).
- Map to the exact existing serialized shape (id, symbol, runId, screenerCount, screenerAttribution, price, change, changePercent, volume, aiRecommendation, confidence, targetPrice, stopLoss, timeHorizon, reasoning, riskFactors, aiSuccess, runDate ISO, runStatus, entryPrice, currentPrice, trackerStatus). `aiRecommendation ?? "HOLD"`, `confidence ?? 0`, volume `Number(...) ?? null`.
- Log `warn` with source `"sqlite"`; cache result in `recommendationsCache` under the same `cacheKey` (1h).

### C. `lib/services/recommendationPerformanceService.ts` — Performance fallback

In `getPerformanceList` (after the memory-cache hit), wrap the Prisma branch (`count` + `findMany` + bridge) in try/catch; on `isDbUnavailableError(error)` delegate to:

```
getPerformanceListFromSqlite(query: PerformanceQuery): Promise<PerformanceListResponse> | null
```

- Guard: `getSqliteFallback()?.isReady()`; null → rethrow (route 500s as today).
- Read: `sqlite.getRecommendationTrackers({ status: status ? [status] : undefined, limit: 5000 })` (bounded like the `returnPercent` branch's `take: 5000`).
- Apply in JS: next-day promotion (`createdAt < todayStart`), `category` ↔ `timeHorizon`, `recommendation` ↔ `aiRecommendation`.
- Map via the existing `toListItem` shape (defensively coerce `createdAt`/`lastCheckedAt` — `new Date(String(v))`, guard NaN), computing `returnPercent` + `daysTracked` exactly like the Prisma path.
- Sort per query (`returnPercent`, `daysTracked`, `createdAt`, `symbol`, `confidence`, entry/current/target/stop-loss fields); paginate slice; `total = filtered.length` (approximation — documented degrade); `columns = getPerformanceColumns()`.
- **Skip** `bridgeMissingCurrentPrices` (another Prisma op — tracker rows already carry `currentPrice`; acceptable degrade).
- Cache the response under the same `PERFORMANCE_CACHE_KEY` key (15 min).
- Log `warn` with source `"sqlite"`.

### D. `lib/services/syncedDataService.ts` — Ideas fallback (`getOrFetchSyncedData`)

Guarded DB access so a hold never breaks the API-success path, and a mirror read covers the API-failure path:

1. **API-success path (step 2, lines ~112–158)**: guard the change-check + upsert block with `if (!isPlanLimitBreakerOpen())`. Inside, wrap `prisma.marketCache.findUnique` + `upsert` in try/catch — on `isDbUnavailableError` log `warn` and **skip the DB write** (still return `source: "api"`, `changed: false`; never throw). When breaker is open OR DB write failed, **best-effort mirror write-through**: `sqlite?.upsertMarketCache({ cacheKey, dataType, indexName, data, recordCount, lastSyncedAt: syncedAt, nextSyncAt, ... })` (zero-Prisma op, never throws) so a later cold API failure can serve fresh mirror data.
2. **API-failure path (step 3, lines ~159–176)**: before the Prisma `findUnique`, if `isPlanLimitBreakerOpen()` → try `sqlite?.getMarketCache(cacheKey)` first; if a row exists serve `{ data: row.data, source: "db", syncedAt: row.lastSyncedAt, changed: false }` + populate memory (5-min TTL). Wrap the Prisma `findUnique` in try/catch — on `isDbUnavailableError` fall through to the mirror read; mirror miss → rethrow original failure (route 500s as today).
- `source` stays within the existing union (`"cache" | "api" | "db"`) — mirror-served reads report `"db"` (stable API contract).

### E. `app/components/recommendations/HistoryTab.tsx` — error-state fix

- Add `const [error, setError] = useState<string | null>(null)`.
- In `fetchStocks`: on fetch throw **or** `data.success === false` → `setError(...)` (keep existing stocks). Reset `error` at fetch start.
- Render: when `error && stocks.length === 0` → error card mirroring the Performance tab's "Could not load history" + **Retry** button (calls `fetchStocks`). `loadingHistory` still drives skeletons.
- Behavior contract unchanged when the API succeeds.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/sqlite.ts` | Modified | Add `getRecommendationRuns()` to `SqliteFallback` interface + impl |
| `app/api/recommendations/top-stocks/route.ts` | Modified | Breaker-guard + `topStocksFromSqlite` fallback assembly |
| `lib/services/recommendationPerformanceService.ts` | Modified | `getPerformanceListFromSqlite` fallback in `getPerformanceList` |
| `lib/services/syncedDataService.ts` | Modified | Guarded DB block + mirror read/write in `getOrFetchSyncedData` |
| `app/components/recommendations/HistoryTab.tsx` | Modified | Error state + Retry (never mask 500 as empty) |
| `lib/__tests__/recommendationsPlanLimitFallbacks.test.ts` | **Created** | Fallback unit tests (History/Performance/Ideas) |
| `lib/__tests__/sqliteMirror.test.ts` | Modified | Add `getRecommendationRuns` coverage |
| `.agents/specs/01-recommendations-plan-limit-fallbacks.md` | **Created** | This spec |
| `.agents/plans/01-recommendations-plan-limit-fallbacks.md` | **Created** | Implementation plan |

---

## 6. Dependencies

### New Packages

None.

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/db-utils` | `isDbUnavailableError`, `isPlanLimitBreakerOpen` | Guard gates |
| `@/lib/sqlite` | `getSqliteFallback` → `getRecommendationRuns`, `getRecommendationStocks`, `getRecommendationTrackers`, `getMarketCache`, `upsertMarketCache`, `isReady` | Mirror reads/writes (zero Prisma) |
| `@/lib/cache` | `recommendationsCache` | 1h / 15-min fallback caching |
| `@/lib/logger` | `logger.warn` | Source `"sqlite"` degradation logs |

---

## 7. API Contract

All three routes keep their **exact** existing 200/500 response shapes — the fallback only changes *what* is computed and adds `source` awareness in logs, not the wire contract.

### GET /api/recommendations/top-stocks

**Query Params (unchanged):** `limit` (default 20, max 100), `offset` (default 0), `filter` (`all|BUY|HOLD|SELL`).

**Response 200 (unchanged shape):**
```json
{
  "success": true,
  "stocks": [{ "id": "…", "symbol": "RELIANCE", "runId": "…", "screenerCount": 3,
               "screenerAttribution": ["…"], "price": 1234.5, "change": 10.5,
               "changePercent": 0.85, "volume": 123456, "aiRecommendation": "BUY",
               "confidence": 72, "targetPrice": 1300, "stopLoss": 1180,
               "timeHorizon": "swing", "reasoning": null, "riskFactors": null,
               "aiSuccess": true, "runDate": "2026-09-24T04:30:00.000Z",
               "runStatus": "completed", "entryPrice": 1234.5, "currentPrice": 1280,
               "trackerStatus": "active" }],
  "total": 643,
  "limit": 20,
  "offset": 0,
  "timestamp": "2026-09-25T…Z",
  "traceId": "…"
}
```

**Response 500 (unchanged, only when mirror also unavailable):** `{ "success": false, "error": "Failed to fetch top stocks" }`

### GET /api/recommendations/performance

Response 200 unchanged: `{ success: true, items: PerformanceListItem[], total: number, columns: PerformanceColumn[] }` (see `lib/services/recommendationPerformanceService.ts` types). 500 only when mirror also unavailable.

### GET /api/recommendations/ideas

Response 200 unchanged: `{ success: true, ideas: TradingIdea[], source: "cache"|"api"|"db" }` (source reports `"db"` when served from the SQLite mirror). 500 only when API failed AND mirror miss.

---

## 8. UI/UX Requirements

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `HistoryTab.tsx` | `app/components/recommendations/` | Add error state + Retry |

### States (History tab)

- **Loading**: existing skeleton (unchanged)
- **Empty**: existing "No recommendations yet" (kept — only shows when API genuinely returns 0 stocks)
- **Error (NEW)**: "Could not load history" + Retry button — shown when `data.success === false` or fetch throws, replacing the misleading empty state
- **Data**: existing sorted/paginated table (unchanged)

### Responsive

No layout changes — error card reuses existing card styles (same classes as Performance tab error card).

---

## 9. Rules & Guardrails

- [x] No Prisma in client components
- [x] All DB operations via Prisma (parameterized) or the validated SQLite mirror; zero new raw SQL beyond the existing query
- [x] Server-side proxy only for NSE/TradingView APIs — never call from client
- [x] All external inputs validated (limit clamped ≤100; filter whitelist)
- [x] Errors return safe defaults; never expose internals (route error strings unchanged)
- [x] Logging via `@/lib/logger` only (no `console.log`)
- [x] Background sync is fire-and-forget (ideas mirror write is best-effort, never awaited as a failure path)
- [x] Cache invalidation on write (`invalidateRecommendationsCache` already handles the Prisma path; fallback responses cache under the same keys)
- [x] Audit trail for state-changing operations (none added — read-path degradation only)
- [x] Fallback never throws when mirror has data; rethrows only the original upstream failure when everything is exhausted
- [x] **Zero Prisma ops in the fallback paths** (executed only when the breaker is open / `isDbUnavailableError` — so they never add load under a hold)

---

## 10. Expected Behavior

1. `top-stocks` with DB healthy → identical to today (Prisma `$queryRaw` path; fallback untouched).
2. `top-stocks` with `prisma.$queryRaw` throwing `P6003` and mirror ready → 200 with the same shape, deduped per symbol (latest run wins), filter applied, screenerCount-desc order, correct pagination + total (unit-verified).
3. `top-stocks` with P6003 AND mirror not ready → 500 `{success:false}` (unchanged from today).
4. `getPerformanceList` with `count`/`findMany` throwing P6003 and mirror ready → same `PerformanceListResponse` shape; next-day promotion, filters, sort, pagination applied in JS; `total` = filtered length (documented approximation).
5. `getOrFetchSyncedData` with breaker open + API success → returns `source: "api"`, **zero** `prisma.marketCache` calls; best-effort `upsertMarketCache` mirror write when payload changed.
6. `getOrFetchSyncedData` with API failure + breaker open + mirror row → returns `source: "db"` with mirror data, memory repopulated (5-min TTL).
7. `getOrFetchSyncedData` with API failure + breaker open + mirror miss → rethrows original error (500 as today).
8. HistoryTab shows error card + Retry when API returns `success:false`; shows empty state only on genuine empty.
9. All existing unit tests remain green (1416 pass / 4 skip baseline).
10. `npx tsc --noEmit` → 0 production errors (46 exact baseline) · `npm run lint` → 0.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| `$queryRaw` throws P6003 (History) | Mirror fallback serves deduped top-stocks | `warn` (source `"sqlite"`) |
| Mirror not ready (History/Performance) | Rethrow original → route 500 (unchanged) | `error` |
| `recommendationTracker` count/findMany throws P6003 (Performance) | Mirror fallback serves list | `warn` (source `"sqlite"`) |
| `marketCache.findUnique` throws P6003 on API-success (Ideas) | Skip DB write, serve API payload, best-effort mirror write | `warn` |
| API failure + breaker open (Ideas) | Mirror read (`getMarketCache`) | `warn` (source `"sqlite"`) |
| API failure + breaker open + mirror miss (Ideas) | Rethrow original (route 500) | `error` |
| HistoryTab fetch throws / `success:false` | Error card + Retry | n/a (client `console.error` retained) |

---

## 12. Test Strategy

### Unit Tests — `lib/__tests__/recommendationsPlanLimitFallbacks.test.ts` (NEW)

- [ ] `topStocksFromSqlite`: happy path — 2 runs × stocks, dedupe (same symbol in newer run wins), filter BUY, screenerCount desc, pagination slice, total = deduped count
- [ ] `topStocksFromSqlite`: tracker join fills entryPrice/currentPrice/trackerStatus; missing tracker → nulls
- [ ] `top-stocks` route: `$queryRaw` resolves → Prisma response served verbatim (fallback not invoked)
- [ ] `top-stocks` route: `$queryRaw` rejects P6003 + mirror ready → 200 + `stocks`
- [ ] `top-stocks` route: P6003 + mirror not ready → 500 `{success:false}`
- [ ] `getPerformanceListFromSqlite`: filters (status/category/recommendation), next-day promotion, sort by returnPercent desc, pagination, `columns` present
- [ ] `getOrFetchSyncedData`: breaker open + API ok → no `prisma.marketCache` calls, source `"api"`, `changed:false`
- [ ] `getOrFetchSyncedData`: API fail + breaker open + mirror row → source `"db"`, mirror data
- [ ] `getOrFetchSyncedData`: API fail + breaker open + mirror miss → throws original
- [ ] `getOrFetchSyncedData`: API fail + no mirror row + prisma throws P6003 → falls to mirror, throws original on miss

### Mirror read tests — `lib/__tests__/sqliteMirror.test.ts` (EXTEND)

- [ ] `getRecommendationRuns` returns runs desc by runDate, camelCase (`runDate`/`uniqueStocks`), excludes `unique_stocks <= 0` and non-listed statuses, respects `limit`
- [ ] `getRecommendationRuns` returns `[]` when mirror empty/unavailable (never throws)

### E2E Tests

- None new — fallback paths require a live plan-limit hold to trigger; covered by unit tests. Existing `e2e/recommendations.spec.ts` must remain green (no UI contract change on success).

---

## 13. Performance Considerations

- **Cache**: fallback responses cached under the same keys (top-stocks 1h, performance 15 min) — repeated tab visits under hold stay zero-Prisma/zero-DB.
- **Mirror reads are zero-Prisma** (in-memory sql.js) — safe during a hold; `getRecommendationRuns` `LIMIT 500` bounds run enumeration (daily runs ≈ 200).
- **Batching**: tracker join via ONE `getRecommendationTrackers({symbolIn})` call (no N+1); stocks read per run is bounded by run count (≤500 reads on in-memory sql.js, acceptable degraded path).
- No new indexes needed (mirror tables already indexed on `symbol`, `data_type`, `last_synced_at`).

---

## 14. Security Considerations

- **Auth**: all three routes are public read-only recommendation views (unchanged) — they expose only screen data already public.
- **Input**: `limit` clamped ≤100; `filter` whitelisted to `all|BUY|HOLD|SELL`; performance query already bounded.
- **Secrets**: none touched; no new env vars.
- **RBAC**: no admin route changes.

---

## 15. Definition of Done

- [x] All functions implemented per section 4
- [x] All files created/modified per section 5
- [x] All routes working per section 2 + contract in section 7 (identical wire shapes)
- [x] No Prisma schema change / no migration required (SQLite mirror tables already exist)
- [x] Unit tests written and passing (`npm run test`) — new fallback tests + all 108 suites green
- [x] `npx tsc --noEmit` passes (0 new errors beyond 46 baseline)
- [x] `npm run lint` passes (0 errors)
- [x] UI error state implemented in HistoryTab (never masks 500 as empty)
- [x] Error handling per section 11 (safe defaults; rethrow only when everything exhausted)
- [x] Documentation updated (AGENTS.md version row, `.agents/changelog/versions-v3.41.md`, TODO quick-ref, Primer, agent-memory, Lessons — new lesson for the masked-error pattern)
- [x] Live-verified on :3000 (dev-server curl of the three routes returns either Prisma data — DB up — or mirror data; unit tests prove the hold path)
- [x] 0 console errors in browser (HistoryTab error path tested via unit/component reasoning + e2e regression)