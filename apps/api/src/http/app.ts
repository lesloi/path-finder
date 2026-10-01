import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';

import {
  buildRouteSet,
  elevationGain,
  generateCandidates,
  parseCriteria,
  type HeightAt,
  type RoutingEngine,
} from '../route-generation/index.ts';
import { clientAddress, parseAddressRanges, type AddressMatcher } from './addresses.ts';
import { readBuildId } from './build-id.ts';
import { createConcurrencyLimiter, createRateLimiter, type Admission } from './limits.ts';

// Vite fingerprints the files it emits under /assets, so they never change.
const IMMUTABLE = 'public, max-age=31536000, immutable';
// Seconds: about one generation, given the < 5 s p95 target.
const BUSY_RETRY_AFTER = 5;
// Milliseconds a route set may take, waiting in the queue included.
const GENERATION_TIMEOUT = 15_000;
const IS_LOOPBACK = parseAddressRanges('127.0.0.0/8, ::1', 'LOOPBACK');
// Every connection, so the rate limit works behind any proxy without configuration. Clients that
// reach the API without a proxy can then forge `X-Forwarded-For`.
const EVERY_ADDRESS = parseAddressRanges('0.0.0.0/0, ::/0', 'EVERY_ADDRESS');

/** The client's address, from the connection and the `X-Forwarded-For` of a trusted proxy. */
function requestClientAddress(c: Context, trustedProxies: AddressMatcher): string {
  return clientAddress(getConnInfo(c).remote.address ?? '', c.req.header('X-Forwarded-For'), trustedProxies);
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
  trustedProxies = EVERY_ADDRESS,
  healthAllowlist,
}: {
  webRoot: string;
  engine: RoutingEngine;
  /** Without it, elevation gain does not count and routes have none. */
  heightAt?: HeightAt;
  /** Rate and concurrency limits, turned off in development. */
  limits?: boolean;
  /** Reverse proxies whose `X-Forwarded-For` counts, by default every connection. */
  trustedProxies?: AddressMatcher;
  /**
   * Callers allowed to check the API's health besides the loopback, such as an uptime monitor
   * (#89). Without it, every caller is.
   */
  healthAllowlist?: AddressMatcher;
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

  // The loopback stays allowed for a healthcheck run inside the container. Others get 404, as if
  // the route did not exist, and are not logged.
  app.get('/health', (c) => {
    if (!healthAllowlist) return c.text('ok');
    const address = requestClientAddress(c, trustedProxies);
    return IS_LOOPBACK(address) || healthAllowlist(address) ? c.text('ok') : c.notFound();
  });

  // What the API can do, for the web app to offer only that. Nothing about the caller.
  app.get('/api/v1/capabilities', (c) => c.json({ elevation: heightAt !== undefined }));

  // No logs here: criteria hold the start point, and requests hold the client address.
  app.post('/api/v1/route-sets', async (c) => {
    const admission = admit(requestClientAddress(c, trustedProxies));
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
