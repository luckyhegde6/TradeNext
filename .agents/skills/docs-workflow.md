# Documentation Workflow Skill

Workflow for TradeNext documentation: feature plan files, GitHub wiki pages, and mandatory repo doc updates (AGENTS.md, CHANGELOG, TODO, Primer, Lessons, swagger/API docs).

> **Golden rule (from `.agents/documentation-standards.md`): if documentation is not updated, the task is NOT complete.**

### Skill map — focused companions

This skill is the umbrella. For deep work, load the focused skill:

| Task | Focused skill (`.opencode/skills/<name>/` + `.agents/skills/<name>.md`) |
|------|------|
| Apply repo doc updates after a change | `docs-updater` |
| Publish/maintain wiki pages | `wiki-creator` |
| Hunt/verify bugs before/after a change | `bug-finder` |
| Audit/enhance UI/UX before/after a change | `ux-enhancer` |

Agent/command mappings live in `.agents/AGENT-SKILL-MATRIX.md` (agents: doc-writer, wiki-publisher, bug-hunter, ux-designer).

## 1. Feature Plan Files

Location: `docs/designDoc/ph<NN>-<feature>-design.md` (e.g. `ph20-recommendation-performance-design.md`).

Write before coding (or before commit) for non-trivial features: new models, API routes, background jobs, state machines, multi-file UI.

### Required structure
```
# <Feature Title> (vX.Y.Z)
> Executive summary: what, why, key lifecycle.

## 1. Overview          — goals, what exists, what changes
## 2. Lifecycle & State Machine — stateDiagram-v2 mermaid, statuses table
## 3. End-to-End Flow   — flowchart TD mermaid, numbered steps
## 4. Data Model        — erDiagram mermaid (new/changed models + relations)
## 5. API Surface       — routes table: method, path, auth, purpose
## 6. UI/UX             — pages/components, states (loading/empty/error), responsive
## 7. Implementation Checklist — checkboxes mapped to files
## 8. Testing           — test files, key cases
## 9. Rollout & Rollback — deploy steps, migration safety, revert plan
```

### Mermaid rules (repo + wiki safe)
- `<br/>` inside labels → **always quote whole label**: `A["text<br/>more"]`
- Labels with `| + ( ) → · @ % & && <=` MUST be double-quoted: `N["a + b"]`, edge `-->|"x && y"|`
- erDiagram: attributes `int id PK` never quoted; relation labels quoted `X ||--o{ Y : "rel"`
- Sequence diagrams: messages with `()` fine unquoted

## 2. GitHub Wiki Pages

Wiki repo: `git@github.com:luckyhegde6/TradeNext.wiki.git` (separate repo, `master`; lazy-created — must create first page via web UI before cloning).

### Pages
| Page | Source |
|------|--------|
| `Home.md` | index: subsystem table + repo-doc links |
| `Architecture-Overview.md` | `ARCHITECTURE.md`, `docs/architecture.html`, `.agents/docs/` |
| `Database-ER-Diagram.md` | `prisma/schema.prisma` (full erDiagram + model reference + clusters) |
| `Daily-Recommendations-Engine.md` | `.agents/docs/daily-recommendations-engine.md` |
| `Tasks-Cron-Workers.md` | `.agents/docs/tasks-cron-workers.md` |
| `Monitoring-And-Logging.md` | `.agents/docs/monitoring-and-logging.md` |
| `Alerts-System.md` | `.agents/docs/alerts-system.md` |

### Workflow
1. Clone: `git clone git@github.com:luckyhegde6/TradeNext.wiki.git <tmp>`
2. Adapt: repo file refs stay inline code; cross-doc links → `[[Page Name]]`
3. Add `## Sources` footer pointing to single source of truth
4. **GitHub renderer-safe mermaid** — quote all labels with specials (GitHub stricter than other renderers)
5. `git add -A && git commit -m "Wiki: <summary>" && git push origin master`
6. Verify: open `https://github.com/luckyhegde6/TradeNext/wiki` — sidebar pages + mermaid renders (no "Parse error" box)

Page file `Architecture-Overview.md` → `/wiki/Architecture-Overview`.

## 3. Repo Documentation Updates (MANDATORY)

After every implementation, before commit. Run `git status` + `git diff` first.

| File | When | What to add |
|------|------|-------------|
| `AGENTS.md` | Every change | Version table row (Ver, Date, Summary) + bullets; Commands/Key Libraries if changed |
| `.agents/CHANGELOG.md` | Every change | Index row → detail in `.agents/changelog/versions-v3.md` (Files Created/Modified + root cause) |
| `TODO.md` | Feature/bug | Mark done; add rows; update Quick Reference |
| `README.md` | User-facing | Feature bullets, credentials, commands, tested table |
| `Primer.md` | Session | Current Project Status + Session History |
| `agent-memory.md` | Session/commit | Activity log entry |
| `Lessons.md` | New gotcha | Root cause + fix |
| `HANDOFF.md` | Session | Orchestration state |
| `.agents/session-todos.md` | Every commit | Done / carry-forward |
| `.agents/sessions/YYYY-MM-DD-<hash>.md` | Session end | Archived todos |
| Swagger/OpenAPI | New/changed route | `app/api/openapi/route.ts` — update schema + summary |

### Swagger specifics
- Every route: summary, request body schema, response schema, admin-marked-secure
- After changing route query params (e.g. zod enum), update OpenAPI schema to match

### AGENTS.md version entry template
```markdown
| **vX.Y.Z** | <Date> | <Title> — <one-line> |
```
Then bullets: changes, Files Created/Modified, root cause (bugs) or feature description.

### Pre-commit docs gate
Run `/pre-commit-check` → verify AGENTS/TODO/Primer/agent-memory/Lessons/session-todos current, README if user-facing. Delete junk: `dev-server.log`, root `*.yaml`, `screenshot-*.png`.

## Checklist

- [ ] Feature plan in `docs/designDoc/ph<NN>-*.md` (non-trivial features)
- [ ] Wiki pages pushed + verified rendering
- [ ] AGENTS.md version table + bullets
- [ ] `.agents/CHANGELOG.md` + detail subfile
- [ ] TODO.md updated
- [ ] Primer.md + agent-memory.md updated
- [ ] Lessons.md updated if new discovery
- [ ] Swagger/OpenAPI updated if API changed
- [ ] Junk artifacts deleted; `git status` reviewed
