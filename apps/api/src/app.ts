import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';

import {
  buildRouteSet,
  elevationGain,
  generateCandidates,
  parseCriteria,
  type HeightAt,
  type RoutingEngine,
} from './route-generation/index.ts';
import { createRateLimiter, createConcurrencyLimiter, createDailySalt } from './rate-limit.ts';

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
  const rateLimiter = createRateLimiter({ threshold: 60, salt: createDailySalt() });
  const concurrencyLimiter = createConcurrencyLimiter({ limit: Math.max(1, Math.ceil(cpus().length / 2)), queueSize: 5 });

  app.use(async (c, next) => {
    await next();
    c.header('Referrer-Policy', 'no-referrer');
  });

  app.get('/health', (c) => c.text('ok'));

  // No logs here: criteria hold the start point.
  app.post('/api/v1/route-sets', async (c) => {
    // Rate limit by IP
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? '127.0.0.1';
    const rateLimit = rateLimiter(ip);
    if (!rateLimit.allowed) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    // Check build ID
    const clientBuildId = c.req.header('X-Build-Id');
    if (buildId && clientBuildId && clientBuildId !== buildId) {
      return c.json({ error: 'The web app has a new version: reload it' }, 426);
    }

    // Generate route set with concurrency limit
    const result = concurrencyLimiter(async () => {
      let parsed: ReturnType<typeof parseCriteria>;
      try {
        parsed = parseCriteria(await c.req.json());
      } catch (error) {
        // JSON syntax errors quote the body, so they get a message of their own.
        if (error instanceof SyntaxError) throw new Error('Criteria must be JSON');
        if (error instanceof RangeError) throw error;
        throw error;
      }
      const { criteria, activity } = parsed;
      const candidates = await generateCandidates(criteria, activity, engine, (geometry) =>
        elevationGain(geometry, heightAt),
      );
      return buildRouteSet(criteria, candidates);
    });

    if (typeof result === 'object' && 'status' in result) {
      c.header('Retry-After', String(result.retryAfter));
      return c.json({ error: 'Server is busy, please retry' }, result.status);
    }

    try {
      const routes = await result;
      return c.json({ routes });
    } catch (error) {
      if (error instanceof RangeError) return c.json({ error: error.message }, 400);
      if (error instanceof Error && error.message === 'Criteria must be JSON') {
        return c.json({ error: 'Criteria must be JSON' }, 400);
      }
      throw error;
    }
  });

  app.use(async (c, next) => {
    await next();
    if (c.res.ok) c.header('Cache-Control', c.req.path.startsWith('/assets/') ? IMMUTABLE : 'no-cache');
  });
  app.use(serveStatic({ root: webRoot }));

  return app;
}
