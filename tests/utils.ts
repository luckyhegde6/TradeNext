import { test, expect, type Page } from '@playwright/test';

const DEMO_USER = {
  email: process.env.DEMO_EMAIL || 'demo@tradenext.in',
  password: process.env.DEMO_PASSWORD || '',
};

const ADMIN_USER = {
  email: process.env.ADMIN_EMAIL || 'admin@tradenext6.app',
  password: process.env.ADMIN_PASSWORD || '',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/auth/signin');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
}

async function loginAsAdmin(page: Page) {
  await login(page, ADMIN_USER.email, ADMIN_USER.password);
}

async function loginAsDemo(page: Page) {
  await login(page, DEMO_USER.email, DEMO_USER.password);
}

export { login, loginAsAdmin, loginAsDemo, DEMO_USER, ADMIN_USER };
