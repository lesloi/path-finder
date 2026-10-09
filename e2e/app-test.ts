import { expect, openMap, test } from './test.ts';

test.describe('the app', () => {
  test('loads with no console error and serves every file with no referrer', async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const policies = new Map<string, string | undefined>();
    page.on('response', (response) => {
      if (response.url().startsWith(baseURL!)) policies.set(response.url(), response.headers()['referrer-policy']);
    });

    await openMap(page);

    expect(errors).toEqual([]);
    expect(policies.size).toBeGreaterThan(1);
    for (const [url, policy] of policies) expect(policy, url).toBe('no-referrer');
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

  test('gives the attribution touch targets, collapsed and open', async ({ page }) => {
    await openMap(page);
    const attribution = page.locator('.maplibregl-ctrl-attrib');
    const toggle = attribution.locator('.maplibregl-ctrl-attrib-button');
    const links = attribution.locator('a');

    // Wide maps open it by themselves, narrow ones keep it collapsed: check both states.
    for (const open of [true, false]) {
      if ((await attribution.evaluate((element) => element.classList.contains('maplibregl-compact-show'))) !== open) {
        await toggle.click();
      }
      for (const target of open ? [toggle, ...(await links.all())] : [toggle]) {
        const box = await target.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test('keeps the map background picked from the button over the map across a reload', async ({ page, isMobile }) => {
    await openMap(page);

    // The button floats right over the location button on phones, and beside it on desktops.
    const [basemap, locate] = await Promise.all([
      page.getByTestId('criteria-basemap').boundingBox(),
      page.getByTestId('criteria-locate').boundingBox(),
    ]);
    if (isMobile) {
      expect(basemap!.y + basemap!.height).toBeLessThanOrEqual(locate!.y);
      expect(Math.abs(basemap!.x - locate!.x)).toBeLessThan(1);
    } else {
      expect(basemap!.x + basemap!.width).toBeLessThanOrEqual(locate!.x);
      expect(Math.abs(basemap!.y - locate!.y)).toBeLessThan(1);
    }

    await page.getByTestId('criteria-basemap').click();
    await page.getByTestId('criteria-basemap-minimal').click();
    await page.reload();
    await page.getByTestId('criteria-basemap').click();

    await expect(page.getByTestId('criteria-basemap-minimal')).toHaveAttribute('aria-checked', 'true');
  });

  test('goes back to the previous map background when the style of the new one fails to load', async ({
    page,
    context,
  }) => {
    await openMap(page);
    // Registered last, so it answers first: the IGN style of the minimal background is down.
    await context.route('**/PLAN.IGN/epure.json', (route) => route.abort('failed'));

    await page.getByTestId('criteria-basemap').click();
    await page.getByTestId('criteria-basemap-minimal').click();

    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('path-finder.settings')!).basemap);
    await expect.poll(saved).toBe('plan');
    await page.getByTestId('criteria-basemap').click();
    await expect(page.getByTestId('criteria-basemap-plan')).toHaveAttribute('aria-checked', 'true');
  });
});
