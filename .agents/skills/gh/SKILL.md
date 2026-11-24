---
name: gh
description: GitHub CLI workflow — PR create/review conventions, push, gh skill updates when learning (learnings stored in PR template, docs, and other skills).
---

# gh — GitHub CLI Workflow

## Create PR (with the TradeNext PR template)

Use the user's conventions (see `.github/PULL_REQUEST_TEMPLATE.md`):

```
gh pr create --title <title> --body-file .pr-body.txt
```

Workflow:
1. Verify branch pushed: `git push -u origin <branch>`.
2. Check PR exists: `gh pr view --json url,title,state`.
3. If the body file approach fails (exit 1, empty output), try: `gh pr create --fill` or `gh pr create --web`, or create manually via the GitHub URL: `https://github.com/luckyhegde6/TradeNext/pull/new/<branch>`.
4. gh IS authenticated (verified `gh auth status` — token with `repo` scope, account luckyhegde6).
5. Body file must be created with the `write` tool (shell redirects to `.pr-body.txt` are unreliable — it's gitignored per `.gitignore`), deleted after.

When creating a PR, follow the template's sections (Review Ready / Diff Owner / Context Engineered / Impact).

## Learnings

When new gh learnings appear, append them to `.agents/skills/gh/references/learnings.md` and re-run the PR steps as needed.
