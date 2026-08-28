# Playwright Debug Skill

TradeNext's developer debug toolkit for diagnosing and fixing failing/flaky
Playwright tests fast. All tooling ships with the installed `@playwright/test` —
no new dependency. Full deep-dive: `.agents/docs/playwright-debug.md`.

## Tools

| Tool | Command | Use when |
|------|---------|----------|
| Inspector | `npx playwright test --debug <spec>` | watch + step line-by-line, evaluate JS, breakpoints |
| UI Mode | `npm run test:e2e:ui` (`npx playwright test --ui`) | flaky/CI-only failures — watch + re-run + step live |
| Codegen | `npx playwright codegen <url>` | generate a test/locator, Pick Locator, assertions, emulation |
| Trace Viewer | `npx playwright show-trace <zip>` | full run recording: DOM snapshot, network, console, errors |
| HTML report | `npx playwright show-report` | all results, filter by browser/status, trace entry point |

## Quick picks

- **Failing test** → Trace first (`show-report` → trace icon), then UI Mode /
  `--debug` if the trace is ambiguous.
- **Ambiguous/weak locator** (`"resolved to N elements"`) → Codegen Pick Locator /
  locator playground, prefer **role/text** over raw CSS (Tailwind reshuffles).
- **New test** → Codegen record + assertion toolbar (visibility/text/value).
- **Context-dependent flow** → Codegen emulation: `--device`, `--viewport-size`,
  `--color-scheme`, `--geolocation`, `--timezone`, and
  `--load-storage=playwright/.auth/demo.json` to reuse the saved demo session.
- **CI flake that passes locally** → `trace: 'on-first-retry'` only records on the
  first retry of a failed test — use UI Mode or `--trace on` locally to capture it.

## Playwright config facts (TradeNext)

`reporter: 'html'` · `trace: 'on-first-retry'` · `screenshot: 'only-on-failure'` ·
`retries: CI ? 2 : 1` · `workers: CI ? 1 : 2` · `timeout: 60_000` · 5 projects
(setup, chromium, firefox, webkit, chromium-logged-out, Mobile Chrome).

## Rules

- Never assert live NSE values (prices/marquee/indices) — assert containers.
- Close browsers + delete stray root `*.yaml`; kill only servers you started
  (never :4096).
- Dev server `:3000` (`npm run local`); demo `demo@tradenext6.app` / `demo123`.

## Related

- `.opencode/skills/playwright-e2e/SKILL.md` — run/author the committed `e2e/` suite.
- `.opencode/skills/playwright-cli/SKILL.md` — ad-hoc CLI browser automation.
- MCP `playwright` / `chrome-devtools` — agentic exploratory + perf audits.

Source: `.opencode/skills/playwright-debug/SKILL.md`
