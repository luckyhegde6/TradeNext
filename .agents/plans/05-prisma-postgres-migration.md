# Implementation Plan — Prisma Postgres Migration (Standalone Accelerate Retirement)

> Generated from spec: `.agents/specs/05-prisma-postgres-migration.md`
> Branch: `v3.26.0-prod-failure-triage` (planning; implementation will branch from `main`)
> Created: 2026-09-04
> Deadline: Dec 1, 2026

## Spec Reference

- **Spec**: `.agents/specs/05-prisma-postgres-migration.md`
- **Branch**: TBD (implementation branch from `main` after planning approval)
- **Created**: 2026-09-04

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step description → verify: [check command]`

### Phase 0: Provisioning (manual, user-directed)

> **These steps require user action in Prisma Console.** Agent cannot provision infrastructure without credentials.

1. **Provision Prisma Postgres instance** — user opens `https://console.prisma.io`, creates/selects workspace + project, provisions a new Prisma Postgres instance (or uses existing one). → verify: Console shows instance with status "Running"; user has the connection strings (DATABASE_URL = `prisma+postgres://...` and DIRECT_URL = `postgres://...`)

2. **Apply schema to new instance** — set `DIRECT_URL` env locally, run `npx prisma migrate deploy` → verify: `npx prisma migrate status` shows "Database schema is up to date" (all 36+ migrations applied)

3. **Migrate prod data** — `pg_dump` from old instance → `pg_restore` to new instance (or use Prisma Console data migration tool if available) → verify: `npx prisma db pull` shows all existing tables and data; row counts match old instance

4. **Update Netlify environment variables** — user updates `DATABASE_URL` and `DIRECT_URL` in Netlify Dashboard → environment variables → trigger a redeploy → verify: deploy succeeds, DB Health dashboard shows "Prisma Online"

> ⚠️ **Steps 1–4 are manual user actions.** Do NOT proceed to Phase 1 until the user confirms the new Prisma Postgres instance is live and data is migrated. The agent should NOT run `pg_dump`/`pg_restore` — these are admin operations requiring prod credentials.

---

### Phase 1: Client Update (`lib/prisma.ts`)

5. **Add `withAccelerate()` to client construction** — in `lib/prisma.ts`:
   - Add import: `import { withAccelerate } from '@prisma/extension-accelerate';`
   - In the `if (useAccelerate)` branch, change `new PrismaClient({ accelerateUrl: databaseUrl } as any)` to `new PrismaClient({ accelerateUrl: databaseUrl }).$extends(withAccelerate())`
   - Remove the `as any` cast (it was a workaround for missing types; `$extends` returns the correct type)
   - Keep the `else` branch (direct PostgreSQL connection) unchanged
   → verify: `npx prisma generate` succeeds; `npx tsc --noEmit` passes (0 new errors)

6. **Reorder extensions** — ensure the extension chain order is:
   1. `otelSetup()` ← before PrismaClient construction
   2. `new PrismaClient({ accelerateUrl }).$extends(withAccelerate())` ← base client + Accelerate
   3. `$extends({ query: { $allOperations } })` ← wraps Accelerate-extended client
   → verify: `npx tsc --noEmit` passes; existing tests pass (`npm run test -- --testPathPattern=db-utils`)

7. **Add `PRISMA_ACCELERATE_CACHE_TTL` env var** — in `lib/prisma.ts`, add a constant `ACCELERATE_CACHE_TTL = Number(process.env.PRISMA_ACCELERATE_CACHE_TTL) || 300` (5 min default). Export it for use by query sites.
   → verify: `npx tsc --noEmit` passes

---

### Phase 2: Query-Site `cacheStrategy` Additions

8. **Add `cacheStrategy` to `app/api/corporate-actions/combined/route.ts`** — on the `prisma.corporateAction.findMany` call, add `cacheStrategy: { ttl: 300, swr: 60 }` (5 min TTL, 1 min stale-while-revalidate). Import `ACCELERATE_CACHE_TTL` from `lib/prisma.ts` if using the env-based default.
   → verify: `npx tsc --noEmit` passes; `curl localhost:3000/api/corporate-actions/combined` returns 200

9. **Add `cacheStrategy` to `app/api/screener/chartink/route.ts`** — on the `prisma.chartinkScreenerResult.findMany` call, add `cacheStrategy: { ttl: 900, swr: 60 }` (15 min TTL matching `CHARTINK_SCREENERS_CACHE_TTL`).
   → verify: `npx tsc --noEmit` passes

10. **Add `cacheStrategy` to `app/api/recommendations/history/route.ts`** — on the `prisma.recommendationTracker.findMany` call, add `cacheStrategy: { ttl: 600, swr: 60 }` (10 min TTL).
    → verify: `npx tsc --noEmit` passes

11. **Add `cacheStrategy` to `lib/services/stock-service.ts`** — on the `prisma.dailyPrice.findFirst` / `findMany` calls (historical data chain), add `cacheStrategy: { ttl: 60, swr: 30 }` (1 min TTL, 30s SWR — price data changes daily).
    → verify: `npx tsc --noEmit` passes

12. **Add `cacheStrategy` to `lib/services/market-cache.ts`** — on the `prisma.marketCache.findMany` / `findFirst` calls, add `cacheStrategy: { ttl: 300, swr: 60 }` (5 min TTL).
    → verify: `npx tsc --noEmit` passes

---

### Phase 3: Verification

13. **Run full test suite** → verify: `npm run test` — all pass (no regressions)

14. **Type check** → verify: `npx tsc --noEmit` — 0 new errors beyond baseline (46)

15. **Lint** → verify: `npm run lint` — no warnings

16. **Verify circuit breaker still works** — existing `db-utils.test.ts` suite runs the breaker trip/close logic → verify: 24 tests pass (breaker trip regression from v3.26.0)

17. **Verify ops counter still counts cache hits** — the `$allOperations` extension fires on client-side calls regardless of `withAccelerate()` caching → verify: in `lib/__tests__/`, write a test (or verify in existing tests) that `dbOpsCounter.reads` increments after a cached query

18. **Verify OTel works** (optional, manual) — set `PRISMA_OTEL_ENABLED=1` locally, run a query, check that OTel spans are emitted → verify: console shows Prisma query spans

19. **Verify SQLite recovery probe still works** — `syncFromPrisma()` still runs on the 6h cadence → verify: existing `lib/__tests__/sqlite.test.ts` + `lib/__tests__/daemon-sqlite-first.test.ts` pass (unchanged)

---

### Phase 4: Documentation

20. **Update `.env.example`** — add `PRISMA_ACCELERATE_CACHE_TTL` with comment (section 4E of spec)
    → verify: `.env.example` includes the new variable

21. **Update `AGENTS.md`** — add version row (e.g. `v3.27.0`) for the Prisma Postgres migration
    → verify: version table is current

22. **Update `.agents/CHANGELOG.md`** — add index entry + create detail file `.agents/changelog/versions-v3.27.md`
    → verify: CHANGELOG index references the new detail file

23. **Update `TODO.md`** — mark the "Prisma Postgres migration planning" row as `[x] Complete`
    → verify: row shows complete

24. **Update `Primer.md`** — current project status reflects the migration
    → verify: status is current

25. **Update `agent-memory.md`** — activity log entry for the migration
    → verify: entry is present

26. **Update `Lessons.md`** — add lesson if pattern/bug was discovered during the migration (e.g. `withAccelerate()` extension ordering, `cacheStrategy` per-query vs schema-level)
    → verify: lesson is present (if applicable)

27. **Create session memory** — `decisions.md` + `flow.md` in `.agents/sessions/`
    → verify: session files exist

---

### Phase 5: Deployment

28. **Commit** → verify: `git status` clean; pre-commit hooks pass
29. **Push branch** → verify: `git push -u origin feature/prisma-postgres-migration`
30. **Open PR** → verify: PR created against `main`
31. **CI passes** → verify: GitHub Actions (quality-gate.yml) all green
32. **Merge PR** → verify: `main` branch is updated with the migration
33. **Netlify auto-deploys** → verify: deploy succeeds on `tradenext6.netlify.app`
34. **Verify prod** → verify: DB Health shows "Prisma Online"; all routes return 200; no console errors

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| `withAccelerate()` import works | new test in `lib/__tests__/` | Client construction with Accelerate extension succeeds |
| `cacheStrategy` on CorporateAction query | new test or extend existing | Query with `cacheStrategy` returns data; second call may be cached |
| `$allOperations` fires with `withAccelerate()` | extend `lib/__tests__/db-utils.test.ts` | Circuit breaker / op counting / timeout still work on Accelerate-extended client |
| `isPlanLimitBreakerOpen()` still works | `lib/__tests__/db-utils.test.ts` (existing) | No regression in 24 existing breaker tests |

### Integration Tests (If API Route)

| Test | What It Verifies |
|------|------------------|
| `GET /api/corporate-actions/combined` returns 200 + correct shape | Route works with `cacheStrategy` on CorporateAction |
| `GET /api/admin/db-health` returns ops metrics | DB Health dashboard shows correct data |
| `npx prisma generate` succeeds | Client regenerates with `withAccelerate()` |

### E2E Tests

None required — migration is infrastructure-only, no UI change.

---

## Verification Checklist

> Run these commands after implementation. All must pass.

```bash
# Type checking
npx tsc --noEmit                    # 0 new errors (baseline: 46)

# Tests
npm run test                        # All pass
npm run lint                        # No warnings

# Prisma
npx prisma validate                 # Schema valid
npx prisma generate                 # Client regenerated (with withAccelerate())

# Build
npm run build                       # Production build succeeds (optional)

# Manual verification (Phase 0 completion)
npx prisma migrate status           # All migrations up to date on new Prisma Postgres instance
curl localhost:3000/api/corporate-actions/combined   # 200 (cacheStrategy wired)
curl localhost:3000/api/admin/db-health              # 200 (ops metrics present)
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| `withAccelerate()` breaks the `$allOperations` extension chain | Wire `withAccelerate()` BEFORE `$allOperations`; test extension ordering in unit tests | No |
| `cacheStrategy` returns stale data | SWR (stale-while-revalidate) period controls freshness; use short TTLs (60–300s) for sensitive models | No |
| Ops counter counts cache hits as reads (inflated metrics) | Document this as expected behavior; the counter tracks client-side volume, not DB volume. Prisma Dashboard is the authoritative source for actual DB ops. | No |
| OTel spans show proxy latency instead of DB latency | Expected behavior; document in OTel docs; no regression in tracing functionality | No |
| `pg_dump`/`pg_restore` misses data or corrupts schema | User verifies row counts post-migration; `prisma migrate status` confirms all migrations applied | No |
| Prod Accelerate instance is decommissioned before migration is complete | Dec 1, 2026 deadline is 3 months away; no urgency to start implementation now | Yes (timeline risk) |
| `PRISMA_ACCELERATE_CACHE_TTL` env not set | Default is 300 (5 min); queries without explicit `cacheStrategy` are NOT cached (only queries that pass `cacheStrategy` key are cached) | No |

---

## Documentation Checklist

> All docs must be updated before commit.

- [ ] **AGENTS.md** — version row in table (v3.27.0)
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.27.md` detail + index update
- [ ] **TODO.md** — mark migration row done
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (e.g. `withAccelerate()` extension ordering, `cacheStrategy` per-query semantics)
- [ ] **Session memory** — `decisions.md` + `flow.md`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context
- [ ] **`.env.example`** — `PRISMA_ACCELERATE_CACHE_TTL` documented

---

## Pre-Commit Gate

> Must pass before any commit.

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated

---

## Timeline

| Phase | When | Who | Effort |
|-------|------|-----|--------|
| Phase 0: Provisioning | Before Dec 1, 2026 (user-directed) | User (admin) | 1–2 hours (manual) |
| Phase 1: Client update | After Phase 0 confirmed | Agent | 1 hour |
| Phase 2: Query-site changes | After Phase 1 | Agent | 1–2 hours |
| Phase 3: Verification | After Phase 2 | Agent + User | 1 hour |
| Phase 4: Documentation | After Phase 3 | Agent | 30 min |
| Phase 5: Deploy | After Phase 4 | User (merge + deploy) | 15 min |

**Total estimated agent effort**: ~4–6 hours (after Phase 0 is complete)
**Total estimated user effort**: ~2 hours (provisioning + deploy)
**Deadline**: Dec 1, 2026 (standalone Accelerate retirement)

**Recommended start**: After v3.26.0 is merged and deployed (to keep changes isolated)
