# Agent ↔ Skill ↔ Command Mapping Matrix

Maps TradeNext's agents to the skills they load and the commands that invoke them. Extensible — add rows as new skills/agents/commands land.

## Legend

- **Agent**: `.agents/agents/<name>.md` profile (also wired in `.opencode/opencode.json` `agent:`)
- **Skill (machine)**: `.opencode/skills/<name>/SKILL.md` — auto-discovered by OpenCode
- **Skill (human)**: `.agents/skills/<name>.md` — mirror for humans/other tools
- **Command**: `/name` in `.agents/commands/<name>.md` (wired in `opencode.json` `command:`)

## Core matrix

| Agent | Primary skill | Related skills | Command(s) | Trigger |
|-------|--------------|----------------|------------|---------|
| **build** (primary) | — | all | — | main work |
| **plan** | docs-workflow | docs-updater | `/plan` | before features |
| **review** | bug-finder | — | `/code-review` | pre-commit / PR |
| **tdd** | bug-finder | ux-enhancer | `/tdd` | test-first features |
| **explore** | — | — | — | codebase questions |
| **doc-writer** | docs-updater | docs-workflow | `/docs-update` | after every implementation |
| **wiki-publisher** | wiki-creator | docs-updater | `/wiki-publish` | docs changed → wiki sync |
| **bug-hunter** | bug-finder | docs-updater | `/find-bugs` | bugs/contract audits |
| **ux-designer** | ux-enhancer | bug-finder | `/ux-audit` | UI/UX audit/enhance |

## Skill inventory

| Skill | Machine (`SKILL.md`) | Human mirror | Purpose |
|-------|---------------------|--------------|---------|
| docs-workflow | `.opencode/skills/docs-workflow/` | `.agents/skills/docs-workflow.md` | umbrella: plans + wiki + repo docs |
| docs-updater | `.opencode/skills/docs-updater/` | `.agents/skills/docs-updater.md` | repo doc updates after changes |
| wiki-creator | `.opencode/skills/wiki-creator/` | `.agents/skills/wiki-creator.md` | publish GitHub wiki pages |
| bug-finder | `.opencode/skills/bug-finder/` | `.agents/skills/bug-finder.md` | hunt/reproduce/verify bugs |
| ux-enhancer | `.opencode/skills/ux-enhancer/` | `.agents/skills/ux-enhancer.md` | UI/UX audit + enhancement |
| nse-integration | `.opencode/skills/nse-integration/` | `.agents/skills/nse-integration.md` | NSE API integration |
| playwright-cli | `.opencode/skills/playwright-cli/` | `.agents/skills/playwright-cli/` | browser testing |

## Command inventory

| Command | Agent | Purpose |
|---------|-------|---------|
| `/docs-update` | doc-writer | mandatory repo doc updates |
| `/wiki-publish` | wiki-publisher | publish wiki pages |
| `/find-bugs` | bug-hunter | bug hunt + contract audit |
| `/ux-audit` | ux-designer | UI/UX audit/enhance |
| `/tdd`, `/code-review`, `/build-fix`, `/plan`, `/pre-commit-check` | existing | existing flows |

## Adding a new skill

1. Create `.opencode/skills/<name>/SKILL.md` (YAML frontmatter: `name`, `description`).
2. Mirror to `.agents/skills/<name>.md` (short human version, `Source:` footer).
3. Create/update the owning agent profile (`.agents/agents/<name>.md`) and command (`.agents/commands/<name>.md`).
4. Wire into `.opencode/opencode.json` (`agent:` + `command:` sections) if it needs agent/command bindings.
5. Update this matrix + AGENTS.md.
