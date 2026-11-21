import { expect, test } from '@playwright/test';
import { login, waitForCards } from './helpers';

test.describe('auth', () => {
  test('unauthenticated / redirects to /login and API is 401', async ({ page, request }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    const res = await request.get('/api/dashboard');
    expect(res.status()).toBe(401);
  });

  test('logout returns to /login and Back does not show dashboard data', async ({ page }) => {
    await login(page);
    await waitForCards(page);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goBack(); // may land on about:blank or a bfcache/re-fetched dashboard route
    await page.waitForLoadState();
    await expect(page.locator('section.card')).toHaveCount(0);
    await expect(page.getByText('Demo mode')).toHaveCount(0);
    await expect(page.locator('.time')).toHaveCount(0);
    // Forward again and a direct visit to / must also end at the login page.
    await page.goForward();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('section.card')).toHaveCount(0);
  });

  test('wrong password shows an error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Password').fill('nope');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect password');
  });
});

test.describe('demo dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForCards(page);
  });

  test('banner, five Demo cards, header time', async ({ page }) => {
    await expect(page.getByText('Demo mode')).toBeVisible();
    for (const name of ['Bus arrivals', 'Weather', 'Canvas', 'Google Calendar', 'Garmin activity']) {
      const card = page.getByRole('region', { name, exact: true });
      await expect(card).toBeVisible();
      await expect(card.getByText('Demo', { exact: true })).toBeVisible();
    }
    await expect(page.locator('header.app-header .time')).toHaveText(/\d{1,2}:\d{2}/);
  });

  test('SPA deep link: reload on /settings works and shows provider setup text', async ({ page }) => {
    await page.goto('/settings');
    await page.reload();
    await expect(page.getByText(/Configured|Setup needed/).first()).toBeVisible();
    const res = await page.request.get('/settings');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
  });

  test('keyboard: Tab reaches refresh, privacy, settings with a visible focus indicator', async ({ page }) => {
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    const wanted = new Set(['Refresh all', 'Privacy: Off', 'Settings']);
    const seen = new Set<string>();
    for (let i = 0; i < 12 && seen.size < wanted.size; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          name: (el.textContent ?? '').trim(),
          outlineStyle: cs.outlineStyle,
          outlineWidth: cs.outlineWidth,
          boxShadow: cs.boxShadow,
        };
      });
      if (info && wanted.has(info.name)) {
        seen.add(info.name);
        const visible = (info.outlineStyle !== 'none' && info.outlineWidth !== '0px') || info.boxShadow !== 'none';
        expect(visible, `focus indicator on ${info.name}`).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual([...wanted].sort());
  });

  test('privacy toggle masks calendar/canvas titles and Garmin values, and restores', async ({ page }) => {
    const calendar = page.getByRole('region', { name: 'Google Calendar' });
    const canvas = page.getByRole('region', { name: 'Canvas', exact: true });
    const garmin = page.getByRole('region', { name: 'Garmin activity' });
    await expect(canvas).toContainText('[Demo] Problem set');
    const calBefore = (await calendar.locator('.row-title').allInnerTexts()).filter(Boolean);
    expect(calBefore.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: /Privacy: Off/ }).click();
    await expect(page.getByRole('button', { name: /Privacy: On/ })).toBeVisible();
    await expect(canvas).not.toContainText('Problem set');
    await expect(canvas.locator('.row-title').first()).toHaveText('•••••');
    for (const t of await calendar.locator('.row-title').allInnerTexts()) expect(t.startsWith('•••••')).toBe(true);
    await expect(garmin.locator('dd').first()).toContainText('•••••');
    await expect(page.locator('.briefing')).not.toContainText('Problem set');

    await page.getByRole('button', { name: /Privacy: On/ }).click();
    await expect(page.getByRole('button', { name: /Privacy: Off/ })).toBeVisible();
    await expect(canvas).toContainText('[Demo] Problem set');
    expect((await calendar.locator('.row-title').allInnerTexts()).filter(Boolean)).toEqual(calBefore);
    await expect(garmin).not.toContainText('•••••');
  });
});
