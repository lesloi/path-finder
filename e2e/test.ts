import { test as base, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// The only runtime third party allowed besides our own origin (CONTRIBUTING.md).
const IGN = 'https://data.geopf.fr';
const FIXTURES = join(import.meta.dirname, 'fixtures/data.geopf.fr');

// A 1 by 1 transparent PNG.
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * Playwright's `test`, with two guards on every test: the IGN Géoplateforme is answered from
 * committed fixtures, never from the network, and a request to any other host fails the test.
 */
export const test = base.extend<{ privacyGuard: void; metricUnits: void }>({
  // Chromium runs in en-US, whose units are imperial: the tests read kilometres unless they pick other units.
  metricUnits: [
    async ({ context }, use) => {
      await context.addInitScript(() => {
        const key = 'path-finder.settings';
        const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
        if (!stored.units) localStorage.setItem(key, JSON.stringify({ ...stored, units: 'metric' }));
      });
      await use();
    },
    { auto: true },
  ],
  privacyGuard: [
    async ({ context, baseURL }, use) => {
      const allowed = new Set([new URL(baseURL!).origin, IGN]);
      const unexpected = new Set<string>();
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (!allowed.has(url.origin)) {
          unexpected.add(url.host);
          return route.abort('blockedbyclient');
        }
        if (url.origin !== IGN) return route.continue();
        const fixture = join(FIXTURES, decodeURIComponent(url.pathname));
        if (existsSync(fixture)) return route.fulfill({ path: fixture });
        // Tiles and glyphs outside the fixtures come back empty, as the map shows no data there.
        if (url.pathname.endsWith('.pbf')) return route.fulfill({ body: '' });
        // Raster basemaps come as tiles of a single WMTS endpoint: a transparent pixel stands for each.
        if (url.pathname === '/wmts') return route.fulfill({ contentType: 'image/png', body: TRANSPARENT_PNG });
        return route.fulfill({ status: 404 });
      });

      await use();

      expect([...unexpected], 'The browser sent requests to hosts other than ours and the IGN').toEqual([]);
    },
    { auto: true },
  ],
});

/**
 * Opens the criteria where they are not already shown: on a phone, the layer over the map that the bar at the top
 * opens, unless it is open already. A desktop has them in its left column.
 */
export async function openCriteria(page: Page) {
  const bar = page.getByTestId('criteria-bar');
  if ((await bar.isVisible()) && !(await page.getByTestId('sub-page').isVisible())) await bar.click();
}

/** Opens the map view once the map has loaded its style, tiles and glyphs. */
export async function openMap(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

export { expect };
