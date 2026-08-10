# Playwright E2E Skill

TradeNext's cross-browser e2e suite (`e2e/`) for UI/regression guards. Runs against the
local dev server (`http://localhost:3000`) with live NSE/TradingView data. Complements
Jest unit tests. Full deep-dive: `.agents/docs/playwright-e2e.md`.

## Commands

```bash
npm run test:e2e                  # full suite (all projects)
npm run test:e2e:ui               # Playwright UI mode
npx playwright test e2e/<spec>.ts --project=chromium     # targeted
npx playwright show-report        # HTML report
npx playwright show-trace test-results/<dir>/trace.zip   # trace
```

Credentials: demo `demo@tradenext6.app` / `demo123` (env-overridable
`E2E_DEMO_EMAIL`/`E2E_DEMO_PASSWORD`).

## Agent workflow

1. Verify dev server on :3000; start only if you must (ask permission); never kill
   servers you didn't start; never touch :4096.
2. Targeted spec first, then full suite before merge/PR.
3. Failure diagnosis: `error-context.md` snapshot → screenshot → trace.
4. Fix the test only if the app is correct — specs encode real behavior.

## Authoring rules

- Role-based locators; OR-matchers for loading/empty/error/data states.
- Decisive assertions get explicit 30–120s timeouts (heavy SSR); default 15s for chrome.
- Never assert live NSE values (prices/marquee/indices) — assert containers or the
  contract under test. No `test.only`, no sleeps.

## Browser quirks (don't regress)

- Desktop viewport **1440×900** (Firefox `xl` nav needs ≥1280px minus scrollbar).
- `navigation.spec.ts`: serial + `noWaitAfter` + `waitForURL` + 60s timeouts.
- WebKit: never `fill()` a controlled `<input type="number">` — use keystrokes +
  `toHaveValue`.
- Never assert the live marquee (renders `null` when NSE is slow).
- `retries: CI ? 2 : 1`, `workers: CI ? 1 : 2` — load knobs, not failure-hiders.

## Related

- `.opencode/skills/playwright-cli/SKILL.md` — interactive CLI browser automation.
- MCP `playwright` / `chrome-devtools` — agentic exploratory + performance audits.

Source: `.opencode/skills/playwright-e2e/SKILL.md`
