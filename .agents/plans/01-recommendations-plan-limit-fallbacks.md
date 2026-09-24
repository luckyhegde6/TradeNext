# Implementation Plan — Recommendations Plan-Limit Fallbacks (History / Performance / Ideas)

> Generated from spec: `.agents/specs/01-recommendations-plan-limit-fallbacks.md`
> Save to `.agents/plans/01-recommendations-plan-limit-fallbacks.md`

## Spec Reference

- **Spec**: `.agents/specs/01-recommendations-plan-limit-fallbacks.md`
- **Branch**: `feature/ph22-decision-engine` (stacked on v3.41.1 `a269057`)
- **Created**: 2026-09-25

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step description → verify: [check command]`

### Phase 1: Mirror read (foundation)

1. **Add `getRecommendationRuns` to `lib/sqlite.ts`** — interface declaration (next to `getRecommendationStocks` ~L380) + implementation (pattern: `getRecommendationStocks` impl at ~L5636): `SELECT * FROM daily_recommendation_run WHERE status IN (…) AND unique_stocks > 0 ORDER BY run_date DESC LIMIT ?`, camelCase rehydrate (dateKeys: run_date/created_at/completed_at), never throws → `[]`. → verify: `npx tsc --noEmit` shows 0 new errors

2. **Extend mirror tests** in `lib/__tests__/sqliteMirror.test.ts` — `getRecommendationRuns` happy path (desc order, camelCase fields, status/uniqueStocks filter, limit) + empty/unavailable → `[]`. → verify: `npx jest lib/__tests__/sqliteMirror.test.ts` passes

### Phase 2: History fallback (route)

3. **Rewrite `app/api/recommendations/top-stocks/route.ts`** — keep Prisma `$queryRaw` path verbatim inside try/catch; on `isDbUnavailableError` call private `topStocksFromSqlite(limit, offset, filter)` (mirror-ready guard → `getRecommendationRuns` → per-run `getRecommendationStocks` + inject runDate/runStatus → dedupe symbol keeping first (runs desc) → filter → tracker join via one `getRecommendationTrackers({symbolIn})` → sort screenerCount desc → slice → map to exact serialized shape → cache 1h). Log `warn` source `"sqlite"`; mirror-not-ready → rethrow. → verify: `npx tsc --noEmit` 0 new errors; `npx jest lib/__tests__/recommendationsPlanLimitFallbacks.test.ts` (once written)

4. **Write History fallback tests** in new `lib/__tests__/recommendationsPlanLimitFallbacks.test.ts` — Prisma-path passthrough, P6003 + mirror ready → 200 shape, dedupe/filter/sort/pagination, tracker join nulls, mirror not ready → 500. → verify: `npx jest lib/__tests__/recommendationsPlanLimitFallbacks.test.ts` passes

### Phase 3: Performance fallback (service)

5. **Modify `lib/services/recommendationPerformanceService.ts`** — in `getPerformanceList`, wrap the Prisma branch (count + findMany + bridge) in try/catch; on `isDbUnavailableError` call private `getPerformanceListFromSqlite(query)` (mirror-ready guard → `getRecommendationTrackers({status?, limit: 5000})` → JS filter next-day promotion + category/recommendation → map via `toListItem` shape with defensive date coercion → sort per query → paginate → `total = filtered.length` → `columns = getPerformanceColumns()` → cache 15 min → `warn` source `"sqlite"`; skip `bridgeMissingCurrentPrices` in fallback). → verify: `npx tsc --noEmit` 0 new errors

6. **Write Performance fallback tests** — filters, next-day promotion, returnPercent sort, pagination, columns, mirror-not-ready → rethrow. → verify: `npx jest lib/__tests__/recommendationsPlanLimitFallbacks.test.ts` passes

### Phase 4: Ideas fallback (service)

7. **Modify `lib/services/syncedDataService.ts`** — step 2: guard DB block with `if (!isPlanLimitBreakerOpen())`; wrap `findUnique` + `upsert` in `isDbUnavailableError` try/catch (skip write, still `source:"api"`); when breaker open OR DB write skipped → best-effort `sqlite?.upsertMarketCache(...)` on payload change. Step 3: breaker-open → `sqlite?.getMarketCache(cacheKey)` first; wrap Prisma `findUnique` in `isDbUnavailableError` try/catch → mirror fallback; mirror miss → rethrow original. Add `getSqliteFallback` import. → verify: `npx tsc --noEmit` 0 new errors

8. **Write Ideas fallback tests** — breaker open + API ok → zero `prisma.marketCache` calls, `source:"api"`; API fail + breaker open + mirror row → `source:"db"`; API fail + breaker open + mirror miss → throws original; API fail + mirror miss + prisma throws P6003 → throws original. → verify: `npx jest lib/__tests__/recommendationsPlanLimitFallbacks.test.ts` passes

### Phase 5: HistoryTab UI error state

9. **Modify `app/components/recommendations/HistoryTab.tsx`** — add `error` state; set on fetch throw or `data.success === false`; render error card + Retry when `error && stocks.length === 0`; keep loading skeleton + genuine empty state. → verify: `npx tsc --noEmit` 0 new errors; manual dev-server curl of `/api/recommendations/top-stocks` returns `success:true`

### Phase 6: Verification

10. **Full gate** → verify:
    - `npx tsc --noEmit` → 0 production errors (46 exact baseline)
    - `npm run test` → ALL suites pass (108/108, 1416 pass / 4 skip — run alone, never chained)
    - `npm run lint` → 0 errors
    - `npm run quickbuild` → builds clean
    - Dev-server smoke: start `npm run dev`, curl `/api/recommendations/top-stocks`, `/api/recommendations/performance`, `/api/recommendations/ideas` — all `success:true` (local DB up), shapes unchanged; `npx playwright test --headed e2e/recommendations.spec.ts` → green (recommendations regression)

### Phase 7: Documentation

11. **Docs pass** (mandatory before commit):
    - AGENTS.md version table → add v3.41.2 row
    - `.agents/changelog/versions-v3.41.md` → spec 01 detail bullet
    - `.agents/CHANGELOG.md` index → addenda v3.41.2
    - TODO.md quick-reference → in-progress row (spec 01)
    - Primer.md → current project status
    - agent-memory.md → activity entry
    - Lessons.md → new lesson: masked-500-as-empty-state bug class (HistoryTab) + plan-limit hold stragglers audit
    - Session memory: `.agents/sessions/<date-hash>/decisions.md` + `flow.md`; `.agents/session-todos.md`; `.agents/handoffs/active/latest.md`
    → verify: `git status` clean of junk; pre-commit workflow + hygiene checklist run

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| `getRecommendationRuns` reads (desc, camelCase, filters, limit, empty) | `sqliteMirror.test.ts` | Mirror read contract |
| topStocksFromSqlite: dedupe/filter/sort/paginate/total | `recommendationsPlanLimitFallbacks.test.ts` | History assembly |
| topStocksFromSqlite: tracker join + nulls | `recommendationsPlanLimitFallbacks.test.ts` | LEFT JOIN semantics |
| Route: Prisma path passthrough (no fallback) | `recommendationsPlanLimitFallbacks.test.ts` | Happy path untouched |
| Route: P6003 + mirror ready → 200; mirror not ready → 500 | `recommendationsPlanLimitFallbacks.test.ts` | Degradation ladder |
| getPerformanceListFromSqlite: filters/promotion/sort/pagination/columns | `recommendationsPlanLimitFallbacks.test.ts` | Performance list |
| getOrFetchSyncedData: 4 hold-path scenarios | `recommendationsPlanLimitFallbacks.test.ts` | Ideas/fetch chain |
| DB-healthy regression (existing 1416 tests) | whole suite | No behavior change |

### Integration Tests (If API Route)

| Test | What It Verifies |
|------|------------------|
| `GET /api/recommendations/top-stocks` returns `success:true` + stocks on :3000 | Route wiring (local DB up) |
| `GET /api/recommendations/performance` returns `success:true` | Route wiring |
| `GET /api/recommendations/ideas` returns `success:true` or graceful ideas | Route wiring |

### E2E Tests (If UI Change)

| Test | What It Verifies |
|------|------------------|
| `e2e/recommendations.spec.ts` remains green | No regression on success path |

---

## Verification Checklist

> Run these commands after implementation. All must pass.

```bash
# Type checking
npx tsc --noEmit                    # 0 production errors (baseline: 46 exact)

# Tests (run ALONE, never chained with ';' on Windows)
npm run test                        # 108/108 suites (1416 pass / 4 skip / 0 fail)

# Lint
npm run lint                        # 0 errors

# Build
npm run quickbuild                  # Next.js build succeeds

# E2E regression (dev server auto-starts via playwright.config webServer)
npx playwright test e2e/recommendations.spec.ts   # green
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Mirror lacks a run (sync lag / cold start) | `getRecommendationRuns` servable subset — dedupe/list still works over present runs; mirror-not-ready rethrow ≠ today's behavior change | No |
| Fallback approximation: `total` = filtered length (Performance) | Same class as `returnPercent` sort branch (fetches bounded 5000 + JS sort); documented; cached 15 min | No |
| `getRecommendationRuns` N+1 stock reads (run × stocks on in-memory sql.js) | Bounded by `LIMIT 500` runs; zero-Prisma (safe during hold); cached 1h | No |
| Ideas mirror `upsertMarketCache` adds writes when `market_cache` table missing in old mirror | Existing table (DDL L1658) + syncFromPrisma cares for it; best-effort try/catch never throws | No |
| HistoryTab error card visual parity | Reuses Performance tab's error card classes | No |

---

## Documentation Checklist

> All docs must be updated before commit.

- [ ] **AGENTS.md** — version row v3.41.2
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.41.md` detail + `.agents/CHANGELOG.md` index addendum
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (masked-500-as-empty-state + hold-straggler audit)
- [ ] **Session memory** — `.agents/sessions/<date-hash>/decisions.md` + `flow.md`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

> Must pass before any commit.

1. `npx tsc --noEmit` — 0 new production errors (46 exact baseline)
2. `npm run test` — all 108 suites pass
3. `npm run lint` — 0 errors
4. `npm run quickbuild` — builds clean
5. `git status` — no junk artifacts, no secrets in diff, only spec-01 files staged
6. Documentation updated per checklist above
7. Engineering checklist (`.agents/rules/checklist.md`) validated
8. Commit message style: `v3.41.2 — Spec 01 Recommendations plan-limit fallbacks (History/Performance/Ideas) + HistoryTab error state` (on explicit user approval only; no push/PR without separate approval)