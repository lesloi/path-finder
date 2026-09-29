import type { Page } from '@playwright/test';

import { expect, test } from './test.ts';

// Both layouts also show it next to the start point: take the one over the map, which comes first.
const myLocationButton = (page: Page) => page.getByRole('button', { name: 'My location' }).first();

// A touch on phones, a mouse press on desktops. Playwright's touchscreen only taps, hence the DevTools protocol.
async function longPress(page: Page, isMobile: boolean) {
  const { width, height } = page.viewportSize()!;
  // Over the map, clear of the left column and of the bottom sheet.
  const x = width * 0.7;
  const y = height * 0.35;
  // Longer than the map's 500 ms long press.
  const HOLD_MS = 700;
  if (isMobile) {
    const devTools = await page.context().newCDPSession(page);
    await devTools.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(HOLD_MS);
    await devTools.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
}

test.describe('the start point', () => {
  test('is set by a long press on the map', async ({ page, isMobile }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await longPress(page, isMobile);

    await expect(page.getByLabel('Start point')).toHaveValue(/° N · .*° E$/);
  });

  test('is set by "My location" when the location is allowed', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 45.8326, longitude: 6.8652 });
    await page.goto('/');

    await myLocationButton(page).click();

    await expect(page.getByLabel('Start point')).toHaveValue('45.8326° N · 6.8652° E');
  });

  test('falls back to the map when the location is denied', async ({ page }) => {
    // Without a granted permission, headless Chromium dismisses the prompt: the location is denied.
    await page.goto('/');

    await myLocationButton(page).click();

    await expect(page.getByRole('alert')).toContainText('Your location is unavailable.');
  });
});
