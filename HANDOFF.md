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
feature: "v3.27.0-prisma-postgres-migration-phase1-3"
```

## Handoff Required?

**Branch `v3.26.0-prod-failure-triage` (on top of v3.26.0 work) — v3.27.0 Prisma Postgres Migration Phase 1-3 code + tests + docs VERIFIED; diff pending user commit (no auto-commit/push deploy).**
- **v3.27.0 — Prisma Postgres Migration Phase 1-3**: standalone Prisma Accelerate (`prisma+postgres://accelerate.prisma-data.net`) retires Dec 1, 2026 → long-term move to Prisma Postgres (Phase 0 = manual Console provisioning at deploy-time, no code). Phase 1 (`lib/prisma.ts`): `new PrismaClient({ accelerateUrl }).$extends(withAccelerate())` in the accelerate branch (order documented — `withAccelerate()` first so `$allOperations` wraps it), `let prismaClient: any`, `type AccelerateClient = PrismaClient`, NEW **`withAccelerateCache(strategy)(args)`** boundary helper (preserves contextual typing via `Parameters<T>[0]`/`ReturnType<T>` — base read-args hard-type `cacheStrategy: never` and intersections don't override it), NEW `ACCELERATE_CACHE_TTL = Number(process.env.PRISMA_ACCELERATE_CACHE_TTL) || 300`. Phase 2 — `cacheStrategy` at 5 direct-Prisma read sites: corp-actions `{ttl:300,swr:60}`, chartinkScreenerResult `{ttl:900,swr:300}`, recommendationTracker ×2 `{ttl:600,swr:60}`, dailyPrice ×2 `{ttl:60,swr:30}`, marketCache `{ttl:300,swr:60}`. Test-coupling fixes (2 mock-factory `withAccelerateCache` stubs + chartink `expect.objectContaining`).
- **Verification**: tsc **46 = exact baseline (0 new)**; `prisma validate` valid + `prisma generate` ok; full suite **995 pass / 4 skip / 2 fail** (2 = pre-existing `intelligence.test.ts` async-cache flake, fails identically in isolation, untouched — excluding it 71 suites / **995 pass / 4 skip / 0 fail**); no schema change → no migration.
- **Docs updated (all)**: AGENTS.md v3.27.0 row, `.agents/CHANGELOG.md` index + `.agents/changelog/versions-v3.27.md`, TODO.md rows (Quick Ref v3.27 + planning row flipped DONE), Primer.md, agent-memory.md, Lessons.md #104, `.env.example` (`PRISMA_ACCELERATE_CACHE_TTL`), session-todos + this file. Spec `.agents/specs/05-prisma-postgres-migration.md` + plan `.agents/plans/05-prisma-postgres-migration.md` committed `db5a5cc`.
- **Next**: present the 8-file diff for user commit approval (no auto-commit/push/deploy). Later REQUIRED: Phase 0 (manual Prisma Postgres provisioning) → post-move, `withAccelerate()` wrapper may be dropped.
- **Unrelated open**: PR #114 (v3.26.0 fixes + Accelerate docs) still pending merge against `main`; earlier branch workstreams await user commit/PR decisions.

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
