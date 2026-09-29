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
});
