---
name: docs-updater
description: Mandatory repo documentation update workflow - update AGENTS.md version table, CHANGELOG, TODO, Primer, Lessons, agent-memory, HANDOFF, session-todos, swagger/OpenAPI after every implementation before commit
metadata:
  audience: agents
  workflow: documentation
---

# Docs Updater Skill

Updates TradeNext's tracked documentation after every implementation. **If docs are not updated, the task is NOT complete** (`.agents/documentation-standards.md`).

## When to run

- After **any** code change, before commit.
- After API route changes (swagger), schema changes (AGENTS/CHANGELOG), bug fixes (Lessons), sessions (Primer/agent-memory/HANDOFF).

## Step-by-step

1. `git status` + `git diff --stat` — know what changed.
2. Apply updates per table below.
3. Delete junk artifacts (`dev-server.log`, root `*.yaml`, `screenshot-*.png`).
4. Run `/pre-commit-check` to verify.

## Update matrix

| File | When | What to add |
|------|------|-------------|
| `@AGENTS.md` | Every change | Version table row (Ver, Date, Summary) + bullets; Commands/Key Libraries if changed |
| `.agents/CHANGELOG.md` | Every change | Index row → detail bullet in per-minor file `.agents/changelog/versions-v3.<minor>.md` (Files Created/Modified + root cause) |
| `@TODO.md` | Feature/bug | Mark done; add rows; update Quick Reference |
| `@README.md` | User-facing | Feature bullets, credentials, commands, tested table; keep **Documentation** + **Agentic Coding** sections in sync |
| `@Primer.md` | Session | Current Project Status + Session History |
| `@agent-memory.md` | Session/commit | Activity log entry |
| `@Lessons.md` | New gotcha | Root cause + fix |
| `@HANDOFF.md` | Session | Orchestration state |
| `.agents/session-todos.md` | Every commit | Done / carry-forward |
| `.agents/sessions/YYYY-MM-DD-<hash>.md` | Session end | Archived todos |
| Swagger/OpenAPI | New/changed route | `app/api/openapi/route.ts` — schema + summary match the route |

## AGENTS.md version entry template

```markdown
| **vX.Y.Z** | <Date> | <Title> — <one-line> |
```
Then bullets: changes, Files Created/Modified, root cause (bugs) or feature description.

## Swagger specifics

- Every route needs: summary, request body schema, response schema, admin-marked-secure.
- When a route's zod query params change (e.g. enum widened), update the OpenAPI schema to match — mismatches break client docs.

## Anti-patterns

- Never leave stale version numbers in AGENTS.md.
- Never skip @Lessons.md when a bug was found (root cause + fix must be recorded).
- Never commit without updating `.agents/session-todos.md`.
