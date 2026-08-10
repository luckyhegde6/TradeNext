import { test, expect } from '@playwright/test';

/**
 * Basic Stock Screener — public. Verifies heading, quick filters, the live
 * TradingView-synced results table, and the link to the advanced screener.
 */
test.describe('Stock Screener (basic)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/markets/screener');
    await expect(page.getByRole('heading', { name: 'Stock Screener' })).toBeVisible();
  });

  test('renders quick filters and advanced screener link', async ({ page }) => {
    await expect(page.getByText('Quick Filters')).toBeVisible();
    await expect(page.getByRole('link', { name: /Advanced Screener/ })).toBeVisible();
    await expect(page.getByText('Top Gainers (3%+)')).toBeVisible();
    await expect(page.getByText('Top Losers (3%-)')).toBeVisible();
  });

  test('loads the stock table with rows', async ({ page }) => {
    // The table shows TradingView-synced stocks (all preset). The count text
    // ("N stocks") confirms the sync finished; then assert a data row exists.
    await expect(page.getByText(/\d+[,.]?\d* stocks?$/).first()).toBeVisible({ timeout: 30_000 });
    // At least one result row is rendered (a cell linking to a company page)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 });
  });

  test('applies a basic filter (Market Cap = Large Cap)', async ({ page }) => {
    // "Large Cap (>20,000 Cr)" is an <option> in the Market Cap select
    // (Basic Filters), not a quick-filter button.
    await page.locator('select').first().selectOption('largecap');
    // Filtering triggers a refetch; the market-cap column header stays visible
    await expect(page.getByRole('columnheader', { name: 'Market Cap' })).toBeVisible();
  });
});
