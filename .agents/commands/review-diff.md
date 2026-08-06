# Review Diff Command

> Analyze code changes for correctness, security, and style before commit or PR.

## Usage

```
/review-diff [scope] [check-type]
```

### Parameters

| Parameter | Required | Description | Values |
|-----------|----------|-------------|--------|
| `scope` | - | What diff to review | `staged` (default), `unstaged`, `branch`, `commit` |
| `check-type` | - | Type of review | `full` (default), `security`, `typescript`, `quick` |

### Examples

```
/review-diff staged               # Review staged changes (full review)
/review-diff branch security      # Review branch diff for security
/review-diff commit abc123 typescript  # Review specific commit
```

## Workflow

### 1. Get Diff
```bash
# Scope options
git diff                       # Unstaged
git diff --cached              # Staged (default)
git diff main...HEAD           # Branch
git show <commit> --stat       # Specific commit
```

### 2. Run Automated Checks
```bash
# Run in parallel
npx tsc --noEmit --skipLibCheck
npm run lint
npm run test -- --changedSince=main
```

### 3. Manual Review Checklist

#### TypeScript Check
- [ ] No `any` types introduced
- [ ] Explicit return types on exported functions
- [ ] Imports use path aliases (`@/`)
- [ ] No unused imports or variables
- [ ] Generic types used correctly
- [ ] `Promise<>` resolved with await

#### Security Check
- [ ] No secrets, API keys, passwords in code
- [ ] Input validation present (Zod)
- [ ] Auth checks on admin routes
- [ ] No `innerHTML` or dangerouslySetInnerHTML
- [ ] Path traversal prevention
- [ ] XSS prevention in React

#### Code Quality Check
- [ ] Error handling with logger context
- [ ] No `console.log` (use logger)
- [ ] Import order follows project rules
- [ ] No dead code or commented-out code
- [ ] Follows project patterns (caching, nseFetch, Prisma upsert)
- [ ] Function length reasonable

#### Architecture Check
- [ ] Prisma only in server code
- [ ] Business logic in lib/services
- [ ] API routes orchestrate, not implement
- [ ] No business logic in UI components

### 4. Output Report

```markdown
# Diff Review: [Branch/Commit]

## Summary
- **Files Changed**: X
- **Insertions**: +XX
- **Deletions**: -XX

## Automated Checks
- TypeScript: ✅ PASS / ❌ FAIL
- Lint: ✅ PASS / ❌ FAIL
- Tests: ✅ PASS / ❌ FAIL / ⏭️ Skipped

## Manual Review

### ✅ Approved
- [file.ts] Changes look good

### ⚠️ Warnings
- [file.ts:42] Consider using logger instead of console.log

### ❌ Issues
- [file.ts:88] No input validation on API route
  - **Fix**: Add Zod schema validation
  - **Severity**: Critical

## Verdict
✅ APPROVED / ❌ CHANGES REQUESTED / ⏸️ NEEDS DISCUSSION
```
