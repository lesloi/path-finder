import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
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
import { createConcurrencyLimiter, createRateLimiter, type Admission } from './limits.ts';

// Vite fingerprints the files it emits under /assets, so they never change.
const IMMUTABLE = 'public, max-age=31536000, immutable';
// Seconds: about one generation, given the < 5 s p95 target.
const BUSY_RETRY_AFTER = 5;
// Milliseconds a route set may take, waiting in the queue included.
const GENERATION_TIMEOUT = 15_000;

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

function retryLater(c: Context, status: 429 | 503, seconds: number, error: string) {
  c.header('Retry-After', String(seconds));
  return c.json({ error }, status);
}

export function createApp({
  webRoot,
  engine,
  heightAt,
  limits = true,
}: {
  webRoot: string;
  engine: RoutingEngine;
  /** Without it, elevation gain does not count and routes have none. */
  heightAt?: HeightAt;
  /** Rate and concurrency limits, turned off in development. */
  limits?: boolean;
}) {
  const app = new Hono();
  const buildId = readBuildId(webRoot);
  // Generous, since mobile carriers put many users behind one address (CGNAT).
  const admit = limits
    ? createRateLimiter({ limit: 60, windowMs: 10 * 60 * 1000 })
    : (): Admission => ({ admitted: true });
  // A generation already keeps BRouter's few calls at once busy, and waiting for more than two
  // would miss the < 5 s p95 target.
  const generate = limits
    ? createConcurrencyLimiter({ limit: 1, queueSize: 2 })
    : <T>(task: () => Promise<T>) => task();

  app.use(async (c, next) => {
    await next();
    c.header('Referrer-Policy', 'no-referrer');
  });

  app.get('/health', (c) => c.text('ok'));

  // No logs here: criteria hold the start point, and requests hold the client address.
  app.post('/api/v1/route-sets', async (c) => {
    const admission = admit(clientAddress(c));
    if (!admission.admitted) {
      return retryLater(c, 429, admission.retryAfter, 'Too many route sets asked for: retry later');
    }
    // A tab left open across a deploy sends the ID of the previous build: it must reload.
    const clientBuildId = c.req.header('X-Build-Id');
    if (buildId && clientBuildId && clientBuildId !== buildId) {
      return c.json({ error: 'The web app has a new version: reload it' }, 426);
    }
    let parsed: ReturnType<typeof parseCriteria>;
    try {
      parsed = parseCriteria(await c.req.json(), { countElevationGain: heightAt !== undefined });
    } catch (error) {
      // JSON syntax errors quote the body, so they get a message of their own.
      if (error instanceof SyntaxError) return c.json({ error: 'Criteria must be JSON' }, 400);
      if (error instanceof RangeError) return c.json({ error: error.message }, 400);
      throw error;
    }
    const { criteria, activity } = parsed;
    // A timer rather than `AbortSignal.timeout`, which cannot be cancelled once the route set is done.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), GENERATION_TIMEOUT);
    try {
      const routes = generate(async () => {
        const candidates = await generateCandidates(
          criteria,
          activity,
          engine,
          heightAt && ((geometry) => elevationGain(geometry, heightAt)),
          deadline.signal,
        );
        const routeSet = buildRouteSet(criteria, candidates);
        if (!heightAt) return routeSet;
        // Heights on every point, to the decimetre, so the web app builds the GPX export offline.
        // Elevation gain only samples along a loop: a point with no height drops its route.
        return routeSet.flatMap((route) => {
          try {
            const geometry = route.geometry.map(([lon, lat]) => [lon, lat, Math.round(heightAt(lon, lat) * 10) / 10]);
            return [{ ...route, geometry }];
          } catch {
            return [];
          }
        });
      });
      if (!routes) {
        return retryLater(c, 503, BUSY_RETRY_AFTER, 'Too many route sets being generated: retry in a few seconds');
      }
      return c.json({ routes: await routes });
    } catch (error) {
      // Only the deadline itself: any other error is a bug, not a slow generation.
      if (error === deadline.signal.reason) return c.json({ error: 'The route set took too long to generate' }, 504);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });

  app.use(async (c, next) => {
    await next();
    if (c.res.ok) c.header('Cache-Control', c.req.path.startsWith('/assets/') ? IMMUTABLE : 'no-cache');
  });
  app.use(serveStatic({ root: webRoot }));

  return app;
}
