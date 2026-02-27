import { test, expect, type Page } from '@playwright/test';

const DEMO_USER = {
  email: 'demo@tradenext.in',
  password: 'demo123',
};

const ADMIN_USER = {
  email: 'admin@tradenext6.app',
  password: 'admin123',
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
