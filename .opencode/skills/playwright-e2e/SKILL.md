---
name: playwright-e2e
description: TradeNext Playwright E2E suite — run, debug, and author specs against the local dev server (npm run test:e2e). Use after UI/UX changes, before merge/PR, and whenever a regression guard is needed (e.g. screener templates, nav, auth flows). Covers cross-browser (Chromium/Firefox/WebKit) + mobile, report/trace diagnostics, and the dev-server-load flakiness playbook.
allowed-tools: Bash(npx playwright test:*), Bash(npx playwright show-*), Read, Grep
---

# Playwright E2E Suite (TradeNext)

Suite of cross-browser integration tests in `e2e/`, run against the **local dev server**
(`http://localhost:3000`) with **live NSE/TradingView data**. Complements Jest unit
tests; guards UI/regression contracts (v3.5.2 screener fix, nav, auth flows, mobile).

**Full deep-dive**: `.agents/docs/playwright-e2e.md` (read first).

## When to use

- After any UI/UX change (components, pages, header/nav, layouts) — mandatory gate.
- Changes to auth, portfolio, watchlist, alerts, profile, screener flows.
- Before merge/PR — confirm full suite green.

## Commands

```bash
npm run test:e2e                  # full suite (all projects)
npm run test:e2e:ui               # Playwright UI mode — `npx playwright test --ui` (watch/filter/step/re-run)
npx playwright test --headed      # run in a visible browser window (watch Playwright drive the site)
npx playwright test e2e/<spec>.ts --project=chromium     # one file, one browser
npx playwright test e2e/advanced-screener.spec.ts --grep "empty"   # one test
npx playwright show-report        # open last HTML report
npx playwright show-trace test-results/<dir>/trace.zip    # view a trace
```

Credentials (env-overridable): demo `demo@tradenext6.app`/`demo123`
(`E2E_DEMO_EMAIL`/`E2E_DEMO_PASSWORD`); admin `admin@tradenext6.app`/`admin123`.

## Workflow

1. Check dev server on :3000 (`netstat -ano | findstr :3000`). If missing, ask
   permission, `npm run dev`. **Never kill a server you didn't start; never touch
   :4096.**
2. Run the targeted spec first (fast feedback).
3. Failure → read `test-results/<Test-Slug>/error-context.md` (snapshot + call log),
   then screenshot, then trace. Fix the test only if the app is correct — these specs
   encode real behavior; loosening a regression guard needs justification.
4. Full run: `npm run test:e2e -- --reporter=line`. `flaky` (retried-then-passed)
   under full load is expected; the same test failing twice = real bug.
5. **Debugging an error/issue?** Start `npm run test:e2e:ui` (`npx playwright test --ui`)
   and use the interactive UI to **visually verify** the fix, reproduce the flow, step
   through specs, and test edge cases — this is also the way to **enhance the user
   experience** (states, responsiveness, dark mode) before committing. For a one-off
   visual check of a single spec, `npx playwright test e2e/<spec>.ts --headed` runs it
   in a visible browser. After any run, `npx playwright show-report` opens the HTML
   report (results, traces, console + network, per-step screenshots) to diagnose why a
   spec failed.

## Authoring rules

- Copy structure of an existing spec; role-based locators
  (`getByRole('link'|'button'|'heading'|'combobox')`, `getByPlaceholder`).
- Handle every state: loading / empty / error / data via OR-matchers
  (`getByText(/Total Value|Create Portfolio/i)`).
- Explicit `{ timeout: 30_000–120_000 }` on the decisive SSR-heavy assertion; leave
  defaults for fast chrome.
- **Never assert live NSE values** (prices/marquee/indices) — assert containers/rows
  or the specific contract under test.
- No `test.only`, no `waitForTimeout` sleeps.

## Browser quirks (do not regress)

- **Firefox nav**: desktop viewport must be 1440×900 (`hidden xl:flex` needs ≥1280px;
  Firefox measures scrollbar-inclusive → 1280×720 fails).
- **WebKit nav flakiness**: `navigation.spec.ts` is serial + `noWaitAfter` +
  `waitForURL` (URL commit, not load) + 60s timeouts — dev server is single-threaded.
- **WebKit number inputs**: never `fill()` a controlled `<input type="number">` —
  click → `ControlOrMeta+a` → `Delete` → `pressSequentially(...)` + `toHaveValue`.
- **Live marquee**: `MarqueeBanner` renders `null` when NSE marquee is slow — never
  assert it in e2e.
- `retries: CI ? 2 : 1`, `workers: CI ? 1 : 2` — dev-server-load knobs, not
  failure-hiders.

## Related

- `.opencode/skills/playwright-cli/SKILL.md` — interactive CLI browser automation.
- MCP `playwright` / `chrome-devtools` (`.opencode/opencode.json`) — agentic
  exploratory testing and performance/Lighthouse audits.
- `.agents/skills/playwright-cli/AGENT-TESTING-GUIDE.md` — UI-testing checklist.
