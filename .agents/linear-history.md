# Git Flow & Branching Strategy — TradeNext

> Adapted from gardenify's PR-only workflow. TradeNext enforces a **strict branch + PR policy**: never commit directly to `main` without explicit user permission. Features, fixes, and docs of any size go on a branch first.

## 1. Branch Naming Convention

Use these prefixes (matching TradeNext's existing history):

```
fix/         # Bug fixes          → e.g. fix/db-query-optimization
feat/        # New features       → e.g. feat/telegram-bot
chore/       # Maintenance, deps  → e.g. chore/update-sdk
docs/        # Documentation      → e.g. docs/update-changelog
ph<N>        # Phase work         → e.g. ph19 (larger feature series)
```

### Rules
```
□ NEVER commit to main directly — feature/fix/docs branches ALWAYS, even solo
□ Direct main commits ONLY with explicit user permission (e.g. trivial docs on request)
□ Branch + PR: main ← your-branch, squash-merge on green CI + review
□ NEVER use force-push to main
□ Keep history linear — rebase feature branches onto latest main
```

## 2. Commit Message Convention

```
type(scope): brief description

- Detail 1
- Detail 2

Refs: #issue-number (if applicable)
```

| Type | When | Example |
|------|------|---------|
| `feat` | New feature | `feat(ai): add AI monitoring persistence` |
| `fix` | Bug fix | `fix(recs): transaction timeout in daily run` |
| `chore` | Maintenance | `chore(deps): update prisma` |
| `docs` | Documentation | `docs(readme): add API examples` |
| `style` | Formatting | `style(ui): fix imports` |
| `refactor` | Restructure | `refactor(db): extract queries` |
| `test` | Add tests | `test(recs): add cap test` |
| `perf` | Performance | `perf(cache): add cleanup` |
| `ci` | CI/CD | `ci: add release workflow` |
| `security` | Security fix | `security: fix path traversal` |

Scopes used in TradeNext: `api`, `ui`, `db`, `worker`, `telegram`, `ai`, `docs`, `deps`.

## 3. Enforced Git Hooks (versioned in `.githooks/`)

TradeNext ships versioned hooks in `.githooks/` (gardenify pattern). Enable on fresh clone:

```bash
git config core.hooksPath .githooks
```

| Hook | Behavior |
|------|----------|
| `.githooks/pre-commit` | WARN on main/master; BLOCK hardcoded secrets + staged `.env`; WARN console.log, junk artifacts, tsc errors |
| `.githooks/post-commit` | Logs checkpoint to `.agents/handoffs/checkpoint.log` (gitignored) |
| `.githooks/pre-push` | WARN when pushing to main/master |

Never bypass with `git commit --no-verify` unless intentional. Secrets stay only on gitignored files (`.env*`).

## 4. Standard Workflow

### Small fix / doc update (solo path — branch + PR)
```bash
git checkout main && git pull origin main
git checkout -b fix/small-fix        # docs/ for doc-only changes
# make changes
git add -A
git commit -m "fix(scope): description"
git push origin fix/small-fix
# Create PR: main ← fix/small-fix; squash-merge after CI green
git checkout main && git pull origin main
git branch -d fix/small-fix
```

### Feature (branch + PR path)
```bash
git checkout main && git pull origin main
git checkout -b fix/my-feature
# implement + test (npm run test, npx tsc --noEmit)
git add -A && git commit -m "fix(scope): description"
git push origin fix/my-feature
# Create PR: main ← fix/my-feature
# Get CI green + review, squash-merge
git checkout main && git pull origin main
git branch -d fix/my-feature
```

## 5. Pre-Push Checklist

```
Before pushing ANY branch:
  [ ] npm run test          (Jest — all pass)
  [ ] npx tsc --noEmit -p tsconfig.json  (production files clean)
  [ ] Commit messages follow convention
  [ ] No secrets or keys staged
  [ ] Branch is rebased on latest main (if behind)
  [ ] Documentation updated (AGENTS.md, TODO.md, Primer.md per pre-commit-workflow.md)
```
