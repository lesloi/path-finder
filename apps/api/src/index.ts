import { serve } from '@hono/node-server';
import { join } from 'node:path';

import { createApp } from './app.ts';
import { createBRouter } from './brouter/brouter.ts';
import { bdAltiHeights } from './elevation/bdalti.ts';

const port = Number(process.env.PORT ?? 3000);
const brouterUrl = process.env.BROUTER_URL;
if (!brouterUrl) throw new Error('BROUTER_URL is not set');
const bdAltiDir = process.env.BDALTI_DIR;
if (!bdAltiDir) console.log('BDALTI_DIR is not set: routes have no elevation gain');
const app = createApp({
  webRoot: join(import.meta.dirname, '../../web/dist'),
  engine: createBRouter(brouterUrl),
  heightAt: bdAltiDir ? bdAltiHeights(bdAltiDir) : undefined,
  // On unless explicitly in development, so forgetting NODE_ENV keeps them on.
  limits: process.env.NODE_ENV !== 'development',
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`API listening on port ${port}`);
});
