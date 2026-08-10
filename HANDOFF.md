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
last_updated: "2026-08-08T16:00:00Z"
feature: "playwright-e2e-suite"
```

## Handoff Required?

**No active handoff.** Session v3.5.3 (Playwright E2E Suite + CI + Docs) on branch `fix/screener-change-percent` (PR #85 OPEN): the user's e2e stack (`e2e/`, `playwright.config.ts`, `.github/workflows/playwright.yml`, `@playwright/test`) was hardened to green — Firefox `xl`-nav viewport **1440×900**, WebKit controlled-number-input **keystroke** fill, single-threaded dev-server nav starvation → serial `navigation.spec.ts` + `Promise.all([waitForURL, click({noWaitAfter:true})])` + 60s URL timeout, `retries: CI?2:1`, `workers: CI?1:2`, live-marquee assertion removed. **Full suite GREEN** (87/89 first attempt + 2 env-flaky on retry #1); 317 Jest tests pass; e2e files typecheck clean. CI workflow hardened (timescale service + migrate deploy + seed + artifact). All docs written (`.agents/docs/playwright-e2e.md`, `playwright-e2e` skill ×2, AGENTS.md v3.5.3 row/commands/lessons, README badge, CHANGELOG, matrix, Primer Session 14, agent-memory, Lessons 55). **Remaining: commit everything to PR #85 → push → report merge-ready (never auto-merge)** — see `.agents/session-todos.md`.

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
