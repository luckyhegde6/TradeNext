# Spec Document — 30: Weekend-Stale Recommendations — Honest "Next Run" + Catch-Up + Staleness Surfacing

> Spec 30 of branch `fix/daily-rec-swing-cron-worker` (targets v3.49.0). This is fix candidate **#3 (Jobs)** from the 2026-10-11 recommendations live analysis.

## 1. Overview

**What**: Make the recommendations experience honest about the **weekday-only `30 4 * * 1-5` schedule** (`recommendationCronService.ts:42`) that leaves weekend viewers staring at a 1-month-stale "Last updated" with zero explanation: (1) surface "next run" + run freshness in the UI/API; (2) add a weekend/no-fire **conditional catch-up fallback** so a botched weekday run (or a long weekend) doesn't leave the page stale for days; (3) wire the stale-run notice from Spec 29 with a "Next run: <timestamp>" hint.

**Why**: Live-verified 2026-10-11 — the page shows the failed Sept-4 run with NO indication of why it's old or when the next attempt happens. Root enablers: weekday-only cron (weekends never fire), plus the failed-run persistence (Spec 29). Even after Spec 29 fixes rendering, the page would show a correct but **stale-but-fresh-looking** "Last updated: Mon 09:20" with no "next run" affordance. Users (and the 2026-10-08 join-request user) need to know the system is on a Mon–Fri cadence, and the operations team needs a way to force a run that isn't gated behind the fixed cron windows.

**Scope**:
- **IN**: (1) `GET /api/recommendations` gains `nextRunAt: string|null` + `lastUpdatedAt: string|null` + `isStale: boolean` (+ `scheduleCron: "30 4 * * 1-5 (Mon-Fri)"` descriptor string); (2) UI freshness banner on DailyPicksTab ("Next run <nextRunAt>" / "Stale — last successful run <date>"); (3) **catch-up fallback**: when the daemon boots or on the hourly sanity tick AND `now` is a weekday after `04:30 UTC` AND no successful `completed` run exists for that calendar day AND no run is currently RUNNING → enqueue the recommendations task via the existing worker path (reuses Spec 24/25 catch-up machinery — `catchUpMissedCronJobs`, `checkScheduledJobs`, worker queue dedup 90-min); (4) admin "Run now" already exists — keep; add explicit "next run" display on the admin recommendations page.
- **OUT**: Changing the schedule to daily (weekend runs of NSE-closed data are meaningless — the choice to run Mon–Fri is CORRECT); AI engine fixes (Spec 29 / 28); Google Sheets (Spec 31).

**Depends on**: `recommendationCronService.ts` (cron constants), `worker-engine.ts` / `cron-daemon.ts` catch-up machinery (Spec 25), `app/api/recommendations/route.ts` + `DailyPicksTab.tsx` (Spec 29 wiring), `lib/services/worker/worker-service.ts` `spawnRegularTask` for admin-triggered + catch-up enqueue.

---

## 2. Routes

### New Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| — | — | — | none new (all additions to existing routes) |

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/recommendations` | Response ADDITIONS (additive, non-breaking): `nextRunAt`, `lastUpdatedAt`, `isStale`, `scheduleCron` |
| GET | `/api/admin/recommendations` | Admin page gains `nextRunAt` per system job (already has job list — add `nextRun` to the payload if missing) |

---

## 3. Database Schema

### A. New Model: `None`

No schema change.

### B. Modifications to Existing Models

None. `CronJob` already has `nextRun`. `DailyRecommendationRun` already has `runDate`/`status` — the day-level "already ran today" check reads `runDate` of the newest completed run (same calendar day, UTC).

### C. Migration Notes

N/A.

---

## 4. Functions to Implement

### A. `lib/services/dailyRecommendationService.ts` (MODIFIED)

#### NEW `getNextRunAt(): Promise<Date | null>`

- Reads the system cron row `RECOMMENDATION_CRON_NAME` (`Daily Recommendations (System)`) → `nextRun`. Falls back to `calculateNextRun(RECOMMENDATION_CRON_EXPR, getCronFrom())` if the row is missing or the query fails (never throws).
- **Standalone helper** so the API route can add the field without digging into Prisma directly.

#### NEW `computeFreshnessFields(): { nextRunAt: string|null; lastUpdatedAt: string|null; isStale: boolean; scheduleCron: string }`

- `lastUpdatedAt` = newest `completed` run's `runDate` (this is the honest "last SUCCESSFUL update", NOT the failed-run date — pairs with Spec 29's `lastSuccessfulRunDate`).
- `isStale` = `lastUpdatedAt` is null OR `now - lastUpdatedAt > STALE_AFTER_MS` (default 48h, env `RECS_STALE_AFTER_MS`). Weekend rule: a Friday-run viewed Sunday IS stale by elapsed time; the UI shows "Last run Friday, next run Monday" (not a red error) — see Expected Behavior 8.
- `nextRunAt` = `getNextRunAt()`.
- `scheduleCron` = static `"30 4 * * 1-5 (Mon-Fri)"` (constant `RECOMMENDATION_CRON_DISPLAY`).

#### NEW `hasSuccessfulRunToday(now = new Date()): Promise<boolean>`

- `prisma.dailyRecommendationRun.count({ where: { status: "completed", aiProcessed: { gt: 0 }, runDate: { gte: startOfUtcDay(now) } } }) > 0` — used by the catch-up fallback ONLY.

#### (if not already present) `invalidateRecommendationsCache()`

- Already exists (`lib/cache.ts`) — reused after any catch-up enqueue.

### B. `lib/services/worker/worker-engine.ts` OR `lib/services/worker/cron-daemon.ts` (MODIFIED) — weekday catch-up

This stickers to the existing Spec 24/25 catch-up pattern (`catchUpMissedCronJobs` exists — verify its scope covers "missed ≤15 min window"). This spec extends it with **day-level semantics**:

#### NEW `ensureDailyRecommendationRan(): Promise<{ enqueued: boolean; reason: string | null }>`

- Runs once at daemon boot AND on the 5-min resync tick (reuse the existing tick location — do NOT add a new timer).
- Guards (ALL must pass to enqueue):
  - `isPlanLimitBreakerOpen()` → skip (degraded SQLite-first path is handled by existing degraded engine — never Prisma-enqueue during a hold).
  - Today is a **weekday** (Mon–Fri, UTC) — weekends intentionally skip (NSE closed).
  - `now >= 04:30 UTC` (the scheduled fire time already passed OR the daemon came up after it).
  - `!hasSuccessfulRunToday(now)` (no completed+AI run today yet).
  - `!isTaskInFlight` for taskType `recommendations` (check the SQLite/worker queue for a `running` task — reuse existing dedup; the 90-min dedup in Spec 21 covers the queue).
- When all pass → `spawnRegularTask("recommendations", { triggeredBy: "catchup", reason: "missed-daily-window" })` (reuse `worker-service.ts` spawn path) → audit `RECOMMENDATIONS_CATCHUP` → return `{ enqueued: true, reason }`.
- **Idempotent + safe**: the guards make it a no-op when anything already ran; the queue dedup prevents double-enqueue even under multi-instance (Leader election from Spec 21 is the single writer — call via the leader path, not from every instance).
- **Log**: `logger.info({ msg: "Recommendations catch-up enqueued", ... })` or `logger.debug` when skipped with the guard reason.

**Important**: this does NOT change the cron schedule — it is a **safety net** for "cron fired but the run failed silently / instance was cold at fire time". Wrong-state risk is bounded: only ever enqueues ONE run per missed weekday window (day-level guard), never on weekends, never when today already succeeded.

### C. `app/api/recommendations/route.ts` (MODIFIED)

- Response body additions (see §7) — route computes them via `computeFreshnessFields()` after `getLatestRecommendations()`, wrapped in try/catch that defaults `nextRunAt: null, lastUpdatedAt: null, isStale: false` (never 500 for a freshness-info failure).

### D. `app/components/recommendations/DailyPicksTab.tsx` (MODIFIED)

- New optional props `nextRunAt?: string|null`, `isStale?: boolean`.
- Freshness banner ABOVE the stats row, only when `isStale`:
  - Stale + has run date: `"Last successful run <date> — next run <nextRunAt> (Mon–Fri, 10:00 IST)"`
  - Stale + no run: `"No successful run yet — next run <nextRunAt>"`
  - Combined with Spec 29's AI-unavailable amber banner (they can coexist — staleness banner is neutral/grey-violet, AI banner is amber).
- Uses `lastUpdatedAt` (successful) not the failed-run date — pairs with Spec 29.

### E. `app/admin/recommendations/page.tsx` (MODIFIED)

- Show `nextRun` for the system recommendations job in the jobs/status table (if not already shown) — the admin sees the *actual* next fire.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/dailyRecommendationService.ts` | Modified | `getNextRunAt`, `computeFreshnessFields`, `hasSuccessfulRunToday` |
| `lib/services/worker/cron-daemon.ts` (or `worker-engine.ts`) | Modified | `ensureDailyRecommendationRan` day-level catch-up + wiring to existing tick/boot |
| `app/api/recommendations/route.ts` | Modified | Add `nextRunAt`, `lastUpdatedAt`, `isStale`, `scheduleCron` |
| `app/components/recommendations/DailyPicksTab.tsx` | Modified | Staleness banner |
| `app/admin/recommendations/page.tsx` | Modified | Next-run display |
| `lib/audit.ts` | Modified | `RECOMMENDATIONS_CATCHUP` tag |
| `lib/__tests__/dailyRecommendationService.test.ts` | Modified | New helpers |
| `lib/__tests__/worker-engine.test.ts` / new `catchup` test | Modified | Day-level catch-up guards |
| `lib/__tests__/recommendationsRoute.test.ts` (extends Spec 29's) | Modified | Freshness fields shape |

---

## 6. Dependencies

### New Packages
| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies
| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/services/worker/worker-service.ts` | `spawnRegularTask` | Catch-up enqueue |
| `@/lib/services/leader.ts` | leader gate | Single-writer catch-up (multi-instance safety) |
| `@/lib/cron-parser` | `calculateNextRun` | nextRun fallback |
| `@/lib/cache` | `invalidateRecommendationsCache` | Post-enqueue |
| `@/lib/audit` | `audit()` | `RECOMMENDATIONS_CATCHUP` |

---

## 7. API Contract

### GET /api/recommendations (additive — full shape)

```json
{
  "success": true,
  "run": { … },
  "latestRun": { … },
  "lastSuccessfulRunDate": "2026-10-10T09:20:00Z",
  "nextRunAt": "2026-10-12T04:30:00.000Z",
  "lastUpdatedAt": "2026-10-10T09:20:00Z",
  "isStale": true,
  "scheduleCron": "30 4 * * 1-5 (Mon-Fri)",
  "stocks": [ … ],
  "timestamp": "…"
}
```

All four new keys are ALWAYS present (values nullable). Redis/memory cache: the route-level 60s cache already stores the response body — the new fields must be computed AFTER cache-read so a cached body isn't served with stale freshness info; see Expected Behavior 6.

---

## 8. UI/UX Requirements

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `DailyPicksTab` (modified) | `app/components/recommendations/` | Freshness banner |

### States
- **Fresh** (`isStale === false`): no banner
- **Stale with days-back**: banner `Last successful run <date> — next run <nextRunAt> (Mon–Fri, 10:00 IST)`
- **Stale, never-run**: `No successful run yet — next run <nextRunAt>`
- **Freshness info unavailable** (nulls): no banner, no error (route defaulted nulls)

### Responsive / Dark mode
- Banner is a single text row (wraps on 375px); inherits card styles.

---

## 9. Rules & Guardrails

- [ ] Schedule is NOT changed to daily — weekend NSE-closed runs stay off (guard explicitly)
- [ ] Catch-up only via leader (never multi-instance double-enqueue)
- [ ] Day-level guard: one successful run today ⇒ no catch-up; a run in flight (queue dedup) ⇒ no catch-up
- [ ] `isPlanLimitBreakerOpen()` ⇒ catch-up skipped (degraded engine owns that path)
- [ ] Freshness info failures NEVER 500 the reads (defaults)
- [ ] Audit on catch-up enqueue only, never on skip (log `info` on enqueue, `debug` on skip-with-reason)
- [ ] Additive API contract — existing fields untouched

---

## 10. Expected Behavior

1. `getNextRunAt()` returns the cron row's nextRun (fallback: computed from expression).
2. `computeFreshnessFields()` returns `isStale: true` when newest completed run is > `RECS_STALE_AFTER_MS` old (48h default).
3. Weekend (Sat/Sun UTC): `ensureDailyRecommendationRan` NEVER enqueues — reason `weekend`.
4. Weekday after 04:30 UTC with no today-run → enqueues exactly ONE recommendations task (leader-only), audit emitted.
5. Weekday with a completed+AI today-run → no enqueue (reason `already-ran`).
6. API serves freshness fields computed from FRESH state on every uncached request; a cached (≤60s) body may carry older freshness ONLY within the TTL window — then the route recomputes before caching (implement: compute before `recommendationsCache.set`, and on the mem-cache hit path patch the new fields from current time).
7. DailyPicksTab shows the stale banner with correct next-run text at 375/768/1440.
8. Friday-run viewed Sunday renders banner (not error): "Last successful run Friday 09:20 — next run Monday 04:30 UTC (10:00 IST)".
9. Full Jest suite green; no regression in cron-daemon tests (Spec 24/25 suite intact).

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Cron row missing | `getNextRunAt` fallback computes from expression | `warn` |
| Freshness computation fails | API defaults `nextRunAt/lastUpdatedAt: null, isStale: false` — never 500 | `warn` |
| Catch-up spawn fails (queue down) | Log error, no retry loop (next 5-min tick retries) | `error` |
| DB unavailable in `hasSuccessfulRunToday` | Return `false` (fail-open → catch-up allowed IF other guards pass — degraded engine picks it up); log | `warn` |
| Non-leader instance | Skip catch-up silently | `debug` |

---

## 12. Test Strategy

### Unit Tests (`lib/__tests__/dailyRecommendationService.test.ts` + worker catch-up test)

- [ ] `getNextRunAt` returns row nextRun; fallback path on missing row
- [ ] `computeFreshnessFields`: stale vs fresh boundary (mock now), null cases
- [ ] `hasSuccessfulRunToday` true/false (mock prisma count)
- [ ] Day-level catch-up: all-guards-pass enqueues once, `already-ran`, `weekend`, `breaker-open`, `session-in-flight` all skip with logged reason
- [ ] Leader-only (non-leader no-op)
- [ ] Audit emitted on enqueue only

### Route Test

- [ ] Freshness fields present + correct on uncached request
- [ ] Cache-hit path patches freshness (mocked timer)

### Component Test (DailyPicksTab)

- [ ] Stale banner renders correct text for both stale-variants; absent when `isStale === false`

### E2E — fold into a future recs spec; manual live-check acceptable (existing `e2e/recommendations.spec.ts` should not break — additive props with defaults)

---

## 13. Performance Considerations

- **Helpers**: `getNextRunAt`/`hasSuccessfulRunToday` are 1–2 index reads/counts per call — the catch-up runs once per 5-min tick, not per request
- **API**: freshness computed once per uncached request (~1 extra read); cache-hit path is O(1) patch
- **No** new timers — reuses existing tick/boot locations

---

## 14. Security Considerations

- **Auth**: no new routes; admin page change is read-only display
- **Input**: none
- **Secrets**: none
- **Audit**: `RECOMMENDATIONS_CATCHUP` (enqueue only)

---

## 15. Definition of Done

- [ ] Freshness + next-run fields in API (additive, always present)
- [ ] `ensureDailyRecommendationRan` day-level catch-up wired at boot + tick via leader with audit
- [ ] DailyPicksTab staleness banner + admin next-run display
- [ ] Tests green (full suite 134), `tsc` 0 new, `lint` 0
- [ ] Live-verify on :3000: banner states + catch-up guard behavior (mocked weekdays)
- [ ] Docs updated (AGENTS.md, CHANGELOG, Todo-ref, Primer, agent-memory, Lessons, session docs, session-todos)

---

## 16. Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Catch-up enqueues a run right after a failed-but-partial weekday attempt | Day guard checks `completed` runs only; failed today ⇒ treated as missed ⇒ one retry (desired) | No |
| Freshness info on cached bodies is ≤60s stale | Route patches on cache-hit before responding | No |
| Multi-instance double-catch-up | Leader-only (Spec 21) + queue dedup | No |
| The truly-correct fix (make the run itself succeed) is outside this spec | Specs 28 (Accelerate) + 29 (AI failed-run) are the companion tracks | Yes — engine reliability |