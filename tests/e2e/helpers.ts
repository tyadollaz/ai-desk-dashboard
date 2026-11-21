import { expect, type Page } from '@playwright/test';

export const LIVE_URL = 'http://localhost:4174';
export const LIVE_PASSWORD = 'live-e2e-password';

export async function login(page: Page, password = 'demo', base = '') {
  await page.goto(`${base}/login`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Dashboard actions' })).toBeVisible();
}

export async function waitForCards(page: Page, count = 5) {
  await expect(page.locator('section.card')).toHaveCount(count);
}
