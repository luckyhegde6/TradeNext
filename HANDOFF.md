# HANDOFF.md - Agent Orchestration State

> **Every agent MUST read this file at session start to understand the current orchestration state.**
> This is the central coordination point for all AI agents working on TradeNext.

---

## Current State

```yaml
status: "in_progress"             # ready | in_progress | handoff_required | recovery
current_agent: "system"          # Current agent type
next_agent: null                 # Next agent to process (if handoff_required)
handoff_version: "1.0"
last_updated: "2026-09-11T18:00:00Z"
feature: "v3.34.x merge into PR #118 (fix/leader-watchdog-self-heal)"
```

## Handoff Required?

**v3.34.0 (Monthly Query Consumption — db-health monthly-ops window, Plan 09 rev-v3 c/d) + v3.34.1 (sql.js WASM async-load gate fix) + v3.33.0 (Leader watchdog self-heal, spec 11) + v3.33.1 (Swing touch-tracking fix) — ALL CODE-COMPLETE, VERIFIED + DOCUMENTED; MERGED into PR #118 branch `fix/leader-watchdog-self-heal` per user-approved plan. PR #118 merge/push/deploy pending user — no push/merge/deploy without explicit approval.**
- **v3.33.0 root cause**: leadership was ONE-SHOT — `acquireLeaderLock()` at boot + `startLeaderHeartbeat(role, onLost)`; v3.28.2 stops engines on `onLost` but NOTHING ever re-acquires → after a lost/stale claim every instance is a standby poller forever (prod scheduler dead ~2026-09-08 07:06 UTC; only manual admin "Start Engine" recovered it). NEW `watchLeaderRole(role, handlers)` (`lib/services/leader.ts`): standby → adaptive probe (fresh foreign row = SLOW re-probe `LEADER_CLAIM_SLOW_MS` 300s; stale/absent = claim via `updateMany` count>0 | `create` | P2002 → false | `isDbUnavailableError` → fail-open) → re-probe OWN row (null/not-ours → `failOpenEvents++`) → **leader** + heartbeat `LEADER_HEARTBEAT_MS` 300s; renewal 0 → internal onLost → standby + `handlers.onLost` + FAST re-probe `LEADER_CLAIM_FAST_MS` 60s; `stop()`; phase-guard; steady-state 1 `findUnique`/300s/instance. `LEADER_STALENESS_MS` 15→**10 min** (human-approved); NEW `LeaderWatchStatus`/`getLeaderWatchStatuses()` (globalThis `__leaderWatchStatus`, zero-Prisma).
- **v3.33.0 wiring** (`instrumentation.ts`, "LEADER WATCHDOGS (v3.33.0, spec 11): replaces the one-shot boot election"): worker/cron-daemon onAcquired/onLost (idempotent `startWorker`/`startCronDaemon`), sqlite-sync log-only; db-health route 7 leader imports :8 + GET leader block :207–225 + POST :242; page client-only `leaderWatch`/`leaderTuning` (NOT importing server-only `lib/services/leader`).
- **v3.33.1 root cause + fix**: `checkSwingPerformance` evaluated target/stop hits with the LATEST CLOSE only → intraday HIGH/LOW touches that closed back inside the range were never counted (missed exits / wrong "still open"). NEW `maxHighSincePosting`/`minLowSincePosting` on `SwingSignalStatusInput` (omit/null → close-only preserved); windowByTicker from ONE `$queryRaw` over `daily_prices` (`WHERE ticker = ANY(${symbols}) AND "tradeDate" >= MIN(postedAt)`, ASC; per-signal JS filter); live-quote bridge `dayHigh`/`dayLow`; BUY intraday-touch target-wins; reason strings `touched … intraday (high/low X, close Y)` vs `crossed`; audit metadata +2.
- **Verification**: NEW `leaderWatch.test.ts` **8/8** + `instrumentation.test.ts` 7 rewritten + `dbHealthRoute.test.ts` +1 + `cron-daemon.test.ts` +1 (engine restart); constant fixes `leader.test.ts:68`/`sqlite.test.ts:282`; targeted **125/125**; full **1154 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake); swing **27/27**; tsc **46 = exact baseline (0 new)**; no migration; no new packages; **+17 new tests**.
- **Docs**: NEW `.agents/changelog/versions-v3.33.md` (v3.33.0 + v3.33.1); AGENTS.md rows + v3.32.1 row amend (commit `bcde7ae`, NOT pushed/merged/deployed — live admin Save Correction still 400s); `.agents/CHANGELOG.md` index; TODO.md rows; Lessons.md #113; Primer.md; agent-memory.md; session-todos.md; latest.md — DONE. No session archive (per approved 15-item plan).
- **(1) Ledger module (pure)** — NEW `lib/services/opsMonthly.ts`: `OpsMonthlyState {monthKey, days}` on globalThis `__opsMonthly`; month key = `getIstDayKey().slice(0, 7)` (YYYY-MM); `getOpsMonthlyState()` lazily seeds + fresh ledger at month rollover; `foldOpsCounterIntoMonthly()` idempotent `Math.max` high-water merge (re-persisting a restored snapshot can never shrink); `buildQueryConsumption()` pure aggregation (live day merged over persisted — restarted instance keeps high-water, current-day replaced before summing, no double count; perDay newest-first ≤ 31; `DB_PLAN_LIMIT_OPS_MONTHLY` default 200_000). PURE module: only imports `getIstDayKey` from `@/lib/prisma`, NEVER invoked at module load (several suites mock `@/lib/prisma` without named exports).
- **(2) Persistence** (`lib/sqlite.ts` +64) — `SqliteFallback.persistOpsMonthly()`/`restoreOpsMonthly()` (iface :244-250) snapshot under `_backup_meta` key `"ops_monthly"` (`OPS_MONTHLY_KEY` :1653); restored in `initSqliteBackup()` (:1421) + persisted after initial sync (:1440) + 60s `startOpsCounterPersistence()` tick folds+persists (:1705); `restoreOpsMonthly` discards stale previous-month snapshots (never leaks prior-month numbers into a new month).
- **(3) API/UI** — db-health GET `queryConsumption` block (+12) + "Monthly Query Consumption" card (+77: month key, MTD reads/writes/total, plan bar + remaining, today merged, per-day table); `.env.example` +5.
- **(4) No hot-path change** — `$allOperations` keeps bumping the live counter; `lib/prisma.ts` diff = 6-line pointer comment.
- **Test-trap fixed (Lesson #114)**: sqlite.test.ts test-3 `resetSqliteStateForTests()` nulls state IN PLACE → next test `TypeError … 'persistTimeCorrection'`; fix = test-3 ends `await ensureSqliteBackup();` before `resetOpsMonthlyForTests()`.
- **Verification**: sqlite **83/83** · targeted **94/94** across 7 suites (opsMonthly, dbHealthRoute, timeCorrection, backtestDataService, worker-engine, recommendationPerformanceService, recommendationCronService) · tsc **46 = exact baseline (0 new)**; no schema change → no migration; no new packages; diff 7 files +310/−2 + 2 new.
- **Deferred**: `query_cache` (Plan 09 rev-v3 c/d).
- **v3.34.1 (sql.js WASM async-load gate fix, commit `d91fb01`)**: `getSqlJs()` loaded `sql-wasm.wasm` via async `fs.readFile`/stream → sql.js init + stray "Cannot log after tests are done" lines landed after a Jest file finished. Fix: synchronous `wasmBinary` load (`fs.readFileSync`, try/catch per candidate path) so sql.js boots fully before any test finishes; `getSqlJs()` memoized. sqlite + cron-daemon **88/88** under `CI=true --runInBand` with zero noise; full **1154 pass / 4 skip / 1 fail** (pre-existing flake); tsc **46 = exact baseline (0 new)**; no migration; no new packages.
- **Next (consolidated)**: both workstreams committed — v3.33.0 watchdog `6e22eca`, v3.33.1 swing `f86d9d0`, v3.34.0 monthly-ops `5d754b7`, v3.34.1 wasm gate-fix `d91fb01` — all merged into PR #118 branch `fix/leader-watchdog-self-heal`; delete `.dev-otel.log`; run `/pre-commit-check` → **no push/merge/deploy of PR #118 without explicit user approval**.
- **Unrelated open**: PR #118 (v3.33.0 + v3.33.1 + v3.34.x merged) OPEN on `fix/leader-watchdog-self-heal`; PR #114 pending; Phase 0 (Prisma Postgres provisioning) REQUIRED before Dec 1 2026 Accelerate retirement (BUGS.md #14). Held (req text not provided — no guess-implement): `dailyRecommendationService` AI-unavailable fallback + rate re-capture wiring; deferred daily recommendation job failures (Issue 3). RESOLVED: v3.32.1 committed `bcde7ae` (+ docs `7e21569`); PR #114 MERGED; v3.31.0 merged via PR #116 (`389935f`); v3.32.0 merged via PR #117 (`38a27bf`).

---

## Agent Pipeline

| Step | Agent | Status | Handoff |
|------|-------|--------|---------|
| 1 | GH Helper | ⏳ Idle | - |
| 2 | Integrator | ⏳ Idle | - |
| 3 | QA | ⏳ Idle | - |
| 4 | DevOps | ⏳ Idle | - |
| * | Observability | ⏳ Idle | - |

## Active Handoff

No active handoff. See `.agents/session-todos.md` for the current session todo list and `.agents/handoffs/active/latest.md` for session state.

---

## Quick Links

| File | Purpose | Must Read? |
|------|---------|------------|
| `.agents/session-todos.md` | Current session todo list | Yes |
| `.agents/handoffs/active/latest.md` | Current session handoff | Yes |
| `.agents/handoffs/SCHEMA.md` | Handoff file format | Yes |
| `@Primer.md` | Project status | Yes |
| `@Lessons.md` | Rules & corrections | Yes |
| `@AGENTS.md` | Full development guide | Reference |
| `@agent-memory.md` | Activity log | Reference |
| `.agents/learning/README.md` | Self-learning system | Reference |
| `.agents/pre-commit-workflow.md` | Pre-commit checklist | Reference |
| `.agents/security-checklist.md` | Security checklist | Reference |
| `.agents/linear-history.md` | Git flow & branching (warn-only main) | Reference |
| `.agents/code-hygiene.md` | Code quality rules (ponytail minimal-code) | Reference |
| `.agents/documentation-standards.md` | Documentation standards | Reference |
| `.agents/docs/` | Subsystem deep-dives (recommendations engine, tasks/cron/workers, monitoring & logging, alerts) — read before editing those subsystems | Reference |
| `.githooks/` | Versioned git hooks (enabled via `core.hooksPath`) | Reference |

---

## Orchestration Rules

1. **Start**: Read @HANDOFF.md → Read latest.md → Read @Primer.md → Read @Lessons.md
2. **Work**: Update handoff files as you go; log in @agent-memory.md
3. **Handoff**: Use `/handoff` command when switching agents or completing
4. **Complete**: Archive handoff → Update @HANDOFF.md to `ready` → Update docs
5. **Recovery**: If session crashes, next agent reads latest.md and continues

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| v1.0 | 2026-07-16 | Initial handoff orchestration system |
| v1.1 | 2026-08-06 | Session ph19 (prod reliability fixes): updated state, added session-todos + pre-commit + security references |
| v1.2 | 2026-08-06 | Session ph19: added gardenify docs links (linear-history, code-hygiene, documentation-standards, .githooks/) |
| v1.3 | 2026-08-06 | Added `.agents/docs/` subsystem deep-dive reference (recommendations engine, tasks/cron/workers, monitoring & logging, alerts) |
| v1.4 | 2026-08-07 | Session ph20 (recommendation performance tracking, v3.5.0): updated state to ph20, session-todos refreshed |
| v1.5 | 2026-08-07 | Session ph21 (carry-forward, v3.5.1): target/SL ₹0 fix + SSE live prices + HistoryTab null-guard; state updated to ph21 |
| v1.6 | 2026-08-08 | Session v3.5.3 (Playwright e2e suite): state updated to e2e docs/commit phase; feature `playwright-e2e-suite` |
| v1.7 | 2026-08-11 | Session v3.5.7 (auth join→approve→login fix + server logs `logs/` dir): state updated; feature `v3.5.7-auth-login-fix-logs-dir`; commit/PR pending, no deploy |
| v1.8 | 2026-08-17 | Session v3.14.0 (swing signal persistence + advanced screener fix + spec-driven dev): state updated to `ready`; branch `docs-readme-refs-agentic-coding` committed + pushed |
| v1.9 | 2026-08-25 | Session v3.19.2 (SQLite expanded + recovery sync + admin DB health dashboard): state updated to `ready`; branch `feature/ai-intelligence` committed + pushed |
| v1.10 | 2026-08-27 | Session v3.20.1 + v3.20.2 (DB ops optimization + DB Health enhancements + Daily Price Cache batch writer): state `in_progress`; branch `feat/db-health-price-cache`; commit/push/PR in progress |
| v1.11 | 2026-09-09 | Session v3.31.0 (SQLite-first NSE read architecture + low-frequency Prisma sync, Plan 09): state `in_progress`; branch `fix/v3.29.1-header-watchlist`; code + tests committed `9303bd7`→`653b617` (9 commits); doc commit pending user |
| v1.12 | 2026-09-10 | Sessions v3.32.0 + v3.32.1 (Admin Time Synchronisation MERGED via PR #117 `38a27bf`; db-health POST body-parsed-once hotfix committed `bcde7ae` + docs `7e21569`) + v3.33.0 + v3.33.1 (leader watchdog self-heal + swing touch tracking): state `in_progress`; branch `fix/leader-watchdog-self-heal`; watchdog `6e22eca` + swing `f86d9d0` commits pending user |
| v1.13 | 2026-09-11 | Session v3.34.x (Monthly Query Consumption — db-health monthly-ops window + sql.js WASM async-load gate fix): state `in_progress`; commits 5d754b7 (v3.34.0) + d91fb01 (v3.34.1) on `feat/db-health-monthly-ops`, merged into PR #118 branch `fix/leader-watchdog-self-heal`; PR #118 merge/push/deploy pending user |

