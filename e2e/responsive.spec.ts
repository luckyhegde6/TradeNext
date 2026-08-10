import { test, expect } from '@playwright/test';

/**
 * Mobile responsive — runs in the "Mobile Chrome" project (Pixel 5 viewport).
 * Verifies the hamburger menu reveals the mobile nav links.
 */
test.describe('Mobile navigation (Pixel 5)', () => {
  test('hamburger menu opens and shows core links', async ({ page }) => {
    await page.goto('/');

    // Mobile menu button (hamburger) lives in the xl:hidden header block;
    // desktop nav links are hidden below xl and vice versa.
    const menuButton = page.locator('header div.xl\\:hidden button').first();
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    // Mobile nav links appear (exact names to avoid matching the dashboard's
    // emoji-prefixed quick-access cards like "📊 Markets All Indices")
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Markets', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Screener', exact: true })).toBeVisible();

    // Navigating via the mobile menu works
    await page.getByRole('link', { name: 'Recommendations', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Daily Recommendations' })).toBeVisible();
  });
});
