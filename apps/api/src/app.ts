import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';

import {
  buildRouteSet,
  elevationGain,
  generateCandidates,
  parseCriteria,
  type HeightAt,
  type RoutingEngine,
} from './route-generation/index.ts';
import { createConcurrencyLimiter, createRateLimiter } from './rate-limit.ts';

// Vite fingerprints the files it emits under /assets, so they never change.
const IMMUTABLE = 'public, max-age=31536000, immutable';
// Seconds: about one generation, given the < 5 s p95 target.
const BUSY_RETRY_AFTER = 5;

/** ID written by each web app build (see `apps/web/vite.config.ts`), or none when the web app is not built. */
function readBuildId(webRoot: string): string | undefined {
  try {
    return readFileSync(join(webRoot, 'build-id'), 'utf8').trim();
  } catch {
    return undefined;
  }
}

/**
 * The reverse proxy appends the address it sees to `X-Forwarded-For`: earlier entries come
 * from the client and can be forged. Without a proxy, the connection's own address counts.
 */
function clientAddress(c: Context): string {
  const forwarded = c.req.header('X-Forwarded-For')?.split(',').at(-1)?.trim();
  return forwarded || (getConnInfo(c).remote.address ?? '');
}

export function createApp({ webRoot, engine, heightAt }: { webRoot: string; engine: RoutingEngine; heightAt: HeightAt }) {
  const app = new Hono();
  const buildId = readBuildId(webRoot);
  // Generous, since mobile carriers put many users behind one address (CGNAT).
  const limitRate = createRateLimiter({ limit: 60, windowMs: 10 * 60 * 1000 });
  // About one generation per core, so BRouter never falls over.
  const cores = availableParallelism();
  const limitGenerations = createConcurrencyLimiter({ limit: cores, queueSize: cores });

  app.use(async (c, next) => {
    await next();
    c.header('Referrer-Policy', 'no-referrer');
  });

  app.get('/health', (c) => c.text('ok'));

  // No logs here: criteria hold the start point, and requests hold the client address.
  app.post('/api/v1/route-sets', async (c) => {
    const rateLimit = limitRate(clientAddress(c));
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfter));
      return c.json({ error: 'Too many route sets asked for: retry later' }, 429);
    }
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
    const routes = limitGenerations(async () => {
      const candidates = await generateCandidates(criteria, activity, engine, (geometry) =>
        elevationGain(geometry, heightAt),
      );
      return buildRouteSet(criteria, candidates);
    });
    if (!routes) {
      c.header('Retry-After', String(BUSY_RETRY_AFTER));
      return c.json({ error: 'Every route generator is busy: retry in a few seconds' }, 503);
    }
    return c.json({ routes: await routes });
  });

  app.use(async (c, next) => {
    await next();
    if (c.res.ok) c.header('Cache-Control', c.req.path.startsWith('/assets/') ? IMMUTABLE : 'no-cache');
  });
  app.use(serveStatic({ root: webRoot }));

  return app;
}
