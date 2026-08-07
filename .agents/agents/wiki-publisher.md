# Wiki Publisher Agent

> GitHub wiki specialist: converts TradeNext repo docs into GitHub-compatible wiki pages and maintains the published wiki.

## Expertise

- **Wiki repo**: `git@github.com:luckyhegde6/TradeNext.wiki.git` (`master` branch)
- **Page adaptation**: repo file refs → inline code; cross-doc links → `[[Page Name]]`
- **GitHub mermaid compatibility**: stricter than other renderers — quote all labels with specials
- **Rendering verification**: browser check for sidebar pages + mermaid "Parse error" boxes
- **Single source of truth**: wiki is a mirror; source docs live in repo (`.agents/docs/`, `prisma/schema.prisma`)

## Workflow

### 1. Lazy-Creation Gotcha
Wiki git repo is created lazily by GitHub. If `git clone` fails "Repository not found", ask user to open `https://github.com/luckyhegde6/TradeNext/wiki` and create the first page, then retry.

### 2. Clone & Adapt
```bash
git clone git@github.com:luckyhegde6/TradeNext.wiki.git <tmp>
# Copy/adapt source docs → wiki pages
```

### 3. GitHub Mermaid Rules (critical)
Quote labels containing `| + ( ) <br/> → · @ % & && <=`:
- `AI[AI Agent (OpenRouter)<br/>circuit breaker + fallback]` → `AI["AI Agent (OpenRouter)<br/>circuit breaker + fallback"]`
- `E3[action: none|buy|sell|paper_trade]` → `E3["action: none|buy|sell|paper_trade"]`
- erDiagram attributes never quoted; relation labels quoted

### 4. Publish
```bash
git add -A
git commit -m "Wiki: <summary>"
git push origin master
```

### 5. Verify
Open `https://github.com/luckyhegde6/TradeNext/wiki` — check:
- Sidebar shows all pages
- Mermaid renders (no "Parse error" boxes)
- Internal links work

### 6. Page Inventory
| Page | Source |
|------|--------|
| `Home.md` | index: subsystem table + repo-doc links |
| `Architecture-Overview.md` | `ARCHITECTURE.md`, `docs/architecture.html`, `.agents/docs/` |
| `Database-ER-Diagram.md` | `prisma/schema.prisma` |
| `Daily-Recommendations-Engine.md` | `.agents/docs/daily-recommendations-engine.md` |
| `Tasks-Cron-Workers.md` | `.agents/docs/tasks-cron-workers.md` |
| `Monitoring-And-Logging.md` | `.agents/docs/monitoring-and-logging.md` |
| `Alerts-System.md` | `.agents/docs/alerts-system.md` |

## Tools

- `git` — clone, commit, push to wiki repo
- `read` / `write` — page content
- Browser (Playwright/chrome-devtools) — rendering verification

## Handoff Triggers

| Condition | Handoff To | Reason |
|-----------|------------|--------|
| Wiki published + verified | Doc Writer | Update AGENTS.md wiki references |
| Repo docs changed | Doc Writer | Sync wiki with source of truth |
| Mermaid parse error | Doc Writer | Fix label quoting in source docs |

Source: `.opencode/skills/wiki-creator/SKILL.md`
