# v3.27.0 — Prisma Postgres Migration Phase 1-3: `withAccelerate()` wiring + `cacheStrategy` at 5 query sites

- **Date**: Sep 04 2026
- **Branch**: `v3.26.0-prod-failure-triage` (on top of v3.26.0 work, which is pending user commit on `main`)
- **Status**: Phase 1-3 complete (code + verification); Phase 4 docs in progress; commit pending user
- **Spec**: `.agents/specs/05-prisma-postgres-migration.md` · **Plan**: `.agents/plans/05-prisma-postgres-migration.md`
  (both committed `db5a5cc`)

## Summary

**Why:** Standalone Prisma Accelerate (`prisma+postgres://accelerate.prisma-data.net`) **retires Dec 1, 2026**
(~3 months out). The long-term fix is a move to **Prisma Postgres** (Accelerate edge caching built-in) — Phase 0
is manual provisioning in Prisma Console (deploy-time, not code). Before that, **Phase 1-2** ship an
intermediate win: activate the already-installed `@prisma/extension-accelerate` `withAccelerate()` on the
runtime client and add explicit **`cacheStrategy`** (edge caching) to the 5 highest-frequency direct-Prisma
**read** sites, reducing proxy round-trips on a healthy DB. This also validates the exact `cacheStrategy`
+ `withAccelerate()` mechanics that carry forward unchanged into Prisma Postgres (post-Phase-0, drop
`withAccelerate()` since Prisma Postgres caches by default and uses `PRISMA_ACCELERATE_CACHE_TTL`).

**The one real engineering blocker** was TypeScript: the base `PrismaClient` model read-args hard-code
`cacheStrategy: never`, so inline/spread `cacheStrategy` fails to type-check, and manual intersections do not
override the `never` (only actual `$extends(withAccelerate())` inference would — too invasive across 400+ call
sites). Resolved with a pure **`withAccelerateCache(strategy)(args)`** boundary helper.

## Files Changed

| File | Change |
|------|--------|
| `lib/prisma.ts` | Phase 1 + helper: `withAccelerate()` applied in the accelerate branch (`new PrismaClient({accelerateUrl}).$extends(withAccelerate())`); extension order documented (`withAccelerate()` first, `$allOperations` wraps it); `type AccelerateClient = PrismaClient` top type (reverted from intersection — preserves 46-error baseline); `let prismaClient: any` + explicit `$allOperations` param types; NEW `withAccelerateCache(strategy)(args)` boundary helper + JSDoc; `ACCELLERATE_CACHE_TTL` export (`PRISMA_ACCELERATE_CACHE_TTL`, default 300) |
| `app/api/corporate-actions/combined/route.ts` | Phase 2 site 1 — `corporateAction.findMany` wrapped `withAccelerateCache({ ttl: 300, swr: 60 })`; import `{ withAccelerateCache }` |
| `lib/services/chartinkScreenerService.ts:435` | Phase 2 site 2 — `chartinkScreenerResult.findMany` wrapped `withAccelerateCache({ ttl: 900, swr: 300 })` (plan targeted the route, but the direct Prisma read lives here) |
| `lib/services/recommendationPerformanceService.ts:255,278` | Phase 2 site 3 — two `recommendationTracker.findMany` wrapped `withAccelerateCache({ ttl: 600, swr: 60 })` (plan targeted history route; actual `RecommendationTracker` reads live here) |
| `lib/stock-service.ts:138,166` | Phase 2 site 4 — two `dailyPrice.findFirst` wrapped `withAccelerateCache({ ttl: 60, swr: 30 })` (note: file is `lib/stock-service.ts`, not `lib/services/stock-service.ts`); `aggregate` at :147 left unwrapped (returns a row count — not a good cacheStrategy target) |
| `lib/market-cache.ts:130` | Phase 2 site 5 — `marketCache.findUnique` wrapped `withAccelerateCache({ ttl: 300, swr: 60 })` |
| `lib/__tests__/recommendationPerformanceService.test.ts` | Mock factory adds `withAccelerateCache` pure stub (new named export `undefined` fix) |
| `lib/__tests__/chartinkScreenerService.test.ts` | Mock factory adds `withAccelerateCache` stub; exact-args assertion → `expect.objectContaining({ where, orderBy })` (cacheStrategy added to args) |

## Implementation Detail

### Phase 1 — `withAccelerate()` wiring (`lib/prisma.ts`)

- `import { withAccelerate } from '@prisma/extension-accelerate';`
- Accelerate branch: `prismaClient = new PrismaClient({ accelerateUrl: databaseUrl }).$extends(withAccelerate());`
- **Extension order matters**: `withAccelerate()` is applied FIRST, then `$allOperations` (circuit breaker /
  op counting / timeout) `$extends()` wraps the Accelerate-extended client — so the breaker sees the cached
  reads too. Documented in a comment.
- `let prismaClient: any` (eslint-disabled) + explicit `$allOperations` param types preserved the 46-error
  tsc baseline (the earlier intersection attempt would have added errors).

### `withAccelerateCache` boundary helper (the typing fix)

- The exported `prisma`/`db` stays typed **`AccelerateClient = PrismaClient`** so all 400+ model-method call
  sites keep their typing. The RUNTIME client is extended with `withAccelerate()`, so reads accept
  `cacheStrategy` — but the base type declares `cacheStrategy?: never`.
- `withAccelerateCache(strategy)` returns a function `(args: Parameters<T>[0]): ReturnType<T>` that spreads
  the args and injects `cacheStrategy` at the boundary (`as any`). `Parameters<T>[0]` preserves Prisma's
  contextual typing (so `orderBy: 'asc'|'desc'` literals still resolve) while `cacheStrategy` is added safely
  (the runtime client supports it). **No client-type restructuring; 46-error baseline untouched.**

### Phase 2 — `cacheStrategy` at 5 query sites

Added to the 5 highest-frequency direct-Prisma **reads** (writes are budget-guarded; cacheStrategy only
applies to reads). TTL/SWR chosen per data freshness tolerance:
1. Corporate actions combined — `{ ttl: 300, swr: 60 }`
2. Chartink screener results — `{ ttl: 900, swr: 300 }`
3. Recommendation performance trackers (×2, both sort paths) — `{ ttl: 600, swr: 60 }`
4. Daily price latest + prev-day (×2) — `{ ttl: 60, swr: 30 }`
5. Market cache lookup — `{ ttl: 300, swr: 60 }`

### Test coupling fixes (jest/prisma-mock)

`recommendationPerformanceService.test` and `chartinkScreenerService.test` mock `@/lib/prisma` with factory
objects returning only `{ __esModule: true, default: mock }`. The new named export `withAccelerateCache` was
`undefined` → `TypeError: (0, _prisma.withAccelerateCache) is not a function`. Both mock factories now include
a pure stub `(strategy) => (args) => ({ ...(args as object), cacheStrategy: strategy })`; the chartink exact-
args assertion switched to `expect.objectContaining({ where, orderBy })`.

## Verification

- `npx tsc --noEmit` = **46 errors = exact baseline (0 new)** — no errors in any touched file.
- `npx prisma validate` = **valid** · `npx prisma generate` = **succeeded**.
- Full suite: **995 pass / 4 skip / 2 fail** — the 2 fails are the **documented pre-existing
  `intelligence.test.ts` async cache-flake** (v3.25.0: `INTELLIGENCE_CACHE_HIT` vs `INTELLIGENCE_GENERATED`
  race; confirmed fails identically in isolation; `intelligence.ts`/`cache.ts`/`audit.ts` untouched).
  Excluding that pre-existing flaky suite: **71 suites, 995 pass, 4 skip, 0 fail from these changes**.
  The two initially-broken suites (chartinkScreenerService, recommendationPerformanceService) now pass.
- `npm run lint` fails with a pre-existing `next lint` CLI directory quirk ("Invalid project directory
  provided … lint") — unrelated to these changes (no lint config touched).
- No schema change → no migration. Diff scoped to exactly the 8 intended files (+ this doc).

## Rollout & Next Phases

- **Phase 0 (deploy-time, no code)**: manually provision a Prisma Postgres instance in Prisma Console;
  set `DATABASE_URL` + `DIRECT_URL` (already documented in v3.20.5). Post-migration, `withAccelerate()`
  wrapper may be dropped (Prisma Postgres caches by default; `PRISMA_ACCELERATE_CACHE_TTL` remains the knob).
- **Phase 4 (docs)**: this changelog + AGENTS.md + TODO + Primer + agent-memory + Lessons + `.env.example`.
- **Do not commit/push/merge without explicit user approval.**
