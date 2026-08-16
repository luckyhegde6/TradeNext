---
name: docs-workflow
description: TradeNext documentation workflow - create feature plan files, publish GitHub wiki pages, and keep all repo docs (AGENTS.md, CHANGELOG, TODO, Primer, Lessons, swagger/API docs) updated after every implementation
metadata:
  audience: agents
  workflow: documentation
---

# Documentation Workflow Skill (TradeNext)

Three responsibilities, all MANDATORY before a task is considered complete:

1. **Feature plan files** — create `docs/designDoc/ph<NN>-<feature>-design.md` before/while building a feature.
2. **Wiki pages** — publish subsystem/architecture docs to the GitHub wiki.
3. **Repo doc updates** — AGENTS.md, CHANGELOG, TODO, Primer, Lessons, agent-memory, HANDOFF, swagger.

> **Golden rule (from `.agents/documentation-standards.md`): if documentation is not updated, the task is NOT complete.**

### Skill map — focused companions

This skill is the umbrella. For deep work, load the focused skill:

| Task | Focused skill |
|------|---------------|
| Apply repo doc updates after a change | `docs-updater` (`.opencode/skills/docs-updater/`) |
| Publish/maintain wiki pages | `wiki-creator` (`.opencode/skills/wiki-creator/`) |
| Hunt/verify bugs before or after a change | `bug-finder` (`.opencode/skills/bug-finder/`) |
| Audit/enhance UI/UX before or after a change | `ux-enhancer` (`.opencode/skills/ux-enhancer/`) |

Agent/command mappings live in `.agents/AGENT-SKILL-MATRIX.md` (agents: doc-writer, wiki-publisher, bug-hunter, ux-designer).

---

## 1. Feature Plan Files

Location: `docs/designDoc/ph<NN>-<feature>-design.md` (e.g. `ph20-recommendation-performance-design.md`).

Write the plan **before** coding (or at least before commit) whenever the feature is non-trivial (new models, API routes, background jobs, state machines, multi-file UI work).

### Required structure
```
# <Feature Title> (vX.Y.Z)
> One-paragraph executive summary: what, why, key lifecycle.

## 1. Overview          — goals, what already exists, what changes
## 2. Lifecycle & State Machine — stateDiagram-v2 mermaid, statuses table
## 3. End-to-End Flow   — flowchart TD mermaid, numbered steps
## 4. Data Model        — erDiagram mermaid (new/changed Prisma models + relations)
## 5. API Surface       — routes table: method, path, auth, purpose
## 6. UI/UX             — pages/components, states (loading/empty/error), responsive
## 7. Implementation Checklist — actionable checkboxes mapped to files
## 8. Testing           — test files, key cases
## 9. Rollout & Rollback — deploy steps, migration safety, revert plan
```

### Mermaid rules (repo + wiki safe)
- Use `<br/>` inside node labels — **always quote the whole label**: `A["text<br/>more"]`.
- Labels with `| + ( ) → · @ % & && <=` MUST be double-quoted: `N["a + b"]`, edge `-->|"x && y"|`.
- erDiagram attribute lines: `int id PK` — never quote attributes; relation labels quoted: `X ||--o{ Y : "rel"`.
- Sequence diagrams: messages with `()` are fine unquoted.

### Lifecycle convention
Cross-reference the version in the plan header and mirror it in the AGENTS.md version table.

---

## 2. GitHub Wiki Pages

Wiki repo: `git@github.com:luckyhegde6/TradeNext.wiki.git` (separate repo; `master` branch; created lazily — must first create a page via the web UI, then clone).

### Page inventory
| Page file | Source | Notes |
|-----------|--------|-------|
| `Home.md` | — | Index: subsystem table + repo-doc links |
| `Architecture-Overview.md` | `ARCHITECTURE.md`, `docs/architecture.html`, `.agents/docs/` | Whole-system flowchart, data flows, caching, security, deployment, ER link |
| `Database-ER-Diagram.md` | `prisma/schema.prisma` | Full erDiagram (~75 models) + model reference table + relationship clusters |
| `Daily-Recommendations-Engine.md` | `.agents/docs/daily-recommendations-engine.md` | |
| `Tasks-Cron-Workers.md` | `.agents/docs/tasks-cron-workers.md` | |
| `Monitoring-And-Logging.md` | `.agents/docs/monitoring-and-logging.md` | |
| `Alerts-System.md` | `.agents/docs/alerts-system.md` | |

### Workflow
```
1. mkdir/enter local clone: C:\Users\lucky\AppData\Local\Temp\opencode\TradeNext.wiki
2. Copy/adapt content: repo file refs stay inline code (`lib/...`), cross-doc links → [[Page Name]]
3. Add "## Sources" footer pointing to the single source of truth (.agents/docs/... or prisma schema)
4. GitHub renderer-safe mermaid: quote ALL labels with specials (see §1 rules) — GitHub is stricter than other renderers
5. git add -A && git commit -m "Wiki: <summary>" && git push origin master
6. Verify: browser open https://github.com/luckyhegde6/TradeNext/wiki — check sidebar pages + mermaid renders (no "Parse error" box)
```

### Page-name → URL mapping
File `Architecture-Overview.md` → `/wiki/Architecture-Overview`. Internal links: `[Name](Page-Name)`. Wiki `[[Name]]` links also work.

---

## 3. Repo Documentation Updates (MANDATORY)

Apply after **every** implementation, before commit. Run `git status` + `git diff` first to know what changed.

| File | When | What to add |
|------|------|-------------|
| `@AGENTS.md` | Every change | Version table row (Ver, Date, Summary) + bullets; update Commands/Key Libraries if changed; `## Version History` entry |
| `.agents/CHANGELOG.md` | Every change | Index row → detail bullet in per-minor file `.agents/changelog/versions-v3.<minor>.md` (or v2/v1): Files Created/Modified + root cause/feature |
| `@TODO.md` | Feature/bug | Mark items done; add new rows; update Quick Reference status |
| `@README.md` | User-facing | Feature bullets, credentials, commands, tested-features table; keep **Documentation** + **Agentic Coding** sections in sync |
| `@Primer.md` | Session | Current Project Status + Session History |
| `@agent-memory.md` | Session/commit | Activity log entry |
| `@Lessons.md` | New gotcha | Root cause + fix lesson (e.g. mermaid quoting, runInChunks, zod enum width) |
| `@HANDOFF.md` | Session | Orchestration state |
| `.agents/session-todos.md` | Every commit | Done / carry-forward |
| `.agents/sessions/YYYY-MM-DD-<hash>.md` | Session end | Archived todos |
| Swagger/OpenAPI | New/changed API route | `app/api/openapi/route.ts` (or per-route docs) — update schema + summary |

### Swagger/OpenAPI specifics
- Every API route has a documented entry: summary, request body schema, response schema, admin-marked-secure.
- After changing a route's query params (e.g. adding a zod enum value), update the OpenAPI schema to match — mismatches break client docs.

### AGENTS.md version entry template
```markdown
| **vX.Y.Z** | <Date> | <Title> — <one-line> |
```
Then bullets under it: changes, Files Created/Modified, root cause (bugs) or feature description.

### Pre-commit docs gate
Run `/pre-commit-check` → verify: @AGENTS.md current, @TODO current, @Primer current, @agent-memory logged, @Lessons updated if new discovery, session-todos clean, @README if user-facing, no stale info. **Delete junk** (`dev-server.log`, `*.yaml` at root, `screenshot-*.png`).

---

## Checklist

- [ ] Feature plan created in `docs/designDoc/ph<NN>-*.md` (non-trivial features)
- [ ] Wiki pages pushed + verified rendering (if docs changed)
- [ ] @AGENTS.md version table + bullets updated
- [ ] `.agents/CHANGELOG.md` + detail subfile updated
- [ ] @TODO.md updated
- [ ] @Primer.md + @agent-memory.md updated
- [ ] @Lessons.md updated if new discovery
- [ ] Swagger/OpenAPI updated if API changed
- [ ] Junk artifacts deleted; `git status` reviewed
