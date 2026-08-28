---
name: playwright-debug
description: Diagnose and fix failing Playwright tests fast using the official developer debug toolkit — Playwright Inspector (npx playwright test --debug), UI Mode (npx playwright test --ui), Codegen (npx playwright codegen), Trace Viewer (npx playwright show-trace), and the HTML report (npx playwright show-report). Use whenever a Playwright test fails, flakes, or you need to generate a test/locator, pick a stable selector, reproduce a browser bug, or step through a failing flow. Complements playwright-e2e (run the committed suite) and playwright-cli (ad-hoc MCP automation).
allowed-tools: Bash(npx playwright *), Bash(npm run test:e2e:*)
---

# Playwright Debug Toolkit (TradeNext)

Hardening Playwright for TradeNext: the developer tools that turn a failing/flaky
test into a root cause fast. All tooling ships with the already-installed
`@playwright/test` — **no new dependency required**. Dev server is `:3000`
(`npm run local`), credentials `demo@tradenext6.app` / `demo123`.

## When to use which tool (quick matrix)

| Problem | Tool |
|---------|------|
| Test fails — see exactly what the page looked like at each step | Trace Viewer (`show-trace`) + HTML report |
| Test fails — want to watch it run and pause/step line-by-line | Inspector (`--debug`) |
| Test fails/flakes in CI — reproduce locally, watch live | UI Mode (`npm run test:e2e:ui`) |
| Need a brand-new test or a stable locator fast | Codegen (`npx playwright codegen <url>`) |
| Prone-to-change / weak locator ("ambiguous" / "resolved to N elements") | Codegen Pick Locator / locator playground |
| Need assertions for a new flow | Codegen assertion toolbar (visibility/text/value) |
| Verify across device/viewport/theme/geo/timezone | Emulation (Codegen flags or config) |
| CI flake that passes locally | Trace `on-first-retry` + HTML report filter + `--debug` |

## 1. Playwright Inspector (`npx playwright test --debug`)

Pauses on every test step with the **Inspector** — watch the run and step through.

```bash
# Debug ONE test in ONE file (instrumented, attaches Inspector)
npx playwright test --debug e2e/login.spec.ts

# Use a grep filter to target a single test (no test.only)
npx playwright test --debug e2e/nav.spec.ts -g "mobile hamburger"
```

Inspector controls:
- **Steppers** at top: `Step over` — run the next action then pause again;
  `Step into` — go into the next action; `Step out` — resume until the test ends.
- **"Resume"** (play) — run to the next breakpoint / end; the run then completes.
- **Breakpoint**: click to the left of a line number inside a spec to toggle a
  breakpoint — the run pauses there instead of every step.
- **"Pause on open"** checkbox — default on; uncheck to run to the first
  breakpoint instead of every action.
- **Evaluate/call log**: Inspect the current page DOM, run JS against it, and see
  the action log of everything Playwright already did.

> Environment alternative: `PWDEBUG=1` (all of `@playwright/test`, incl. library
> scripts) or `PWDEBUG=console` (jumps straight to the browser console to run
> `page.` helper snippets) adds the Inspector drop-down to the browser.

TradeNext note: the dev server is single-threaded — during `--debug` nothing else
is scheduled. Prefer a **targeted spec + grep** over a full-suite debug run.

## 2. UI Mode (`npm run test:e2e:ui` → `npx playwright test --ui`)

The best tool for flaky or CI-only failures you can't see in Trace alone. Watches
and re-runs tests with a GUI.

```bash
npm run test:e2e:ui        # or: npx playwright test --ui
```

- **Left file list**: pick a spec. **Run / re-run** a single test, watch it live.
- **Filter/sort bar**: by browser (Chromium/Firefox/WebKit/Mobile), passed/failed/
  skipped/flaky, errors, and search by test title.
- **Action tab**: step through each action with appears/console/snapshot.
- **Locator tab**: see the live locator + full element tree (a mini explorer).
- **Source tab**: the spec source. **Console/Network/Errors tabs**: browser
  console, network requests, and error traces for the current run.
- **Timeline**: view per-action timing to spot slow steps.

UI Mode makes the Trace-driven diagnosis human — pair it with `--debug` to pause.

## 3. Codegen (`npx playwright codegen`)

Generates a real test file (and robust locators) by recording your clicks/typing —
no guess-and-check on selectors.

```bash
# Generate a test against the local app (log in yourself, it stays on this URL)
npx playwright codegen http://localhost:3000

# Codegen with the SAME state as the committed suite (already logged in)
npx playwright codegen http://localhost:3000 --load-storage=playwright/.auth/demo.json
```

While recording:
- **Every click/typo emits Playwright actions** (usually a `locator()` line with
  accessible role/text locators — the recommended kind). Live-copy them into the
  spec, or use the "Copy" picker for the immediate line.
- **Assertion toolbar**: pick an element then choose an assertion — e.g.
  visibility (`toBeVisible`), text content (`toHaveText`), value (`toHaveValue`).
  These are stable, high-signal assertions for loading/empty/error/data states.
- **Pick Locator** (target icon): click an element to get the best locator + a
  preview of how many elements it matches. Great for pruning ambiguous locators.
- **Locator playground**: test/refine a locator you typed (how many matches,
  live highlight) before committing it to the spec.
- Toolbar buttons (right side): copy the generated test (`Copy`), copy just a
  locator (`Copy locator`), open the locator playground, and toggle the
  **server/Pause** controls.

Emulation (Codegen flags) when the flow depends on context:
```bash
# Device emulation (e.g. mobile)
npx playwright codegen --device="Pixel 5" http://localhost:3000

# Viewport
npx playwright codegen --viewport-size="800,600" http://localhost:3000

# Color scheme (dark/light) for theme-dependent locators
npx playwright codegen --color-scheme=dark http://localhost:3000

# Geolocation, language, timezone
npx playwright codegen --geolocation="19.076,72.8777" --lang="hi-IN" --timezone="Asia/Kolkata" http://localhost:3000

# Authenticated state — reuse the saved demo session above (--load-storage)
```

TradeNext rule: prefer **role/text locators** Codegen emits over raw CSS — they
survive the frequent `Tailwind` class reshuffles. Add `E2E_DEMO_EMAIL` /
`E2E_DEMO_PASSWORD` env overrides if you record a login (don't hardcode).

## 4. Trace Viewer (`npx playwright show-trace`)

A full **recording** of a test run — every action, its DOM snapshot, network
requests, console messages, errors, and the page you can inspect.

Record traces:
```bash
# Record for a specific run (write a trace.zip you can inspect)
npx playwright test e2e/broken.spec.ts --project=chromium --trace on

# The committed config already records on first retry:
#   use: { trace: 'on-first-retry' }
```

View them:
```bash
npx playwright show-trace test-results/broken-spec-chromium/trace.zip
# Or open the HTML report and click the "trace" icon on a failed test
npx playwright show-report
```

Trace Viewer panels:
- **Actions sidebar** — the full action log; click any action to inspect its state.
- **DOM snapshot** — the exact page snapshot at that step (Action/Before/After).
  Usually where the fix becomes obvious ("the row never rendered", "the modal
  never opened").
- **Log / Source** — console logs + the spec source at that step.
- **Network** — every request (status, timing, response body) — spot the 4xx/5xx
  or slow NSE call that stalls the action.
- **Errors / Console** — the failing assertion + all console messages (incl. the
  React hydration/`error` warnings TradeNext checks for).
- **DevTools** (available in the trace) — inspect the live page as if DevTools
  were open.

> ⚠️ Config gotcha: `trace: 'on-first-retry'` records ONLY on the first retry of
> a **failed** test, not the first run. With `retries: process.env.CI ? 2 : 1`,
> a locally-passing test records nothing. To always capture locally, either use
> **UI Mode** (auto-records without config changes) or run with `--trace on`.

## 5. HTML Report (`npx playwright show-report`)

All results in a browsable HTML report (config `reporter: 'html'`).

```bash
npx playwright show-report        # open the latest report
```

- **Filters** (top bar): by **browser/project**, and status —
  passed / failed / **skipped** / **flaky** / errors.
- **Failed test detail**: full error stack, the failing assertion diff
  (expected vs actual DOM), screenshot, and **trace** icon → open the Trace.
- **Auto-open**: the report opens automatically in CI on failure; locally run
  `show-report` whenever you need it.
- Re-run from the report: "Re-run all / Re-run failed" in the summary header.

## TradeNext project facts (from `playwright.config.ts`)

- `reporter: 'html'`, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`.
- `retries: CI ? 2 : 1`, `workers: CI ? 1 : 2`, `timeout: 60_000`,
  `expect.timeout: 15_000` — generous for live NSE/TradingView scans.
- 5 projects: `setup` (auth), `chromium`/`firefox`/`webkit` (auth, 1440×900),
  `chromium-logged-out` (login only), `Mobile Chrome` (Pixel 5, responsive).
- Storage state saved to `playwright/.auth/demo.json` after `setup` — reuse it
  for Codegen (`--load-storage`) and matching the committed suite's auth.
- **Never assert live NSE values** (prices/marquee/indices) — assert containers
  or the contract under test.

## Debugging playbook (recommended flow)

1. **Get the failure** — run the targeted spec; or open the CI artifact / local
   report. Note browser + test title.
2. **Trace first** — `show-report` → trace icon, or `show-trace <dir>` — inspect
   the failing action's DOM snapshot + network + console. 80% of TradeNext bugs
   (a null field, a 400 from a mismatched zod enum, a slow NSE call) are visible
   in the trace alone.
3. **Reproduce live** if the trace is ambiguous — **UI Mode** running just that
   test, then `--debug` on the same spec to step and evaluate.
4. **Fix the locator or test** — Codegen / Pick Locator / locator playground for
   a stable role/text locator; avoid raw CSS that Tailwind reshuffles.
5. **Verify** — re-run the targeted spec locally, then the full suite /
   cross-browser before merge/PR.
6. **Cleanup** — close browsers; delete root `*.yaml` snapshots or
   `npx playwright` CLI artifacts (code hygiene); kill only servers you started
   (never :4096).

## Related skills & tooling

- **`.opencode/skills/playwright-e2e/SKILL.md`** — run/author the committed e2e
  suite (`e2e/`, `npm run test:e2e`), cross-browser + mobile matrix, deep-dive
  `.agents/docs/playwright-e2e.md`. Use it to RUN the suite; this skill is for
  DIAGNOSING/generating during development & verification.
- **`.opencode/skills/playwright-cli/SKILL.md`** — interactive CLI browser
  automation (`playwright-cli open/click/fill/...`) for ad-hoc exploratory checks
  not tied to the committed suite.
- **MCP `playwright`** (`@playwright/mcp`) — agentic browser automation (navigate/
  click/fill/snapshot/console) used by `e2e-agent`/`ux-designer`.
- **MCP `chrome-devtools`** — performance traces (Core Web Vitals), Lighthouse,
  network inspection, device emulation — complements Playwright for perf bugs.
- Deep-dive doc: `.agents/docs/playwright-debug.md`.
