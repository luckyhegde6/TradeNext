# Spec Document — Prisma Postgres Migration (Standalone Accelerate Retirement)

> Branch: `v3.26.0-prod-failure-triage` (planning only; implementation will branch from main)
> Created: 2026-09-04
> Deadline: **Dec 1, 2026** (standalone Accelerate retirement)

## 1. Overview

**What**: Plan and implement the migration from standalone Prisma Accelerate (transport-only) to Prisma Postgres (managed PostgreSQL with built-in Accelerate caching), plus activate the `withAccelerate()` extension and `cacheStrategy` on high-frequency read models.

**Why**: Standalone Prisma Accelerate (`prisma+postgres://accelerate.prisma-data.net`) retires **Dec 1, 2026** (~3 months from investigation date). While the current app routes queries through Accelerate as a transport/proxy only (no `cacheStrategy` enabled), the underlying standalone Accelerate infrastructure will be decommissioned. Prisma Postgres is the successor product — Accelerate caching is built-in, the connection string format is identical (`prisma+postgres://`), and the `DIRECT_URL` for DDL already works. Additionally, the current app has `@prisma/extension-accelerate@^1.3.0` installed but **never imported** (`cacheStrategy` was never active) — every query is a real proxy round-trip to the DB with zero Accelerate caching. Migrating to Prisma Postgres gives us the opportunity to activate caching and reduce DB ops (relevant to the 10K ops/day plan limit).

**Scope**:
- IN: Provision Prisma Postgres instance, migrate prod DB data, update connection config, activate `withAccelerate()` + `cacheStrategy` on targeted models, verify DB Health / OTel / circuit breaker still work, update `.env.example` and docs.
- OUT: Schema changes (new models), app feature changes, UI changes, changes to the `$allOperations` extension logic (circuit breaker, write budget, op counting, timeout). This is a pure infrastructure migration.

**Depends on**: v3.26.0 (on `v3.26.0-prod-failure-triage` branch); v3.21.3 (OTel tracing); v3.22.0 (write-behind / leader election); v3.25.0 (SQLite-primary daemon). No blocked dependencies — all prior versions are already committed.

---

## 2. Routes

> No API routes change. The migration is transparent to the HTTP layer.

### New Routes

None.

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/admin/db-health` | Potential: add Accelerate cache-hit ratio to metrics (future follow-up, not this spec) |

---

## 3. Database Schema

> No schema changes. The same 75+ Prisma models apply. The migration is an infrastructure/data move.

### A. No New Models

None.

### B. No Modifications to Existing Models

`cacheStrategy` annotations will be added to specific models (see section 4F) — these are Prisma client annotations, NOT schema-level changes. They live in `prisma/schema.prisma` as per-model metadata.

### C. Migration Notes

- **Prod DB migration**: data moves from the standalone Accelerate-managed PostgreSQL to a Prisma Postgres-managed PostgreSQL instance. This is a **data export/import** operation (not a Prisma schema migration).
- Migration method: `pg_dump` + `pg_restore` (or Prisma Console data migration tool), NOT `prisma migrate deploy`.
- Schema DDL: the existing 36 migrations already cover all tables — apply them to the new Prisma Postgres instance via `DIRECT_URL` + `npx prisma migrate deploy`.
- ⚠️ Local DB: unchanged (Docker PostgreSQL). Only prod moves to Prisma Postgres.

---

## 4. Functions to Implement

### A. Update Client Construction — `lib/prisma.ts`

Current:
```typescript
import { PrismaClient } from '@prisma/client';
// ...
if (useAccelerate) {
  prismaClient = new PrismaClient({ accelerateUrl: databaseUrl } as any);
}
```

Target:
```typescript
import { PrismaClient } from '@prisma/client';
import { withAccelerate } from '@prisma/extension-accelerate';
// ...
if (useAccelerate) {
  prismaClient = new PrismaClient({
    accelerateUrl: databaseUrl,
  }).$extends(withAccelerate());
}
```

Key behavior:
- `withAccelerate()` is layered ON TOP of the existing `$allOperations` extension (circuit breaker, op counting, write budget, timeout) — it must be applied **first** so caching sits between the app and the proxy.
- The `$extends({ query: { $allOperations(...) } })` call wraps the client AFTER `withAccelerate()`.
- The `otelSetup()` call at module top remains before the PrismaClient construction (unchanged).

### B. Update Extension Chain Order

Current order (in `lib/prisma.ts`):
1. `otelSetup()` ← runs before PrismaClient construction
2. `new PrismaClient({ accelerateUrl })` ← base client
3. `$extends({ query: { $allOperations } })` ← adds circuit breaker, op counting, timeout

Target order:
1. `otelSetup()` ← unchanged
2. `new PrismaClient({ accelerateUrl }).$extends(withAccelerate())` ← base client + Accelerate caching
3. `$extends({ query: { $allOperations } })` ← wraps the Accelerate-extended client

This order means: App → `$allOperations` (circuit breaker/op counting/timeout) → `withAccelerate()` (caching) → Accelerate proxy → DB. The `$allOperations` extension counts operations even on cache hits (it cannot see inside `withAccelerate()`), which is correct behavior — the ops counter tracks client-side request volume, not DB-side query volume.

### C. `cacheStrategy` Annotations on Target Models

Add `cacheStrategy` to the highest-frequency direct-Prisma read models to reduce Accelerate round-trips and DB load. These are the models that bypass the SQLite-first reads (the "LOW-frequency" direct-Prisma path in readTier):

```prisma
// Example: CorporateAction — read frequently by combined route, 5-min cache
model CorporateAction {
  // ... existing fields ...
  @@index([...])
  @@map("corporate_actions")
}
// cacheStrategy added in Prisma client, not schema — see section 4D
```

**Models to target** (based on readTier LONG_QUERY_MS >100ms and high-frequency access patterns):

| Model | Read pattern | Proposed TTL | Rationale |
|-------|-------------|-------------|-----------|
| `CorporateAction` | `/api/corporate-actions/combined` | 300s (5 min) | Read every request, changes infrequently |
| `ChartinkScreenerResult` | `/api/screener/chartink` | 900s (15 min) | 15-min cache TTL already in code |
| `RecommendationTracker` | Performance/History tabs | 600s (10 min) | Read-only after creation |
| `DailyPrice` | Historical data, indicators | 60s (1 min) | Changes daily, read frequently |
| `MarketCache` | NSE data, corp actions | 300s (5 min) | Market data, moderate TTL |

Models that are **NOT cached** (write-heavy or already SQLite-mirrored):
- `WorkerStatus`, `WorkerTask`, `CronJob` — already SQLite-primary (v3.25.0)
- `DailyRecommendationStock`, `DailyRecommendationRun` — write-heavy, short-lived
- `AuditLog`, `ServerLog` — write-behind to SQLite (v3.22.0)

### D. `cacheStrategy` in Prisma Schema

`cacheStrategy` is a Prisma client feature, NOT a schema-level directive. It is applied via the `$extends(withAccelerate())` call and model-level `cacheStrategy` in the `prisma-client-js` generator output. In practice, the way to declare it for Prisma Postgres is:

```typescript
// In code where the model is queried — cacheStrategy is part of the Prisma client API:
const corporateActions = await prisma.corporateAction.findMany({
  cacheStrategy: { ttl: 300, swr: 60 },  // 5 min TTL, 1 min stale-while-revalidate
  where: { ... },
});
```

This is a **per-query** annotation, not a schema-level one. It does NOT require schema changes.

**Per-query `cacheStrategy` is optional and incremental** — each route opts in independently by adding the `cacheStrategy` key to its `findMany`/`findFirst` calls. The spec requires implementing this on the 5 target models listed above (section 4C) as part of the migration; other models can be added later.

### E. Environment Variables

`.env.example` changes:

```bash
# DATABASE_URL — Prisma Postgres Accelerate proxy (query caching built-in)
# Format: prisma+postgres://accelerate.prisma-data.net/?api_key=YOUR_API_KEY
DATABASE_URL=prisma+postgres://accelerate.prisma-data.net/?api_key=API_KEY

# DIRECT_URL — Direct TCP connection for Prisma Migrate / db push
# (Accelerate proxy cannot run DDL; DIRECT_URL bypasses it)
# Format: postgres://USER:PASSWORD@db.prisma.io:5432/?sslmode=require
# Get from Prisma Console → Database → Connections → Create new direct connection
DIRECT_URL=

# PRISMA_ACCELERATE_CACHE_TTL — Default cache TTL for Accelerate caching (seconds)
# Only effective when withAccelerate() is wired and cacheStrategy is used.
# Default: 300 (5 minutes). Set to 0 to disable caching globally.
# PRISMA_ACCELERATE_CACHE_TTL=300
```

New env var: `PRISMA_ACCELERATE_CACHE_TTL` — optional, allows tuning the default cache TTL without code changes. Used as a fallback when `cacheStrategy.ttl` is not specified in a query.

### F. OTel / Instrumentation

- `@prisma/instrumentation` works with `withAccelerate()` — PrismaInstrumentation hooks into the query engine regardless of Accelerate presence. No change needed.
- OTel spans will show the Accelerate proxy latency (not DB latency) when caching is active — this is expected behavior, not a regression.
- The `PRISMA_OTEL_ENABLED` opt-in gate is unchanged.

### G. SQLite Backup Layer

- `lib/sqlite.ts` and the SQLite-primary daemon (v3.22.0–v3.25.0) are **unchanged**. SQLite serves as a DB-outage resilience layer; it sits alongside Prisma, not in place of it.
- The recovery probe (`syncFromPrisma`) still runs on the 6h cadence (v3.26.0).
- Write-behind promotion model (v3.22.0) is unchanged.

### H. DB Health Dashboard

- `app/api/admin/db-health/route.ts` — unchanged (reads from `dbOpsCounter`, `dbErrorLog`, `dbErrorCounts`, SQLite health status).
- `app/admin/utils/db-health/page.tsx` — unchanged (the UI reads from the API).
- Optional future enhancement: add Accelerate cache-hit ratio to the readTier metrics (out of scope for this migration).

### I. Plan-Limit Circuit Breaker

- `lib/db-utils.ts` — unchanged.
- The circuit breaker (`isPlanLimitBreakerOpen`, `openPlanLimitBreaker`, `closePlanLimitBreaker`) is still wired into the `$allOperations` extension.
- **Important nuance**: `withAccelerate()` cache hits are NOT counted as DB operations by the breaker — the breaker only sees operations that reach the Prisma client layer. If `cacheStrategy` returns a cached response, the `$allOperations` extension still counts it (it runs on the Prisma client, not the Accelerate layer). This is acceptable: the ops counter tracks client-side request volume, not DB-side query volume. The write budget limiter only blocks **writes**; reads (cached or not) are always allowed.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/prisma.ts` | Modified | Wire `withAccelerate()` before `$allOperations`; add `PRISMA_ACCELERATE_CACHE_TTL` env; update client construction |
| `app/api/corporate-actions/combined/route.ts` | Modified | Add `cacheStrategy: { ttl: 300, swr: 60 }` to `prisma.corporateAction.findMany` |
| `app/api/screener/chartink/route.ts` | Modified | Add `cacheStrategy` to ChartinkScreenerResult query |
| `app/api/recommendations/history/route.ts` | Modified | Add `cacheStrategy` to RecommendationTracker query |
| `lib/services/stock-service.ts` | Modified | Add `cacheStrategy` to DailyPrice query |
| `lib/services/market-cache.ts` | Modified | Add `cacheStrategy` to MarketCache query |
| `lib/sqlite.ts` | Unchanged | — |
| `lib/db-utils.ts` | Unchanged | — |
| `lib/otel.ts` | Unchanged | — |
| `prisma/schema.prisma` | Unchanged | No new models, no DDL changes |
| `prisma.config.ts` | Unchanged | `directUrl` + `getDirectUrl()` already works |
| `.env.example` | Modified | Document `PRISMA_ACCELERATE_CACHE_TTL` |
| `AGENTS.md` | Modified | Version row for the migration |
| `.agents/CHANGELOG.md` | Modified | Index entry |
| `.agents/changelog/versions-v3.XX.md` | Created | Migration detail |
| `TODO.md` | Modified | Mark the Accelerate migration row done |
| `Primer.md` | Modified | Status update |
| `agent-memory.md` | Modified | Activity entry |
| `Lessons.md` | Modified | New lesson if pattern discovered |

---

## 6. Dependencies

### New Packages

None — `@prisma/extension-accelerate@^1.3.0` is already installed and will be used for the first time.

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@prisma/client` | `PrismaClient` | Base client (unchanged) |
| `@prisma/extension-accelerate` | `withAccelerate()` | Activate Accelerate caching |
| `@prisma/adapter-pg` | `PrismaPg` | Direct-connection adapter for DDL (unchanged) |
| `@prisma/instrumentation` | `PrismaInstrumentation` | OTel tracing (unchanged) |

---

## 7. API Contract

> No API contracts change. All routes remain identical from the client's perspective.

---

## 8. UI/UX Requirements

> No UI changes. The migration is transparent to the frontend.

---

## 9. Rules & Guardrails

- [ ] `withAccelerate()` is wired **before** `$allOperations` — caching sits between the app and the proxy
- [ ] `cacheStrategy` is per-query, NOT schema-level — no schema changes needed
- [ ] `otelSetup()` remains BEFORE PrismaClient construction — PrismaInstrumentation hooks at client construction time
- [ ] The `$allOperations` extension (circuit breaker, op counting, write budget, timeout) wraps the Accelerate-extended client — order is: App → $allOperations → withAccelerate → Accelerate proxy → DB
- [ ] `DIRECT_URL` is set in prod for `prisma migrate deploy` — Accelerate proxy cannot run DDL
- [ ] Local dev environment is unchanged (Docker PostgreSQL, no Accelerate)
- [ ] SQLite backup layer (v3.22.0–v3.25.0) is unchanged — it sits alongside Prisma
- [ ] All existing tests pass with no changes — the migration is infrastructure-only
- [ ] `npx prisma generate` must be run after enabling `withAccelerate()` (the client output changes)

---

## 10. Expected Behavior

1. After migration, the same `DATABASE_URL` (`prisma+postgres://accelerate.prisma-data.net`) works — Prisma Postgres is a managed upgrade, not a URL change.
2. `withAccelerate()` is recognized and activates Accelerate caching — queries with `cacheStrategy` are cached at the edge.
3. The `$allOperations` extension still fires on every client-side call (cache hits are counted as reads, not excluded).
4. Circuit breaker, write budget, and timeout all work identically to pre-migration.
5. OTel spans show Accelerate proxy latency (not raw DB latency) when caching is active — expected, not a regression.
6. SQLite recovery probe (`syncFromPrisma`) runs every 6h as before — data sync is bidirectional.
7. DB Health dashboard shows the same metrics (ops, errors, SQLite health).
8. `npx prisma migrate status` via `DIRECT_URL` shows all 36+ migrations up to date on the new Prisma Postgres instance.
9. The old standalone Accelerate instance continues to work until Dec 1, 2026 — no cutover urgency.
10. After Dec 1, 2026, standalone Accelerate stops accepting connections — Prisma Postgres must be live by then.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Prisma Postgres instance not provisioned | App fails to connect (same as current) | `error` |
| `DIRECT_URL` not set | `prisma migrate deploy` falls back to Accelerate URL (will fail with DDL error) — document this clearly | `error` |
| `withAccelerate()` import missing | `npx prisma generate` fails at build time — catch early in CI | build error |
| Cache hit returns stale data | `swr` (stale-while-revalidate) period controls freshness — acceptable for read-heavy models | `info` |
| Circuit breaker opens during migration | Same as current — 5-min cooldown, graceful degradation | `warn` |
| OTel spans show proxy latency instead of DB latency | Expected — document in OTel docs | `info` |

---

## 12. Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| `withAccelerate()` import works | `lib/__tests__/prisma.test.ts` (new) | Client construction with Accelerate extension |
| `cacheStrategy` per-query works | `lib/__tests__/cache-strategy.test.ts` (new) | Queries with `cacheStrategy` return cached results on second call |
| `$allOperations` still fires with `withAccelerate()` | `lib/__tests__/prisma-extensions.test.ts` (new) | Circuit breaker / op counting / timeout still work on cached queries |
| DB ops counter counts cache hits as reads | `lib/__tests__/prisma-extensions.test.ts` | Ops counter increments on cache-hit reads (not excluded) |
| `isPlanLimitBreakerOpen()` still works | `lib/__tests__/db-utils.test.ts` (existing) | No regression in existing breaker tests |

### Integration Tests

| Test | What It Verifies |
|------|------------------|
| `GET /api/corporate-actions/combined` returns 200 + correct shape | Route works with `cacheStrategy` on CorporateAction |
| `GET /api/admin/db-health` returns ops metrics | DB Health dashboard shows correct data |
| `npx prisma generate` succeeds | Client regenerates with `withAccelerate()` |

### E2E Tests

| Test | What It Verifies |
|------|------------------|
| None required | Migration is infrastructure-only, no UI change |

---

## 13. Performance Considerations

- **Cache**: Accelerate `cacheStrategy` reduces DB round-trips for high-frequency reads. TTLs chosen to match existing NodeCache/SQLite cache patterns (no cache stampede).
- **Ops reduction**: cached reads at the Accelerate layer don't reach the DB, reducing actual DB ops (though the client-side ops counter still counts them).
- **Latency**: cached reads are served from the edge (faster); uncached reads have the same latency as current (proxy round-trip).
- **No new queries**: this migration adds zero new DB queries — it only caches existing ones.

---

## 14. Security Considerations

- **Auth**: unchanged — no route auth changes.
- **Secrets**: `DIRECT_URL` contains DB credentials — must be in `.env` (gitignored) or Netlify environment variables only.
- **Caching sensitivity**: `cacheStrategy` caches query results at the Accelerate layer — ensure no user-specific data is cached cross-tenant (TradeNext is single-user/demo, so this is N/A).
- **OTel**: `PRISMA_OTEL_ENABLED` opt-in gate unchanged — no new sensitive data exposed.

---

## 15. Definition of Done

- [ ] Prisma Postgres instance provisioned and accessible via `DIRECT_URL`
- [ ] Prod DB data migrated to Prisma Postgres instance (pg_dump + pg_restore or Console tool)
- [ ] `npx prisma migrate deploy` via `DIRECT_URL` applies all 36+ migrations to the new instance
- [ ] `npx prisma generate` succeeds with `withAccelerate()` in the client chain
- [ ] `lib/prisma.ts` updated: `withAccelerate()` wired before `$allOperations`
- [ ] `PRISMA_ACCELERATE_CACHE_TTL` env var documented in `.env.example`
- [ ] `cacheStrategy` added to 5 target models (CorporateAction, ChartinkScreenerResult, RecommendationTracker, DailyPrice, MarketCache)
- [ ] `npx tsc --noEmit` passes (0 new errors beyond baseline)
- [ ] `npm run test` passes (all existing tests + new Accelerate tests)
- [ ] Circuit breaker / write budget / op counting / timeout all work with `withAccelerate()`
- [ ] OTel tracing works with `withAccelerate()` (PRISMA_OTEL_ENABLED=1 test)
- [ ] DB Health dashboard shows correct metrics
- [ ] SQLite recovery probe (`syncFromPrisma`) still works
- [ ] Local dev environment unchanged (Docker PostgreSQL)
- [ ] Documentation updated (AGENTS.md, CHANGELOG, TODO, Primer, agent-memory, Lessons)
- [ ] No schema changes → no migration needed
