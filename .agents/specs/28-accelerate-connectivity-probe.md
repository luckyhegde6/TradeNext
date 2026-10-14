# Spec Document — 28: Accelerate Connectivity Probe + Worker/Reaper Resilience

> Spec 28 of branch `fix/daily-rec-swing-cron-worker` (targets v3.49.0). This is fix candidate **#1 (Workers/jobs)** from the 2026-10-11 recommendations live analysis (`.agents/sessions/2026-10-11-recs-live-analysis/`).

## 1. Overview

**What**: Instrument production Prisma **Accelerate** connectivity from the running app and make the worker/reaper paths resilient to transient Accelerate outages so the daily recommendations pipeline stops failing silently.

**Why**: Live prod logs (2026-10-11 analysis, 24-h dump) show a recurring failure on the scheduled pipeline: `Stale recommendation-run reap failed, error=Unable to connect to the Accelerate API. This may be due to a network or DNS issue...` — Accelerate is unreachable from Netlify at times, and the same failure class breaks run persistence/AI phases, leaving prod stuck on a single **failed** run from 2026-09-04 (`aiProcessed:0`, 100 HOLDs). There is currently **no visibility** into this connectivity from inside the app; the reap failure is only visible as a log line, and the worker engine treats an Accelerate outage as a reaper failure with no signal to ops.

**Scope**:
- **IN**: (1) a zero-prisma, fail-open Accelerate connectivity probe (`lib/services/accelerateProbe.ts`) with an admin diagnostic route + a small admin console card; (2) a worker-engine reaper hardening change so that while Accelerate is unreachable the reaper **skips** instead of logging a scary error every 5 min (the rows cannot be touched anyway — a DB-down reap attempt is wasted work and log noise; failure-counting keeps happening in `recordSystemRunOutcome` for genuinely-executed failures).
- **OUT**: FIXING Accelerate connectivity itself (Netlify env/DNS — ops action, not code); the overall "AI stage makes a failed run" UX redesign (Spec 29); cron weekday-only scheduling changes (Spec 30); Google Sheets env arming (Spec 31).

**Depends on**: `lib/prisma.ts` Accelerate adapter + `withAccelerateCache` (v3.28.4), `lib/services/worker/worker-engine.ts` `reapStaleWorkerTasks` (reaper), `lib/services/worker/worker-service.ts` `recordSystemRunOutcome`, degraded-mode machinery (v3.45.0, Spec 21).

---

## 2. Routes

### New Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/accelerate/probe` | admin | Run the connectivity probe live and return timings/status (also renders the console card) |

### Modified Routes
| Method | Path | Change |
|--------|------|--------|
| GET | `/api/admin/workers` | `GET` payload gains optional `accelerate: {reachable, lastProbeMs, lastError}` diagnostic block (cheap, does not run a probe; reflects the last probe result) |

---

## 3. Database Schema

### A. New Model: `None`

No Prisma models. The probe result is transient in-memory (never persisted — it is a diagnostic, not audit data) and the reaper skip decision is computed live from probe state.

### B. Modifications to Existing Models

None.

### C. Migration Notes

N/A — no migration required.

---

## 4. Functions to Implement

### A. `lib/services/accelerateProbe.ts` (NEW)

#### `probeAccelerate(): Promise<AccelerateProbeResult>`

- Signature: `probeAccelerate(opts?: { force?: boolean }): Promise<AccelerateProbeResult>`.
- Purpose: measure whether the production Prisma dataplane (Accelerate) is reachable **without** performing a business operation. Runs a trivial, index-only read raced against a short timeout (`ACCELERATE_PROBE_TIMEOUT_MS`, default 3500 ms, env-overridable).
- Behavior:
  - NEVER throws — returns `{ reachable: false, error, latencyMs, at }` on failure.
  - Uses the **least expensive** query available: `prisma.$queryRaw` `SELECT 1` (or `dailyRecommendationRun.findFirst({select:{id:true}, take:1})` if raw is unavailable in the adapter context) with `withAccelerateCache` disabled.
  - Caches the last result in-memory (module-level, TTL `ACCELERATE_PROBE_TTL_MS` default 60 000 ms) so the reaper and dashboards share ONE probe per TTL window — never one probe per reap tick.
  - Records `latencyMs` as `Math.round(performance.now()-start)`; `at` = ISO string.
  - `getLastProbe(): AccelerateProbeResult | null` — synchronous accessor for the reaper/admin route (no new I/O).
- Router-route note: `SELECT 1` under Accelerate may not round-trip through the dataplane in all adapter versions; the smoke test must assert against the fallback path too (see tests).

#### `isReachableCached(): boolean` / `shouldSkipReap(): boolean`

- `shouldSkipReap()` returns `true` when the cached probe says unreachable **or** when the probe itself is unavailable because Prisma is known-down (`isPlanLimitBreakerOpen()` from `@/lib/db-utils`).

#### `clearProbeCache(): void`

- Test/circuit-state helper; clears the module-level cache.

### B. `lib/services/worker/worker-engine.ts` (MODIFIED) — reaper hardening

#### `reapStaleWorkerTasks` — skip-on-unreachable

- At the TOP of the function, BEFORE any Prisma read: `if (shouldSkipReap()) { return { reapedTasks: 0, reapedRuns: 0 }; }` and log ONE throttled `logger.warn({ msg: "Reap skipped — Accelerate unreachable", ... })` (throttle: log at most once per 5 min — reuse a module-level `lastReapSkipLog` timestamp).
- Preserves the existing breaker-guard (`isPlanLimitBreakerOpen` early return at `worker-engine.ts:551`) — the new check is additive.
- The `Stale recommendation-run reap failed` / `Stale worker-task reap failed` log lines at `worker-engine.ts:607` and `:647` remain for genuinely-executed errors (e.g. a query failing mid-reap while the DB was reachable at start) — they are NOT silenced, only the DB-down case is skipped earlier.

#### `recordSystemRunOutcome` (worker-service.ts) — unchanged

- No change: the reaper skip must not touch cron-ledger outcome counters (an unexecuted reaper pass is not a run outcome). Tests assert counters are untouched.

### C. `app/api/admin/accelerate/probe/route.ts` (NEW)

- `GET` → admin session required (`auth()` role check, same pattern as `app/api/admin/google-sheets/config/route.ts:29-33`).
- Runs `probeAccelerate({ force:true })` (force bypasses TTL cache — the console button must give a fresh answer).
- 200 `{ success: true, probe: { reachable, latencyMs, at, error } }` — never 500 (fail-open probe).
- Audit tag: `ACCELERATE_PROBE` (info-level, no secret data).

### D. Admin console card (app/admin/live-prices/page.tsx? — see Files)

- Small "Accelerate Connectivity" card on an existing admin diagnostic page (recommended: **AI Monitoring** page, which already hosts decision/diagnostics) showing `reachable ✓/✗`, last `latencyMs`, `at`, and a "Run probe" button hitting `GET /api/admin/accelerate/probe`.
- Renders `<null>`-safe when unknown ("never probed").

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/accelerateProbe.ts` | **Created** | Probe + cache + `shouldSkipReap` |
| `lib/services/worker/worker-engine.ts` | Modified | `reapStaleWorkerTasks` skip-on-unreachable guard + throttled skip log |
| `app/api/admin/accelerate/probe/route.ts` | **Created** | Admin probe route (force) |
| `app/api/admin/workers/route.ts` | Modified | GET payload gains `accelerate` diagnostic block (read-only `getLastProbe()`) |
| `app/admin/ai-monitoring/page.tsx` | Modified | Accelerate Connectivity card (or nearest admin diagnostic page) |
| `lib/audit.ts` | Modified | Add `ACCELERATE_PROBE` tag |
| `lib/__tests__/accelerateProbe.test.ts` | **Created** | Unit + smoke tests |
| `lib/__tests__/worker-engine.test.ts` | Modified | Reaper-skip tests (Accelerate unreachable → 0/0, counters untouched) |
| `lib/__tests__/worker-service.test.ts` | Modified | If `recordSystemRunOutcome` touched by tests, assert unchanged behavior |

---

## 6. Dependencies

### New Packages
| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies
| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/prisma` | `prisma.$queryRaw`/findFirst | Probe query |
| `@/lib/db-utils` | `isPlanLimitBreakerOpen`, `isDbUnavailableError` | Skip-guard condition |
| `@/lib/audit` | `audit()` | Probe audit tag |
| `@/lib/logger` | `logger.info/warn` | Structured logging (throttled skip log) |

---

## 7. API Contract

### GET /api/admin/accelerate/probe

**Auth**: admin session required → 401 `{ error: "Unauthorized" }` otherwise.

**Response (200):**
```json
{
  "success": true,
  "probe": {
    "reachable": true,
    "latencyMs": 87,
    "at": "2026-10-11T11:42:00.000Z",
    "error": null
  }
}
```

**Response (200, unreachable — still 200, fail-open):**
```json
{
  "success": true,
  "probe": {
    "reachable": false,
    "latencyMs": 3500,
    "at": "2026-10-11T11:42:00.000Z",
    "error": "Unable to connect to the Accelerate API. This may be due to a network or DNS issue..."
  }
}
```

**Response (401):**
```json
{ "error": "Unauthorized" }
```

### GET /api/admin/workers (MODIFIED)

Existing contract unchanged; payload object gains:
```json
{
  "accelerate": { "reachable": false, "lastProbeMs": 3500, "at": "2026-10-11T11:42:00.000Z" }
}
```
`at`/`lastProbeMs` `null` when never probed. No probe is executed by this route — read-only `getLastProbe()`.

---

## 8. UI/UX Requirements

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `AccelerateCard` (inline within AI Monitoring page) | `app/admin/ai-monitoring/` | Reachable status, latency, last-probe time, "Run probe" button |

### States
- **Loading**: skeleton/pulsing badge while probe runs
- **Error/Unreachable**: red ✗ + error text (truncated to 1 line, tooltip for full) + retry button
- **Data**: green ✓ + `latencyMs` + `at` timestamp
- **No data**: "never probed" (grey)

### Responsive
- Inline card grids — no table layout; fine at 375/768/1440 (card stacks under existing content).

---

## 9. Rules & Guardrails

- [ ] Probe never throws — fail-open by construction
- [ ] Zero Prisma ops while `isPlanLimitBreakerOpen()` — the probe is a diagnostic, not a workaround
- [ ] Reaper skip is additive; existing breaker guard preserved
- [ ] Skip must NOT record cron-ledger outcomes (counters untouched)
- [ ] One probe per TTL window (share across reaper + dashboards)
- [ ] Admin route: role-gated + audit tagged; no secret data ever logged
- [ ] Logging via `@/lib/logger` only
- [ ] Use `performance.now()` for latency (nodejs runtime)

---

## 10. Expected Behavior

1. `probeAccelerate()` returns `{ reachable: true, latencyMs < 3500 }` when the DB is reachable.
2. `probeAccelerate()` returns `{ reachable: false, error: "...Accelerate API..." }` (never throws) when the dataplane is down.
3. Two calls within the TTL window execute ONE probe (second returns cached).
4. `probeAccelerate({ force: true })` always executes a fresh probe.
5. `reapStaleWorkerTasks()` with Accelerate unreachable returns `{ reapedTasks: 0, reapedRuns: 0 }` WITHOUT any Prisma read (log once per 5 min, throttled).
6. The breaker-open early return in the reaper still fires first (existing behavior preserved).
7. `GET /api/admin/accelerate/probe` returns 401 without admin session; 200 with probe payload for admin.
8. `GET /api/admin/workers` includes the `accelerate` block without running a probe.
9. No audit tag is emitted when the probe is unreachable (probe failure is operational state, not an auditable action — the route audit fires on the attempt).
10. Jest worker-engine suite passes — no reaper regression.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Accelerate unreachable | `reachable:false`, `error` captured, probe cached | `warn` (once/5 min in reaper) |
| Probe timeout (> 3500 ms) | Treated as unreachable, `error: "probe timeout"` | `warn` |
| `isPlanLimitBreakerOpen()` | `shouldSkipReap()` true — reaper returns 0/0 before any read | `warn` (existing guard) |
| Probe route without admin | 401 | `warn` |
| Admin probe route during outage | 200 fail-open with `reachable:false` | `info` (audit `ACCELERATE_PROBE`) |
| Mid-reap genuine error (DB reachable at start) | Existing `failed` log lines kept (not silenced) | `error` |

---

## 12. Test Strategy

### Unit Tests (`lib/__tests__/accelerateProbe.test.ts`)

- [ ] Probe returns reachable payload on healthy mock Prisma
- [ ] Probe returns unreachable (never throws) on mock throw/timeout
- [ ] TTL: 2nd call within window does not re-run the query (mock call count == 1)
- [ ] `force:true` bypasses TTL
- [ ] `shouldSkipReap()` true when last probe unreachable
- [ ] `shouldSkipReap()` true when `isPlanLimitBreakerOpen()` (mock)
- [ ] `shouldSkipReap()` false when reachable + breaker closed
- [ ] `clearProbeCache()` resets state

### Integration / Modified (`lib/__tests__/worker-engine.test.ts`)

- [ ] Reaper returns 0/0 + NO Prisma query when probe says unreachable
- [ ] Reaper skip logs at most once per 5 min (mock timestamps)
- [ ] Reaper skip does NOT call `recordSystemRunOutcome`
- [ ] Existing breaker-open test (`reapStaleWorkerTasks is a no-op when the breaker is OPEN`) still passes
- [ ] Existing reap tests (alive-worker, dead-owner, legacy, run-reap) all still pass

### API Route Test

- [ ] 401 without admin session
- [ ] 200 contract shape with probe for admin
- [ ] `GET /api/admin/workers` includes `accelerate` block without triggering a fresh probe

---

## 13. Performance Considerations

- **Probe share**: one Accelerate round-trip per 60 s TTL window regardless of reaper tick (5 min) or console reads
- **Reaper skip read cost**: ZERO Prisma reads when unreachable (vs today's 4+ reads per tick every 5 min during an outage)
- **Timeout**: 3500 ms bounded, nodejs runtime

---

## 14. Security Considerations

- **Auth**: probe route admin-only (server-side role check via `auth()`)
- **Input**: no request body; no user input to validate
- **Secrets**: NEVER log the probe query, DATABASE_URL, or Accelerate credentials — only reachable/latency/at/error message
- **Audit**: `ACCELERATE_PROBE` info-tagged (probe attempt), no metadata secrets

---

## 15. Definition of Done

- [ ] `lib/services/accelerateProbe.ts` implemented (probe, TTL cache, force, `shouldSkipReap`, `getLastProbe`, `clearProbeCache`)
- [ ] Reaper skip-on-unreachable wired in `worker-engine.ts` with throttled log
- [ ] `app/api/admin/accelerate/probe/route.ts` created (admin-gated, fail-open 200)
- [ ] `app/api/admin/workers/route.ts` GET gains `accelerate` block (no probe execution)
- [ ] Admin console card renders all 4 states
- [ ] `ACCELERATE_PROBE` audit tag added
- [ ] Unit tests written + passing (`npm run test` — full suite, 134 suites)
- [ ] `npx tsc --noEmit` — 0 new errors beyond baseline (46 exact)
- [ ] `npm run lint` — 0 errors
- [ ] Live-verified on :3000 (dev): probe button returns reachable, console card renders
- [ ] Pre-commit hygiene + docs updated (AGENTS.md row, CHANGELOG, Todo-ref, Primer, agent-memory, Lessons if new pattern, session memory, session-todos)

---

## 16. Verification Commands (planning reference)

```bash
npx tsc --noEmit
npm run test -- --testPathPattern=accelerateProbe
npm run test -- --testPathPattern=worker-engine
npm run lint
```