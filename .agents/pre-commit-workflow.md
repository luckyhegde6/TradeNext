# Pre-Commit Workflow

> Run this checklist BEFORE every commit.
> The `.githooks/pre-commit` hook (enabled via `git config core.hooksPath .githooks`) automates the SECURITY + CODE QUALITY + GIT sections. Keep this file as the human-readable source of truth.

## Session Todo File (MANDATORY)

Always maintain `.agents/session-todos.md` from session start until the final commit:

1. **At session start**: copy the checklist + any carried-forward todos into the file.
2. **Before every commit**: review all todos — mark completed/cancelled; carry unfulfilled ones forward as "next session" todos.
3. **During commit check**: if an unfulfilled todo is a confirmed bug, add it to `BUGS.md`.
4. **Never drop a todo silently** — carry it forward or log it.

## Pre-Commit Checklist

```
□ SECURITY
  □ No hardcoded secrets (grep for password, secret, apiKey, token)
  □ .env* files are gitignored (never commit real credentials)
  □ Netlify secrets scan: new files with demo creds added to SECRETS_SCAN_OMIT_PATHS
  □ No PII or secrets in log output
  □ Auth/admin routes protected (auth() + role check)

□ CODE QUALITY
  □ TypeScript: npx tsc --noEmit -p tsconfig.json (zero errors)
  □ ESLint: npm run lint
  □ No console.log in production code (use pino logger from @/lib/logger)
  □ No `any` types — use `unknown` + narrowing
  □ No Prisma calls in client components
  □ No business logic in UI (services in lib/services)

□ TESTING
  □ npm run test passes (190+ tests)
  □ No test files modified unless intentionally adding/updating tests
  □ New code has tests (jest in lib/__tests__/)

□ DOCUMENTATION (MANDATORY — task is NOT complete without it)
  □ AGENTS.md version history updated (date + what changed + files)
  □ TODO.md Quick Reference updated
  □ Primer.md Current Project Status + Session History updated
  □ agent-memory.md activity log updated
  □ Lessons.md updated if new discovery/lesson
  □ HANDOFF.md orchestration state updated
  □ .agents/session-todos.md checked — all done/carried-forward; unfulfilled bugs → BUGS.md

□ GIT
  □ Commit message follows conventional format
  □ One logical change per commit
  □ No junk artifacts staged (playwright snapshots, dev-server.log, screenshots)
  □ git status reviewed — all staged files intended

□ PRODUCT
  □ Feature solves a real user problem
  □ Error states handled (loading/empty/error)
  □ Responsive layout (375px+)
  □ UI/UX tested with Playwright if UI changed
```

## Commit Message Format

```
type(scope): brief description

- Detail 1
- Detail 2

Refs: #issue-number (if applicable)
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, no code change
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Build process, dependencies
- `perf`: Performance improvement
- `ci`: CI/CD changes
- `security`: Security fix

### Scopes

- `api`: Backend API
- `ui`: Frontend components
- `db`: Prisma schema/migrations
- `worker`: Worker engine / cron jobs
- `telegram`: Telegram bot
- `ai`: AI agent layer
- `docs`: Documentation
- `deps`: Dependencies

## Quick Commands

```bash
# Enable versioned hooks (one-time per clone)
git config core.hooksPath .githooks

# Run all checks
npx tsc --noEmit -p tsconfig.json   # TypeScript type check
npm run lint                        # ESLint
npm run test                        # Jest
git status                          # Review staged files
```

## References

- `.agents/linear-history.md` — branch naming, commit message convention, pre-push checklist
- `.agents/code-hygiene.md` — ponytail minimal-code rules, file/function limits, imports, comments
- `.agents/documentation-standards.md` — doc set table + mandatory update rules
- `.agents/security-checklist.md` — deep security gate (secrets scan, auth, RLS patterns)

## Cleanup & Code Hygiene (Pre-Commit)

- [ ] `git status` — review ALL untracked and modified files
- [ ] Delete junk artifacts: Playwright snapshots (`*.yaml` at root), screenshots, temp logs
- [ ] Verify `.gitignore` covers new artifact patterns (add if missing)
- [ ] Check no secrets/tokens/passwords in the diff
- [ ] Ensure no dead code, commented-out code, or debug `console.log` statements
- [ ] Review diff size — if unexpectedly large, investigate each file
