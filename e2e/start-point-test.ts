import type { Page } from '@playwright/test';

import { criteriaText } from '../apps/web/src/i18n/index.ts';
import { expect, openCriteria, openMap, test } from './test.ts';

// Longer than the map's 500 ms long press.
const LONG_PRESS_HOLD_MS = 700;

const startPoint = (page: Page) => page.getByTestId('criteria-start');
// The one over the map: desktops also show one next to the start point.
const myLocationButton = (page: Page) => page.getByTestId('criteria-locate');

// A touch on phones, a mouse press on desktops. Playwright's touchscreen only taps, hence the DevTools protocol.
async function longPress(page: Page, isMobile: boolean) {
  const { width, height } = page.viewportSize()!;
  // Over the map, clear of the left column, the bar at the top and the bottom sheet.
  const x = width * 0.7;
  const y = height * 0.35;
  if (isMobile) {
    const devTools = await page.context().newCDPSession(page);
    await devTools.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(LONG_PRESS_HOLD_MS);
    await devTools.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(LONG_PRESS_HOLD_MS);
  await page.mouse.up();
}

test.describe('the start point', () => {
  test('is set by a long press on the map', async ({ page, isMobile }) => {
    await openMap(page);

    await longPress(page, isMobile);

    await openCriteria(page);
    await expect(startPoint(page)).toHaveValue(/° N · .*° E$/);
  });

  test('is set by "My location" when the location is allowed', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 45.8326, longitude: 6.8652 });
    await page.goto('/');

    await myLocationButton(page).click();

    await openCriteria(page);
    await expect(startPoint(page)).toHaveValue('45.8326° N · 6.8652° E');
  });

  test('is set by typed coordinates', async ({ page }) => {
    await page.goto('/');
    await openCriteria(page);

    await startPoint(page).fill('45.8326, 6.8652');
    await startPoint(page).press('Enter');

    await expect(startPoint(page)).toHaveValue('45.8326° N · 6.8652° E');
  });

  test('falls back to the map when the location is denied', async ({ page }) => {
    // Without a granted permission, headless Chromium dismisses the prompt: the location is denied.
    await page.goto('/');

    await myLocationButton(page).click();

    await expect(page.getByTestId('criteria-toast')).toContainText(criteriaText.en.unavailable);
  });
});
