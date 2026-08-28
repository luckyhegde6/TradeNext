# Playwright Debug Toolkit — Implementation & Agent Guide

> TradeNext subsystem deep-dive. Read before diagnosing a failing/flaky Playwright
> run, generating a test/locator, picking a stable selector, or stepping through a
> browser flow that fails.
>
> Companion skills: `.opencode/skills/playwright-debug/` (this toolkit),
> `.opencode/skills/playwright-e2e/` (run/author the committed e2e suite),
> `.opencode/skills/playwright-cli/` (interactive browser automation), MCP servers
> `playwright` (`@playwright/mcp`) and `chrome-devtools`.

## 1. Why a debug toolkit?

The committed e2e suite (`e2e/`) is the regression guard, but when a test **fails or
flakes**, or when an agent needs a **new test / stable locator**, the real leverage is
Playwright's developer tools — the Inspector, UI Mode, Codegen, Trace Viewer, and the
HTML report. All ship inside the installed `@playwright/test` (no new dependency).

| Tool | Command | What it does |
|------|---------|--------------|
| **Inspector** | `npx playwright test --debug <spec>` | Pauses on each step, step over/into, breakpoints, evaluate JS against the page |
| **UI Mode** | `npm run test:e2e:ui` (`npx playwright test --ui`) | Watch/re-run a test live, filter by browser/status, action + locator + source + console + network tabs, timeline |
| **Codegen** | `npx playwright codegen <url>` | Records clicks/typing into a real test, assertion toolbar, Pick Locator, locator playground, emulation |
| **Trace Viewer** | `npx playwright show-trace <zip>` | Full run recording — DOM snapshot per action, network, console, errors, DevTools |
| **HTML report** | `npx playwright show-report` | All results, filter by browser/status (passed/failed/skipped/flaky), trace entry point, auto-open on failure |

## 2. Recommended diagnosis flow

```
1. Get the failure        → run targeted spec, or open CI artifact / local report.
2. Trace first            → show-report → trace icon  OR  show-trace test-results/<dir>/trace.zip
                           (80% of TradeNext bugs are visible here: null field, 4xx from a
                            zod/sort mismatch, a slow NSE call stalling an action).
3. Reproduce live         → UI Mode running just that test; then --debug on the same
                           spec to step + evaluate + set breakpoints.
4. Fix locator/test       → Codegen / Pick Locator / locator playground for a stable
                           role/text locator (avoid raw CSS — Tailwind reshuffles classes).
5. Verify                 → re-run targeted spec, then full suite / cross-browser before merge/PR.
6. Cleanup                → close browsers; delete stray root *.yaml; kill only servers
                           you started (never :4096).
```

## 3. Tools in detail

### 3.1 Inspector (`--debug`)

```bash
npx playwright test --debug e2e/nav.spec.ts -g "mobile hamburger"   # grep to one test
```

- `Step over` / `Step into` / `Step out` steppers; `Resume` runs to next breakpoint.
- Toggle **breakpoints** on a line; `Pause on open` checkbox controls whether it stops
  on every action or only at breakpoints.
- **Evaluate** — run JS against the live page; see the action log of what ran.
- Env alternative: `PWDEBUG=1` / `PWDEBUG=console` adds the Inspector dropdown.

TradeNext note: the dev server is single-threaded — don't `--debug` a full suite; use
a targeted spec + `-g` filter.

### 3.2 UI Mode (`npm run test:e2e:ui`)

The first tool to reach for on a flaky or CI-only failure:

- Left file list → run/re-run a single test, watch live.
- Filter bar by browser (Chromium/Firefox/WebKit/Mobile) and status
  (passed/failed/skipped/flaky) + search.
- **Action**, **Locator** (live locator + element tree), **Source**, **Console**,
  **Network**, **Errors** tabs + per-action **Timeline**.

### 3.3 Codegen

```bash
npx playwright codegen http://localhost:3000 --load-storage=playwright/.auth/demo.json
```

- Records actions (emits `locator()` with accessible role/text locators — the
  recommended stable kind).
- **Assertion toolbar** — pick an element → `toBeVisible` / `toHaveText` /
  `toHaveValue` for loading/empty/error/data states.
- **Pick Locator** — click an element for the best locator + match count (prune
  ambiguous locators).
- **Locator playground** — refine a typed locator before committing it.
- Emulation flags: `--device="Pixel 5"`, `--viewport-size="800,600"`,
  `--color-scheme=dark`, `--geolocation="19.076,72.8777"`, `--timezone="Asia/Kolkata"`,
  `--load-storage=playwright/.auth/demo.json` (reuse saved demo session).

### 3.4 Trace Viewer (`show-trace`)

```bash
npx playwright show-trace test-results/broken-spec-chromium/trace.zip
```

- **Actions sidebar** + click any action to inspect its state.
- **DOM snapshot** (Action/Before/After) — usually where the fix becomes obvious.
- **Log / Source**, **Network** (status/timing/response — spot the 4xx/5xx or slow NSE
  call), **Errors / Console**, and **DevTools** for the live page.

> ⚠️ Config gotcha: `trace: 'on-first-retry'` records ONLY on the first retry of a
> **failed** test. With `retries: CI ? 2 : 1`, a locally-passing test records nothing.
> To always capture locally use **UI Mode** (auto-records) or run `--trace on`.

### 3.5 HTML report (`show-report`)

```bash
npx playwright show-report
```

- Filters by **browser/project** and status — passed / failed / **skipped** / **flaky** / errors.
- Failed-test detail: error stack, assertion diff (expected vs actual DOM),
  screenshot, and **trace** icon.
- "Re-run all / Re-run failed" in the summary header; report auto-opens in CI on failure.

## 4. TradeNext config facts (`playwright.config.ts`)

- `reporter: 'html'`, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`.
- `retries: CI ? 2 : 1`, `workers: CI ? 1 : 2`, `timeout: 60_000`,
  `expect.timeout: 15_000` — generous for live NSE/TradingView scans.
- 5 projects: `setup` (auth), `chromium`/`firefox`/`webkit` (auth, 1440×900),
  `chromium-logged-out` (login only), `Mobile Chrome` (Pixel 5, responsive).
- Storage state `playwright/.auth/demo.json` (gitignored) — reuse for Codegen.
- **Never assert live NSE values** (prices/marquee/indices) — assert containers.

## 5. Locator strategy (why role/text over CSS)

Tailwind reshuffles utility classes frequently; raw CSS locators break. Codegen's
default role/text locators (`getByRole('button', { name: 'Submit' })`) survive those
changes. Always prefer them, and use Pick Locator / locator playground to prune
ambiguous or multi-match selectors. Decisive assertions on heavy SSR pages get
explicit 30–120s timeouts (default 15s for chrome).

## 6. Wiring into agents

The skill is loaded by the agents that code and verify UI:

| Agent | How `playwright-debug` is used |
|-------|-------------------------------|
| **build** | UI/UX testing + debug step after UI changes |
| **qa** | diagnose failing/flaky e2e, generate stable locators |
| **e2e-agent** | reproduce + debug user-flow failures |
| **bug-hunter** | browser repro of a UI bug, network-tab root-cause |
| **ux-designer** | live verification + stable role/text locators |
| **code-reviewer** | validate a failing/flaky test has a real repro path |
| **tdd** | author first e2e draft via Codegen + debug failures |

## 7. Related docs

- `.agents/docs/playwright-e2e.md` — the committed suite (run/author process).
- `README.md` / `AGENTS.md` — commands (`npm run test:e2e:ui`,
  `npx playwright test --headed`, `show-report`, `show-trace`, `--debug`, `codegen`).
- MCP `chrome-devtools` — performance (Core Web Vitals), Lighthouse, network.
