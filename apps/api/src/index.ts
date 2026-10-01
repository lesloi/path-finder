import { serve } from '@hono/node-server';
import { join } from 'node:path';

import { parseAddressRanges } from './addresses.ts';
import { createApp } from './app.ts';
import { createBRouter } from './brouter/brouter.ts';
import { bdAltiHeights } from './elevation/bdalti.ts';

// Empty, like unset, it takes the default rather than a random port.
const port = Number(process.env.PORT || 3000);
const brouterUrl = process.env.BROUTER_URL;
if (!brouterUrl) throw new Error('BROUTER_URL is not set');
const bdAltiDir = process.env.BDALTI_DIR;
if (!bdAltiDir) console.log('BDALTI_DIR is not set: routes have no elevation gain');
const trustedProxiesList = process.env.TRUSTED_PROXIES;
const healthAllowlistValue = process.env.HEALTH_ALLOWLIST;
const app = createApp({
  webRoot: join(import.meta.dirname, '../../web/dist'),
  engine: createBRouter(brouterUrl),
  heightAt: bdAltiDir ? bdAltiHeights(bdAltiDir) : undefined,
  // On unless explicitly in development, so forgetting NODE_ENV keeps them on.
  limits: process.env.NODE_ENV !== 'development',
  // Unset or empty, every connection is a trusted proxy.
  ...(trustedProxiesList?.trim() && {
    trustedProxies: parseAddressRanges(trustedProxiesList, 'TRUSTED_PROXIES'),
  }),
  // Unset or empty, every caller may check the API's health.
  ...(healthAllowlistValue?.trim() && {
    healthAllowlist: parseAddressRanges(healthAllowlistValue, 'HEALTH_ALLOWLIST'),
  }),
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`API listening on port ${port}`);
});
