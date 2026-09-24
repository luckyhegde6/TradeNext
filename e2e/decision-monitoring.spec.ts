import { test, expect } from '@playwright/test';

/**
 * Spec 17 — Decision Engine monitoring tab on the admin AI Monitoring page.
 *
 * The shared Playwright storage state (playwright/.auth/demo.json) authenticates
 * as the DEMO user, but /admin/utils/ai-monitoring is admin-only — so this spec
 * resets to a logged-out context and performs its own admin login (same flow as
 * e2e/auth.setup.ts).
 *
 * SECURITY: admin credentials are never hardcoded in the repo. They are read
 * from the environment only (E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD, with a
 * fallback to ADMIN_EMAIL / ADMIN_PASSWORD from the gitignored .env when a
 * runner already loaded it). When none are present the whole suite is skipped
 * with a clear reason instead of failing.
 *
 * Run from a shell where the vars are exported (or with dotenv loaded):
 *   set E2E_ADMIN_EMAIL=admin@tradenext6.app&& set E2E_ADMIN_PASSWORD=...&& npx playwright test e2e/decision-monitoring.spec.ts --project=chromium
 * Visual check (headed browser):
 *   npx playwright test e2e/decision-monitoring.spec.ts --headed --project=chromium
 *
 * Covers the tab contract (6 stat cards + 3 breakdowns), the live ping ->
 * trace-recorded flow, the Clear action, and the 375px mobile viewport.
 *
 * NOTE: this is the first spec in the suite to perform a login on WebKit
 * (auth.setup.ts and login.spec.ts are chromium-only) — the login helper below
 * absorbs the dev-server auth-response stall observed on WebKit under load.
 */
test.use({ storageState: { cookies: [], origins: [] } });

// Auth posts are heavy (bcrypt cost-12 + DB session insert) on the
// single-threaded dev server — run the desktop + mobile cases in series.
test.describe.configure({ mode: 'serial' });

const adminEmail = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';

test.skip(
  !adminEmail || !adminPassword,
  'Admin decision-monitoring tests need E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD (or ADMIN_EMAIL/ADMIN_PASSWORD from .env)',
);

/**
 * Admin login (assumes the /auth/signin page is already loaded).
 *
 * The single-threaded Next dev server can stall the auth response while it
 * recompiles under parallel load: authorize() resolves server-side ("Auth:
 * Login successful" in the log) but the 302/Set-Cookie never completes in the
 * browser — the page stays on /auth/signin with NO error banner and the form
 * still filled. Recovery: a quick URL probe instead of a 45s wait, then a
 * reload — a session cookie that DID land redirects away via the session gate,
 * otherwise the fresh form is re-submitted. Max 3 attempts.
 */
async function loginAsAdmin(page: import('@playwright/test').Page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.getByPlaceholder('you@example.com').fill(adminEmail);
    await page.getByPlaceholder('••••••••').fill(adminPassword);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    try {
      if (attempt === 3) {
        // Last attempt: give a very late response time to complete.
        await expect(page).toHaveURL(/\/$/, { timeout: 45_000 });
        return;
      }
      await expect(page).toHaveURL(/\/$/, { timeout: 12_000 });
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      await page.reload();
      try {
        await expect(page).toHaveURL(/\/$/, { timeout: 5_000 });
        return;
      } catch {
        // Still on /auth/signin without a landing session — next attempt re-submits.
      }
    }
  }
}

/** Logs in as admin and lands on the Decision Engine tab of AI Monitoring. */
async function openDecisionTab(page: import('@playwright/test').Page) {
  await page.goto('/auth/signin');
  await loginAsAdmin(page);

  await page.goto('/admin/utils/ai-monitoring');
  // Tab renders only after monitoring data loads (stats fetch).
  await expect(page.getByRole('button', { name: 'Decision Engine', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Decision Engine', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Decision Engine Traces' })).toBeVisible();
}

/**
 * The single-threaded Next dev server drops keep-alive connections while it
 * recompiles a route on demand — retry once so a warm-up ECONNRESET does not
 * waste a whole test retry.
 */
async function pingAdmin(page: import('@playwright/test').Page) {
  const last = await page.request.get('/api/admin/decision/ping').catch(() => null);
  if (last) return last;
  await page.waitForTimeout(500);
  const retry = await page.request.get('/api/admin/decision/ping');
  return retry;
}

test('Decision Engine tab: stats contract, ping trace flow, and clear', async ({ page }) => {
  await openDecisionTab(page);

  // Contract: header, 6 stat cards + 3 breakdowns. The monitoring endpoint
  // returns a zeroed stats object for an empty buffer, so the cards always render.
  await expect(page.getByRole('button', { name: 'Clear Decision Traces' })).toBeVisible();
  // Labels unique to the Decision Engine grid.
  for (const label of ['Total Traces', 'Avg Attempts', 'Questions Eval.', 'Gates Emitted']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  // "Success Rate" / "Avg Latency" also exist on the always-rendered AI grid; the
  // Decision grid renders after it on the same tab, so assert the LAST match.
  await expect(page.getByText('Success Rate', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Avg Latency', { exact: true }).last()).toBeVisible();
  for (const heading of ['Traces by Kind', 'Traces by Provider', 'Traces by Gate']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  // Exercise the engine ping — admin session cookies are shared with page.request.
  const ping = await pingAdmin(page);
  expect(ping.ok()).toBeTruthy();

  // Reload -> the ping trace renders as a row in the trace list.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Decision Engine', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Decision Engine', exact: true }).click();
  await expect(page.getByText('ping', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // Clear (accept the confirm dialog) -> buffer empties and the empty state returns.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Clear Decision Traces' }).click();
  await expect(page.getByText('No decision traces yet.')).toBeVisible({ timeout: 15_000 });
});

test.describe('Decision Engine tab — mobile viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('tab renders and expands at 375px', async ({ page }) => {
    await openDecisionTab(page);
    await expect(page.getByText('Total Traces', { exact: true })).toBeVisible();

    // Ping + reload -> row visible on mobile; latency suffix confirms row content.
    const ping = await pingAdmin(page);
    expect(ping.ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Decision Engine', exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Decision Engine', exact: true }).click();
    const row = page.getByText('ping', { exact: true }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.getByText(/\d+ms/).first()).toBeVisible();
  });
});