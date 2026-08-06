# Session Archives

Completed sessions are archived here as `YYYY-MM-DD-<commit-hash>.md`.

## Format

```markdown
# Session YYYY-MM-DD — <short title>

## Date
2026-08-06

## Commit
<full commit hash>

## Work Completed
- <item>

## Todos Carried Forward
- <item>

## Issues / Bugs Logged
- <item>
```

## Rules

1. Archive a session when all todos are resolved or explicitly carried forward.
2. Filename: `YYYY-MM-DD-<first-8-chars-of-commit-hash>.md`
3. Remove the archived todos from `.agents/session-todos.md` after archiving.
4. Never delete an archive — they are the session history.

## Existing Archives

- 2026-08-06 — see `git log --oneline` for ph19 commit hashes (code commit `8bcc72a`; docs commit for the gardenify port follows).

> Note: the 2026-08-06 ph19 session has two commits — `8bcc72a` (v3.4.1 prod reliability code) and the pending v3.4.2 commit (git hooks + gardenify docs port). Archive when the session fully closes.
