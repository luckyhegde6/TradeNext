import { test, expect } from '@playwright/test';

/**
 * Daily Recommendations page — public. Verifies the heading, tab bar and
 * that the Today's Picks + History tabs render their content shells.
 */
test.describe('Recommendations page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/recommendations');
    await expect(page.getByRole('heading', { name: 'Daily Recommendations' })).toBeVisible();
  });

  test('shows the tab bar with core tabs', async ({ page }) => {
    for (const tab of ["Today's Picks", 'History', 'Performance', 'Dividends']) {
      await expect(page.getByRole('button', { name: new RegExp(tab) })).toBeVisible();
    }
  });

  test('picks tab renders summary cards, a picks list, or the empty state', async ({ page }) => {
    // Local/dev DBs may have no runs yet: accept EITHER populated summary
    // cards (Total Stocks) OR the "No recommendations yet" empty state.
    // These two states are mutually exclusive, so .or() cannot strict-violate.
    const summaryCards = page.getByText('Total Stocks').first();
    const emptyState = page.getByText('No recommendations yet').first();
    await expect(summaryCards.or(emptyState)).toBeVisible({ timeout: 30_000 });
  });

  test('History tab renders the run list', async ({ page }) => {
    await page.getByRole('button', { name: /History/ }).click();
    // History shows per-run top stocks: cards render "Predicted:"/"Current:"
    // prices, or the "No recommendations yet" empty state on a fresh DB.
    await expect(page.getByText(/Predicted:|No recommendations yet/).first())
      .toBeVisible({ timeout: 30_000 });
  });
});
