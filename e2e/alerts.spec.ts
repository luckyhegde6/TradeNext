import { test, expect } from '@playwright/test';

/**
 * Alerts page — authenticated. Verifies the 5-tab structure
 * (My Alerts / Alert Rules / Channels / Event History / Telegram Bot).
 */
test.describe('Alerts page (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
  });

  test('shows all five alert tabs', async ({ page }) => {
    for (const tab of ['My Alerts', 'Alert Rules', 'Channels', 'Event History', 'Telegram Bot']) {
      await expect(page.getByRole('button', { name: tab })).toBeVisible();
    }
  });

  test('switches to Alert Rules tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Alert Rules' }).click();
    await expect(page.getByText(/Alert Rules|New Alert Rule|No rules/i).first())
      .toBeVisible({ timeout: 15_000 });
  });
});
