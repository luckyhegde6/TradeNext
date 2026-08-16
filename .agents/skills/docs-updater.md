# Docs Updater Skill

Updates TradeNext's tracked documentation after every implementation. **If docs are not updated, the task is NOT complete** (`.agents/documentation-standards.md`).

## Update matrix

| File | When | What to add |
|------|------|-------------|
| `AGENTS.md` | Every change | Version table row (Ver, Date, Summary) + bullets; Commands/Key Libraries if changed |
| `.agents/CHANGELOG.md` | Every change | Index row → detail in per-minor file `.agents/changelog/versions-vX.Y.md` — e.g. `versions-v3.13.md`; `versions-v3.md`/`versions-v2.md`/`versions-v1.md` are per-minor indexes (Files Created/Modified + root cause) |
| `TODO.md` | Feature/bug | Mark done; add rows; update Quick Reference |
| `README.md` | User-facing | Feature bullets, credentials, commands, tested table |
| `Primer.md` | Session | Current Project Status + Session History |
| `agent-memory.md` | Session/commit | Activity log entry |
| `Lessons.md` | New gotcha | Root cause + fix |
| `HANDOFF.md` | Session | Orchestration state |
| `.agents/session-todos.md` | Every commit | Done / carry-forward |
| `.agents/sessions/YYYY-MM-DD-<hash>.md` | Session end | Archived todos |
| Swagger/OpenAPI | New/changed route | `app/api/openapi/route.ts` — schema + summary match the route |

## Process

1. `git status` + `git diff --stat` — know what changed.
2. Apply updates per matrix.
3. Delete junk artifacts (`dev-server.log`, root `*.yaml`, `screenshot-*.png`).
4. Run `/pre-commit-check` to verify.

## AGENTS.md version entry template

```markdown
| **vX.Y.Z** | <Date> | <Title> — <one-line> |
```
Then bullets: changes, Files Created/Modified, root cause (bugs) or feature description.

## Swagger specifics

- Every route needs: summary, request body schema, response schema, admin-marked-secure.
- When a route's zod query params change (e.g. enum widened), update OpenAPI schema to match.

## Anti-patterns

- Never leave stale version numbers.
- Never skip Lessons.md when a bug was found.
- Never commit without updating `.agents/session-todos.md`.

Source: `.opencode/skills/docs-updater/SKILL.md`
