import { commonText } from '../apps/web/src/i18n/index.ts';
import { expect, openMap, test } from './test.ts';

test.describe('the app', () => {
  test('loads with no console error and serves every file with no referrer and a content security policy', async ({
    page,
    baseURL,
  }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const referrers = new Map<string, string | undefined>();
    const securityPolicies = new Map<string, string | undefined>();
    page.on('response', (response) => {
      if (response.url().startsWith(baseURL!)) {
        referrers.set(response.url(), response.headers()['referrer-policy']);
        securityPolicies.set(response.url(), response.headers()['content-security-policy']);
      }
    });

    await openMap(page);

    expect(errors).toEqual([]);
    expect(referrers.size).toBeGreaterThan(1);
    for (const [url, policy] of referrers) expect(policy, url).toBe('no-referrer');
    for (const [url, policy] of securityPolicies) expect(policy, url).toContain("default-src 'self'");
  });

  test('does not ask for the location on load', async ({ page }) => {
    await page.addInitScript(() => {
      for (const method of ['getCurrentPosition', 'watchPosition'] as const) {
        navigator.geolocation[method] = () => {
          document.documentElement.dataset.geolocation = method;
          return 0;
        };
      }
    });

    await openMap(page);

    await expect(page.locator('html')).not.toHaveAttribute('data-geolocation');
  });

  test('names the map and the toggle of its attribution in the language of the app', async ({ page }) => {
    await openMap(page);
    const map = page.locator('canvas.maplibregl-canvas');
    const toggle = page.locator('.maplibregl-ctrl-attrib-button');

    await expect(map).toHaveAccessibleName(commonText.en.mapName);
    await expect(toggle).toHaveAccessibleName(commonText.en.toggleAttribution);

    // The language changes while the map stays mounted: MapLibre has named its controls by then.
    await page.getByTestId('criteria-settings').click();
    await page.getByTestId('settings-language').selectOption('fr');
    await page.keyboard.press('Escape');

    await expect(map).toHaveAccessibleName(commonText.fr.mapName);
    await expect(toggle).toHaveAccessibleName(commonText.fr.toggleAttribution);
  });

  test('keeps the text of the map controls from being selected', async ({ page }) => {
    await openMap(page);

    // A double click on the map would select it.
    const attribution = page.locator('.maplibregl-ctrl-attrib');
    expect(await attribution.evaluate((element) => getComputedStyle(element).userSelect)).toBe('none');
  });

  test('keeps the map background picked in the settings across a reload', async ({ page }) => {
    await openMap(page);

    await page.getByTestId('criteria-settings').click();
    await page.getByTestId('settings-basemap').selectOption('minimal');
    await page.reload();

    await expect(page.getByTestId('settings-basemap')).toHaveValue('minimal');
  });

  test('goes back to the previous map background when the style of the new one fails to load', async ({
    page,
    context,
  }) => {
    await openMap(page);
    // Registered last, so it answers first: the IGN style of the minimal background is down.
    await context.route('**/PLAN.IGN/epure.json', (route) => route.abort('failed'));

    await page.getByTestId('criteria-settings').click();
    await page.getByTestId('settings-basemap').selectOption('minimal');

    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('path-finder.settings')!).basemap);
    await expect.poll(saved).toBe('plan');
    await expect(page.getByTestId('settings-basemap')).toHaveValue('plan');
    await expect(page.getByTestId('settings-basemap-error')).toBeVisible();
  });
});
