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
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();

  // Successful login redirects to the callbackUrl (default "/"). Generous
  // timeout: the dev server recompiles routes on demand and NSE fetches can
  // delay the credentials callback under parallel load.
  await expect(page).toHaveURL(/\/$/, { timeout: 45_000 });

  // Sanity-check the logged-in state: user avatar (initials) in the header
  await expect(page.locator('header button[title="Sign Out"]')).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: 'playwright/.auth/demo.json' });
});
