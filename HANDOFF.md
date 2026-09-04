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
last_updated: "2026-09-04T00:00:00Z"
feature: "v3.28.2-lost-leader-engine-stop"
```

## Handoff Required?

**Branch `fix/v3.28.1-sqlite-self-heal` (on top of v3.28.1 `718b5d2`) — v3.28.2 lost-leader engine stop code + tests + docs VERIFIED; diff pending user commit (no auto-commit/push/deploy).**
- **v3.28.2 — Lost-leader engine stop, single-active-worker enforcement** (post-ship audit, on top of v3.28.1): user reported "tasks/worker failing, only 1 worker/task active at a time". Audit verified ALL persistence paths — AI-call tracking (`trackAiCall` → memory ring + SQLite `enqueueWriteBehind("server_log")` + two-tier `getPersistedAiCalls` merge), daily Recommendations (run + trackers + stocks + run.update, no-fake-HOLD deleteMany intact), performance tracking (status updates + history + 360d archive), IPO details (DB `market_cache` ipo_analysis + memory + cleanup), Swing trackers (`persistSwingTrackers` + `patchSwingSignalAnalysis` on `analysisStatus==="done"`), cron sync (`syncFromPrisma` pulls `cron_job`; `reconcileControlToPrisma` at the 6h sync pushes nextRun/lastRun/counters + heartbeats + task statuses). ✅ all persist.
- **Defect + fix**: `instrumentation.ts` `onLost` callbacks only `logger.warn`; combined with `acquireLeaderLock` **fail-open on DB-unavailable** (every instance starts worker poll loop + cron daemon during a blip), the losers' `renewLeaderLock` returned false on DB recovery → `onLost` fired → they **kept polling forever** → N active workers/tasks. Fix (surgical, `instrumentation.ts` only): worker onLost → `stopWorkerEngine()`; cron onLost → `stopCronDaemon()`; sqlite-sync onLost stays log-only (gated per-run by `isLeader`).
- **Tests**: NEW `lib/__tests__/instrumentation.test.ts` (5 — leader-elected start for all 3 roles; worker onLost → `stopWorkerEngine`; cron onLost → `stopCronDaemon`; not-leader no-start; non-node early return) 5/5.
- **Verification**: tsc **46 = exact baseline (0 new)**; targeted 85/85 (sqlite 36 + daemon-sqlite-first + dbOpTiering + historical + leader); full suite **1003 pass / 4 skip / 1 fail** (1003 = 998 + 5; 1 = documented pre-existing `intelligence.test.ts` flake, untouched — excluding it 72 suites / 1003 / 4 / 0). No schema change → no migration.
- **Docs updated (all)**: AGENTS.md v3.28.2 row, `.agents/CHANGELOG.md` index + `.agents/changelog/versions-v3.28.md`, Primer.md (Last Updated + Current Project Status + Session 22), agent-memory.md, Lessons #105, session-todos + this file.
- **Next**: present the v3.28.2 diff (instrumentation.ts + test + docs) for user commit approval (no auto-commit/push/deploy; do not amend `718b5d2`/`8020dee`/`a6d902e`/`24e3586`/`3605c64`). Post-ship: investigate any remaining **daily recommendation job failures** (Issue 3, deferred).
- **Unrelated open**: PR #114 (v3.26.0 fixes + Accelerate docs) still pending merge against `main`; v3.28.1 `718b5d2` + v3.28.0 + v3.27.0 diffs also pending user commit; Phase 0 (Prisma Postgres provisioning) REQUIRED before Dec 1 2026 Accelerate retirement (BUGS.md #14).

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
