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
last_updated: "2026-09-07T00:00:00Z"
feature: "v3.30.0-daemon-cadence-touch-wasm"
```

## Handoff Required?

**On `fix/v3.29.1-header-watchlist` (HEAD `8af65cc` = v3.30.0 code Phase 1–4; v3.29.2 `1e907f1` + v3.29.1 `6e8db23` committed) — v3.30.0 daemon control-plane cadence + SQLite mirror touch-freshness + `upsertCronJob` Date-bind fix + Netlify WASM staging: Phases 1–4 committed `8af65cc`; Date-bind fix + v3.30.0 docs COMMIT PENDING USER (no push/merge/deploy).**
- **Cadence** (`lib/services/leader.ts` `LEADER_STALENESS_MS` 5min→**15min** + `LEADER_HEARTBEAT_MS` 60s→**300s**; `lib/services/worker/cron-daemon.ts` NEW `SWING_DRAIN_INTERVAL_MS = 900s` — swing drain off the 60s resync tick; `lib/services/worker/worker-engine.ts` `REAP_INTERVAL_MS` 60s→**300s**).
- **Mirror freshness**: NEW `SqliteFallback.touchControlMirror(table)` re-marks `control_write_at:<table>` = NOW; `discoverPendingTask()` touches on the ready-DB path so freshness tracks poll cadence — a previously idle system no longer silently falls back to Prisma every poll.
- **Schema-init root cause** (the recurring db-health "SQLite Not Ready" + all-SQLite-first-reads-falling-back-to-Prisma noise): SCHEMA_SQL stray `;` inside `--` comments → sql.js `near "Prisma": syntax error` on EVERY boot → mirror never `ready`. Fix committed `8af65cc`.
- **Netlify WASM staging**: NEW `scripts/copy-sql-wasm-netlify.mjs` → copies `public/sql-wasm.wasm` to `.next/sql-wasm.wasm` post-build (Netlify publish dir = `.next`; quickbuild/build wired; non-fatal). **Plan 09 Phase 0 = verify `npm run quickbuild` exits 0 + `.next/sql-wasm.wasm` exists.**
- **`upsertCronJob` Date-bind fix (UNCOMMITTED, `lib/sqlite.ts`)**: Prisma `CronJob` rows carry real `Date` instances; binding them raw → locale string ("Sat Sep … GMT+0530") breaks the ISO read-back `new Date(String(col))` in `reconcileControlToPrisma` (12h reconcile could write corrupt `nextRun`); NEW `toIso(v)` on lastRun/nextRun/createdAt binds (+82 in `lib/__tests__/sqlite.test.ts`: NEW Date-binding describe 2 — ISO-not-locale fails pre-fix, re-upsert same id replaces — + mock INSERT regex/OR REPLACE semantics).
- **Verification**: targeted **96/96**; tsc **46 = exact baseline (0 new)**; no schema change → no migration.
- **Next**: session-todos + this HANDOFF are the last doc files → stage ONLY `lib/sqlite.ts` + `lib/__tests__/sqlite.test.ts` + 10 doc files → commit `fix(daemon/worker): upsertCronJob Date-bind toIso + v3.30.0 docs (v3.30.0)` (code → no `[skip ci]`) → **Plan 09 Phase 0 `npm run quickbuild` verification** (dev :3000 PID 12096 active — do not kill; watch .next contention).
- **Plan 09 (SQLite-first read architecture) — USER-APPROVED, implementation starting**: v3 directives — (a) plan limit now **MONTHLY 200K ops/mo resetting on the 2nd** (was 10K/day model); (b) **Prisma calls ONLY at 3 moments: boot hydration, 6h SQLite→Prisma push, ONE hourly ops-usage write — zero between**; (c) NEW SQLite `query_cache`; (d) db-health gains "Total Ops (Monthly Window)" + "Recent 7 Days"; phases 4b/4c new, Phase 8 extended. Spec `.agents/specs/09-sqlite-first-read-architecture.md` + plan `.agents/plans/09-sqlite-first-read-architecture.md` (both untracked — do NOT commit).
- **Unrelated open**: PR #114 (v3.26.0 fixes + Accelerate docs) pending merge against `main`; v3.28.0/v3.27.0 diffs pending user commit; Phase 0 (Prisma Postgres provisioning) REQUIRED before Dec 1 2026 Accelerate retirement (BUGS.md #14); deferred daily recommendation job failures (Issue 3); held (req text not provided — no guess-implement): `dailyRecommendationService` AI-unavailable fallback + rate re-capture wiring.

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
