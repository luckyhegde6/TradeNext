import { test, expect } from '@playwright/test';

/**
 * Privacy Policy + Terms of Service — public pages. Verifies both pages
 * render their core content without auth, and that the contact page's
 * legal-links strip navigates to /privacy.
 */
test.describe('Legal pages', () => {
  test('/privacy loads publicly and shows the policy', async ({ page }) => {
    await page.goto('/privacy');

    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Information We Collect' })).toBeVisible();
    await expect(page.getByText('luckyhegdedev+tradenext@gmail.com')).toBeVisible();
  });

  test('/terms loads publicly and states the not-financial-advice promise', async ({ page }) => {
    await page.goto('/terms');

    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Not Financial Advice' })).toBeVisible();
    await expect(page.getByText(/TradeNext is a tool, not an adviser/)).toBeVisible();
  });

  test('contact page legal-links strip navigates to /privacy and /terms', async ({ page }) => {
    await page.goto('/contact');

    const privacyLink = page.getByRole('link', { name: 'Privacy Policy' });
    const termsLink = page.getByRole('link', { name: 'Terms of Service' });
    await expect(privacyLink).toBeVisible();
    await expect(termsLink).toBeVisible();

    await privacyLink.click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();

    await page.goto('/contact');
    await page.getByRole('link', { name: 'Terms of Service' }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  });
});