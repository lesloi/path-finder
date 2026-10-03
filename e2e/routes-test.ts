import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { expect, test } from './test.ts';

// Annecy: the stand-in graph (`apps/server/internal/standin`) covers it, with rolling hills for the elevation gain.
const START = '45.8992, 6.1294';

async function findRoutes(page: Page) {
  await page.goto('/');
  await page.getByTestId('criteria-start').fill(START);
  await page.getByTestId('criteria-start').press('Enter');
  await page.getByTestId('criteria-submit').click();
  await expect(page.getByTestId('routes-count')).toBeVisible();
}

// A swipe with a finger over the detail, through the DevTools protocol: Playwright's touchscreen only taps.
async function swipeLeft(page: Page) {
  const box = (await page.getByTestId('route-figures').boundingBox())!;
  const y = box.y + box.height / 2;
  const [from, to] = [box.x + box.width * 0.9, box.x + box.width * 0.2];
  const devTools = await page.context().newCDPSession(page);
  await devTools.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
  await devTools.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: (from + to) / 2, y }] });
  await devTools.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to, y }] });
  await devTools.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('the route set', () => {
  test('lists the routes of the criteria', async ({ page }) => {
    await findRoutes(page);

    await expect(page.getByTestId('routes-row-0')).toBeVisible();
    await expect(page.getByTestId('routes-row-1')).toBeVisible();
    await expect(page.getByTestId('routes-row-2')).toBeVisible();
    await expect(page.getByTestId('routes-row-0-distance')).toHaveText(/^\d+\.\d km$/);
  });

  test('shows the elevation gain of each route', async ({ page }) => {
    await findRoutes(page);

    await expect(page.getByTestId('routes-row-0-gain')).toBeVisible();
    await expect(page.getByTestId('routes-row-0-profile')).toBeVisible();
  });

  test('goes back to the criteria, still set', async ({ page }) => {
    await findRoutes(page);

    await page.getByTestId('routes-back').click();

    await expect(page.getByTestId('criteria-submit')).toBeVisible();
    await expect(page.getByTestId('criteria-start')).toHaveValue('45.8992° N · 6.1294° E');
  });

  test('keeps the routes found when going back to the criteria', async ({ page }) => {
    await findRoutes(page);

    await page.getByTestId('routes-back').click();
    await page.getByTestId('criteria-routes').click();

    await expect(page.getByTestId('routes-row-0')).toBeVisible();
  });

  test('opens the detail of a route and moves to the next one', async ({ page, isMobile }) => {
    await findRoutes(page);

    await page.getByTestId('routes-row-0').click();
    await expect(page.getByTestId('route-position')).toHaveText(/^1\/\d$/);
    // On phones, the collapsed sheet stops at the figures: its handle expands it to the surface breakdown.
    if (isMobile) await page.getByTestId('criteria-sheet-handle').click();
    // The stand-in graph has paved streets west of the start and rough tracks east of it: a share of each.
    await expect(page.getByTestId('route-surface')).toContainText(/\d+%/);
    await expect(page.getByTestId('route-climb')).toBeVisible();
    await expect(page.getByTestId('route-descent')).toBeVisible();
    await expect(page.getByTestId('route-profile')).toBeVisible();

    if (isMobile) await swipeLeft(page);
    else await page.getByTestId('route-next').click();

    await expect(page.getByTestId('route-position')).toHaveText(/^2\/\d$/);
  });

  test('exports the route as a GPX file', async ({ page, isMobile }) => {
    await findRoutes(page);
    await page.getByTestId('routes-row-0').click();
    // On phones, the collapsed sheet stops at the figures: its handle expands it to the export.
    if (isMobile) await page.getByTestId('criteria-sheet-handle').click();

    const download = page.waitForEvent('download');
    await page.getByTestId('route-export').click();

    const file = await download;
    // The elevation gain is in the name, and every point carries its height.
    expect(file.suggestedFilename()).toMatch(/^(Run|Course)-\d{4}-\d+km_\d+m\.gpx$/);
    expect(await readFile((await file.path())!, 'utf8')).toContain('<ele>');
  });
});
