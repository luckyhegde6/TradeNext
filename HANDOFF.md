# HANDOFF.md - Agent Orchestration State

> **Every agent MUST read this file at session start to understand the current orchestration state.**
> This is the central coordination point for all AI agents working on TradeNext.

---

## Current State

```yaml
status: "in_progress"              # ready | in_progress | handoff_required | recovery
current_agent: "system"          # Current agent type
next_agent: null                 # Next agent to process (if handoff_required)
handoff_version: "1.0"
last_updated: "2026-08-15T14:45:00Z"
feature: "v3.11.2-recs-cache-module-graph-singleton"
```

## Handoff Required?

**No active handoff.** Session v3.11.2 (Stale recs cache across module graphs FIX) on branch `fix/cron-tz-swing-perf` (on top of v3.11.1; work-in-progress, NOT committed): Next.js dev loads `instrumentation.ts` (worker/cron daemon) and API routes as SEPARATE module graphs → `lib/cache.ts` was evaluated TWICE → two independent `recommendationsCache` NodeCaches; the worker's `invalidateRecommendationsCache()` flushed ITS copy while the API route kept serving the stale 23h run ("Last updated: 14/8/2026" after v3.11.1 re-ran recs). Fix: `recommendationsCache` now lives on `globalThis` (`__recommendationsCache`, mirrors `lib/prisma.ts`); all importers resolve the SAME instance; other caches unchanged (short TTLs, no cross-module invalidation). NEW `lib/__tests__/cacheSingleton.test.ts` (4 tests — `jest.resetModules()` re-require proves identity + cross-instance visibility + worker→route `flushAll` invalidation + shared `keys()`). **Suite 700 pass** (was 696; 54 suites + 1 pre-existing skip); tsc 71 exact baseline (0 new); no UI change (no Playwright re-run). Docs updated (AGENTS.md v3.11.2 row, CHANGELOG index + versions-v3.md, TODO.md row, Lessons #76, Primer, agent-memory, session flow/decisions, session-todos). **Remaining: commit v3.11.2 (pending user — along with v3.11.0 `6c4ef41` + v3.11.1 `b2d9423` holds) → push → PR (ask first); NO deploy** (serverless must keep `CRON_DAEMON_DISABLED=1`; netlify.toml no longer ships a functions dir; remove Netlify cron UI entries after deploy).

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

No active handoff. Session ph19 code + docs complete; pending test run, deploy, and prod verification. See `.agents/session-todos.md` for the current session todo list and `.agents/handoffs/active/latest.md` for session state.

---

## Quick Links

| File | Purpose | Must Read? |
|------|---------|------------|
| `.agents/session-todos.md` | Current session todo list | ✅ Yes |
| `.agents/handoffs/active/latest.md` | Current session handoff | ✅ Yes |
| `.agents/handoffs/SCHEMA.md` | Handoff file format | ✅ Yes |
| `Primer.md` | Project status | ✅ Yes |
| `Lessons.md` | Rules & corrections | ✅ Yes |
| `AGENTS.md` | Full development guide | 📖 Reference |
| `agent-memory.md` | Activity log | 📖 Reference |
| `.agents/learning/README.md` | Self-learning system | 📖 Reference |
| `.agents/pre-commit-workflow.md` | Pre-commit checklist | 📖 Reference |
| `.agents/security-checklist.md` | Security checklist | 📖 Reference |
| `.agents/linear-history.md` | Git flow & branching (warn-only main) | 📖 Reference |
| `.agents/code-hygiene.md` | Code quality rules (ponytail minimal-code) | 📖 Reference |
| `.agents/documentation-standards.md` | Documentation standards | 📖 Reference |
| `.agents/docs/` | Subsystem deep-dives (recommendations engine, tasks/cron/workers, monitoring & logging, alerts) — read before editing those subsystems | 📖 Reference |
| `.githooks/` | Versioned git hooks (enabled via `core.hooksPath`) | 📖 Reference |

---

## Orchestration Rules

1. **Start**: Read HANDOFF.md → Read latest.md → Read Primer.md → Read Lessons.md
2. **Work**: Update handoff files as you go; log in agent-memory.md
3. **Handoff**: Use `/handoff` command when switching agents or completing
4. **Complete**: Archive handoff → Update HANDOFF.md to `ready` → Update docs
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
