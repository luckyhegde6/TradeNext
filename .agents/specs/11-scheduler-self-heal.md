# Spec 11 — Scheduler Leadership Self-Heal (v3.33.x)

> **Status:** Draft for human approval — no implementation until approved.
> **Branch:** to be created from `main` (v3.32.1 hotfix `bcde7ae` is committed on local `main`, NOT yet pushed/deployed).
> **Problem:** prod background scheduler (cron daemon + worker engine) has been dead since ~2026-09-08 07:06 UTC with NO automatic recovery — leader rows stale, "Scheduler Stopped", zero liveness heartbeats, frozen worker tasks, 0 AI calls. Root cause is CODE-VERIFIED below.

---

## 1. Overview & Goals

### The bug

Netlify treats the app as a **persistent server** but can run **multiple instances** (cold-start burst / scale). Since v3.22.0, leadership is elected via a `worker_status` single-writer lock (`leader-<role>` rows) so only ONE instance runs the worker engine, the cron daemon, and the SQLite→Prisma sync.

**Code-verified defect: leadership is ONE-SHOT and stop-on-lost with NO re-acquisition.**

- `instrumentation.ts` (lines 38–83) calls `acquireLeaderLock(role)` **once per role, once per boot**:
  - Winner → `startWorker(30_000)` / `startCronDaemon()` / sync + `startLeaderHeartbeat(role, onLost → stopEngine)`.
  - Loser → `logger.warn("NOT started (another instance is … leader)")` — and **never tries again**.
- `startLeaderHeartbeat` (`lib/services/leader.ts:182–210`) — on a failed renewal (`increment` matches 0 rows): `stopped = true; clearInterval; onLost?.(role)` — **no re-acquire**.
- `acquireLeaderLock` (`leader.ts:82–144`) — `updateMany` stale claim (`lastHeartbeat < now − 10 min`) → else `create` → P2002 → stand down; **DB-unavailable → fail-open `true`** (degrade to local leader). `LEADER_STALENESS_MS` is tuned **15 min → 10 min** (human-approved amendment) so the margin over the 5-min heartbeat is 2×, not 3×.

**Consequence:** recovery depends 100% on a FUTURE fresh boot landing after the row is stale. If Netlify's warm instances keep the row claimed-or-fresh across churn (boots land inside the 10-min window; losers never retry; fail-open can also let every instance start then stop losers via `onLost` with nobody re-claiming), the system wedges forever. This matches prod: leader rows stale since ~09-08 07:06 UTC, no instance has re-claimed.

### Goals

1. **Self-healing leadership** — any instance that is NOT leader retries the claim until it is; a leader that LOSES the lock stands down, then re-claims. Worst-case dead window after a leader death ≤ ~11 min (staleness 10 min + fast probe 60s), down from "indefinite".
2. **Zero manual intervention** — the current dead prod state must recover on its own after deploy (no clicking admin "Start Engine").
3. **Restart-safe engines** — `startWorker` / `startCronDaemon` are already idempotent + restartable (guards on `workerInterval` / `running`), so leader transitions cannot double-start.
4. **DB-op discipline** — new claim probes must NOT violate the user's cost model (monthly 200K ops / "Prisma only at boot + 6h push + hourly ops write"). Adaptive cadence: cheap steady-state probe, fast probe ONLY when the leader row is stale/absent.
5. **Diagnosable** — admin db-health shows real heartbeat age (not "15m ago" clamped) + per-role watchdog phase (leader/standby, last claim/last lost, attempt count), so "stale" vs "fresh" and "watchdog alive" are visible.

### Non-goals

- No schema change, no migration, no new packages, no new routes.
- No change to the manual admin **Start Engine** escape hatch (`app/api/admin/workers/engine/route.ts`).
- No audit-tag additions (leader transitions are `logger`-tracked; audit writes would add DB ops — deferred).
- Durable Netlify fix (fewer/longer-lived instances, correct `TZ` env) stays out of scope.

---

## 2. Routes / API Changes

### New routes

None.

### Modified endpoints

| Route | Change |
|-------|--------|
| `GET /api/admin/db-health` | Extend the `leader` block with a zero-Prisma in-memory **watchdog status**: per-role `{ role, phase: "leader"\|"standby", leaderSince, lastClaimAt, lastLostAt, claimAttempts, heartbeatsRenewed, claimedStale, claimedCreated, failOpenEvents }`. Also expose `LEADER_STALENESS_MS` / `LEADER_HEARTBEAT_MS` / `LEADER_CLAIM_FAST_MS` / `LEADER_CLAIM_SLOW_MS` in the response so the UI renders real age + stale badge without hardcoding (or the page computes from the ISO `lastHeartbeat` + returned constants — see section 7). |

---

## 3. Database Schema

**No schema change → no migration.**

- Tables touched: none.
- Rows touched: the existing `worker_status` `leader-<role>` rows via the existing `acquireLeaderLock` / `renewLeaderLock` Prisma ops (unchanged semantics).

---

## 4. Functions to Implement

### A. `lib/services/leader.ts` — NEW `watchLeaderRole(role, handlers)`

**Signature:**

```typescript
export interface LeaderWatchHandlers {
  /** Called EXACTLY once per leader transition (standby → leader). Must be idempotent-safe to invoke after onLost (engine start after stop). */
  onAcquired: (role: LeaderRole) => void;
  /** Called once per lost transition (leader → standby). */
  onLost?: (role: LeaderRole) => void;
}

export interface LeaderWatchStatus {
  role: LeaderRole;
  phase: "leader" | "standby";
  leaderSince: Date | null;
  lastClaimAt: Date | null;
  lastLostAt: Date | null;
  claimAttempts: number;
  heartbeatsRenewed: number;
  claimedStale: boolean;
  claimedCreated: boolean;
  failOpenEvents: number;
}

export function watchLeaderRole(
  role: LeaderRole,
  handlers: LeaderWatchHandlers,
): { stop: () => void; getStatus: () => LeaderWatchStatus };

export function getLeaderWatchStatuses(): Record<LeaderRole, LeaderWatchStatus>; // globalThis registry
```

**Behavior (state machine):**

- `phase: "standby"` initial → probe every `LEADER_CLAIM_SLOW_MS` (5 min) for a healthy leader row; probe every `LEADER_CLAIM_FAST_MS` (60s) when the leader row is **stale or absent** (`getLeaderInfo` check, 1 op).
- Probe cheap first: `getLeaderInfo(role)` (findUnique, 1 op).
  - Row fresh & not ours → stay standby, back off to slow probe.
  - Row stale/absent → `acquireLeaderLock(role)` (updateMany/create, 2 ops) → on `true` → **transition to leader**.
  - `acquireLeaderLock` fail-open `true` (DB unavailable) → transition to leader (`failOpenEvents++`) — preserved existing semantics.
- Phase `"leader"` → call `handlers.onAcquired(role)` ONCE, then run the existing `startLeaderHeartbeat(role, onLost)` unchanged.
- Heartbeat renewal `false` (lost) → `handlers.onLost?.(role)` → phase → `"standby"` → claim loop resumes (fast probe).
- Fail-open during renewal (`renewLeaderLock` returns `true` while DB down) → stay leader; when DB recovers a foreign row → renewal `false` → onLost → standby → re-claim. Same semantics as today, but now it SELF-HEALS.
- **No double-start guard:** `onAcquired` fires only on a `standby→leader` transition; while `phase === "leader"` the claim loop is NOT running. Engine-level idempotence (`startWorker`/`startCronDaemon` guards) is belt-and-braces.
- `stop()` clears both probe + heartbeat timers (`unref`'d like `startLeaderHeartbeat`).
- Status lives on a `globalThis` registry (`__leaderWatchStatus`) mirroring the `readTier` pattern — per-instance memory, zero Prisma. `getLeaderWatchStatuses()` is read by the db-health route.

### B. `instrumentation.ts` — REWIRE the three one-shot blocks (lines 38–83)

Replace each `acquireLeaderLock` + `startLeaderHeartbeat` pair with a `watchLeaderRole` call:

| Role | `onAcquired` | `onLost` |
|------|--------------|----------|
| `worker` | `() => startWorker(30_000)` | `() => stopWorkerEngine()` |
| `cron-daemon` | `() => { startCronDaemon().then(...log...); }` | `() => stopCronDaemon()` |
| `sqlite-sync` | `() => {}` (no engine; sync gated per-run by `isLeader`) | `() => {}` (log-only, unchanged) |

The `start`/`stop` action functions and their idempotent guards stay untouched.

### C. db-health — diagnostics

- `app/api/admin/db-health/route.ts` GET: add `leaderWatch: getLeaderWatchStatuses()` + expose `leaderTuning: { stalenessMs, heartbeatMs, claimFastMs, claimSlowMs }` (zero Prisma).
- `app/admin/utils/db-health/page.tsx` leader card: render **real heartbeat age** (`Date.now() − lastHeartbeat`) with a **STALE (red) / FRESH (green) badge** instead of the current clamped "15m ago"; add a per-role watchdog line (phase + last claim/lost + attempts + fail-open count) so an admin can SEE the watchdog is alive even when this instance is a standby.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/leader.ts` | Modified | Add `watchLeaderRole`, `LeaderWatchHandlers`, `LeaderWatchStatus`, `getLeaderWatchStatuses`, `LEADER_CLAIM_FAST_MS` (60s), `LEADER_CLAIM_SLOW_MS` (5 min); tune `LEADER_STALENESS_MS` 15 min → 10 min (approved amendment; `leader.test.ts` + `sqlite.test.ts` constants updated). Existing `acquireLeaderLock` / `renewLeaderLock` / `startLeaderHeartbeat` / `isLeader` / `getLeaderInfo` UNCHANGED. |
| `instrumentation.ts` | Modified | Rewire the 3 one-shot leader blocks to `watchLeaderRole` (keep `LEADER_SELF` logs). |
| `app/api/admin/db-health/route.ts` | Modified | GET adds `leaderWatch` + `leaderTuning` (zero Prisma). Body-parse-once (v3.32.1) untouched. |
| `app/admin/utils/db-health/page.tsx` | Modified | Real heartbeat age + stale/fresh badge + watchdog phase line in the leader card. |
| `lib/__tests__/leaderWatch.test.ts` | **Created** | Watchdog state machine tests (see section 12). |
| `lib/__tests__/instrumentation.test.ts` | Modified | Reconcile mock to `watchLeaderRole`; add re-acquire + no-double-start coverage. |
| `lib/__tests__/dbHealthRoute.test.ts` | Modified | Mock `getLeaderWatchStatuses`; assert new fields in GET. |
| `lib/__tests__/cron-daemon.test.ts` | Modified (if needed) | Explicit stop→start restart assertion. |
| `.agents/plans/11-scheduler-self-heal.md` | **Created** | Plan companion. |

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/prisma` | `workerStatus.findUnique/updateMany/create` | Claim + renew (existing) |
| `@/lib/db-utils` | `isDbUnavailableError` | Fail-open semantics (existing) |
| `@/lib/logger` | `logger.info/warn/error` | Transition logging |

---

## 7. API Contract

### GET /api/admin/db-health (extended, non-breaking)

Existing `leader` / `liveness` blocks unchanged. ADDED:

```jsonc
{
  "leader": { "self": "...", "worker": {...}, "cronDaemon": {...}, "sqliteSync": {...} }, // unchanged
  "leaderWatch": {
    "worker":    { "role": "worker",    "phase": "standby", "leaderSince": null, "lastClaimAt": "2026-09-10T…", "lastLostAt": null, "claimAttempts": 3, "heartbeatsRenewed": 0, "claimedStale": false, "claimedCreated": false, "failOpenEvents": 0 },
    "cron-daemon": { "...": "..." },
    "sqlite-sync": { "...": "..." }
  },
  "leaderTuning": { "stalenessMs": 600000, "heartbeatMs": 300000, "claimFastMs": 60000, "claimSlowMs": 300000 },
  "liveness": [ /* unchanged */ ]
}
```

**Response (200):** complete JSON above. **Auth:** admin session required (existing). **Security:** zero DB reads added outside the existing leader row fetch.

---

## 8. UI/UX Requirements

### db-health leader card (per role: Worker / Cron Daemon / SQLite Sync)

- **State A — leader, fresh:** green dot + "leader · 2m ago" (real age).
- **State B — leader, STALE:** red dot + "leader · 38m ago (STALE)" — never happens with a live watchdog, but signals heartbeat failure instantly.
- **State C — standby (watchdog alive):** amber dot + "standby · watching (last claim 42s ago · attempts 5)".
- **State D — no watchdog:** gray dot + "not watching" (pre-deploy, or watchdog crashed — impossible by construction, belt-and-braces).
- Dark/light mode: existing card palette reused. No new components — the leader card rows gain the badge + a small second line.

### Responsive

- Desktop 1440 / tablet 768: existing grid. Mobile 375: leader card already stacks; ensure the second line wraps (text truncation ok).

---

## 9. Rules & Guardrails

- [x] No Prisma in client components
- [x] All DB operations parameterized via Prisma (existing claim/renew code — unchanged)
- [x] Server-side only (leader code already node-only)
- [x] Logging via `@/lib/logger` only (no new `console.log`)
- [x] Background work is fire-and-forget / timer-driven (never blocks HTTP)
- [x] DB-op budget respected — see section 13 cadence analysis + adaptive probe
- [x] Leader-election single-writer preserved (atomic `updateMany` stale claim + P2002 stand-down, unchanged)

---

## 10. Expected Behavior

1. A standby instance re-claims stale leadership within `LEADER_STALENESS_MS + LEADER_CLAIM_FAST_MS` (≤ ~11 min) of the leader's death — **without any new boot**.
2. A standby instance whose `acquireLeaderLock` returns `false` forever does NOT start engines (no double-run) and does NOT log an error — it keeps watching.
3. A leader whose heartbeat renewal returns `false` → `onLost` stops its engine → phase → standby → it re-claims when the row is stale again (self-heal of a stolen lock).
4. `onAcquired` fires EXACTLY once per `standby→leader` transition; no double `startWorker` / `startCronDaemon` (guards confirmed by tests).
5. DB-unavailable during claim → fail-open → local leader (existing behavior); on DB recovery, a foreign fresh row → renewal `false` → onLost → standby → re-claim. No permanent split.
6. `stop()` halts all timers (no leaked intervals after engine-stop in tests).
7. db-health GET returns `leaderWatch` + `leaderTuning`; page shows real heartbeat age + stale badge + watchdog phase.
8. Full jest suite green (baseline 1127 pass / 4 skip / 2 fail — 1 documented `intelligence.test.ts` flake); `npx tsc --noEmit` 46 = exact baseline (0 new).

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| `acquireLeaderLock` throws genuine non-conflict error | Propagate (existing) — watchdog stays standby, retries next probe | `error` |
| `acquireLeaderLock` generic claim failure | Stand down (existing, returns false) → watchdog retries | `error` |
| DB unavailable during claim | Fail-open → local leader (existing) → `failOpenEvents++` | `warn` |
| DB unavailable during renew | Renew returns `true` (existing keep-local) | (silent degrade) |
| Heartbeat renewal `false` (stolen) | `onLost` fires + standby + fast re-claim | `warn` |
| `getLeaderInfo` probe throws | Treat as unavailable → attempt claim (fail-open path) | `warn` |

---

## 12. Test Strategy

### NEW `lib/__tests__/leaderWatch.test.ts` (node env, mocked `@/lib/prisma`, fake timers)

- [ ] standby → healthy foreign row → stays standby, slow probe cadence (no claim op)
- [ ] standby → stale/absent row → `acquireLeaderLock` called at fast cadence → `true` → `onAcquired` once, phase leader, claim loop stops
- [ ] leader → renewal `false` → `onLost` once → standby → row goes stale → re-claim `true` → `onAcquired` again (re-election, exactly once per transition)
- [ ] no double `onAcquired` while already leader
- [ ] fail-open claim (DB down) → local leader + `failOpenEvents` increments
- [ ] fail-open renew (DB down) → stays leader; DB recovers + foreign row → renewal `false` → onLost → standby
- [ ] `stop()` clears probe + heartbeat timers (no further calls after stop)
- [ ] `getLeaderWatchStatuses()` returns all 3 roles with `phase` populated

### Modified `lib/__tests__/instrumentation.test.ts` (5 existing + new)

- [ ] existing: starts worker + cron daemon when elected leader (now via `watchLeaderRole` mock capturing handlers)
- [ ] existing: `onLost` wiring → `stopWorkerEngine` / `stopCronDaemon` called
- [ ] existing: not-leader → engines NOT started, but watchdog active (probe loop running)
- [ ] existing: non-node runtime → no dynamic imports
- [ ] NEW: standby re-acquire — after `onLost`, calling captured `onAcquired` again restarts engines (no throw, no double)
- [ ] NEW: `handleOnLost` for sqlite-sync is log-only (no engine stop)

### Modified `lib/__tests__/dbHealthRoute.test.ts`

- [ ] mock `getLeaderWatchStatuses` + assert `leaderWatch` / `leaderTuning` present in GET 200

### Modified `lib/__tests__/cron-daemon.test.ts` (+worker-engine.test.ts if gap)

- [ ] explicit `stop()` → `start()` re-runs (already-asserted guards re-verified)

### Full-suite gate

- `npm run test` — target **leaderWatch (8) + instrumentation (6) + dbHealthRoute (5) + cron-daemon (12) + worker-engine (11) + daemon-sqlite-first (7)** green; full suite ≥ baseline 1127 pass / 4 skip / 2 fail (1 documented flake).

---

## 13. Performance Considerations

### DB-op budget for the watchdog (IMPORTANT — user directive: monthly 200K ops, Prisma only at boot + 6h push + hourly ops write)

| State | Ops per role per instance | Notes |
|-------|---------------------------|-------|
| Leader (healthy) | heartbeat 1 write / 5 min = 288/day | existing, unchanged |
| Standby (healthy leader row) | 1 `findUnique` probe / 5 min = 288/day | cheap, long backoff |
| Standby (stale/absent row — failure) | fast probe 1 op + claim 2 ops at 60s | bounded by failure duration only; accelerates recovery |
| DB down | local leader, 0 ops | fail-open |

**Steady-state (3 instances, 2 standbys):** probe cost ≈ 2×288×3 roles ≈ **1,728 ops/day** — ~17% of the 10K/day figure but comfortably inside the **monthly 200K** budget (~1.6%). It is REQUIRED for leader election to function at all (the v3.22.0 lock already spends heartbeat ops; the probe is the minimal addition that makes it self-healing). Failure-state fast probing is transient by nature.

**No other query additions.** No new caches, no pagination concerns. `getLeaderWatchStatuses` is in-memory (globalThis), zero Prisma.

---

## 14. Security Considerations

- **Auth:** db-health route already admin-only (existing `auth()` gate). No new endpoints.
- **Inputs:** none (watchdog takes no external input).
- **Secrets:** none added; no logs of credentials/DB URLs (existing `LEADER_SELF` host-pid logging unchanged).
- **RBAC:** no role changes.
- **Split-brain safety:** single-writer preserved via atomic `updateMany` stale claim + P2002 create stand-down; renewal checks `workerName === LEADER_SELF`. The watchdog never bypasses these.

---

## 15. Definition of Done

- [ ] `watchLeaderRole` + status registry implemented per section 4 (leader.ts)
- [ ] `instrumentation.ts` rewired to 3 `watchLeaderRole` calls (worker / cron-daemon / sqlite-sync)
- [ ] db-health GET returns `leaderWatch` + `leaderTuning`; page shows real heartbeat age + stale/fresh badge + watchdog phase
- [ ] No schema change → no migration; no new packages; no new routes
- [ ] Tests: `leaderWatch.test.ts` (8) + instrumentation (6) + dbHealthRoute updated + cron-daemon/worker-engine restart assertions; full suite ≥ 1127 pass / 4 skip / 2 fail
- [ ] `npx tsc --noEmit` passes (46 = exact baseline, 0 new)
- [ ] `npm run lint` — pre-existing failure untouched (NOT fixed)
- [ ] No live/prod state changed during implementation (admin "Start Engine" NOT clicked)
- [ ] Documentation updated (AGENTS.md row, CHANGELOG, TODO, Primer, agent-memory, Lessons)
- [ ] Session memory (`decisions.md` + `flow.md`) written
- [ ] Human-approved spec + plan; commit/push/deploy ONLY on explicit user approval