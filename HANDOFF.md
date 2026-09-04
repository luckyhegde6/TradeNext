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
feature: "v3.28.1-sqlite-partial-init-self-heal"
```

## Handoff Required?

**Branch `v3.26.0-prod-failure-triage` (on top of v3.28.0 + v3.27.0 + v3.26.0 work) — v3.28.1 SQLite partial-init self-heal + promote not-ready guard code + tests + docs VERIFIED; diff pending user commit (no auto-commit/push/deploy).**
- **v3.28.1 — SQLite partial-init self-heal + promote not-ready guard** (prod triage after the v3.28.0 deploy to `main`): live "SQLite Not Ready" dashboard + `promoteNseToPrisma … no such table: daily_price` (and `chartink_screener_result`). Root cause (1 defect → both symptoms): `initSqliteBackup` (`lib/sqlite.ts` :970) assigns `state.db = db` (:976) BEFORE the schema loop (:979-982); a schema throw left `state.db` non-null (partially built) + `ready:false`, and the `if (state.db) return` early-return (:971) made the `ensureSqliteBackup()` retry a permanent no-op. `ensureNseColumns` is ALTER-only (can't create missing tables). Fix (1): init catch now resets `state.db = null` + `_instance = null` so the next call REBUILDS from scratch (self-healing). Fix (2): `promoteNseToPrisma()`/`promoteTable()` now require `!state.ready ||` → partial mirror skipped (all-zero summary, no Prisma ops, no throw).
- **Verification**: tsc **46 = exact baseline (0 new)**; sqlite.test.ts 36/36 + daemon-sqlite-first/dbOpTiering/historical (31) green; full suite **998 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` async-cache flake, untouched — excluding it 71 suites / **998 pass / 4 skip / 0 fail**); +2 regression tests (partial-init repair via patched `MockDatabase.run` schema-throw; promote not-ready returns zero); no schema change → no migration.
- **Docs updated (all)**: AGENTS.md v3.28.1 row, `.agents/CHANGELOG.md` index + `.agents/changelog/versions-v3.28.md`, Primer.md (Last Updated + Current Project Status + Session History), agent-memory.md, session-todos + this file. Spec `.agents/specs/06-sqlite-first-nse-store.md` + plan `.agents/plans/06-sqlite-first-nse-store.md` unchanged (design — this is an operational self-heal defect).
- **Next**: present the 2-code-file + docs diff for user commit approval (no auto-commit/push/deploy; do not amend `8020dee`/`a6d902e`/`24e3586`/`3605c64`). Post-ship: investigate **daily recommendation job failures** (Issue 3, deferred from this triage). Later REQUIRED: Phase 0 (manual Prisma Postgres provisioning) → post-move, `withAccelerate()` wrapper may be dropped.
- **Unrelated open**: PR #114 (v3.26.0 fixes + Accelerate docs) still pending merge against `main`; v3.28.0 + v3.27.0 diffs also pending user commit; earlier branch workstreams await user commit/PR decisions.

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
