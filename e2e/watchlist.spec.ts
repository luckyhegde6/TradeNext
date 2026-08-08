import { test, expect } from '@playwright/test';

/**
 * Watchlist page — authenticated (demo user via storage state).
 */
test.describe('Watchlist page (authenticated)', () => {
  test('renders the watchlist heading', async ({ page }) => {
    await page.goto('/watchlist');
    await expect(page.getByRole('heading', { name: 'Watchlist' }).first()).toBeVisible();
  });

  test('shows create-watchlist action (empty or populated state)', async ({ page }) => {
    await page.goto('/watchlist');
    // Empty state CTA or the "new watchlist" button — one of them is always present
    const emptyCta = page.getByRole('button', { name: /Create (Your First )?Watchlist/ }).first();
    const addBtn = page.getByRole('button', { name: /Add Symbol to Watchlist|Create New Watchlist/ }).first();
    await expect(emptyCta.or(addBtn)).toBeVisible({ timeout: 30_000 });
  });
});
