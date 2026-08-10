import { test, expect, type Page } from '@playwright/test';

/**
 * Header navigation — verifies public links in the desktop nav navigate to the
 * right pages. Runs in the authenticated projects (demo user).
 *
 * Markets / Analytics / Calendar / News / Contact are heavy server-rendered
 * pages (NSE data fetches). Under parallel load (2 workers) webkit can exceed
 * 30s waiting for the page's `load` event, so:
 *  - URL waits use 45s and resolve on URL *commit* (not `load`) via the
 *    Promise.all([waitForURL, click({ noWaitAfter: true })]) pattern;
 *  - heading assertions get a generous 30s timeout for the SSR render.
 */
const URL_TIMEOUT = 60_000;
const HEADING_TIMEOUT = 30_000;

/** Click a desktop nav link and wait for the URL change without blocking on `load`. */
async function clickNav(page: Page, name: string, url: RegExp) {
  await Promise.all([
    page.waitForURL(url, { timeout: URL_TIMEOUT }),
    page.getByRole('link', { name, exact: true }).click({ noWaitAfter: true }),
  ]);
}

async function expectHeading(page: Page, name: string) {
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: HEADING_TIMEOUT });
}

test.describe('Header navigation (desktop)', () => {
  // Serial: every test performs a full SSR navigation on the single-threaded
  // dev server. Running them in parallel (fullyParallel) makes all 7 hit the
  // server at once and starve each other's NSE-heavy renders.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('navigates to Markets', async ({ page }) => {
    await clickNav(page, 'Markets', /\/markets$/);
    await expectHeading(page, 'Markets Overview');
  });

  test('navigates to Analytics', async ({ page }) => {
    await clickNav(page, 'Analytics', /\/markets\/analytics$/);
    await expectHeading(page, 'Market Analytics');
  });

  test('navigates to Calendar', async ({ page }) => {
    await clickNav(page, 'Calendar', /\/markets\/calendar$/);
    await expectHeading(page, 'Corporate Actions Calendar');
  });

  test('navigates to Recommendations', async ({ page }) => {
    await clickNav(page, 'Recommendations', /\/recommendations$/);
    await expectHeading(page, 'Daily Recommendations');
  });

  test('navigates to News', async ({ page }) => {
    await clickNav(page, 'News', /\/news$/);
    await expectHeading(page, 'Market News');
  });

  test('navigates to Screener', async ({ page }) => {
    await clickNav(page, 'Screener', /\/markets\/screener$/);
    await expectHeading(page, 'Stock Screener');
  });

  test('navigates to Contact', async ({ page }) => {
    await clickNav(page, 'Contact', /\/contact$/);
    await expectHeading(page, 'Contact Us');
  });
});
