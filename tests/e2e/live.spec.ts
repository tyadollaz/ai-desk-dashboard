import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { LIVE_PASSWORD, LIVE_URL, login, waitForCards } from './helpers';

test.use({ baseURL: LIVE_URL });

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test.describe('live mode without credentials', () => {
  test('demo password is rejected; real password shows Setup needed and no demo content', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Password').fill('demo');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect password');

    await login(page, LIVE_PASSWORD);
    await waitForCards(page);
    await expect(page.getByText('Demo mode')).toHaveCount(0);
    await expect(page.locator('.badge')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('[Demo]');
    await expect(page.getByText(/Setup needed/).first()).toBeVisible();
    // A card in a setup state offers a way to Settings
    await expect(page.getByRole('link', { name: 'Open Settings' }).first()).toBeVisible();
  });

  test('settings page shows provider setup text', async ({ page }) => {
    await login(page, LIVE_PASSWORD);
    await page.goto('/settings');
    await expect(page.getByText(/Setup needed:/).first()).toBeVisible();
  });
});

test.describe('secrets never leak', () => {
  test('built client assets contain no sentinel', () => {
    const files = walk(path.resolve('dist/client'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(f, 'latin1'), f).not.toContain('SENTINEL_');
  });

  test('API responses contain no sentinel; server log contains none', async ({ page }) => {
    const request = page.request; // shares the browser session cookie
    const headers = { 'X-Desk-Request': '1', Origin: LIVE_URL };
    await login(page, LIVE_PASSWORD);
    await waitForCards(page);
    const bodies: string[] = [];
    for (const url of ['/api/dashboard', '/api/settings', '/api/auth/session']) {
      const r = await request.get(url);
      expect(r.status()).toBe(200);
      bodies.push(await r.text());
    }
    for (const id of ['lta', 'weather', 'canvas', 'google', 'garmin']) {
      const r = await request.post(`/api/providers/${id}/refresh`, { headers });
      bodies.push(await r.text());
    }
    await page.goto('/settings');
    await expect(page.getByText(/Setup needed:/).first()).toBeVisible();
    bodies.push(await page.content());
    for (const b of bodies) expect(b).not.toContain('SENTINEL_');

    await new Promise((r) => setTimeout(r, 500)); // let the log flush
    const log = readFileSync(path.resolve('test-results/e2e-state/logs/live.log'), 'utf8');
    expect(log.length).toBeGreaterThan(0);
    expect(log).not.toContain('SENTINEL_');
  });
});
