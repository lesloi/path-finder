import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

import { API_CONTRACT } from './contract.ts';
import {
  buildRouteSet,
  elevationGain,
  generateCandidates,
  parseCriteria,
  type HeightAt,
  type RoutingEngine,
} from './route-generation/index.ts';

// Vite fingerprints the files it emits under /assets, so they never change.
const IMMUTABLE = 'public, max-age=31536000, immutable';

export function createApp({ webRoot, engine, heightAt }: { webRoot: string; engine: RoutingEngine; heightAt: HeightAt }) {
  const app = new Hono();

  app.use(async (c, next) => {
    await next();
    c.header('Referrer-Policy', 'no-referrer');
  });

  app.get('/health', (c) => c.text('ok'));

  // No logs here: criteria hold the start point.
  app.post('/api/v1/route-sets', async (c) => {
    if (c.req.header('X-Api-Contract') !== String(API_CONTRACT)) {
      return c.json({ error: `This API expects contract version ${API_CONTRACT}` }, 426);
    }
    let parsed: ReturnType<typeof parseCriteria>;
    try {
      parsed = parseCriteria(await c.req.json());
    } catch (error) {
      // JSON syntax errors quote the body, so they get a message of their own.
      if (error instanceof SyntaxError) return c.json({ error: 'Criteria must be JSON' }, 400);
      if (error instanceof RangeError) return c.json({ error: error.message }, 400);
      throw error;
    }
    const { criteria, activity } = parsed;
    const candidates = await generateCandidates(criteria, activity, engine, (geometry) =>
      elevationGain(geometry, heightAt),
    );
    return c.json({ routes: buildRouteSet(criteria, candidates) });
  });

  app.use(async (c, next) => {
    await next();
    if (c.res.ok) c.header('Cache-Control', c.req.path.startsWith('/assets/') ? IMMUTABLE : 'no-cache');
  });
  app.use(serveStatic({ root: webRoot }));

  return app;
}
