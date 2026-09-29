import { test as base, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// The only runtime third party allowed besides our own origin (CONTRIBUTING.md).
const IGN = 'https://data.geopf.fr';
const FIXTURES = join(import.meta.dirname, 'fixtures/data.geopf.fr');

/**
 * Playwright's `test`, with two guards on every test: the IGN Géoplateforme is answered from
 * committed fixtures, never from the network, and a request to any other host fails the test.
 */
export const test = base.extend<{ privacyGuard: void }>({
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
        return route.fulfill({ status: 404 });
      });

      await use();

      expect([...unexpected], 'The browser sent requests to hosts other than ours and the IGN').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
