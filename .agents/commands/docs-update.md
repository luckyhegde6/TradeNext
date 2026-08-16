# Docs Update Command

> Apply mandatory repo documentation updates after an implementation. If docs are not updated, the task is NOT complete.

## Usage

```
/docs-update [scope]
```

### Parameters

| Parameter | Required | Description | Values |
|-----------|----------|-------------|--------|
| `scope` | - | What to update | `all` (default), `quick`, `check` |

### Examples

```
/docs-update           # Full update: @AGENTS.md, CHANGELOG, @TODO, @Primer, @Lessons, swagger
/docs-update check     # Dry-run: list what needs updating, no edits
/docs-update quick     # Minimal: @AGENTS.md + CHANGELOG + session-todos only
```

## Workflow

### 1. Know What Changed
```bash
git status
git diff --stat
```

### 2. Apply Updates (per docs-updater skill matrix)
| File | Update |
|------|--------|
| `@AGENTS.md` | Version row (Ver, Date, Summary) + bullets; Commands/Key Libraries if changed |
| `.agents/CHANGELOG.md` | Index row → per-minor detail: `.agents/changelog/versions-v3.<minor>.md` (Files + root cause) |
| `@TODO.md` | Check off done items; add rows |
| `@README.md` | User-facing features/credentials; keep **Documentation** + **Agentic Coding** sections in sync |
| `@Primer.md` | Project status + session history |
| `@agent-memory.md` | Activity log entry |
| `@Lessons.md` | New gotcha → root cause + fix |
| `@HANDOFF.md` | Orchestration state |
| `.agents/session-todos.md` | Done / carry-forward |
| Swagger/OpenAPI | Route schema + summary match zod |

### 3. AGENTS.md Version Entry
```markdown
| **vX.Y.Z** | <Date> | <Title> — <one-line> |
```
Then bullets: changes, Files Created/Modified, root cause (bugs) or feature description.

### 4. Cleanup + Gate
- Delete junk: `dev-server.log`, root `*.yaml`, `screenshot-*.png`
- Run `/pre-commit-check` → verify @AGENTS/@TODO/@Primer/@agent-memory/@Lessons/session-todos current, @README if user-facing

## Checklist

- [ ] `git status` reviewed — know what changed
- [ ] @AGENTS.md version table + bullets updated
- [ ] `.agents/CHANGELOG.md` + detail subfile updated
- [ ] @TODO.md updated
- [ ] @Primer.md + @agent-memory.md updated
- [ ] @Lessons.md updated if new discovery
- [ ] Swagger/OpenAPI updated if API changed
- [ ] Junk artifacts deleted
