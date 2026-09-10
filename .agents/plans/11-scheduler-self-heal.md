# Implementation Plan — Scheduler Leadership Self-Heal (v3.33.x)

> Generated from spec: `.agents/specs/11-scheduler-self-heal.md`
> Save to `.agents/plans/11-scheduler-self-heal.md`

## Spec Reference

- **Spec**: `.agents/specs/11-scheduler-self-heal.md`
- **Branch**: `fix/leader-watchdog-self-heal` (from `main`, on top of v3.32.1 `bcde7ae`)
- **Created**: 2026-09-10
- **Gate**: human-approved spec + plan BEFORE any code; commit/push/deploy ONLY on explicit user approval

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step description → verify: [check command]`

### Phase 0: Baseline (verify current state, no code)

1. **Confirm baseline** → `npx tsc --noEmit` (46 errors = baseline); `npm run test` full suite (1127 pass / 4 skip / 2 fail — 1 documented `intelligence.test.ts` flake)
2. **Confirm untouched prod state** → do NOT click admin "Start Engine"; no deploy; no push (`git status` on `main` = v3.32.1 `bcde7ae` + spec/plan docs only)

### Phase 1: Service Layer — `lib/services/leader.ts`

3. **Add constants** — `LEADER_CLAIM_FAST_MS = 60_000`, `LEADER_CLAIM_SLOW_MS = 300_000` (near existing `LEADER_STALENESS_MS`/`LEADER_HEARTBEAT_MS`); doc comments linking to spec 11. **Tune `LEADER_STALENESS_MS` 15 min → 10 min** (human-approved amendment; 2× heartbeat margin — constants in `leader.test.ts:68` + `sqlite.test.ts:282` updated in Phase 4). → verify: `npx tsc --noEmit` (46 = exact baseline, 0 new)
4. **Add types + status registry** — `LeaderWatchHandlers`, `LeaderWatchStatus`, `getLeaderWatchStatuses()` via `globalThis.__leaderWatchStatus` (mirror `readTier` pattern; zero Prisma). → verify: tsc 46 exact baseline
5. **Implement `watchLeaderRole(role, handlers)`** — phase state machine (`"standby" | "leader"`):
   - standby probe loop: `getLeaderInfo(role)` (1 op) → fresh-foreign → back off slow probe; stale/absent → `acquireLeaderLock` (2 ops) → `true` → `onAcquired` + `startLeaderHeartbeat(role, onLost)`; fail-open true → `failOpenEvents++` + same transition
   - leader phase: claim loop STOPPED; heartbeat loss → `onLost` + phase → standby → fast probe resumes
   - no double `onAcquired` between transitions; `stop()` clears probe + heartbeat timers (both `unref()`'d)
   - reuse existing `renewLeaderLock`/`acquireLeaderLock`/`getLeaderInfo`/`startLeaderHeartbeat` UNCHANGED → verify: `npx tsc --noEmit` (46 exact baseline)

### Phase 2: Wiring — `instrumentation.ts`

6. **Rewire worker block** (lines 38–52) → `watchLeaderRole("worker", { onAcquired: () => startWorker(30_000), onLost: () => stopWorkerEngine() })` → verify: `npx tsc --noEmit` (46 exact baseline)
7. **Rewire cron-daemon block** (lines 54–63) → `watchLeaderRole("cron-daemon", { onAcquired: () => { startCronDaemon().then(...); }, onLost: () => stopCronDaemon() })` → verify: tsc + `npx jest lib/__tests__/cron-daemon.test.ts` stays green (mock shape updated in Phase 4)
8. **Rewire sqlite-sync block** (lines ~65–83) → `watchLeaderRole("sqlite-sync", { onAcquired: () => {}, onLost: () => {} })` (log-only; sync gated per-run by `isLeader`) → verify: tsc + `npx jest lib/__tests__/daemon-sqlite-first.test.ts` green
9. **Keep** `LEADER_SELF` logging + `start`/`stop` action functions untouched → verify: grep no remaining direct `acquireLeaderLock(` outside `watchLeaderRole`

### Phase 3: Diagnostics — db-health API + UI

10. **Route** `app/api/admin/db-health/route.ts` GET → add `leaderWatch: getLeaderWatchStatuses()` + `leaderTuning: { stalenessMs, heartbeatMs, claimFastMs, claimSlowMs }` (zero Prisma; body-parse-once v3.32.1 untouched) → verify: `npx jest lib/__tests__/dbHealthRoute.test.ts` (updated in Phase 4)
11. **UI** `app/admin/utils/db-health/page.tsx` leader card → replace clamped "15m ago" display with real heartbeat age (`Date.now() − lastHeartbeat`) + STALE (red) / FRESH (green) badge (compare vs `leaderTuning.stalenessMs`) + per-role watchdog line (`phase`, `lastClaimAt`, `lastLostAt`, `claimAttempts`, `failOpenEvents`) → verify: Playwright :3000 admin db-health (logged-in) — 4 states (leader-fresh / leader-stale / standby-watching / not-watching) render; 0 console errors; responsive 375px
12. **No live/prod state changes** during any verification → verify: admin "Start Engine" NOT clicked

### Phase 4: Tests

13. **NEW `lib/__tests__/leaderWatch.test.ts`** — 8 tests per spec §12 (state machine with mocked `@/lib/prisma`, `jest.useFakeTimers`, `env-node`) → verify: `npx jest lib/__tests__/leaderWatch.test.ts` 8/8 green
14. **Update `lib/__tests__/instrumentation.test.ts`** — mock exposes `watchLeaderRole` capturing handlers; existing 5 tests reconciled + NEW re-acquire restart + sqlite-sync log-only → verify: 6/6 (target) green
15. **Update `lib/__tests__/dbHealthRoute.test.ts`** — mock `getLeaderWatchStatuses`, assert `leaderWatch`/`leaderTuning` in GET → verify: 5/5 green
16. **Constant updates** — `leader.test.ts:68` `LEADER_STALENESS_MS` assert → `10 * 60_000`; `sqlite.test.ts:282` mock constant → `10 * 60_000` → verify: leader 18/18 + sqlite 71/71 green
17. **Restart assertions** — `cron-daemon.test.ts` (+ `worker-engine.test.ts` if gap) explicit stop→start → verify: 12/11 green
18. **Full suite** → `npm run test` → verify: ≥ 1127 pass / 4 skip / 2 fail (1 documented flake), 0 new failures

### Phase 5: Verification

18. **Run all gates** → `npx tsc --noEmit` (46 exact baseline) + `npm run test` (full) + `git status` (only expected files) → verify: no junk artifacts, no secrets, no new production errors
19. **`npm run lint`** → expected pre-existing failure (NOT fixed in this branch — document, do not repair) → verify: failure identical to baseline, no NEW lint errors in touched files

### Phase 6: Documentation (after human approval to commit)

20. **AGENTS.md** → version table row v3.33.x → verify: row added
21. **CHANGELOG** → `.agents/changelog/versions-v3.33.md` + index → verify: created/updated
22. **TODO.md** → quick-reference row → verify: added
23. **Primer.md** → current project status → verify: updated
24. **agent-memory.md** → activity entry → verify: added
25. **Lessons.md** → new lesson (one-shot leader election without re-claim = silent permanent failure; watchdog probes must respect DB-op budget) → verify: added
26. **Session memory** → `decisions.md` + `flow.md` in `.agents/sessions/2026-09-10-<hash>/` → verify: created
27. **handoffs/active/latest.md** → resume context → verify: updated

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Standby + healthy foreign row → stays standby, slow cadence | `leaderWatch.test.ts` | No spurious claim ops |
| Standby + stale/absent row → fast claim → onAcquired once | `leaderWatch.test.ts` | Promotion path |
| Leader renewal false → onLost → standby → re-claim → onAcquired again | `leaderWatch.test.ts` | Self-heal of stolen lock |
| No double onAcquired while leader | `leaderWatch.test.ts` | Idempotency |
| Fail-open claim (DB down) → local leader + counter | `leaderWatch.test.ts` | Degrade semantics preserved |
| Fail-open renew → stays leader; DB recovery + foreign row → onLost | `leaderWatch.test.ts` | Recovery after blip |
| `stop()` clears both timers | `leaderWatch.test.ts` | Leak-free |
| `getLeaderWatchStatuses()` returns 3 roles | `leaderWatch.test.ts` | Status registry |
| Instrumentation starts engines via watch handlers (worker + cron) | `instrumentation.test.ts` | Wiring |
| onLost → stopWorkerEngine / stopCronDaemon | `instrumentation.test.ts` | Stop wiring |
| Not-leader → engines not started, watchdog alive | `instrumentation.test.ts` | No double-run |
| Re-acquire after onLost restarts engines (no throw) | `instrumentation.test.ts` | Restart safety |
| sqlite-sync onLost is log-only | `instrumentation.test.ts` | No engine stop |
| stop→start re-runs | `cron-daemon.test.ts` / `worker-engine.test.ts` | Engine restartability |

### Integration Tests (If API Route)

| Test | What It Verifies |
|------|------------------|
| GET /api/admin/db-health 200 + `leaderWatch`/`leaderTuning` present | Route wiring (zero Prisma additions) |
| Existing leader/liveness blocks unchanged | Non-breaking contract |

### E2E / Manual (UI Change — db-health leader card)

| Check | What It Verifies |
|-------|------------------|
| Playwright :3000 admin db-health (logged-in) — 4 leader-card states render | Component rendering |
| Real heartbeat age + STALE/FRESH badge visible | Diagnostic accuracy |
| Responsive 375px — second line wraps | Responsive design |
| 0 console errors | Clean render |

---

## Verification Checklist

> Run these commands after implementation. All must pass.

```bash
# Type checking
npx tsc --noEmit                    # 46 = exact baseline (0 new)

# Tests (targeted)
npx jest lib/__tests__/leaderWatch.test.ts lib/__tests__/instrumentation.test.ts lib/__tests__/dbHealthRoute.test.ts lib/__tests__/cron-daemon.test.ts lib/__tests__/worker-engine.test.ts lib/__tests__/daemon-sqlite-first.test.ts

# Tests (full)
npm run test                        # ≥ 1127 pass / 4 skip / 2 fail (1 documented flake)

# Prisma
npx prisma validate                 # Schema valid (unchanged)
npx prisma generate                 # No-op safety (no schema change)

# Lint — EXPECTED pre-existing failure, do NOT fix; confirm no NEW errors in touched files
npm run lint
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Watchdog standby probes add Prisma ops | Adaptive cadence: 1 `findUnique`/5 min steady-state; fast 60s probe only when leader row stale/absent (~1.7K ops/day worst steady-state for 3 instances ≈ 1.6% of monthly 200K budget) | Benchmarked in prod via db-health |
| Double-start of engines on rapid transitions | Phase-guard (`onAcquired` only on standby→leader) + existing idempotent `startWorker`/`startCronDaemon` guards | No |
| Split leadership during DB blip (fail-open local leaders) | Existing semantics preserved; on DB recovery losers stand down via renewal `false` → onLost; worker task claims are atomic `updateMany` (no double-execution); cron spawn has 90-min dedup window | No |
| Recovery latency ≤ ~11 min after leader death (staleness 10 + fast probe 1) | Acceptable: vs. current "indefinite dead" (2+ days observed). `LEADER_STALENESS_MS` tuned 15→10 min (human-approved amendment; 2× heartbeat margin) so recovery latency ≈ 11 min | No |
| v3.32.1 (`bcde7ae`) not yet deployed → live Save Correction 400 persists | Separate deploy decision — remind user; deploy before or with v3.33 | Deploy approvals |
| Netlify multi-instance cost of heartbeats overall | Existing v3.22.0 model (5-min heartbeat, 10-min staleness) unchanged | Netlify instance tuning |

---

## Documentation Checklist

> All docs must be updated before commit.

- [ ] **AGENTS.md** — version row in table
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.33.md` detail + index update
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (one-shot leader election without re-claim; watchdog DB-op budget)
- [ ] **Session memory** — `decisions.md` + `flow.md`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

> Must pass before any commit.

1. `npx tsc --noEmit` — 46 = exact baseline (0 new errors)
2. `npm run test` — full suite ≥ 1127 pass / 4 skip / 2 fail (1 documented flake)
3. `npm run lint` — pre-existing failure unchanged (documented, not fixed)
4. `git status` — no junk artifacts, no secrets in diff, only expected files
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated
7. **Human approval of spec + plan + commit** — no auto-commit/push/deploy; no prod state touched