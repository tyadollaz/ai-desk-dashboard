import { expect, test, type Page } from '@playwright/test';
import { login, waitForCards } from './helpers';

async function box(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox();
  expect(b, sel).not.toBeNull();
  return b!;
}

async function noHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(r.sw).toBeLessThanOrEqual(r.iw);
}

test.describe('1440x900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('no overflow; bus, weather, calendar, canvas tops (and all cards) inside viewport', async ({ page }) => {
    await login(page);
    await waitForCards(page);
    await noHorizontalOverflow(page);
    for (const c of ['lta', 'weather', 'google', 'canvas', 'garmin']) {
      const b = await box(page, `section.card-${c}`);
      expect(b.y, `${c} top`).toBeGreaterThanOrEqual(0);
      expect(b.y, `${c} top inside viewport`).toBeLessThan(900);
    }
  });
  // Informational: records (does not fail on) which cards extend below the fold at 1440x900.
  test('report which cards are fully visible without scrolling', async ({ page }) => {
    await login(page);
    await waitForCards(page);
    for (const c of ['lta', 'weather', 'google', 'canvas', 'garmin']) {
      const b = await box(page, `section.card-${c}`);
      test.info().annotations.push({ type: 'fold', description: `${c}: top=${Math.round(b.y)} bottom=${Math.round(b.y + b.height)} fullyVisible=${b.y + b.height <= 900}` });
    }
  });
});

test.describe('1024x600', () => {
  test.use({ viewport: { width: 1024, height: 600 } });
  test('time, next event, next deadline, bus, weather visible without scrolling', async ({ page }) => {
    await login(page);
    await waitForCards(page);
    await noHorizontalOverflow(page);
    const vh = 600;
    const sels: Record<string, string> = {
      time: 'header.app-header .time',
      'next event (overview bullet)': '.briefing li:has-text("Next event")',
      'next deadline (overview bullet)': '.briefing li:has-text("Canvas deadline")',
      bus: 'section.card-lta',
      weather: 'section.card-weather',
    };
    const failures: string[] = [];
    for (const [name, sel] of Object.entries(sels)) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) {
        failures.push(`${name}: not found`);
        continue;
      }
      const b = (await loc.boundingBox())!;
      if (b.y < 0 || b.y + b.height > vh) failures.push(`${name}: y=${Math.round(b.y)} bottom=${Math.round(b.y + b.height)}`);
    }
    expect(failures, failures.join('; ')).toEqual([]);
  });
});

test.describe('390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('no overflow and cards stack in a single column', async ({ page }) => {
    await login(page);
    await waitForCards(page);
    await noHorizontalOverflow(page);
    const lefts = await page.locator('section.card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(1);
  });
});
