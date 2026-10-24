import type { Page } from '@playwright/test';

import { criteriaText } from '../apps/web/src/i18n/index.ts';
import { expect, openCriteria, test } from './test.ts';

// Annecy: the stand-in graph covers it, with rolling hills for the elevation gain.
const START = '45.8992, 6.1294';
const en = criteriaText.en;

// The map eases to the start point typed: the tap has to wait for it to settle.
async function setStart(page: Page) {
  await page.goto('/');
  await openCriteria(page);
  await page.getByTestId('criteria-start').fill(START);
  await page.getByTestId('criteria-start').press('Enter');
  await page.getByTestId('sub-page-back').click();
  await page.waitForTimeout(800);
}

// The start point sits at the centre of the map: a tap this far east lands away from it, and clear of the bar, the
// sheet and the buttons.
async function tapEast(page: Page, pixels: number) {
  const { width, height } = page.viewportSize()!;
  await page.touchscreen.tap(width / 2 + pixels, height / 2);
}

/** The distance between two positions, in metres, as the server measures it on a small circle. */
function metresBetween([lng1, lat1]: number[], [lng2, lat2]: number[]) {
  const rad = Math.PI / 180;
  const dLat = (lat2! - lat1!) * rad;
  const dLng = (lng2! - lng1!) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1! * rad) * Math.cos(lat2! * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

test.describe('the areas to avoid of a phone', () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'The button over the map is for phones.'));

  test('are drawn, resized and removed with a finger', async ({ page }) => {
    await setStart(page);
    const button = page.getByTestId('criteria-avoided');
    await expect(button).toHaveAccessibleName(en.addAvoidedArea);

    await button.click();
    await expect(page.getByTestId('criteria-avoided-bar')).toContainText(en.placeAvoidedAreaTouch);
    await expect(button).toHaveAttribute('aria-pressed', 'true');

    await tapEast(page, 140);

    const badge = page.getByTestId('criteria-avoided-marker');
    await expect(badge).toHaveCount(1);
    await badge.tap();

    const value = page.getByTestId('criteria-avoided-radius-value');
    const before = await value.textContent();
    await page.getByTestId('criteria-avoided-radius-plus').click();
    await expect(value).not.toHaveText(before!);

    await page.getByTestId('criteria-avoided-bubble-remove').click();

    await expect(badge).toHaveCount(0);
  });

  test('keep the start point, the waypoints and the routes clear of them', async ({ page }) => {
    await setStart(page);
    await page.getByTestId('criteria-avoided').click();
    await tapEast(page, 140);
    // A circle wide enough to reach the waypoint below, and still clear of the start point.
    await page.getByTestId('criteria-avoided-marker').tap();
    await page.getByTestId('criteria-avoided-radius').press('End');
    await page.getByTestId('criteria-avoided-done').click();
    // A tap on the map, below the bubble, puts it away, as a popover does.
    const { width, height } = page.viewportSize()!;
    await page.touchscreen.tap(width / 2, height / 2 + 120);

    // A waypoint in the circle is refused before the server hears of it: 30 px north of the area's centre, clear of
    // its badge and inside the circle whatever the zoom the map settled at.
    await page.getByTestId('criteria-waypoint').click();
    await page.touchscreen.tap(width / 2 + 140, height / 2 - 30);
    await expect(page.getByTestId('criteria-waypoint-refused')).toContainText(en.waypointInAvoidedArea);
    await page.getByTestId('criteria-waypoint-done').click();

    await openCriteria(page);
    const [request, response] = await Promise.all([
      page.waitForRequest((request) => request.url().endsWith('/api/v1/route-sets')),
      page.waitForResponse((response) => response.url().endsWith('/api/v1/route-sets')),
      page.getByTestId('criteria-submit').click(),
    ]);
    await expect(page.getByTestId('routes-count')).toBeVisible();

    const asked = request.postDataJSON() as { avoidedAreas: { center: number[]; radius: number }[] };
    expect(asked.avoidedAreas).toHaveLength(1);
    const area = asked.avoidedAreas[0]!;
    for (const route of (await response.json()).routes as { geometry: number[][] }[]) {
      for (const [lng, lat] of route.geometry) {
        expect(metresBetween(area.center, [lng!, lat!]), 'a route goes through an area to avoid').toBeGreaterThan(
          area.radius - 5,
        );
      }
    }
  });
});
