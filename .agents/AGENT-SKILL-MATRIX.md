# Agent ↔ Skill ↔ Command Mapping Matrix

Maps TradeNext's agents to the skills they load and the commands that invoke them. Extensible — add rows as new skills/agents/commands land.

## Legend

- **Agent**: `.agents/agents/<name>.md` profile (also wired in `.opencode/opencode.json` `agent:`)
- **Skill (canonical, format A)**: `.agents/skills/<name>/SKILL.md` — single source of truth for humans and LLMs (may include `references/` assets). OpenCode may still discover skills from configured locations, but repo-canonical content lives in `.agents/skills`.
- **Command**: `/name` in `.agents/commands/<name>.md` (wired in `opencode.json` `command:`)

## Core matrix

| Agent | Primary skill | Related skills | Command(s) | Trigger |
|-------|--------------|----------------|------------|---------|
| **build** (primary) | — | all | — | main work |
| **orchestrator** (primary) | — | docs-workflow, docs-updater | `/orchestrate` | ≥ 2 independent workstreams; subagent health |
| **plan** | docs-workflow | docs-updater | `/plan` | before features |
| **review** | bug-finder | playwright-debug | `/code-review` | pre-commit / PR |
| **tdd** | bug-finder | ux-enhancer, playwright-debug | `/tdd` | test-first features |
| **explore** | — | — | — | codebase questions |
| **doc-writer** | docs-updater | docs-workflow | `/docs-update` | after every implementation |
| **wiki-publisher** | wiki-creator | docs-updater | `/wiki-publish` | docs changed → wiki sync |
| **bug-hunter** | bug-finder | docs-updater, playwright-debug | `/find-bugs` | bugs/contract audits |
| **ux-designer** | ux-enhancer | bug-finder, playwright-debug | `/ux-audit` | UI/UX audit/enhance |
| **qa** | playwright-e2e | playwright-debug, playwright-cli | — | test execution, cross-browser validation |
| **e2e-agent** | playwright-e2e | playwright-debug, playwright-cli, playwright (MCP) | — | user flow validation, responsive |
| **code-reviewer** | — | bug-finder, playwright-debug | — | code quality + security review |
| **devops** | — | server-log-analysis | — | deployment, CI/CD, infra |
| **integrator** | nse-integration | — | `/nse-integration` | NSE/API contracts, cross-module wiring |
| **observability** | server-log-analysis | — | `/server-log` | monitoring, logging, health, perf |
| **webmcp-integrator** | webmcp | nse-integration, docs-workflow | — | in-browser agent tool surfaces (`document.modelContext`) |

## Skill inventory (canonical: `.agents/skills/<name>/SKILL.md`)

| Skill | Path | Purpose |
|-------|------|---------|
| audit-logging | `.agents/skills/audit-logging/` | audit logging patterns and implementation guidance |
| bug-finder | `.agents/skills/bug-finder/` | hunt/reproduce/verify bugs and layer contract mismatches |
| daily-recommendations | `.agents/skills/daily-recommendations/` | daily recommendations domain workflow |
| docs-updater | `.agents/skills/docs-updater/` | mandatory repo doc updates after changes |
| docs-workflow | `.agents/skills/docs-workflow/` | umbrella: plans + wiki + repo docs |
| nse-integration | `.agents/skills/nse-integration/` | NSE/TradingView integration (nseFetch, caching, historical/backtest chain) |
| playwright-cli | `.agents/skills/playwright-cli/` | exploratory browser automation CLI (+ references) |
| playwright-debug | `.agents/skills/playwright-debug/` | Inspector/UI Mode/Codegen/Trace/HTML report debugging |
| playwright-e2e | `.agents/skills/playwright-e2e/` | committed e2e suite (`e2e/`, `npm run test:e2e`) |
| prisma-client-api | `.agents/skills/prisma-client-api/` | Prisma client API usage patterns |
| prisma-database-setup | `.agents/skills/prisma-database-setup/` | Prisma/database setup guidance |
| prisma-driver-adapter-implementation | `.agents/skills/prisma-driver-adapter-implementation/` | Prisma driver adapter implementation |
| prisma-postgres | `.agents/skills/prisma-postgres/` | Prisma + Postgres specifics |
| self-heal | `.agents/skills/self-heal/` | self-heal/self-improve workflows |
| server-log-analysis | `.agents/skills/server-log-analysis/` | server log triage/clean/format and incident playbooks |
| ux-enhancer | `.agents/skills/ux-enhancer/` | UI/UX audit and enhancement |
| webmcp | `.agents/skills/webmcp/` | WebMCP (`document.modelContext`) tool design and integration |
| wiki-creator | `.agents/skills/wiki-creator/` | publish/maintain GitHub wiki pages |

## Command inventory

| Command | Agent | Purpose |
|---------|-------|---------|
| `/docs-update` | doc-writer | mandatory repo doc updates |
| `/wiki-publish` | wiki-publisher | publish wiki pages |
| `/find-bugs` | bug-hunter | bug hunt + contract audit |
| `/ux-audit` | ux-designer | UI/UX audit/enhance |
| `/nse-integration` | — (template/skill-backed) | NSE API integration patterns |
| `/orchestrate` | orchestrator | decompose → dispatch → monitor → handoff (Tier A/B) |
| `/server-log` | observability | server log triage/clean/format |
| `/tdd`, `/code-review`, `/build-fix`, `/plan`, `/pre-commit-check` | build/tdd/review/plan | existing flows |

## Adding a new skill (canonical policy)

1. Create `.agents/skills/<name>/SKILL.md` (YAML frontmatter: `name`, `description`; optional `metadata`, `allowed-tools`) and any `references/` assets.
2. **Do not** create skills under `.agents/skills` (avoids confusion for other LLMs). If OpenCode requires local discovery wiring, mirror/copy only via explicit tooling config — `.agents/skills` remains source of truth.
3. Create/update the owning agent profile (`.agents/agents/<name>.md`) and command (`.agents/commands/<name>.md`) as needed.
4. Wire into `.opencode/opencode.json` (`agent:` / `command:` sections) if bindings are required.
5. Update this matrix + `@AGENTS.md` (and relevant docs/rules).
