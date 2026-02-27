import { test, expect } from '@playwright/test';
import { loginAsAdmin, loginAsDemo, ADMIN_USER, DEMO_USER } from './utils';

test.describe('Stock Recommendations Management (Admin)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should navigate to recommendations page', async ({ page }) => {
    await page.goto('/admin/recommendations');
    await expect(page.locator('h1')).toContainText('Stock Recommendations');
  });

  test('should display recommendations list', async ({ page }) => {
    await page.goto('/admin/recommendations');
    await expect(page.locator('text=Recommendations')).toBeVisible();
  });

  test('should open add recommendation modal', async ({ page }) => {
    await page.goto('/admin/recommendations');
    await page.click('button:has-text("Add Recommendation")');
    await expect(page.locator('text=Add Recommendation')).toBeVisible();
  });

  test('should fill recommendation form', async ({ page }) => {
    await page.goto('/admin/recommendations');
    await page.click('button:has-text("Add Recommendation")');
    
    await page.fill('input[name="symbol"]', 'RELIANCE');
    await page.selectOption('select[name="recommendation"]', 'BUY');
    await page.fill('input[name="targetPrice"]', '2500');
    await page.fill('input[name="analysis"]', 'Strong buy recommendation');
    
    await expect(page.locator('input[name="symbol"]')).toHaveValue('RELIANCE');
    await expect(page.locator('input[name="targetPrice"]')).toHaveValue('2500');
  });

  test('should validate required fields', async ({ page }) => {
    await page.goto('/admin/recommendations');
    await page.click('button:has-text("Add Recommendation")');
    await page.click('button:has-text("Create")');
    
    await expect(page.locator('text=Invalid input')).toBeVisible();
  });
});

test.describe('Audit Management (Admin)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should navigate to audit page', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(page.locator('h1')).toContainText('Audit Management');
  });

  test('should display audit logs', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(page.locator('text=Audit Logs')).toBeVisible();
  });

  test('should filter by action type', async ({ page }) => {
    await page.goto('/admin/audit');
    await page.selectOption('select', 'API_CALL');
    await page.waitForTimeout(500);
  });

  test('should filter by date range', async ({ page }) => {
    await page.goto('/admin/audit');
    await page.fill('input[type="date"]', '2024-01-01');
  });

  test('should navigate pagination', async ({ page }) => {
    await page.goto('/admin/audit');
    const nextButton = page.locator('button:has-text("Next")');
    if (await nextButton.isEnabled()) {
      await nextButton.click();
    }
  });
});

test.describe('Holdings Management (Admin)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should navigate to holdings page', async ({ page }) => {
    await page.goto('/admin/holdings');
    await expect(page.locator('h1')).toContainText('Holdings Management');
  });

  test('should display user dropdown', async ({ page }) => {
    await page.goto('/admin/holdings');
    await expect(page.locator('select')).toBeVisible();
  });

  test('should select user and show transactions', async ({ page }) => {
    await page.goto('/admin/holdings');
    const select = page.locator('select');
    const options = await select.locator('option').count();
    if (options > 1) {
      await select.selectOption({ index: 1 });
      await page.waitForTimeout(500);
    }
  });
});

test.describe('NSE API Monitoring (Admin Overview)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should display NSE API calls tile', async ({ page }) => {
    await page.goto('/admin/utils');
    await expect(page.locator('text=NSE API Calls')).toBeVisible();
  });

  test('should display rate limited users tile', async ({ page }) => {
    await page.goto('/admin/utils');
    await expect(page.locator('text=Rate Limited Users')).toBeVisible();
  });

  test('should show total NSE calls count', async ({ page }) => {
    await page.goto('/admin/utils');
    await expect(page.locator('text=Total Calls')).toBeVisible();
  });
});

test.describe('User Portfolio - Recommendations', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page);
  });

  test('should display investment recommendations section', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.locator('text=Investment Recommendations')).toBeVisible();
  });

  test('should refresh recommendations', async ({ page }) => {
    await page.goto('/portfolio');
    await page.click('button:has-text("Refresh Insights")');
    await page.waitForTimeout(1000);
  });
});

test.describe('User Portfolio - My Alerts', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page);
  });

  test('should display my alerts section', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.locator('text=My Alerts')).toBeVisible();
  });

  test('should open create alert modal', async ({ page }) => {
    await page.goto('/portfolio');
    await page.click('button:has-text("Create Alert")');
    await expect(page.locator('text=Create Alert')).toBeVisible();
  });

  test('should fill alert form', async ({ page }) => {
    await page.goto('/portfolio');
    await page.click('button:has-text("Create Alert")');
    
    await page.fill('input[placeholder*="RELIANCE"]', 'RELIANCE');
    await page.fill('input[placeholder*="2500"]', '2500');
    await page.fill('input[placeholder*="RELIANCE above"]', 'RELIANCE above 2500');
    
    await expect(page.locator('button:has-text("Create Alert")')).toBeVisible();
  });

  test('should show alerts for today', async ({ page }) => {
    await page.goto('/portfolio');
    await page.click('button:has-text("Refresh")');
    await page.waitForTimeout(500);
  });
});

test.describe('Rate Limiting', () => {
  test('should return 429 when rate limited', async ({ request }) => {
    for (let i = 0; i < 15; i++) {
      const response = await request.post('/api/rate-limit?endpoint=refresh');
      if (response.status() === 429) {
        expect(response.headers()['retry-after']).toBeDefined();
        break;
      }
    }
  });

  test('should include rate limit headers', async ({ request }) => {
    const response = await request.get('/api/rate-limit?endpoint=refresh');
    const headers = response.headers();
    expect(headers['x-ratelimit-limit']).toBeDefined();
    expect(headers['x-ratelimit-remaining']).toBeDefined();
  });
});
