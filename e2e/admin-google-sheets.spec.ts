import { test, expect } from '@playwright/test';

/**
 * Spec 20 — Google Sheets admin console (/admin/google-sheets).
 *
 * The console is the operator's only surface for the append-only Tracker sheet,
 * and three of its controls are destructive or externally visible, so this spec
 * pins the BEHAVIOUR of the actions rather than the live sheet:
 *
 *  - Rescan vs Sync stay separate actions, and the notice distinguishes
 *    "queued" (screener, delegated to the producer) from "appended" (custom).
 *  - Remove-unreadable is confirmed inline with the exact count AND seqs, and
 *    the destructive DELETE is the one request a test must be careful with.
 *  - Metrics renders nullable KPIs as "—", never as 0, and the Append button
 *    stays disabled when there is no snapshot to append.
 *
 * The admin APIs are ROUTE-MOCKED with `page.route()` rather than driven against
 * a real sheet. Three reasons: OAuth consent is a one-shot manual step that CI
 * cannot perform, a real append is irreversible (append-only by design, so a
 * test run would permanently pollute the user's sheet), and the ledger is a
 * durable mirror whose state a test must not depend on. The assertions are
 * therefore on the console's own contract — which request it sends, and what it
 * tells the operator — which is exactly the part this spec owns. Server-side
 * behaviour of the same routes is covered by lib/__tests__/googleSheetsAdminRoutes.test.ts
 * and googleSheetsRescan.test.ts.
 *
 * SECURITY: admin credentials are never hardcoded in the repo. They are read from
 * the environment only (E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD, falling back to
 * ADMIN_EMAIL / ADMIN_PASSWORD from the gitignored .env). With none present the
 * whole spec is skipped with a clear reason instead of failing.
 *
 * Run:
 *   set E2E_ADMIN_EMAIL=...&& set E2E_ADMIN_PASSWORD=...&& npx playwright test e2e/admin-google-sheets.spec.ts --project=chromium
 * Visual check: add --headed
 */
test.use({ storageState: { cookies: [], origins: [] } });

// Auth posts are heavy (bcrypt cost-12 + DB session insert) on the single-threaded
// dev server — run in series.
test.describe.configure({ mode: 'serial' });

const adminEmail = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';

test.skip(
  !adminEmail || !adminPassword,
  'Admin google-sheets tests need E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD (or ADMIN_EMAIL/ADMIN_PASSWORD from .env)',
);

/** A status payload with the six-tab registry and a real-looking cursor. */
const TABS = ['swing', 'daily-rec', 'screener', 'custom', 'decisions', 'metrics'] as const;

/**
 * Mirrors `SheetsStatus` in lib/services/googleSheets/statusService.ts exactly.
 *
 * This payload is the whole point of the route mock, so it has to track the real
 * contract field-for-field. An earlier revision still spoke the pre-console
 * (v3.42) dialect — `configured` / `enabled` / `perTab[].detail` — so the page's
 * `status.oauthConfigured.clientId` threw on undefined and every test in this
 * spec failed inside the global ErrorBoundary. The self-skip on missing admin
 * creds is what kept that invisible; a spec that always skips cannot go red.
 */
function statusBody(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    status: {
      // Env master is on and a config row exists, but the DB switch is off (see
      // the config mock below), so a row still could not be written: that is the
      // exact "why" the console is required to explain, and it keeps Append
      // disabled in every test that does not say otherwise.
      envEnabled: true,
      dbConfigured: true,
      sheetIdMasked: '1AbCd…wXyZ',
      oauthConfigured: { clientId: true, clientSecret: true, refreshToken: true },
      trackingEnabled: false,
      perTab: TABS.map((tab) => ({
        tab,
        headerState: 'matched',
        lastMark: tab === 'swing' ? '2026-09-26T04:30:00.000Z' : null,
      })),
    },
    sync: {
      confirmThreshold: 100,
      unreadableCap: 200,
      tabs: TABS.map((tab) => ({
        tab,
        queued: tab === 'swing' ? 3 : 0,
        retained: tab === 'swing' ? 5 : 0,
        unreadable: tab === 'swing' ? 2 : 0,
        // Only swing has unreadable rows here, so the destructive control appears
        // on exactly one row and row-scoped locators stay unambiguous.
        unreadableSeqs: tab === 'swing' ? [412, 413] : [],
        cursor: tab === 'swing' ? '410' : null,
      })),
    },
    ...overrides,
  };
}

/**
 * Admin login. Mirrors e2e/decision-monitoring.spec.ts: the single-threaded dev
 * server can resolve authorize() server-side yet never complete the 302, leaving
 * the filled form on /auth/signin with no error. A fast URL probe plus reload,
 * up to 3 attempts, recovers from it.
 */
async function loginAsAdmin(page: import('@playwright/test').Page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.getByPlaceholder('you@example.com').fill(adminEmail);
    await page.getByPlaceholder('••••••••').fill(adminPassword);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    try {
      if (attempt === 3) {
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
        /* still on /auth/signin — re-submit */
      }
    }
  }
}

/** Admin login, then land on the console with its read-only routes mocked. */
async function openConsole(page: import('@playwright/test').Page) {
  await page.goto('/auth/signin');
  await loginAsAdmin(page);

  await page.route('**/api/admin/google-sheets/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statusBody()) }),
  );
  await page.route('**/api/admin/google-sheets/config', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        config: { sheetIdMasked: '1AbCd…wXyZ', displayName: 'Tracker', enabled: false, lastSyncAt: null, tabMarks: {} },
      }),
    }),
  );

  await page.goto('/admin/google-sheets');
  await expect(page.getByRole('heading', { name: 'Google Sheets Tracking' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Tabs & queue' })).toBeVisible({ timeout: 30_000 });
}

/** The table row for one tab, so actions can be scoped without index maths. */
function tabRow(page: import('@playwright/test').Page, tab: string) {
  return page.getByRole('row').filter({ has: page.getByRole('cell').filter({ hasText: new RegExp(`^${tab}$`) }) });
}

/**
 * The console's own error banner.
 *
 * `getByRole('alert')` alone is ambiguous here: Next.js keeps a live region at
 * `#__next-route-announcer__` with `role="alert"`, so a strict locator resolves
 * to two nodes and the assertion dies on a strict-mode violation instead of
 * reading the message. Everything the console says about a refusal goes through
 * this one element, so exclude the announcer by id.
 */
function errorBanner(page: import('@playwright/test').Page) {
  return page.locator('div[role="alert"]:not(#__next-route-announcer__)');
}

test('console renders the six-tab queue and the metrics contract', async ({ page }) => {
  await openConsole(page);

  // Six registry rows, and the two count columns are kept separate on purpose.
  for (const tab of TABS) {
    await expect(tabRow(page, tab)).toBeVisible();
  }
  const swing = tabRow(page, 'swing');
  await expect(swing.getByRole('cell').nth(2)).toHaveText('3'); // queued
  await expect(swing.getByRole('cell').nth(3)).toHaveText('5'); // retained
  await expect(swing.getByRole('cell').nth(5)).toHaveText('410'); // cursor

  // Unreadable rows are collapsed behind a disclosure, and the seqs are the
  // input to the destructive action — so they must be visible once expanded.
  await swing.getByText('2 row(s)').click();
  await expect(swing.getByText('412, 413')).toBeVisible();

  // Metrics is opt-in: nothing is computed until Preview is pressed, and the
  // Append button is disabled until there is a snapshot.
  await expect(page.getByText('Preview to compute the current projection.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Append snapshot' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Preview' })).toBeEnabled();
});

test('Rescan posts the right body and reports queued vs appended', async ({ page }) => {
  await openConsole(page);

  // screener: no config id, and the producer's own append is delegated to it —
  // so the notice must say "queued ... Sync to append them".
  const seen: Array<{ body: string; url: string }> = [];
  await page.route('**/api/admin/google-sheets/rescan', async (r) => {
    const req = r.request();
    seen.push({ url: req.url(), body: req.postData() ?? '' });
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        tab: 'screener',
        appended: 4,
        total: 9,
        delegatedExport: true,
        executionMs: 1200,
        elapsedMs: 1300,
        rowLimit: 200,
      }),
    });
  });

  await tabRow(page, 'screener').getByRole('button', { name: 'Rescan' }).click();

  // The request body is the contract: screener sends NO configId.
  await expect.poll(() => seen.length).toBe(1);
  expect(JSON.parse(seen[0].body)).toEqual({ tab: 'screener' });
  // 4 of 9 matches, under the cap, and the delegated-append caveat is surfaced.
  await expect(page.getByRole('status')).toContainText('queued 4 row(s) of 9 matches (cap 200)');
  await expect(page.getByRole('status')).toContainText('Sync to append them.');

  // custom: requires a config id, and is refused client-side before any request.
  let customCalls = 0;
  await page.route('**/api/admin/google-sheets/rescan**', async (r) => {
    if (JSON.parse(r.request().postData() ?? '{}').tab === 'custom') {
      customCalls++;
      await r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          tab: 'custom',
          appended: 2,
          total: 2,
          delegatedExport: false,
          executionMs: 300,
          elapsedMs: 310,
          rowLimit: 200,
        }),
      });
      return;
    }
    await r.fallback();
  });

  await tabRow(page, 'custom').getByRole('button', { name: 'Rescan' }).click();
  await expect(errorBanner(page)).toContainText('Enter the saved config id');
  expect(customCalls).toBe(0); // guarded client-side, so nothing was sent

  await page.getByLabel('Saved config id to re-scan into the custom tab').fill('cfg_abc123');
  await tabRow(page, 'custom').getByRole('button', { name: 'Rescan' }).click();

  await expect.poll(() => customCalls).toBe(1);
  // No "Sync to append them" here: custom awaited its own export.
  await expect(page.getByRole('status')).toContainText('queued 2 row(s)');
  await expect(page.getByRole('status')).not.toContainText('Sync to append them.');
});

test('Remove unreadable confirms the exact seqs, then deletes only those', async ({ page }) => {
  await openConsole(page);

  let deleted: unknown = null;
  await page.route('**/api/admin/google-sheets/ledger', async (r) => {
    expect(r.request().method()).toBe('DELETE');
    deleted = JSON.parse(r.request().postData() ?? '{}');
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, tab: 'swing', requested: 2, deleted: 2 }),
    });
  });

  // Cancelling the confirm must NOT issue the request — the dialog names the
  // rows being destroyed, so dismissing it has to be a true no-op.
  page.once('dialog', (d) => d.dismiss());
  await tabRow(page, 'swing').getByRole('button', { name: 'Remove unreadable' }).click();
  await expect(page.getByRole('heading', { name: 'Google Sheets Tracking' })).toBeVisible();
  expect(deleted).toBeNull();

  // Accepting sends exactly the seqs the console displayed, scoped to the tab.
  let confirmText = '';
  page.once('dialog', (d) => {
    confirmText = d.message();
    void d.accept();
  });
  await tabRow(page, 'swing').getByRole('button', { name: 'Remove unreadable' }).click();

  await expect.poll(() => deleted).not.toBeNull();
  expect(deleted).toEqual({ tab: 'swing', seqs: [412, 413] });
  expect(confirmText).toContain('Delete 2 unreadable row(s) from "swing"');
  expect(confirmText).toContain('412, 413');
  await expect(page.getByRole('status')).toContainText('Removed 2 unreadable row(s) from swing.');
});

test('a refused delete surfaces the server error instead of claiming success', async ({ page }) => {
  await openConsole(page);

  // The server re-checks every row; a 409 means a guard tripped mid-flight. The
  // console must show the reason and must NOT report rows as removed.
  await page.route('**/api/admin/google-sheets/ledger', (r) =>
    r.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'row 412 is no longer unreadable' }),
    }),
  );

  page.once('dialog', (d) => void d.accept());
  await tabRow(page, 'swing').getByRole('button', { name: 'Remove unreadable' }).click();

  await expect(errorBanner(page)).toContainText('row 412 is no longer unreadable');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('metrics preview renders null KPIs as a dash, not zero', async ({ page }) => {
  await openConsole(page);

  await page.route('**/api/admin/google-sheets/metrics', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        ok: true,
        // netPnlPct / avgReturnPct are null because nothing has closed yet: that
        // is an absence, and rendering it as 0% would misreport the tracker.
        snapshot: {
          snapshotAt: '2026-09-27T10:00:00.000Z',
          totalTracked: 12,
          active: 4,
          targetAchieved: 3,
          stopLossHit: 1,
          expired: 4,
          winRate: 75,
          netPnlAbs: 4200.5,
          netPnlPct: null,
          avgReturnPct: null,
          grossPnlAbs: 9800.25,
        },
      }),
    }),
  );

  await page.getByRole('button', { name: 'Preview' }).click();

  // Anchor the row on a rendered KPI, never on `snapshotAt`: the console
  // formats the timestamp with `toLocaleString()`, so the ISO value is not in
  // the DOM and matching on it (or on a specific date string) would make this
  // assertion depend on the machine's locale.
  const row = page.getByRole('row').filter({ hasText: '75.00%' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('12'); // tracked
  await expect(row).toContainText('75.00%'); // win rate
  await expect(row).toContainText('₹4200.50'); // net P&L
  // Two "—" cells (net % and avg return) and NOT a "0.00%".
  await expect(row.getByText('—')).toHaveCount(2);
  await expect(row).not.toContainText('0.00%');
});

test('a held database disables Append and says no row was queued', async ({ page }) => {
  await openConsole(page);

  // P6003 plan-limit hold: the console must explain it and must never offer to
  // append a fabricated all-zero snapshot.
  await page.route('**/api/admin/google-sheets/metrics', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, ok: false, reason: 'db_unavailable', snapshot: null }),
    }),
  );

  await page.getByRole('button', { name: 'Preview' }).click();

  await expect(page.getByText(/database is held \(plan limit\)/i)).toBeVisible();
  await expect(page.getByText('No row is queued.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Append snapshot' })).toBeDisabled();
});

test.describe('Google Sheets console — mobile viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('queue table scrolls and actions stay reachable at 375px', async ({ page }) => {
    await openConsole(page);

    // The table is wide (7 columns); it must scroll rather than overflow the
    // page, and the row actions must remain clickable.
    const scroller = page.locator('div.overflow-x-auto').first();
    await expect(scroller).toBeVisible();

    await expect(tabRow(page, 'swing')).toBeVisible();
    await expect(tabRow(page, 'screener').getByRole('button', { name: 'Rescan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();

    // No horizontal page overflow at 375px.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
