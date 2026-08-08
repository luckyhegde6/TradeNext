import { defineConfig, devices } from '@playwright/test';

/**
 * TradeNext UI test configuration (Playwright).
 *
 * - Test files live in `e2e/` and target the local Next.js dev server.
 * - `auth.setup.ts` logs in as the demo user once and saves storage state to
 *   `playwright/.auth/demo.json` (gitignored) — browser projects reuse it so
 *   authenticated flows (portfolio, watchlist, alerts, profile) work out of the box.
 * - A separate `chromium-logged-out` project runs `login.spec.ts` WITHOUT
 *   pre-auth state so the sign-in page itself can be tested.
 * - The dev server must be running on port 3000 (`npm run dev`); the webServer
 *   block reuses an existing one and only starts a fresh server on CI.
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only. Local runs keep 1 retry: the single-threaded dev server
   * can be momentarily saturated by concurrent NSE/TradingView scans, which
   * starves a few SSR navigation requests (webkit especially). One retry runs
   * after the heavy scans finish and recovers those. */
  retries: process.env.CI ? 2 : 1,
  /* Opt out of parallel tests on CI. Locally use 2 workers: the dev server is
   * single-threaded and NSE/TradingView scans are slow, so 4+ workers starve
   * auth POSTs and page loads (15s timeouts blow up under recompilation). */
  workers: process.env.CI ? 1 : 2,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Generous timeouts — NSE/TradingView data is live and scans can take 30-60s */
  timeout: 60_000,
  expect: { timeout: 15_000 },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    /* 1. Auth setup — log in as demo user once, save storage state */
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    /* 2. Main browser projects — authenticated as demo user */
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: 'playwright/.auth/demo.json' },
      dependencies: ['setup'],
      testIgnore: [/login\.spec\.ts/, /responsive\.spec\.ts/],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 }, storageState: 'playwright/.auth/demo.json' },
      dependencies: ['setup'],
      testIgnore: [/login\.spec\.ts/, /responsive\.spec\.ts/],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, storageState: 'playwright/.auth/demo.json' },
      dependencies: ['setup'],
      testIgnore: [/login\.spec\.ts/, /responsive\.spec\.ts/],
    },

    /* 3. Logged-out project — only the login page tests (no pre-auth state) */
    {
      name: 'chromium-logged-out',
      testMatch: /login\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    /* 4. Mobile viewport — responsive/nav tests */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'], storageState: 'playwright/.auth/demo.json' },
      dependencies: ['setup'],
      testMatch: /responsive\.spec\.ts/,
    },
  ],

  /* Run the dev server before starting the tests (reuses an existing one locally) */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
