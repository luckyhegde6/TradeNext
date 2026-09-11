# v3.33.0 — Leader Watchdog Self-Heal — a dead scheduler must never happen again

- **Date**: 2026-09-10
- **Branch**: `fix/leader-watchdog-self-heal`
- **Status**: Committed (own commit by workstream; push/merge/deploy pending user approval)
- **Spec**: `.agents/specs/11-scheduler-self-heal.md` · **Plan**: `.agents/plans/11-scheduler-self-heal.md`

## User directive (confirmed)

> "don't let this happen again"

Prod scheduler dead since ~2026-09-08 07:06 UTC with NO automatic recovery — recovery today is a manual admin "Start Engine" click. The system must self-heal with **zero manual intervention**.

## Root causes found

1. **One-shot leadership** — `acquireLeaderLock()` at boot + `startLeaderHeartbeat(role, onLost)`. v3.28.2 STOPPED worker/cron engines when `onLost` fired, but NOTHING ever re-acquired → after a lost/stale claim every instance stays a standby poller forever; only a manual admin start recovered.
2. **15-min staleness too slow** for reclaiming a dead leader's role.
3. **No observability** — db-health could not show leader phase / claim attempts / fail-open events, so triage was blind.

## Design — phases implemented

### Phase 1 — service layer (`lib/services/leader.ts`)

- `LEADER_STALENESS_MS` 15 min → **10 min** (human-approved; comment `v3.33.0: 15 → 10 min (spec 11)`); `LEADER_HEARTBEAT_MS` 300 s kept; NEW `LEADER_CLAIM_FAST_MS = 60_000`, `LEADER_CLAIM_SLOW_MS = 300_000`; `LEADER_SELF` kept.
- NEW `watchLeaderRole(role, handlers)` self-healing loop:
  - standby → **adaptive probe** (fresh foreign row → SLOW re-probe 300 s; stale/absent → claim via `updateMany` count>0 | `create` | P2002 → false | `isDbUnavailableError` → fail-open) → **re-probe OWN row** (null/not-ours → `failOpenEvents++`) → **leader** + 300 s heartbeat
  - renewal count 0 → internal `onLost` → **standby** + `handlers.onLost` + FAST re-probe (60 s)
  - `stop()` clears timers; phase-guard prevents double `onAcquired`; steady-state standby = 1 `findUnique` / 300 s / instance
- NEW types `LeaderWatchHandlers` / `LeaderWatchStatus` + `getLeaderWatchStatuses()` (globalThis `__leaderWatchStatus`, zero-Prisma, mirrors `readTier`).

### Phase 2 — wiring (`instrumentation.ts`)

- Comment: `LEADER WATCHDOGS (v3.33.0, spec 11): replaces the one-shot boot election`
- worker: `watchLeaderRole("worker", { onAcquired: () => startWorker(30_000) /* idempotent */, onLost: stopWorkerEngine })`
- cron-daemon: `watchLeaderRole("cron-daemon", { onAcquired: () => startCronDaemon().then(...), onLost: stopCronDaemon })`
- sqlite-sync: log-only (`onAcquired: () => {}`)

### Phase 3 — diagnostics (db-health)

- Route: 7 leader imports at :8 (`getLeaderInfo`, `getLeaderWatchStatuses`, `LEADER_CLAIM_FAST_MS`, `LEADER_CLAIM_SLOW_MS`, `LEADER_HEARTBEAT_MS`, `LEADER_SELF`, `LEADER_STALENESS_MS`); GET leader block :207–225; POST :242.
- Page: client-only `leaderWatch: Record<string, { role; phase: "standby"|"leader"; claimAttempts; failOpenEvents; lastClaimAt; lastLostAt; lastProbeAt }>` + `leaderTuning { stalenessMs; heartbeatMs; claimFastMs; claimSlowMs }` — the page must NOT import server-only `lib/services/leader`.

## Verification

- NEW tests: `lib/__tests__/leaderWatch.test.ts` (8) · `lib/__tests__/instrumentation.test.ts` (7 rewritten) · `lib/__tests__/dbHealthRoute.test.ts` +1 · `lib/__tests__/cron-daemon.test.ts` +1 (engine restart).
- Constant fixes `lib/__tests__/leader.test.ts:68` + `lib/__tests__/sqlite.test.ts:282`.
- Full suite **1154 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake); targeted **125/125**; `npx tsc --noEmit` **46 = exact baseline (0 new)**; no migration; no new packages.
- Note: the plan doc's "Phase 0 baseline 1127 pass / 4 skip / 2 fail" is the PRE-WORK baseline — do not confuse with the final verification numbers above.

---

# v3.33.1 — Swing performance touch-tracking fix — intraday HIGH/LOW touches count

- **Date**: 2026-09-10
- **Branch**: `fix/leader-watchdog-self-heal`
- **Status**: Committed (own commit by workstream; push/merge/deploy pending user approval)
- **Spec/Plan**: n/a — defect follow-up, no plan (small surgical fix)

## Root cause

`checkSwingPerformance` evaluated target/stop hits using the LATEST CLOSE only → an intraday touch that closed back inside the range was never counted as a hit (missed exits / wrong "still open" status).

## Design

- `SwingSignalStatusInput` NEW `maxHighSincePosting` / `minLowSincePosting` (omit/null → close-only behaviour preserved).
- `checkSwingPerformance` builds `windowByTicker` from ONE `$queryRaw` over `daily_prices` (`WHERE ticker = ANY(${symbols}) AND "tradeDate" >= MIN(postedAt)`, ordered ASC); per-signal window filtered `tradeDate >= signal.postedAt` in JS.
- Live-quote bridge captures `dayHigh` / `dayLow`; BUY intraday-touch target-wins the tie.
- Status-change audit metadata includes the two new fields; reason strings distinguish `touched … intraday (high/low X, close Y)` vs `crossed`.

## Verification

- `lib/__tests__/swingPerformanceService.test.ts` **27/27**; full suite **1154 pass / 4 skip / 1 fail** (pre-existing `intelligence.test.ts` flake); tsc **46 = exact baseline (0 new)**; no migration; no new packages.