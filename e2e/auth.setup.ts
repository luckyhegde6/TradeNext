import { test as setup, expect } from '@playwright/test';

/**
 * One-time auth setup: log in as the demo user and persist the session cookies
 * to `playwright/.auth/demo.json`. Browser projects reference this storage
 * state so authenticated flows (portfolio, watchlist, alerts, profile) work
 * without repeating the login in every test.
 *
 * Credentials come from E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD (defaults match the
 * seeded demo user — see AGENTS.md). No real secrets live in this file.
 */
const demoUser = process.env.E2E_DEMO_EMAIL || 'demo@tradenext6.app';
const demoPassword = process.env.E2E_DEMO_PASSWORD || 'demo123';

setup('authenticate as demo user', async ({ page }) => {
  await page.goto('/auth/signin');

  await page.getByPlaceholder('you@example.com').fill(demoUser);
  await page.getByPlaceholder('••••••••').fill(demoPassword);

  /**
   * CSRF double-submit race (Lesson 137): under parallel load the
   * single-threaded dev server can serve the page-mount useSession session
   * GETs (each mints its own csrf cookie) before the login submit; the
   * credentials POST's cookie token then differs from its body token →
   * MissingCSRF → the "Invalid email or password" banner. The jar holds ONE
   * token after the failed submit, so one more Sign In click succeeds.
   * Also covers the stalled-response variant (no banner, still on signin):
   * reload → re-fill → re-submit. Max 2 attempts — a fresh context re-rolls
   * the race, so this is preferred over relying on config-level retries.
   */
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    try {
      // Successful login redirects to the callbackUrl (default "/"). Generous
      // timeout: the dev server recompiles routes on demand and NSE fetches
      // can delay the credentials callback under parallel load.
      await expect(page).toHaveURL(/\/$/, { timeout: attempt === 1 ? 12_000 : 45_000 });
      break;
    } catch (e) {
      if (attempt === 2) throw e;
      if (await page.getByText('Invalid email or password').isVisible().catch(() => false)) {
        // Token race — the jar is coherent now; resubmit without reload.
        continue;
      }
      // Stalled response — reload redirects if the session cookie landed,
      // otherwise re-fill and try again.
      await page.reload();
      await page.getByPlaceholder('you@example.com').fill(demoUser);
      await page.getByPlaceholder('••••••••').fill(demoPassword);
    }
  }

  // Sanity-check the logged-in state: user avatar (initials) in the header
  await expect(page.locator('header button[title="Sign Out"]')).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: 'playwright/.auth/demo.json' });
});
