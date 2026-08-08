import { test, expect } from '@playwright/test';

/**
 * Portfolio page — authenticated (demo user via storage state).
 * Verifies the page shell and holdings/transactions tabs. Demo user may or may
 * not have holdings, so assertions target the stable shell elements.
 */
test.describe('Portfolio page (authenticated)', () => {
  test('renders the portfolio page shell', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByRole('heading', { name: 'My Portfolio' })).toBeVisible();
  });

  test('shows holdings and transactions tabs', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByRole('button', { name: /Holdings/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Transactions/ })).toBeVisible();
  });

  test('loads portfolio metrics or shows the empty/create state', async ({ page }) => {
    await page.goto('/portfolio');
    // Either real metrics render, or the empty state prompts portfolio creation.
    // Single regex + .first() avoids strict-mode violations from .or() when both
    // a metric label AND the Add Transaction button are present.
    await expect(page.getByText(/Total Value|Create Portfolio|Add Transaction/i).first())
      .toBeVisible({ timeout: 30_000 });
  });
});
