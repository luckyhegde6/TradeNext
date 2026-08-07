# Wiki Creator Skill

Publishes and maintains the TradeNext GitHub wiki (`git@github.com:luckyhegde6/TradeNext.wiki.git`, branch `master`).

> **Gotcha:** the wiki git repo is created lazily by GitHub. If clone says "Repository not found", ask the user to open `https://github.com/luckyhegde6/TradeNext/wiki` and click "Create the first page" once, then retry.

## Pages

| Page | Source (single source of truth) |
|------|--------------------------------|
| `Home.md` | index: subsystem table + repo-doc links |
| `Architecture-Overview.md` | `ARCHITECTURE.md`, `docs/architecture.html`, `.agents/docs/` |
| `Database-ER-Diagram.md` | `prisma/schema.prisma` (full erDiagram + model reference + clusters) |
| `Daily-Recommendations-Engine.md` | `.agents/docs/daily-recommendations-engine.md` |
| `Tasks-Cron-Workers.md` | `.agents/docs/tasks-cron-workers.md` |
| `Monitoring-And-Logging.md` | `.agents/docs/monitoring-and-logging.md` |
| `Alerts-System.md` | `.agents/docs/alerts-system.md` |

## Workflow

1. Clone: `git clone git@github.com:luckyhegde6/TradeNext.wiki.git <tmp>`
2. Adapt: repo file refs → inline code; cross-doc links → `[[Page Name]]`; add `## Sources` footer.
3. **GitHub renderer-safe mermaid** — quote ALL labels with specials.
4. `git add -A && git commit -m "Wiki: <summary>" && git push origin master`
5. Verify: open `https://github.com/luckyhegde6/TradeNext/wiki` — sidebar pages + no "Parse error" boxes.

Page file `Architecture-Overview.md` → `/wiki/Architecture-Overview`. Internal links `[Name](Page-Name)`.

## Mermaid GitHub-compat rules (critical)

GitHub's wiki mermaid renderer rejects unquoted specials that other renderers accept:
- `AI[AI Agent (OpenRouter)<br/>circuit breaker + fallback]` → `AI["AI Agent (OpenRouter)<br/>circuit breaker + fallback"]`
- `E3[action: none|buy|sell|paper_trade]` → `E3["action: none|buy|sell|paper_trade"]`

Always quote labels containing: `| + ( ) <br/> → · @ % & && <=`. erDiagram attributes (`int id PK`) never quoted; relation labels quoted.

Source: `.opencode/skills/wiki-creator/SKILL.md`
