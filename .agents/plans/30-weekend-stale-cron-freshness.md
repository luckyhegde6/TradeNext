# Implementation Plan — Weekend-Stale Recommendations (freshness fields + day-level catch-up)

> Generated from spec: `.agents/specs/30-weekend-stale-cron-freshness.md`
> Save to `.agents/plans/30-weekend-stale-cron-freshness.md`

## Spec Reference

- **Spec**: `.agents/specs/30-weekend-stale-cron-freshness.md`
- **Branch**: `fix/daily-rec-swing-cron-worker` (base `main` = PR #134 MERGED; Spec 26 at `44156e6`)
- **Created**: 2026-10-11
- **Status**: ⏳ **DRAFT — pending human spec review & approval before implementation (spec-driven gate)**

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step → verify: [check]`

### Phase 1: Service helpers (`lib/services/dailyRecommendationService.ts`)

1. **Add `getNextRunAt(): Promise<Date | null>`** — read system cron row (`RECOMMENDATION_CRON_NAME`), fallback `calculateNextRun(RECOMMENDATION_CRON_EXPR, getCronFrom())` on missing row/throw; never throws → verify: `npx tsc --noEmit` (0 new); unit tests.

2. **Add `computeFreshnessFields()`** → `{ nextRunAt, lastUpdatedAt, isStale, scheduleCron }` where `lastUpdatedAt` = newest **completed+aiProcessed>0** run's runDate (same `LATEST_RUN_WHERE` predicate from Spec 29 — reuse), `isStale` = null-dated OR `now - lastUpdatedAt > RECS_STALE_AFTER_MS` (default 48 h) → verify: tsc; tests.

3. **Add `hasSuccessfulRunToday(now?)`** → count `status:"completed" AND aiProcessed>0 AND runDate >= startOfUtcDay(now)` > 0; DB failure → `false` (fail-open) + `logger.warn` → verify: tsc; tests.

4. **Add `RECOMMENDATION_CRON_DISPLAY = "30 4 * * 1-5 (Mon-Fri)"`** constant near the schedule constant; `scheduleCron` uses it → verify: export present.

### Phase 2: Day-level catch-up (worker daemon)

5. **In `lib/services/worker/cron-daemon.ts`** (or `worker-engine.ts` per the existing Spec 24/25 location — confirm where `catchUpMissedCronJobs` and the 5-min resync tick live): add `ensureDailyRecommendationRan()` —
   - Guards: `isPlanLimitBreakerOpen()` → skip; weekday (Mon–Fri UTC) else skip; `now >= 04:30Z` (scheduled-fire passed or daemon booted late); `!hasSuccessfulRunToday()`; no in-flight `recommendations` task (reuse existing queue dedup / `running` check).
   - On pass → leader-gated `spawnRegularTask("recommendations", { triggeredBy: "catchup", reason: "missed-daily-window" })` → audit `RECOMMENDATIONS_CATCHUP` → `logger.info`.
   - On skip → `logger.debug` with guard reason; never audit on skip.
   → verify: tsc; test fixtures below green.

6. **Wire at daemon boot + 5-min resync tick** (same sites as Spec 25 catch-up — do NOT add a new timer) → verify: boot log shows evaluation; enforcement via tests.

7. **Add audit tag `RECOMMENDATIONS_CATCHUP`** to `lib/audit.ts` → verify: tag exported.

### Phase 3: API + UI

8. **`app/api/recommendations/route.ts`**: after reading/caching latest-run body, append `nextRunAt, lastUpdatedAt, isStale, scheduleCron` from `computeFreshnessFields()`; **on the mem-cache hit path patch the four fields from current time** (freshness must not go stale inside the 60 s TTL); try/catch defaults `null/false` — never 500 → verify: curl :3000 shape; route tests.

9. **`app/components/recommendations/DailyPicksTab.tsx`**: new optional props `nextRunAt?: string|null`, `isStale?: boolean`; stale banner "Last successful run <date> — next run <nextRunAt> (Mon–Fri, 10:00 IST)" (grey-violet, neutral); "No successful run yet — next run <nextRunAt>" variant; absent when `isStale === false` → verify: component tests; manual render at 375/768/1440.

10. **`app/admin/recommendations/page.tsx`**: display `nextRun` for the system job if not already shown → verify: page renders.

### Phase 4: Tests

11. **Extend `lib/__tests__/dailyRecommendationService.test.ts`** — `getNextRunAt` (row/fallback), `computeFreshnessFields` (stale/fresh/null boundaries with mocked now), `hasSuccessfulRunToday` (true/false/fail-open) → verify: `npm run test -- dailyRecommendationService`.

12. **New worker daemon tests** (extend the Spec 24/25 catch-up suite file): guards all-pass → enqueues once + audit; `already-ran`; `weekend`; `breaker-open`; in-flight → skip with logged reason; non-leader no-op → verify: `npm run test -- cron-daemon` (or the suite hosting catch-up).

13. **Route/component tests**: four fields present + correct on uncached; cache-hit path patches freshness (mock timer); banner renders both stale variants / absent when fresh → verify: `npm run test`.

### Phase 5: Docs

14. **`.agents/changelog/versions-v3.49.md`** — Spec 30 detail (weekend-stale evidence + design) → verify: file exists, indexed.
15. **AGENTS.md** — version row (32 KB cap watch, Lesson 142 — defer into changelog if capped) → verify: row added or deferral noted.
16. **TODO.md / Primer.md / agent-memory.md** — status + activity entries → verify: each updated.
17. **Lessons.md** — add if reusable pattern (weekday-cron staleness honesty; day-level catch-up vs ≤15-min window catch-up) → verify: entry appended.
18. **Session memory** — `.agents/sessions/2026-10-11-recs-live-analysis/` updates → verify: files reflect Spec 30.
19. **`.agents/session-todos.md` + `.agents/handoffs/active/latest.md`** → verify: updated.

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| `getNextRunAt` returns row nextRun | `dailyRecommendationService.test.ts` | Primary path |
| `getNextRunAt` fallback on missing row/throw | `dailyRecommendationService.test.ts` | No-throw |
| `computeFreshnessFields` stale/fresh/null boundaries | `dailyRecommendationService.test.ts` | 48 h rule + nulls |
| `hasSuccessfulRunToday` true/false/fail-open | `dailyRecommendationService.test.ts` | Day gate |
| Catch-up all-guards-pass → enqueues once + audit | cron-daemon catch-up suite | The core |
| `already-ran` skip | cron-daemon catch-up suite | Day-level |
| weekend skip (Sat/Sun UTC) | cron-daemon catch-up suite | Schedule honesty |
| breaker-open skip | cron-daemon catch-up suite | Degraded path |
| in-flight skip | cron-daemon catch-up suite | Dedup |
| non-leader no-op | cron-daemon catch-up suite | Single-writer |
| Route: 4 fields present + correct uncached | route test | API contract |
| Route: cache-hit patches freshness | route test | TTL freshness |
| Banner both stale variants / absent fresh | DailyPicksTab component test | UI |

### Integration Tests

| Test | What It Verifies |
|------|------------------|
| `GET /api/recommendations` carries the 4 fields (live :3000) | Route wiring |
| Daemon boot log evaluates catch-up (debug reason visible) | Live boot |

### E2E Tests

| Test | What It Verifies |
|------|------------------|
| Existing `e2e/recommendations.spec.ts` still green (additive) | No regression |
| (optional) fresh page has NO banner; stale fixture shows it | Manual |

---

## Verification Checklist

> Run these commands after implementation. All must pass.

```bash
# Type checking (baseline: 46 error lines, prod 0)
npx tsc --noEmit

# Tests — RUN ALONE, never chained with ';'
npm run test -- dailyRecommendationService
npm run test -- cron-daemon
npm run test            # full suite

npm run lint

# Hygiene
git status        # no junk (*.yaml, screenshots, dev-server.log), no secrets
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Catch-up enqueues after a partial failed weekday run | Day check counts completed+AI only; failed today ⇒ one retry — desired | No |
| Freshness fields on cached bodies ≤60 s stale | Patch on cache-hit before respond | No |
| Multi-instance double-catch-up | Leader-only + queue dedup (Spec 21) | No |
| Catch-up never fires on Netlify (instance suspended) | Next warm boot/tick evaluates; same class as Spec 25 — documented | No |
| Honest "stale" text may alarm users on weekends | Copy is neutral ("Last run Friday — next run Monday") not an error | No |

---

## Documentation Checklist

> All docs must be updated before commit.

- [ ] **AGENTS.md** — version row (or documented deferral at 32 KB cap, Lesson 142)
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.49.md` + index update
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (if pattern/bug discovered)
- [ ] **Session memory** — `decisions.md` + `flow.md`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

> Must pass before any commit. **Commit only on explicit user request; merge/deploy user-only (D9).**

1. `npx tsc --noEmit` — 0 new errors (baseline 46)
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated