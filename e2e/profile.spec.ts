import { test, expect } from '@playwright/test';

/**
 * Profile page — authenticated. Verifies account info + Telegram sections.
 * NOTE: goto() waits only for domcontentloaded — the page is heavy (NSE/user
 * API calls) and can exceed the default 60s `load` event under parallel load.
 */
test.describe('Profile page (authenticated)', () => {
  test('renders account information and telegram sections', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Profile Settings/ })).toBeVisible();
    await expect(page.getByText('Account Information').first()).toBeVisible();
    await expect(page.getByText('Telegram Notifications').first()).toBeVisible();
  });

  test('shows the signed-in demo email', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('demo@tradenext6.app')).toBeVisible({ timeout: 15_000 });
  });
});
