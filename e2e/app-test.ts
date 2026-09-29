import { expect, test } from './test.ts';

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

    await page.goto('/');
    // The map has loaded its style, tiles and glyphs.
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
    expect(policies.size).toBeGreaterThan(1);
    for (const [url, policy] of policies) expect(policy, url).toBe('no-referrer');
  });

  test('does not ask for the location on load', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: string[] = [];
      Object.assign(window, { geolocationCalls: calls });
      for (const method of ['getCurrentPosition', 'watchPosition'] as const) {
        navigator.geolocation[method] = () => {
          calls.push(method);
          return 0;
        };
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(await page.evaluate(() => (window as unknown as { geolocationCalls: string[] }).geolocationCalls)).toEqual(
      [],
    );
  });
});
