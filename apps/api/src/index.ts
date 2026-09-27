import { serve } from '@hono/node-server';
import { join } from 'node:path';

import { createApp } from './app.ts';
import { createBRouter } from './brouter/brouter.ts';
import { loadCommunes } from './commune/communes.ts';
import { bdAltiHeights } from './elevation/bdalti.ts';

const port = Number(process.env.PORT ?? 3000);
const bdAltiDir = process.env.BDALTI_DIR;
if (!bdAltiDir) throw new Error('Set BDALTI_DIR to the tiles written by scripts/convert-bdalti.ts');
const communesFile = process.env.COMMUNES_FILE;
const app = createApp({
  webRoot: join(import.meta.dirname, '../../web/dist'),
  engine: createBRouter(process.env.BROUTER_URL ?? 'http://localhost:17777'),
  heightAt: bdAltiHeights(bdAltiDir),
  communeAt: communesFile ? loadCommunes(communesFile) : undefined,
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`API listening on port ${port}`);
});
