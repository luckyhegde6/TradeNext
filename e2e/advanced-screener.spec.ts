import { test, expect } from '@playwright/test';

/**
 * Advanced Screener — public. Exercises the template flow end-to-end and
 * validates the v3.5.2 fix: the "Short Term Breakouts" template uses
 * TradingView-native `change>0, relative_volume_10d_calc>1, Perf.5D>3`
 * and now returns ~250 stocks (previously silently matched 0 because the
 * `change_percent` field is unsupported on NSE).
 *
 * NOTE: these scans hit TradingView LIVE and can take 30-60s each. The
 * describe runs in serial mode and the heavy test retries the scan if the
 * first attempt transiently returns 0 (TradingView occasionally rate-limits
 * parallel requests).
 */
test.describe('Advanced Screener', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/markets/screener/advanced');
    await expect(page.getByRole('heading', { name: 'Advanced Screener' })).toBeVisible();
  });

  test('renders the scan toolbar', async ({ page }) => {
    await expect(page.getByRole('button', { name: '▶ Run Scan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Templates' })).toBeVisible();
    await expect(page.getByText('Filter Conditions')).toBeVisible();
  });

  test('opens the templates panel with searchable templates', async ({ page }) => {
    await page.getByRole('button', { name: 'Templates' }).click();
    await expect(page.getByText('Screener Templates')).toBeVisible();

    // Search for the breakout template
    await page.getByPlaceholder('Search templates...').fill('Short Term Breakouts');
    await expect(page.getByText('Short Term Breakouts', { exact: true })).toBeVisible();
  });

  test('applies Short Term Breakouts template and returns stocks (v3.5.2 fix)', async ({ page }) => {
    // 1. Open templates
    await page.getByRole('button', { name: 'Templates' }).click();
    await expect(page.getByText('Screener Templates')).toBeVisible();

    // 2. Search + apply the template (auto-runs the scan on apply)
    await page.getByPlaceholder('Search templates...').fill('Short Term Breakouts');
    const templateButton = page.getByText('Short Term Breakouts', { exact: true });
    await templateButton.click();

    // 3. Panel should close and the scan should start automatically. The apply
    //    fetches /api/screener/templates/{id}; under parallel load that fetch
    //    can transiently fail (silent catch) leaving the panel open — retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      const panelClosed = await page
        .getByText('Screener Templates')
        .waitFor({ state: 'hidden', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (panelClosed) break;
      await templateButton.click({ timeout: 10_000 }).catch(() => {});
    }
    await expect(page.getByText('Screener Templates')).toBeHidden({ timeout: 15_000 });

    // 4. Wait for the scan result; if TradingView transiently returns 0,
    //    retry the scan (the template conditions persist after apply).
    let count = 0;
    const resultsText = page.getByText(/\d+ stocks found/);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(resultsText).toBeVisible({ timeout: 120_000 });
      const match = (await resultsText.textContent())?.match(/(\d+) stocks found/);
      count = match ? Number(match[1]) : 0;
      if (count > 0) break;
      await page.getByRole('button', { name: '▶ Run Scan' }).click();
    }

    // 5. The v3.5.2 regression guard: NSE breakout scan must return > 0 stocks
    expect(count).toBeGreaterThan(0);

    // 6. Results table shows the % Change column and at least one data row
    await expect(page.getByRole('columnheader', { name: '% Change' })).toBeVisible();
    await expect(page.getByRole('table').locator('tbody tr').first()).toBeVisible();
  });

  test('scan with an impossible filter shows the empty state', async ({ page }) => {
    // Set the default condition to Price > 99999999 — nothing on NSE matches.
    // Use keystrokes instead of fill(): WebKit drops a programmatic fill() on
    // a controlled <input type="number"> (React re-renders with the old value),
    // so the scan would silently run with the default `close > 0` filter and
    // return all 2000 stocks instead of the empty state.
    const valueInput = page.getByRole('spinbutton', { name: 'e.g. 500' });
    await valueInput.click();
    await valueInput.press('ControlOrMeta+a');
    await valueInput.press('Delete');
    await valueInput.pressSequentially('99999999');
    await expect(valueInput).toHaveValue('99999999');

    await page.getByRole('button', { name: '▶ Run Scan' }).click();
    await expect(page.getByText('No stocks match your filters. Try adjusting your criteria.'))
      .toBeVisible({ timeout: 120_000 });
  });
});
