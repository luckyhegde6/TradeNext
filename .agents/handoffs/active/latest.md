---
handoff: v3.33.0-leader-watchdog-self-heal
session_id: v3.33.0-leader-watchdog-self-heal
date: 2026-09-10
branch: fix/leader-watchdog-self-heal (HEAD bcde7ae = committed v3.32.1; on top of v3.32.0 PR #117 merge 38a27bf)
last_commits: bcde7ae (v3.32.1 committed), b75deb0 (v3.32.0 docs update), 38a27bf (PR #117 merge)
dev: local :3000 (dev PID 12096 — do not kill; MCP 4096 do not kill; pg docker 5432 do not kill)
status: in_progress
commit: pending user approval (commit 1 = v3.33.0 watchdog + docs, commit 2 = v3.33.1 swing; staged by workstream, not yet committed)
---

# Handoff — v3.33.0 Leader watchdog self-heal + v3.33.1 Swing touch-tracking fix

## Summary
**Both workstreams are CODE-COMPLETE, TEST-VERIFIED and DOCUMENTED in the working tree on branch `fix/leader-watchdog-self-heal` (on top of committed v3.32.1 `bcde7ae`). Two commits pending per the user-approved commit plan — no push/merge/deploy.**

## v3.33.0 — Leader watchdog self-heal (spec 11)
User directive: "don't let this happen again" — prod scheduler dead since ~2026-09-08 07:06 UTC, NO automatic recovery (only manual admin "Start Engine"). Root cause: leadership was ONE-SHOT — `acquireLeaderLock()` at boot + `startLeaderHeartbeat(role, onLost)`; v3.28.2 stops engines on `onLost` but NOTHING ever re-acquires → standby pollers forever.
- NEW `watchLeaderRole(role, handlers)` (`lib/services/leader.ts`): standby → adaptive probe (fresh foreign row = SLOW re-probe `LEADER_CLAIM_SLOW_MS` 300s; stale/absent = claim via `updateMany` count>0 | `create` | P2002 → false | `isDbUnavailableError` → fail-open) → re-probe OWN row (null/not-ours → `failOpenEvents++`) → **leader** + heartbeat `LEADER_HEARTBEAT_MS` 300s; renewal 0 → internal onLost → standby + `handlers.onLost` + FAST re-probe `LEADER_CLAIM_FAST_MS` 60s; `stop()`; phase-guard (no double `onAcquired`); steady-state 1 `findUnique`/300s/instance.
- `LEADER_STALENESS_MS` 15→**10 min** (human-approved); NEW `LeaderWatchHandlers`/`LeaderWatchStatus` + `getLeaderWatchStatuses()` (globalThis `__leaderWatchStatus`, zero-Prisma, mirrors `readTier`).
- Wiring (`instrumentation.ts`, "LEADER WATCHDOGS (v3.33.0, spec 11): replaces the one-shot boot election"): worker `onAcquired → startWorker(30_000)` / `onLost → stopWorkerEngine`; cron-daemon `onAcquired → startCronDaemon().then(...)` / `onLost → stopCronDaemon`; sqlite-sync log-only (`onAcquired: () => {}`).
- db-health: route 7 leader imports at :8, GET leader block :207–225, POST :242; page client-only `leaderWatch`/`leaderTuning` (must NOT import server-only `lib/services/leader`).

## v3.33.1 — Swing touch-tracking fix
Root cause: `checkSwingPerformance` evaluated target/stop hits with the LATEST CLOSE only → an intraday HIGH/LOW touch that closed back inside the range was never counted (missed exits / wrong "still open"). Fix: `SwingSignalStatusInput` NEW `maxHighSincePosting`/`minLowSincePosting` (omit/null → close-only preserved); windowByTicker from ONE `$queryRaw` over `daily_prices` (`WHERE ticker = ANY(${symbols}) AND "tradeDate" >= MIN(postedAt)`, ASC; per-signal JS filter); live-quote bridge captures `dayHigh`/`dayLow`; BUY intraday-touch target-wins the tie; reason strings `touched … intraday (high/low X, close Y)` vs `crossed`; status-change audit metadata +2 fields. Files for the commit: `lib/services/swingPerformanceService.ts` + `lib/__tests__/swingPerformanceService.test.ts` ONLY.

## Verification
- NEW `leaderWatch.test.ts` **8/8** + `instrumentation.test.ts` 7 rewritten + `dbHealthRoute.test.ts` +1 + `cron-daemon.test.ts` +1 (engine restart); constant fixes `leader.test.ts:68`/`sqlite.test.ts:282`; targeted **125/125**; full **1154 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake); swing **27/27**; tsc **46 = exact baseline (0 new)**; no migration; no new packages; **+17 new tests**.

## Deferred / Next
- **Deferred (unchanged)**: live `probe_time` DB check; durable Netlify `TZ`/`UTC` env fix (v3.32.0). v3.32.1 (`bcde7ae`) still NOT merged/deployed → live admin Save Correction still 400s.
- **Next**: delete `.dev-otel.log` → stage + commit 1 `feat(leader): v3.33.0 watchdog self-heal — watchLeaderRole replaces one-shot boot election (spec 11)` (watchdog code/tests + `.agents/plans/11-scheduler-self-heal.md` + `.agents/specs/11-scheduler-self-heal.md` + ALL docs incl. `.agents/changelog/versions-v3.33.md`) → stage + commit 2 `fix(swing): v3.33.1 touch-tracking — intraday HIGH/LOW counts as target/stop hit` (ONLY swing service + test) → `/pre-commit-check` → **no push/merge/deploy without explicit user approval**.

## Session archive
No session archive created for v3.33.x (per approved 15-item plan — session-todos/HANDOFF/latest.md updated instead). Spec/plan 11: `.agents/specs/11-scheduler-self-heal.md` + `.agents/plans/11-scheduler-self-heal.md`. Changelog: `.agents/changelog/versions-v3.33.md` (v3.33.0 + v3.33.1 sections).