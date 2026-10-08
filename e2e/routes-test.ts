import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { expect, openCriteria, test } from './test.ts';

// Annecy: the stand-in graph (`apps/server/internal/standin`) covers it, with rolling hills for the elevation gain.
const START = '45.8992, 6.1294';

async function search(page: Page) {
  await openCriteria(page);
  await page.getByTestId('criteria-start').fill(START);
  await page.getByTestId('criteria-start').press('Enter');
  await page.getByTestId('criteria-submit').click();
  await expect(page.getByTestId('routes-count')).toBeVisible();
}

async function findRoutes(page: Page) {
  await page.goto('/');
  await search(page);
}

// A swipe with a finger over an element, through the DevTools protocol: Playwright's touchscreen only taps.
async function swipeLeft(page: Page, testId: string) {
  const box = (await page.getByTestId(testId).boundingBox())!;
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

  test('asks again by itself when the server is busy, and shows the routes', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/v1/route-sets', (route) => {
      requests++;
      // The first answer is a refusal for lack of a free slot; the retry reaches the real server.
      return requests === 1
        ? route.fulfill({ status: 429, headers: { 'Retry-After': '1' }, json: { error: 'overloaded' } })
        : route.continue();
    });

    await findRoutes(page);

    await expect(page.getByTestId('routes-row-0')).toBeVisible();
    await expect(page.getByTestId('routes-toast')).toHaveCount(0);
    expect(requests).toBe(2);
  });

  test('shows the elevation gain of each route', async ({ page }) => {
    await findRoutes(page);

    await expect(page.getByTestId('routes-row-0-gain')).toBeVisible();
    await expect(page.getByTestId('routes-row-0-profile')).toBeVisible();
  });

  test('badges the routes with a technical stretch only once they are included', async ({ page }) => {
    const badge = page.locator('[data-testid^="routes-row-"][data-testid$="-technical"]');
    await page.goto('/');
    await openCriteria(page);
    await page.locator('label', { has: page.getByTestId('criteria-surface-unpaved') }).click();

    // The stand-in graph tags the tracks 1.2 km east of the start as technical.
    await search(page);
    await expect(page.getByTestId('routes-row-0')).toBeVisible();
    await expect(badge).toHaveCount(0);

    await openCriteria(page);
    await page.locator('label', { has: page.getByTestId('criteria-technical') }).click();
    await search(page);

    await expect(page.getByTestId('routes-row-0')).toBeVisible();
    await expect(badge.first()).toBeVisible();
  });

  test('shows the criteria, still set', async ({ page }) => {
    await findRoutes(page);

    // A desktop shows the criteria beside the routes; a phone, in a layer over them.
    await openCriteria(page);

    await expect(page.getByTestId('criteria-submit')).toBeVisible();
    await expect(page.getByTestId('criteria-start')).toHaveValue('45.8992° N · 6.1294° E');
  });

  test('keeps the routes found under the criteria layer of a phone', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'A desktop shows the criteria and the routes together.');
    await findRoutes(page);

    await openCriteria(page);
    await page.getByTestId('sub-page-back').click();

    await expect(page.getByTestId('routes-row-0')).toBeVisible();
  });

  test('selects the route a swipe settles on in the carousel of a phone', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'The carousel is for phones.');
    await findRoutes(page);
    await expect(page.getByTestId('routes-position')).toHaveText(/^1\/\d$/);

    await swipeLeft(page, 'routes-list');

    await expect(page.getByTestId('routes-position')).toHaveText(/^2\/\d$/);
    await expect(page.getByTestId('routes-row-1')).toHaveAttribute('data-selected', '');
  });

  test('opens the detail of a route and moves to the next one', async ({ page, isMobile }) => {
    await findRoutes(page);

    // On phones, the first card is in the middle: a tap on it opens its detail.
    await page.getByTestId('routes-row-0').click();
    await expect(page.getByTestId('route-position')).toHaveText(isMobile ? /^1\/\d$/ : /1/);
    // The stand-in graph has paved streets west of the start and rough tracks east of it: a share of each.
    await expect(page.getByTestId('route-surface')).toContainText(/\d+%/);
    await expect(page.getByTestId('route-climb')).toBeVisible();
    await expect(page.getByTestId('route-descent')).toBeVisible();
    await expect(page.getByTestId('route-profile')).toBeVisible();

    if (isMobile) await swipeLeft(page, 'route-figures');
    // On desktops, the list stays beside the dock: another row moves the dock to its route.
    else await page.getByTestId('routes-row-1').click();

    await expect(page.getByTestId('route-position')).toHaveText(isMobile ? /^2\/\d$/ : /2/);
  });

  test.describe('on desktops', () => {
    test.beforeEach(({ isMobile }) => test.skip(isMobile, 'The dock is for desktops.'));

    test('selects no route at first, and opens the dock on a click', async ({ page }) => {
      await findRoutes(page);
      await expect(page.getByTestId('route-dock')).toHaveCount(0);

      await page.getByTestId('routes-row-1').click();

      await expect(page.getByTestId('route-dock')).toBeVisible();
      // The criteria are still there to change.
      await expect(page.getByTestId('criteria-submit')).toBeVisible();
    });

    test('closes the dock with the button, Escape and a click on the map', async ({ page }) => {
      await findRoutes(page);

      await page.getByTestId('routes-row-0').click();
      await page.getByTestId('route-close').click();
      await expect(page.getByTestId('route-dock')).toHaveCount(0);

      await page.getByTestId('routes-row-0').click();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('route-dock')).toHaveCount(0);

      await page.getByTestId('routes-row-0').click();
      // Over the map under the left column, where the routes are framed clear of.
      await page.mouse.click(200, page.viewportSize()!.height - 20);
      await expect(page.getByTestId('route-dock')).toHaveCount(0);
    });

    test('says the routes are stale once the criteria change', async ({ page }) => {
      await findRoutes(page);

      await page.locator('label', { has: page.getByTestId('criteria-surface-unpaved') }).click();

      await expect(page.getByTestId('routes-stale')).toBeVisible();
      await page.getByTestId('routes-search-again').click();
      await expect(page.getByTestId('routes-stale')).toHaveCount(0);
      await expect(page.getByTestId('routes-row-0')).toBeVisible();
    });
  });

  test('exports the route as a GPX file', async ({ page }) => {
    await findRoutes(page);
    await page.getByTestId('routes-row-0').click();

    const download = page.waitForEvent('download');
    await page.getByTestId('route-export').click();

    const file = await download;
    // The elevation gain is in the name, and every point carries its height.
    expect(file.suggestedFilename()).toMatch(/^\d{4}-\d+km_\d+m\.gpx$/);
    expect(await readFile((await file.path())!, 'utf8')).toContain('<ele>');
  });
});
