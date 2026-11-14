---
name: wiki-creator
description: Publish and maintain GitHub wiki pages for TradeNext - create Home, Architecture Overview, Database ER Diagram, and subsystem deep-dive pages; push to TradeNext.wiki.git; verify rendering
metadata:
  audience: agents
  workflow: documentation
---

# Wiki Creator Skill

Publishes and maintains the TradeNext GitHub wiki (`git@github.com:luckyhegde6/TradeNext.wiki.git`, branch `master`).

> **Gotcha:** the wiki git repo is created lazily by GitHub. It does NOT exist until the first page is saved via the web UI. If clone says "Repository not found", ask the user to open `https://github.com/luckyhegde6/TradeNext/wiki` and click "Create the first page" once, then retry.

## Page inventory

| Page file | Source (single source of truth) | Notes |
|-----------|--------------------------------|-------|
| `Home.md` | — | Index: subsystem table + repo-doc links |
| `Architecture-Overview.md` | `ARCHITECTURE.md`, `docs/architecture.html`, `.agents/docs/` | Whole-system flowchart, data flows, caching, security, deployment, ER link |
| `Database-ER-Diagram.md` | `prisma/schema.prisma` | Full erDiagram (~75 models) + model reference table + relationship clusters |
| `Daily-Recommendations-Engine.md` | `.agents/docs/daily-recommendations-engine.md` | |
| `Tasks-Cron-Workers.md` | `.agents/docs/tasks-cron-workers.md` | |
| `Monitoring-And-Logging.md` | `.agents/docs/monitoring-and-logging.md` | |
| `Alerts-System.md` | `.agents/docs/alerts-system.md` | |

## Workflow

```
1. Clone: git clone git@github.com:luckyhegde6/TradeNext.wiki.git <tmp>
2. Adapt content:
   - Repo file refs (lib/..., app/...) → inline code, no links
   - Cross-doc links → [[Page Name]]
   - Add "## Sources" footer → single source of truth path
3. GitHub renderer-safe mermaid (GitHub is stricter than other renderers):
   - Quote ALL node labels with specials: A["text<br/>more"], N["a + b"]
   - Edge labels with | + ( ) && <= → "quoted"
   - erDiagram: attributes int id PK never quoted; relation labels quoted
4. git add -A && git commit -m "Wiki: <summary>" && git push origin master
5. Verify in browser: https://github.com/luckyhegde6/TradeNext/wiki
   - Sidebar shows all pages
   - No "Parse error" boxes under mermaid blocks
```

## Page-name → URL mapping

File `Architecture-Overview.md` → `/wiki/Architecture-Overview`. Internal links: `[Name](Page-Name)` or wiki `[[Name]]`.

## Mermaid GitHub-compat rules (critical)

GitHub's wiki mermaid renderer rejects unquoted specials that other renderers accept. Known failure examples:
- `AI[AI Agent (OpenRouter)<br/>circuit breaker + fallback]` → must be `AI["AI Agent (OpenRouter)<br/>circuit breaker + fallback"]`
- `E3[action: none|buy|sell|paper_trade]` → `E3["action: none|buy|sell|paper_trade"]`

Always quote labels containing: `| + ( ) <br/> → · @ % & && <=`.

## Verification checklist

- [ ] Pages pushed to wiki master
- [ ] Browser shows pages in sidebar
- [ ] Mermaid renders (no "Parse error" box, no raw code visible)
- [ ] Sources footers present
