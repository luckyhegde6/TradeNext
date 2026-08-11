import { test, expect } from '@playwright/test';

/**
 * Sign-in page — runs in the `chromium-logged-out` project (NO pre-auth state),
 * so the form and error handling are tested from a genuinely logged-out browser.
 *
 * Demo credentials come from E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD (defaults match
 * the seeded demo user — see AGENTS.md). No real secrets live in this file.
 */
const demoUser = process.env.E2E_DEMO_EMAIL || 'demo@tradenext6.app';
const demoPassword = process.env.E2E_DEMO_PASSWORD || 'demo123';

test.describe('Sign-in page (logged out)', () => {
  test('renders the sign-in form', async ({ page }) => {
    await page.goto('/auth/signin');

    await expect(page.getByRole('heading', { name: 'Sign In to TradeNext' })).toBeVisible();
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();

    // Link to request access — self-signup was removed in v3.6.0, so the
    // primary CTA points to the admin-moderated join flow.
    await expect(page.getByRole('link', { name: 'Join Now' })).toHaveAttribute('href', '/auth/join');
    // Forgot-password link → reset request flow (admin-approved)
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/auth/password-reset');
  });

  test('shows an error for invalid credentials', async ({ page }) => {
    await page.goto('/auth/signin');

    await page.getByPlaceholder('you@example.com').fill('nobody@tradenext6.app');
    await page.getByPlaceholder('••••••••').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    // Credentials callback can be slow under dev-server recompilation
    await expect(page.getByText('Invalid email or password')).toBeVisible({ timeout: 30_000 });
  });

  test('logs in with demo credentials and lands on the dashboard', async ({ page }) => {
    await page.goto('/auth/signin');

    await page.getByPlaceholder('you@example.com').fill(demoUser);
    await page.getByPlaceholder('••••••••').fill(demoPassword);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    // Successful login redirects to the callbackUrl (default "/")
    await expect(page).toHaveURL(/\/$/, { timeout: 45_000 });
    await expect(page.locator('header button[title="Sign Out"]')).toBeVisible({ timeout: 15_000 });
  });
});
