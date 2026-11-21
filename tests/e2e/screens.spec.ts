import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { login, waitForCards } from './helpers';

// Review screenshots for the visual pass. Only runs with SHOTS=1 (see .unlazy/frontend).
test.skip(!process.env.SHOTS, 'set SHOTS=1 to capture review screenshots');

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
  { width: 390, height: 844 },
];
const THEMES = ['light', 'dark'] as const;
const OUT = path.resolve('.unlazy/frontend/shots');

for (const size of SIZES) {
  for (const theme of THEMES) {
    test(`${size.width}x${size.height} ${theme}`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      await page.setViewportSize(size);
      await page.addInitScript((t) => localStorage.setItem('desk-theme', t), theme);
      await login(page);
      await waitForCards(page);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(OUT, `${size.width}x${size.height}-${theme}.png`), fullPage: true });
    });
  }
}

// Settings and login pages.
for (const theme of THEMES) {
  for (const size of [SIZES[0]!, SIZES[3]!]) {
    test(`settings ${size.width}x${size.height} ${theme}`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      await page.setViewportSize(size);
      await page.addInitScript((t) => localStorage.setItem('desk-theme', t), theme);
      await login(page);
      await page.goto('/settings');
      await page.getByText('Save settings').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(OUT, `settings-${size.width}x${size.height}-${theme}.png`), fullPage: true });
    });
  }
  test(`login 1440x900 ${theme}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((t) => localStorage.setItem('desk-theme', t), theme);
    await page.goto('/login');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, `login-1440x900-${theme}.png`), fullPage: true });
  });
}
