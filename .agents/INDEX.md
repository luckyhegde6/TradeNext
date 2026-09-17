# TradeNext — Agent Documentation Index

> **Read on demand — NOT auto-injected.** Topic → file manifest so agents can jump straight to
> the right doc instead of reading everything. Root injected files live in `.opencode/opencode.json`
> (`instructions`); everything here is loaded only when needed.
>
> Convention (v3.39.4 context-optimisation): keep auto-injected files short; push detail into
> `.agents/changelog/`, `.agents/docs/`, and root `@File.md` files referenced from here.

---

## 1. Operating Rules & Identity (read first, every session)

| Topic | File |
|-------|------|
| Master agentic rules — read on fresh clone | `.agents/RULES.md` |
| Agent identity & principles | `.agents/SOUL.md` |
| Coding standards index | `.agents/rules/README.md` *(injected)* |
| Engineering guardrail checklist (hard contract) | `.agents/rules/checklist.md` *(injected)* |
| Machine-readable checklist | `.agents/checklist.yml` |
| Full dev guide (root, injected) | `AGENTS.md` |

## 2. Session Memory, Handoff & Process

| Topic | File |
|-------|------|
| Session start read-order, memory cadence, git rules, token efficiency | `.agents/rules/session-memory-rules.md` |
| Per-session `decisions.md` + `flow.md` (MANDATORY) | `.agents/rules/session-decisions-flow.md` |
| Current session todo list (live/in-progress) | `.agents/session-todos.md` |
| Archived sessions `YYYY-MM-DD-<hash>/` | `.agents/sessions/` |
| Pre-commit checklist | `.agents/pre-commit-workflow.md` |
| Security checklist | `.agents/security-checklist.md` |
| Git flow / branching | `.agents/linear-history.md` |
| Code quality rules (ponytail minimal-code) | `.agents/code-hygiene.md` |
| Documentation standards | `.agents/documentation-standards.md` |
| Handoff state (orchestration) | `HANDOFF.md`, `.agents/handoffs/active/latest.md`, `.agents/handoffs/flow/` |
| Tool-output protocol (redirect → slice; context-loop guard) | `.agents/rules/tool-output-protocol.md` |
| Tool-output chunker (splits `.context/out/` captures into parts + index) | `scripts/dev-checks/chunk-output.mjs` |
| Durable memory — two-tier (`.remember/now.md` + memory MCP graph) | `.agents/rules/durable-memory.md` |

## 3. Spec-Driven Development (MANDATORY for features)

| Topic | File |
|-------|------|
| Spec → Plan → Implement → Verify flow | `.agents/rules/spec-driven-development.md` |
| Spec template / saved specs | `.agents/templates/spec-template.md`, `.agents/specs/` |
| Plan template / saved plans | `.agents/templates/plan-template.md`, `.agents/plans/` |
| PRD (root copy) / design docs | `.agents/PRD.md`, `.agents/prd/`, `docs/designDoc/` |

## 4. Version History & Changelog (read on demand)

| Topic | File |
|-------|------|
| Compact version index (moved out of `AGENTS.md`) | `.agents/changelog/versions-index.md` |
| Full changelog index | `.agents/CHANGELOG.md` |
| Per-minor detail (v1 / v2 / v3) | `.agents/changelog/versions-v*.md` |
| TODO Quick Reference archive (moved out of `TODO.md`) | `.agents/changelog/todo-quick-reference-archive.md` |
| Implementation checklist (root) | `TODO.md` |

## 5. Subsystem Deep-Dives (`.agents/docs/`)

| Topic | File |
|-------|------|
| Recommendations engine | `.agents/docs/daily-recommendations-engine.md` |
| Tasks / cron / workers | `.agents/docs/tasks-cron-workers.md` |
| Monitoring & logging | `.agents/docs/monitoring-and-logging.md` |
| Serverless logging | `.agents/docs/serverless-logging.md` |
| Alerts system | `.agents/docs/alerts-system.md` |
| Screener | `.agents/docs/screener.md` |
| Chartink API | `.agents/docs/chartink-api.md` |
| Corporate actions | `.agents/docs/corp-actions.md` |
| Security & workers | `.agents/docs/security-workers.md` |
| DB migration ledger (what/why/decisions) | `.agents/docs/db-migrations.md` |
| Playwright e2e / debug | `.agents/docs/playwright-e2e.md`, `.agents/docs/playwright-debug.md` |
| Backtest history prod gap plan | `.agents/docs/plan-backtest-history-prod-gap.md` |

## 6. Skills, Agents & Commands

| Topic | File |
|-------|------|
| Agent ↔ Skill ↔ Command matrix | `.agents/AGENT-SKILL-MATRIX.md` |
| Skill machines (auto-discovered) | `.opencode/skills/<name>/SKILL.md` |
| Skill human mirror | `.agents/skills/` |
| Agent profiles | `.agents/agents/` |
| `/command` templates | `.agents/commands/` |
| Wiring | `.opencode/opencode.json` |
| Architecture deep-dive | `ARCHITECTURE.md`, `docs/architecture.html` |

## 7. Root-Level Reference Docs (`@File.md` convention)

| File | Purpose |
|------|---------|
| `README.md` *(injected)* | Project overview, features, quick start, credentials, commands |
| `USAGE.md` / `SETUP.md` / `DOCKER_ENV_SETUP.md` | Setup & environment guides |
| `BUGS.md` / `TODO_ENHANCEMENTS.md` | Bug tracker / future ideas |
| `TODO-PENTESTING.md` / `TODO-PERF-TESTING.md` | Security & performance checklists |
| `SECURITY.md` / `VERIFICATION_REPORT.md` | Policy / verification report |
| `llms.txt`, `robots.txt`, `sitemap.xml`, `/api/openapi` | AI/agent discovery + API surface |
