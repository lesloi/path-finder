import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/** ID written by each web app build (see `apps/web/vite.config.ts`), or none when the web app is not built. */
function readBuildId(webRoot: string): string | undefined {
  try {
    return readFileSync(join(webRoot, 'build-id'), 'utf8').trim();
  } catch {
    return undefined;
  }
}

export function createApp({ webRoot, engine, heightAt }: { webRoot: string; engine: RoutingEngine; heightAt: HeightAt }) {
  const app = new Hono();
  const buildId = readBuildId(webRoot);

  app.use(async (c, next) => {
    await next();
    c.header('Referrer-Policy', 'no-referrer');
  });

  app.get('/health', (c) => c.text('ok'));

  // No logs here: criteria hold the start point.
  app.post('/api/v1/route-sets', async (c) => {
    // A tab left open across a deploy sends the ID of the previous build: it must reload.
    const clientBuildId = c.req.header('X-Build-Id');
    if (buildId && clientBuildId && clientBuildId !== buildId) {
      return c.json({ error: 'The web app has a new version: reload it' }, 426);
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
