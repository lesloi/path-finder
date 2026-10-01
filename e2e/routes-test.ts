import type { Page } from '@playwright/test';

import { expect, test } from './test.ts';

// Annecy: the fake BRouter (`fake-brouter.ts`) answers from anywhere.
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

  test('goes back to the criteria, still set', async ({ page }) => {
    await findRoutes(page);

    await page.getByTestId('routes-back').click();

    await expect(page.getByTestId('criteria-submit')).toBeVisible();
    await expect(page.getByTestId('criteria-start')).toHaveValue('45.8992° N · 6.1294° E');
  });

  test('opens the detail of a route and moves to the next one', async ({ page, isMobile }) => {
    await findRoutes(page);

    await page.getByTestId('routes-row-0').click();
    await expect(page.getByTestId('route-position')).toHaveText(/^1\/\d$/);
    await expect(page.getByTestId('route-surface')).toContainText('50%');

    if (isMobile) await swipeLeft(page);
    else await page.getByTestId('route-next').click();

    await expect(page.getByTestId('route-position')).toHaveText(/^2\/\d$/);
  });

  test('exports the route as a GPX file', async ({ page }) => {
    await findRoutes(page);
    await page.getByTestId('routes-row-0').click();

    const download = page.waitForEvent('download');
    await page.getByTestId('route-export').click();

    expect((await download).suggestedFilename()).toMatch(/^(Run|Course)-\d{4}-\d+km\.gpx$/);
  });
});
