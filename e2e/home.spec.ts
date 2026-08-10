import { test, expect } from '@playwright/test';

/**
 * Home / dashboard page — public, no auth required.
 * Asserts stable UI chrome (hero, search, chart shell, quick-access cards).
 * Avoids asserting live NSE values (quotes, marquee, indices), which can be
 * slow or momentarily unavailable under parallel load — those are covered by
 * unit/integration tests with mocks instead.
 */
test.describe('Home page', () => {
  test('renders hero, search and chart shell', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Market Intelligence by');
    await expect(page.getByText('Live indices, charts & corporate events')).toBeVisible();

    // Stock search bar (symbol input)
    await expect(page.getByPlaceholder(/search|symbol/i).first()).toBeVisible();

    // Chart chrome — symbol selector + timeframe buttons are always rendered
    await expect(page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'NIFTY 50' }) }))
      .toBeVisible();
    await expect(page.getByRole('button', { name: '1D' })).toBeVisible();
    await expect(page.getByRole('button', { name: '1M' })).toBeVisible();
    await expect(page.getByText(/Market (Open|Closed)/)).toBeVisible({ timeout: 30_000 });
  });

  test('quick access cards link to key sections', async ({ page }) => {
    await page.goto('/');

    // Quick-access cards have distinct accessible names (emoji + label + subtitle)
    await expect(page.getByRole('link', { name: /All Indices/ })).toHaveAttribute('href', '/markets');
    await expect(page.getByRole('link', { name: /Get Started|My Assets/ })).toHaveAttribute('href', /\/portfolio/);
    await expect(page.getByRole('link', { name: /Data Analysis/ })).toHaveAttribute('href', '/markets/analytics');
    await expect(page.getByRole('link', { name: /Stock Screener/ })).toHaveAttribute('href', '/markets/screener');
  });
});
