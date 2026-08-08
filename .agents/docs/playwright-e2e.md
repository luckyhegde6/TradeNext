# Playwright E2E Automation — Implementation & Agent Guide

> TradeNext subsystem deep-dive. Read before adding/modifying e2e tests, debugging a
> failing run, or wiring Playwright into agent workflows.
>
> Companion skills: `.opencode/skills/playwright-e2e/` (suite authoring/debugging),
> `.opencode/skills/playwright-cli/` (interactive browser automation), MCP servers
> `playwright` (`@playwright/mcp`) and `chrome-devtools` (agentic browser control).

## 1. Why an e2e suite?

Unit tests (Jest, `lib/__tests__/`) cover services, engines and helpers. They do **not**
verify that pages render, that the header nav actually navigates, that the demo user can
log in, or that a v3.5.2-style regression (TradingView `change` = % change on NSE) works
end-to-end against live data. The Playwright suite fills that gap:

- **Regression guards** for production fixes (e.g. "Short Term Breakouts" must return
  `> 0` stocks, not silently 0).
- **Cross-browser sanity** (Chromium, Firefox, WebKit) for the desktop app.
- **Authenticated flows** (portfolio, watchlist, alerts, profile) using the demo user.
- **Mobile responsive** checks (Pixel 5) for the hamburger nav.

The suite runs against the **local dev server** (`http://localhost:3000`) and hits
**live NSE/TradingView data** — it is an integration test, not a mocked one.

## 2. Architecture

```
e2e/
├── auth.setup.ts          # logs in as demo user once → playwright/.auth/demo.json
├── login.spec.ts          # chromium-logged-out project (no pre-auth) — sign-in form
├── home.spec.ts           # public dashboard chrome (hero, search, chart, quick cards)
├── navigation.spec.ts     # desktop header nav → 7 public pages (serial)
├── recommendations.spec.ts# Today's Picks / History tabs (empty-state tolerant)
├── screener.spec.ts       # basic screener: table rows + Market Cap select filter
├── advanced-screener.spec.ts # template flow + v3.5.2 regression guard (serial)
├── portfolio.spec.ts      # authenticated: tabs, metrics or empty/create state
├── watchlist.spec.ts      # authenticated: heading + create action (empty-tolerant)
├── alerts.spec.ts         # authenticated: 5 tabs
├── profile.spec.ts        # authenticated: account info + demo email
└── responsive.spec.ts     # Pixel 5 only — hamburger menu + core links

playwright.config.ts       # project matrix, storage state, workers, timeouts, webServer
```

### Project matrix

| Project | Browsers / viewport | Auth | What runs |
|---------|--------------------|------|-----------|
| `setup` | — | logs in | `auth.setup.ts` → saves `playwright/.auth/demo.json` |
| `chromium` / `firefox` / `webkit` | Desktop **1440×900** | demo storage state | everything except login + responsive |
| `chromium-logged-out` | Desktop Chrome 1280×720 | none | `login.spec.ts` only |
| `Mobile Chrome` | Pixel 5 (393×851) | demo storage state | `responsive.spec.ts` only |

### Key design decisions (do not silently change)

1. **Desktop viewport is 1440×900, not the device default 1280×720.** The header nav is
   `hidden xl:flex` (≥1280px). Firefox evaluates media queries against the
   scrollbar-excluded width, so at exactly 1280×720 the nav **never renders** in Firefox
   (Chromium/WebKit match `xl`). 1440 gives a safety margin in every browser.
2. **`workers: CI ? 1 : 2`.** The Next dev server is single-threaded; 4+ workers starve
   auth POSTs and SSR renders (15s timeouts blow up). Even at 2 workers the heavy
   TradingView scans can momentarily starve webkit navigations — see §7 flakiness.
3. **`retries: CI ? 2 : 1`.** The dev server is a shared, live-data resource; one local
   retry recovers load-induced timeouts. Playwright treats retried-then-passed as green.
4. **`navigation.spec.ts` is `mode: 'serial'` and uses
   `Promise.all([waitForURL, click({ noWaitAfter: true })])`.** Every test performs a
   full SSR navigation; running 7 in parallel self-starves. `noWaitAfter` resolves on
   URL *commit* instead of waiting for the page `load` event (heavy NSE SSR pages can
   take >45s to `load` under load).
5. **Live-data pages assert *contracts*, not values.** `home.spec.ts` avoids the marquee
   entirely (it renders `null` when `/api/nse/marquee` is slow/empty — live-data
   assertions flake). `recommendations.spec.ts` / `portfolio.spec.ts` accept empty
   states via OR-matchers. Only the screener scan tests assert live numbers, and only
   because they are the point of the v3.5.2 guard.
6. **Never `fill()` a controlled `<input type="number">` on WebKit.** WebKit drops the
   programmatic fill (React re-renders the old value). Use click → `ControlOrMeta+a` →
   `Delete` → `pressSequentially(...)` and verify with `toHaveValue` (see
   `advanced-screener.spec.ts` empty-state test).

## 3. Running the suite

```bash
npm run dev                     # dev server on :3000 (user-owned — never kill someone else's)
npm run test:e2e                # full suite (all projects)
npm run test:e2e:ui             # Playwright UI mode (watch, filter, step through)
npx playwright test             # same as test:e2e
npx playwright test e2e/navigation.spec.ts --project=webkit          # one file, one browser
npx playwright test e2e/advanced-screener.spec.ts --grep "empty"     # one test by title
npx playwright test --project=chromium --reporter=line               # fast feedback loop
npx playwright show-report      # open the last HTML report
npx playwright show-trace test-results/.../trace.zip                 # view a trace
```

**Credentials** (env-overridable): demo `demo@tradenext6.app` / `demo123`
(`E2E_DEMO_EMAIL` / `E2E_DEMO_PASSWORD`). Admin `admin@tradenext6.app` / `admin123`.

**Prereqs**: dev server running on :3000 (config reuses an existing one locally),
PostgreSQL seeded with the demo user (`npx prisma db seed`), `npx playwright install`
for browser binaries.

## 4. How the agent uses this suite

### When to run e2e

- **After any UI/UX change** (components, pages, header/nav, layouts) — mandatory per
  the checklist's `UI/UX Testing` gate.
- **After changes to auth, portfolio, alerts, watchlist, profile** flows.
- **After screener/template changes** — the `advanced-screener` spec is the regression
  guard for trading-view field semantics.
- **Before merge/PR** — confirm the full suite is green (retries are expected to catch
  occasional dev-server starvation; two consecutive reds on the *same* test = real bug).

### Standard workflow

1. Check the dev server: `netstat -ano | findstr :3000`. If not running, ask permission
   then `npm run dev`. **Never kill a server you didn't start; never touch :4096.**
2. Run the targeted spec first (fast feedback): `npx playwright test e2e/<spec>.ts`.
3. On failure, read `test-results/<test-dir>/error-context.md` (page snapshot + call
   log), then the screenshot, then `npx playwright show-trace` if a trace exists
   (`trace: 'on-first-retry'`).
4. Fix the **test** only when the app is correct — these specs encode real behavior
   (e.g. v3.5.2's `> 0` stocks guard). A "fix" that loosens a regression guard must be
   justified.
5. Full suite: `npm run test:e2e -- --reporter=line`. Count `passed` vs `flaky`
   (retried-then-passed) vs `failed`. `flaky` under full load is expected; `failed`
   twice on the same test is a real failure.
6. Clean up artifacts you created (`test-results/`, `playwright-report/`,
   `playwright/.auth/` are gitignored — nothing to delete from git, but don't commit
   stray screenshots/snapshots).

### Authoring a new spec (test suite generation)

1. **Copy the structure of an existing spec** — `test.describe` + clear title; assert
   stable chrome first, live data last.
2. **Prefer role-based locators**: `getByRole('link'|'button'|'heading'|'combobox')`,
   `getByPlaceholder`, `getByText` with `{ exact: true }` when ambiguous. Use the app's
   accessible names (e.g. the mobile hamburger is `header div.xl\:hidden button`; the
   screener Market Cap filter is a `<select>` with `<option value="largecap">`).
3. **Handle every state**: loading, empty, error, data. OR-matchers like
   `getByText(/Total Value|Create Portfolio|Add Transaction/i)` keep live-data pages
   stable.
4. **Timeouts**: heavy SSR pages get explicit `{ timeout: 30_000–120_000 }` on the
   decisive assertion; leave `expect` defaults (15s) for fast chrome.
5. **Never assert live NSE values** (prices, marquee, indices) — assert presence of
   containers/rows only, or the specific contract under test.
6. **Add the project wiring** if your spec is mobile-only or auth-free (see matrix).
7. Verify with `--reporter=line` on the target project, then `npx tsc --noEmit`
   (e2e files are typechecked via `**/*.ts` — keep them clean).
8. **Update this guide** when you add a browser-specific quirk or a new pattern.

## 5. Interactive / agentic browser automation

Two complementary tools exist for exploratory, non-scripted browser work:

### Playwright CLI (`playwright-cli`)

Human/agent CLI for ad-hoc checks: open a page, snapshot, click, fill, resize, trace,
state-save. Full reference: `.opencode/skills/playwright-cli/SKILL.md` +
`.agents/skills/playwright-cli/AGENT-TESTING-GUIDE.md`.

```bash
playwright-cli open http://localhost:3000
playwright-cli snapshot --filename=.playwright-cli/snapshots/test.yaml  # ALWAYS --filename
playwright-cli click e5
playwright-cli fill e7 "demo@tradenext6.app"
playwright-cli console          # check for JS errors
playwright-cli close
```

⚠️ Snapshot files without `--filename` land in the repo root as `*.yaml` — delete them
or always pass `--filename` (covered by the code-hygiene checklist).

### MCP servers (`playwright`, `chrome-devtools`)

Configured in `.opencode/opencode.json`:

- **`playwright`** (`@playwright/mcp`) — browser automation MCP: navigate, click, fill,
  snapshot (a11y tree), console/network inspection. Use for UI/UX audits
  (`/ux-audit`), bug reproduction (`/find-bugs`), and manual verification of fixes.
- **`chrome-devtools`** (`chrome-devtools-mcp`) — DevTools-driven: performance traces,
  Lighthouse audits, network requests, heap snapshots, device emulation. Use for
  performance/Core-Web-Vitals work and deep network debugging.

**When to use which**: scripted regression → `e2e/` suite; exploratory verification →
`playwright` MCP or `playwright-cli`; performance/Lighthouse → `chrome-devtools` MCP.

## 6. Reports, artifacts & Trace Viewer

| Artifact | Location | How to read |
|----------|----------|-------------|
| HTML report | `playwright-report/` (after run) | `npx playwright show-report` — failures, video, traces, retry history |
| Per-test failure context | `test-results/<Test-Name-Slug>/error-context.md` | Page snapshot at failure + call log — read **first** |
| Screenshots | `test-results/<Test-Name-Slug>/test-failed-1.png` | Visual state at failure |
| Traces | `test-results/<Test-Name-Slug>/trace.zip` (`trace: 'on-first-retry'`) | `npx playwright show-trace <file>` — DOM snapshots, console, network, timeline |
| Line reporter | terminal | Fast pass/fail + which test flaked |

**Diagnosis order for a failure**: error-context.md snapshot → screenshot → trace.
The snapshot usually answers "did the element exist / what did the page show" in seconds.

## 7. Troubleshooting

### Flaky webkit navigation (Markets/Analytics/News/Contact time out)

**Symptoms**: `TimeoutError: page.waitForURL: Timeout X exceeded`; the error log shows
`navigated to "http://localhost:3000/"` (still on home); a *different* nav test fails
each run.

**Cause**: the single-threaded dev server is saturated — the `advanced-screener`
TradingView scans (30–60s each, running in 3 browser projects) queue SSR responses for
nav requests. WebKit is the slowest and times out first.

**Mitigations already in place**: serial nav describe; `waitForURL` on URL commit
(`noWaitAfter: true`); 60s URL timeout; `retries: 1`. If it *still* flakes, check the
server isn't already overloaded (other manual scans), or temporarily run
`--project=chromium --project=firefox` to confirm webkit is the only straggler.

### `No stocks match` never appears / scan returns all 2000

**Symptoms**: advanced-screener empty-state test times out; snapshot shows
`spinbutton "e.g. 500": "0"` and `2000 stocks found`.

**Cause**: WebKit dropped `fill('99999999')` on the controlled `<input type="number">`;
the scan silently ran with the default `close > 0`. **Fix**: keystroke input +
`toHaveValue` verification (see §2.6). Never revert to bare `fill()` for that input.

### Marquee / live prices absent

**Symptoms**: home marquee assertions fail; `./animate-marquee` not found or empty.

**Cause**: `MarqueeBanner` renders `null` when `/api/nse/marquee` is slow/empty —
by design. Live-data widgets are **not** asserted in e2e (see §2.5).

### Firefox nav links missing entirely

**Symptoms**: Firefox-only `getByRole('link', { name: 'Markets' })` timeouts; the
snapshot shows only the logo + user menu + hamburger.

**Cause**: viewport at exactly 1280×720 with the `hidden xl:flex` nav —
Firefox's scrollbar-inclusive media query drops below `xl`. **Fix**: 1440×900 desktop
viewport (see §2.1).

### Firefox "Tearing down context exceeded timeout" (flaky)

**Symptoms**: `browserContext.close: Test ended` with `RenderCompositorSWGL failed
mapping default framebuffer` in browser logs.

**Cause**: Firefox headless rendering crash under load on this machine — environmental,
not test logic. Passes on retry. If it becomes frequent, restart the dev server and
re-run; do not weaken the test.

### CI is red but local is green

1. Confirm the workflow booted the DB (`timescale/timescaledb` service), ran
   `prisma migrate deploy` and `prisma db seed` **before** the dev server starts
   (see `.github/workflows/playwright.yml`).
2. NSE endpoints can block datacenter IPs — tests that *require* NSE (marquee, some
   home data) may fail on CI even when green locally. The suite is written to tolerate
   this; scan tests use TradingView which is CI-safe.
3. CI uses `workers: 1` and `retries: 2` — read the retried attempts in
   `show-report` before assuming a real regression.

### Recompilation makes the first test slow

Next dev on-demand compilation means the *first* page load after a server restart is
slow. Run `auth.setup` once (it warms the server) or run the target spec twice; the
suite is designed to absorb this via timeouts.

## 8. Scope guardrails

- Keep the suite **green and deterministic**: no assertions on live prices/values,
  no `test.only`, no sleeps (`waitForTimeout`) — use `expect` polling or
  `waitForFunction`.
- Keep specs **small and readable**: stable-chrome-first, one concern per test.
- **Never** change `retries`/`workers` to hide a real failure — those knobs exist for
  the dev-server-load reality documented above.
- Unit (Jest) and e2e (Playwright) are complementary: add unit tests for logic, e2e for
  integration/UI regressions. Don't duplicate.
