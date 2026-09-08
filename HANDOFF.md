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
last_updated: "2026-09-09T00:00:00Z"
feature: "v3.31.0-sqlite-first-read-architecture"
```

## Handoff Required?

**On `fix/v3.29.1-header-watchlist` (HEAD `653b617` = v3.31.0 code P8; v3.30.0 `8af65cc` + v3.29.2 `1e907f1` + v3.29.1 `6e8db23` committed) — v3.31.0 SQLite-first NSE read architecture + low-frequency Prisma sync (Plan 09): CODE + TESTS COMMITTED `9303bd7`→`653b617` (9 commits); DOC COMMIT PENDING USER (no push/merge/deploy).**
- **(1) sync_history ledger** — durable `sync_history` table + `recordSyncHistory()` (prune-100) + `recentSyncs` in health; SCHEMA_SQL stray-`;`-in-comment sql.js parse error fixed (root cause of v3.30.0 boot noise; converted `--` comment `;` → `/* */`).
- **(2) Boot hydration on every instance** — `syncFromPrisma(opts)` (`reason`/`skipReconcile`/`leaderBypass`/`force`); `initSqliteBackup()` → `{boot, skipReconcile, leaderBypass}`.
- **(3) NSE rate guard** — NEW `lib/services/nseRateGuard.ts` + 6 tests (single-flight, throttle, burst cooldown); wired `nse-client.ts` + `market-cache.ts`.
- **(4) `_sync_outbox` + 6h PUSH engine** — `_sync_outbox` table + `pushSqliteToPrisma` (grouped latest-op-wins, chunk-200 sinks, `reconcileControlToPrisma`); NEW `lib/sqlitePushSinks.ts`; 6h probe pivots PULL→PUSH. **Prod bug FIXED**: `if (!isLeader("sqlite-sync"))` never fired (isLeader returns `Promise` — always truthy) → awaited.
- **(5) NSE captures SQLite+outbox only** — auto-promote off (`NSE_PROMOTE_ENABLED=1` env-gated).
- **(6) Jobs write SQLite-first (recs/swing/perf)** — 5 mirror tables + 7 write-through helpers; pipelines mirror-first with Prisma fallback.
- **(7) Admin long-lived datasets SQLite-first** — +7 helpers (`admin_announcement`/`alert`/`transaction`/`corporate_action`) + 4 admin CRUD routes flipped.
- **(8) db-health wiring** — GET spreads outbox/derived-counts/sync-history; POST `push_to_prisma`; UI Outbox + Derived-counts + Push button; 5 hot-route headers document the read chain.
- **Verification**: sqlite.test.ts **68/68** (11 new P8); instrumentation +1; NEW nseRateGuard 6; full **1105 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake); tsc **46 = exact baseline (0 new)**; no schema change → no migration.
- **Deferred (plan rev-v3 c/d)**: SQLite `query_cache` + db-health monthly-ops window NOT implemented (follow-up).
- **Next**: doc commit — stage the doc files (changelog versions-v3.31.md + CHANGELOG index + AGENTS.md + TODO.md + Primer.md + agent-memory.md + Lessons.md + session-todos.md + plan + spec) → run `/pre-commit-check` → commit `docs(sqlite): v3.31.0 Plan 09 SQLite-first read architecture (AGENTS/CHANGELOG/TODO/Primer/memory/Lessons)` (no code — code already landed).
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
| v1.11 | 2026-09-09 | Session v3.31.0 (SQLite-first NSE read architecture + low-frequency Prisma sync, Plan 09): state `in_progress`; branch `fix/v3.29.1-header-watchlist`; code + tests committed `9303bd7`→`653b617` (9 commits); doc commit pending user |
