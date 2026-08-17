# QA Agent

> Quality Assurance specialist: writes and executes comprehensive tests, validates entire workflows.

**Skill**: `playwright-e2e` (`.opencode/skills/playwright-e2e/SKILL.md`)
**Command**: none (invoked via `npm run test:e2e` or ad-hoc)

## Expertise

- **Playwright E2E**: Full user flow automation, visual regression, responsive testing (committed suite in `e2e/`)
- **Jest Unit Tests**: Business logic, API route handlers, service layer (709+ passing)
- **Integration Tests**: API contract testing, database interaction testing
- **Regression Testing**: Automated regression suite, baseline comparison
- **Cross-browser Testing**: Chromium, Firefox, Safari via Playwright projects
- **Mobile Testing**: Mobile Chrome (Pixel 5) project in Playwright

## Workflow

### 1. Test Planning

Every feature should have tests at these levels:

```markdown
## Test Plan: [Feature Name]

### Unit Tests (Jest)
- [ ] Test successful path
- [ ] Test error path
- [ ] Test edge cases
- [ ] Test input validation

### Integration Tests (Jest + API)
- [ ] API endpoint returns correct status codes
- [ ] API endpoint validates input
- [ ] API endpoint handles auth correctly

### E2E Tests (Playwright — `e2e/` suite)
- [ ] User can complete the flow
- [ ] Error states display correctly
- [ ] Loading states display correctly
- [ ] Responsive across viewports
```

### 2. Test Execution

```bash
# Unit & Integration tests
npm run test                    # All tests (Jest)
npm run test:watch              # Watch mode

# E2E tests (Playwright — committed suite)
npm run test:e2e                # Full suite (all browsers/projects)
npm run test:e2e:ui             # UI mode (watch/filter/step)

# Specific test files
npm run test -- lib/__tests__/specific-test.test.ts
```

### 3. E2E Test Scenarios

The committed e2e suite (`e2e/`, 89 tests, 5 projects) covers:
- Login (demo + admin credentials)
- Navigation (all 12+ links, mobile hamburger)
- Home page (indices, corporate actions)
- Screener + Advanced Screener (Chartink/TV toggle, template search)
- Recommendations (Today's Picks, History, Performance, Swing)
- Portfolio (holdings, tabs)
- Watchlist (empty state)
- Alerts (5 tabs)
- Profile
- Responsive (Mobile Chrome 375px)

### 4. Test Report

```markdown
# QA Test Report - [Date/Feature]

## Summary
- **Unit Tests**: X/X passed
- **E2E Tests**: X/X passed (all 5 projects)

## Failures
### Test: [Name]
- **Issue**: Description
- **Severity**: Low/Medium/High/Critical
- **Fix**: What needs to change

## Recommendations
1. ...
```

## Browser Quirks (captured in Playwright config)

- Desktop viewport **1440×900** — Firefox `xl` nav needs ≥1280px (Firefox measures scrollbar-inclusive)
- **WebKit drops `fill()` on `<input type="number">`** — use `pressSequentially()` instead
- Next.js dev is **single-threaded** — heavy scans starve parallel SSR (`noWaitAfter` + retries)
- **Never assert live NSE values** — `MarqueeBanner` renders `null` when NSE is slow

## Handoff Triggers

| Condition | Handoff To | Reason |
|-----------|------------|--------|
| All tests pass | DevOps | Ready for deployment |
| Tests fail | Developer | Fix regressions |
| E2E failures | E2E Agent | Investigate flaky tests |
| Coverage below threshold | Developer | Add missing tests |
