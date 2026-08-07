# Wiki Publish Command

> Publish TradeNext repo docs to the GitHub wiki. Mirrors source-of-truth docs with GitHub-renderer-safe mermaid.

## Usage

```
/wiki-publish [page]
```

### Parameters

| Parameter | Required | Description | Values |
|-----------|----------|-------------|--------|
| `page` | - | Page to publish | `all` (default), `home`, `architecture`, `er`, `recommendations`, `tasks`, `monitoring`, `alerts` |

### Examples

```
/wiki-publish            # Publish all 7 wiki pages
/wiki-publish er         # Publish only Database-ER-Diagram.md
/wiki-publish alerts     # Publish only Alerts-System.md
```

## Workflow

### 1. Lazy-Creation Gotcha
If `git clone` fails "Repository not found", the wiki repo doesn't exist yet — ask user to open `https://github.com/luckyhegde6/TradeNext/wiki` and create the first page, then retry.

### 2. Clone
```bash
git clone git@github.com:luckyhegde6/TradeNext.wiki.git C:\Users\lucky\AppData\Local\Temp\opencode\TradeNext.wiki
```

### 3. Adapt + Write
| Page | Source |
|------|--------|
| `Home.md` | index: subsystem table + repo-doc links |
| `Architecture-Overview.md` | `ARCHITECTURE.md`, `docs/architecture.html`, `.agents/docs/` |
| `Database-ER-Diagram.md` | `prisma/schema.prisma` (erDiagram + model ref + clusters) |
| `Daily-Recommendations-Engine.md` | `.agents/docs/daily-recommendations-engine.md` |
| `Tasks-Cron-Workers.md` | `.agents/docs/tasks-cron-workers.md` |
| `Monitoring-And-Logging.md` | `.agents/docs/monitoring-and-logging.md` |
| `Alerts-System.md` | `.agents/docs/alerts-system.md` |

Adaptation rules:
- Repo file refs stay inline code (`lib/...`)
- Cross-doc links → `[[Page Name]]`
- Add `## Sources` footer pointing to single source of truth

### 4. GitHub Mermaid Rules (critical)
Quote labels with `| + ( ) <br/> → · @ % & && <=`:
- `AI[AI Agent (OpenRouter)<br/>circuit breaker + fallback]` → `AI["AI Agent (OpenRouter)<br/>circuit breaker + fallback"]`
- `E3[action: none|buy|sell|paper_trade]` → `E3["action: none|buy|sell|paper_trade"]`
- erDiagram attributes (`int id PK`) never quoted; relation labels quoted

### 5. Publish
```bash
git add -A
git commit -m "Wiki: <summary>"
git push origin master
```

### 6. Verify
Browser: open `https://github.com/luckyhegde6/TradeNext/wiki` — sidebar pages render, no mermaid "Parse error" boxes, internal links work.

## Checklist

- [ ] Clone succeeded (or lazy-creation handled)
- [ ] Content adapted from source of truth
- [ ] Mermaid labels quoted per GitHub rules
- [ ] Committed + pushed to `master`
- [ ] Browser-verified: pages render, mermaid ok
