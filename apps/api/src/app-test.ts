import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Mock } from 'vitest';

import { parseAddressRanges } from './addresses.ts';
import { createApp } from './app.ts';
import type { Position, RoutingEngine } from './route-generation/index.ts';

const START: Position = [6.1294, 45.8992];

// Loops 5 times as long as the radius asked for, each out to a point in its own heading.
const engine: RoutingEngine = async ({ radius, heading }) => {
  const angle = (heading * Math.PI) / 180;
  const offset = radius / 111_000;
  return {
    geometry: [START, [START[0] + offset * Math.sin(angle), START[1] + offset * Math.cos(angle)], START],
    distance: (5 * radius) / 1000,
    ways: [{ length: 5 * radius, surface: 'gravel' }],
  };
};
const flat = () => 450;

const criteria = { start: START, activity: 'run', target: { distance: 10 }, surface: 'any', pace: 6 };
const BUILD_ID = 'b1d-2026';
// The reverse proxy, such as Caddy on the Docker network.
const PROXY = '172.18.0.3';
const trustedProxies = parseAddressRanges(PROXY, 'TRUSTED_PROXIES');

function postRouteSet(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {},
  remoteAddress = PROXY,
) {
  return app.request(
    '/api/v1/route-sets',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.1', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    { incoming: { socket: { remoteAddress } } },
  );
}

describe('api', () => {
  let webRoot: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    webRoot = await mkdtemp(join(tmpdir(), 'web-'));
    await mkdir(join(webRoot, 'assets'));
    await writeFile(join(webRoot, 'index.html'), '<h1>Path finder</h1>');
    await writeFile(join(webRoot, 'assets', 'index-a1b2c3.js'), 'console.log(1);');
    await writeFile(join(webRoot, 'build-id'), `${BUILD_ID}\n`);
    // A static file the health check must not fall back to when it rejects a caller.
    await writeFile(join(webRoot, 'health'), 'static');
    app = createApp({ webRoot, engine, heightAt: flat, trustedProxies });
  });

  afterAll(async () => {
    await rm(webRoot, { recursive: true });
  });

  describe('health check', () => {
    let monitored: ReturnType<typeof createApp>;

    beforeAll(() => {
      monitored = createApp({
        webRoot,
        engine,
        trustedProxies,
        healthAllowlist: parseAddressRanges('198.51.100.0/24', 'HEALTH_ALLOWLIST'),
      });
    });

    function getHealth(app: ReturnType<typeof createApp>, remoteAddress: string, headers: Record<string, string> = {}) {
      return app.request('/health', { headers }, { incoming: { socket: { remoteAddress } } });
    }

    it.each([
      ['the loopback', '127.0.0.1'],
      ['a public address', '203.0.113.1'],
      ['no address', ''],
    ])('answers %s by default', async (_, address) => {
      const response = await getHealth(app, address);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok');
    });

    it.each([
      ['the IPv4 loopback', '127.0.0.1'],
      ['the IPv6 loopback', '::1'],
      ['the IPv4 loopback mapped to IPv6', '::ffff:127.0.0.1'],
      ['an allowed address', '198.51.100.7'],
    ])('answers %s with allowed addresses', async (_, address) => {
      const response = await getHealth(monitored, address);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok');
    });

    it.each([
      ['a public address', '203.0.113.1'],
      ['the Docker bridge gateway', '172.18.0.1'],
      ['no address', ''],
    ])('answers 404 to %s with allowed addresses, even with a health file in the web app', async (_, address) => {
      const response = await getHealth(monitored, address);

      expect(response.status).toBe(404);
    });

    it.each([
      ['an allowed client', '198.51.100.7', 200],
      ['another client', '203.0.113.1', 404],
    ])('checks %s through a trusted proxy by its forwarded address', async (_, forwarded, status) => {
      const response = await getHealth(monitored, PROXY, { 'X-Forwarded-For': forwarded });

      expect(response.status).toBe(status);
    });

    it('answers 404 to a client that is not a trusted proxy, whatever X-Forwarded-For says', async () => {
      const response = await getHealth(monitored, '203.0.113.1', { 'X-Forwarded-For': '198.51.100.7' });

      expect(response.status).toBe(404);
    });
  });

  it('serves the web app on the same origin', async () => {
    const response = await app.request('/');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<h1>Path finder</h1>');
  });

  it('lets browsers revalidate the web app entry point', async () => {
    const response = await app.request('/');

    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('caches hashed assets forever', async () => {
    const response = await app.request('/assets/index-a1b2c3.js');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('generates a loop route set', async () => {
    const response = await postRouteSet(app, criteria);

    expect(response.status).toBe(200);
    const { routes } = await response.json();
    expect(routes.length).toBeGreaterThanOrEqual(3);
    expect(routes[0]).toMatchObject({ kind: 'match', distance: expect.closeTo(10), elevationGain: 0, unpavedShare: 1 });
  });

  it('asks the routing engine with the activity and measures elevation gain on BD ALTI', async () => {
    const spy = vi.fn(engine);
    let height = 0;
    const climbing = createApp({ webRoot, engine: spy, heightAt: () => (height += 1) });

    const response = await postRouteSet(climbing, { ...criteria, activity: 'hike', elevationGain: 'hilly' });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ start: START, activity: 'hike', surface: 'any' }),
      expect.any(AbortSignal),
    );
    const { routes } = await response.json();
    expect(routes[0].elevationGain).toBeGreaterThan(0);
  });

  it('gives every point of a route its BD ALTI height, for the GPX export', async () => {
    const response = await postRouteSet(app, criteria);

    const { routes } = await response.json();
    expect(routes[0].geometry[0]).toEqual([...START, 450]);
    expect(routes[0].geometry.every((point: number[]) => point[2] === 450)).toBe(true);
  });

  it('drops a route with a point it finds no height for', async () => {
    // Elevation gain samples along the loops, never on the far point of the loops heading east.
    const unknown = new Set<string>();
    const eastward: RoutingEngine = async (request, signal) => {
      const loop = await engine(request, signal);
      if (request.heading < 180) unknown.add(String(loop.geometry[1]));
      return loop;
    };
    const heightAt = (lon: number, lat: number) => {
      if (unknown.has(String([lon, lat]))) throw new RangeError('No BD ALTI tile here');
      return 450;
    };
    const partial = createApp({ webRoot, engine: eastward, heightAt });

    const response = await postRouteSet(partial, criteria);

    expect(response.status).toBe(200);
    const { routes } = await response.json();
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.some((route: { geometry: number[][] }) => unknown.has(String(route.geometry[1].slice(0, 2))))).toBe(
      false,
    );
  });

  describe('without BD ALTI', () => {
    const noElevation = () => createApp({ webRoot, engine });

    it('gives routes no elevation gain and ignores the target elevation gain', async () => {
      const response = await postRouteSet(noElevation(), { ...criteria, elevationGain: 'hilly' });

      expect(response.status).toBe(200);
      const { routes } = await response.json();
      expect(routes[0]).toMatchObject({ kind: 'match', misses: [] });
      expect(routes[0]).not.toHaveProperty('elevationGain');
    });

    it('gives the points of a route no height', async () => {
      const response = await postRouteSet(noElevation(), criteria);

      const { routes } = await response.json();
      expect(routes[0].geometry[0]).toEqual(START);
    });

    it('turns a target duration into distance alone', async () => {
      const response = await postRouteSet(noElevation(), {
        ...criteria,
        target: { duration: 30 },
        elevationGain: 2_000,
      });

      expect(response.status).toBe(200);
      const { routes } = await response.json();
      expect(routes[0]).toMatchObject({ distance: expect.closeTo(5), estimatedDuration: expect.closeTo(30) });
    });
  });

  it.each([
    ['invalid criteria', { ...criteria, target: { distance: 100 } }],
    [
      'a target duration too short for the target elevation gain',
      { ...criteria, target: { duration: 30 }, elevationGain: 2_000 },
    ],
    ['a body that is not JSON', '{'],
  ])('answers 400 on %s', async (_, body) => {
    const response = await postRouteSet(app, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it('answers 426 to a web app from another build', async () => {
    const response = await postRouteSet(app, criteria, { 'X-Build-Id': 'older' });

    expect(response.status).toBe(426);
  });

  it.each([
    ['the same build', { 'X-Build-Id': BUILD_ID }],
    ['no build ID', {}],
  ])('generates a route set for a web app from %s', async (_, headers) => {
    const response = await postRouteSet(app, criteria, headers);

    expect(response.status).toBe(200);
  });

  it('checks no build ID when the web app is not built', async () => {
    const unbuilt = await mkdtemp(join(tmpdir(), 'web-'));

    const response = await postRouteSet(createApp({ webRoot: unbuilt, engine, heightAt: flat }), criteria, {
      'X-Build-Id': 'older',
    });

    expect(response.status).toBe(200);
    await rm(unbuilt, { recursive: true });
  });

  it.each(['/health', '/', '/assets/index-a1b2c3.js', '/missing', '/api/v1/route-sets'])(
    'sends no referrer from %s',
    async (path) => {
      const response = await app.request(path);

      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    },
  );

  describe('rate limit', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval'] });
      vi.setSystemTime(new Date('2026-09-27T10:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function postManyTimes(
      limited: ReturnType<typeof createApp>,
      times: number,
      forwardedFor: (i: number) => string,
      remoteAddress = PROXY,
    ) {
      for (let i = 0; i < times; i++) {
        await postRouteSet(limited, '{', { 'X-Forwarded-For': forwardedFor(i) }, remoteAddress);
      }
    }

    it('answers 429 after 60 requests in 10 minutes from the address the proxy saw', async () => {
      const limited = createApp({ webRoot, engine, heightAt: flat, trustedProxies });
      await postManyTimes(limited, 60, () => '203.0.113.9');

      const response = await postRouteSet(limited, criteria, { 'X-Forwarded-For': '203.0.113.9' });

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('600');
      expect((await postRouteSet(limited, criteria, { 'X-Forwarded-For': '203.0.113.10' })).status).toBe(200);
    });

    it('ignores the addresses a client forges before the one the proxy appends', async () => {
      const limited = createApp({ webRoot, engine, heightAt: flat, trustedProxies });
      await postManyTimes(limited, 60, (i) => `10.0.0.${i}, 203.0.113.9`);

      const response = await postRouteSet(limited, criteria, { 'X-Forwarded-For': '10.0.0.99, 203.0.113.9' });

      expect(response.status).toBe(429);
    });

    it('lets an address in again after 10 minutes', async () => {
      const limited = createApp({ webRoot, engine, heightAt: flat, trustedProxies });
      await postManyTimes(limited, 61, () => '203.0.113.9');

      vi.advanceTimersByTime(10 * 60 * 1000);

      expect((await postRouteSet(limited, criteria, { 'X-Forwarded-For': '203.0.113.9' })).status).toBe(200);
    });

    it('admits every request when limits are off', async () => {
      const unlimited = createApp({ webRoot, engine, heightAt: flat, limits: false, trustedProxies });
      await postManyTimes(unlimited, 60, () => '203.0.113.9');

      expect((await postRouteSet(unlimited, criteria, { 'X-Forwarded-For': '203.0.113.9' })).status).toBe(200);
    });

    it('counts connections without a proxy by their own address', async () => {
      const limited = createApp({ webRoot, engine, heightAt: flat });
      const post = (remoteAddress: string) =>
        limited.request(
          '/api/v1/route-sets',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(criteria) },
          { incoming: { socket: { remoteAddress } } },
        );
      for (let i = 0; i < 60; i++) await post('198.51.100.1');

      expect((await post('198.51.100.1')).status).toBe(429);
      expect((await post('198.51.100.2')).status).toBe(200);
    });

    it.each([
      ['from a public address by default', undefined, '198.51.100.1'],
      ['from a private network by default', undefined, '172.18.0.3'],
      ['from a unique local IPv6 address by default', undefined, 'fd12::3'],
      ['from a connection that is not a trusted proxy', trustedProxies, '198.51.100.1'],
      ['from a private network left out of the trusted proxies', trustedProxies, '10.0.0.1'],
      ['from any connection when no proxy is trusted', parseAddressRanges('', 'TRUSTED_PROXIES'), PROXY],
    ])('ignores X-Forwarded-For %s, so a client cannot rotate it', async (_, proxies, remoteAddress) => {
      const limited = createApp({ webRoot, engine, heightAt: flat, ...(proxies && { trustedProxies: proxies }) });
      await postManyTimes(limited, 60, (i) => `203.0.113.${i}`, remoteAddress);

      const response = await postRouteSet(limited, criteria, { 'X-Forwarded-For': '203.0.113.99' }, remoteAddress);

      expect(response.status).toBe(429);
    });

    it.each(['127.0.0.1', '127.0.1.1', '::1', '::ffff:127.0.0.1'])(
      'trusts X-Forwarded-For by default from %s, on the loopback',
      async (remoteAddress) => {
        const limited = createApp({ webRoot, engine, heightAt: flat });
        await postManyTimes(limited, 60, () => '203.0.113.9', remoteAddress);

        const response = await postRouteSet(limited, criteria, { 'X-Forwarded-For': '203.0.113.10' }, remoteAddress);

        expect(response.status).toBe(200);
      },
    );

    it('trusts X-Forwarded-For from any connection when every proxy is trusted', async () => {
      const limited = createApp({
        webRoot,
        engine,
        heightAt: flat,
        trustedProxies: parseAddressRanges('0.0.0.0/0, ::/0', 'TRUSTED_PROXIES'),
      });
      await postManyTimes(limited, 60, () => '203.0.113.9', '198.51.100.1');

      const response = await postRouteSet(limited, criteria, { 'X-Forwarded-For': '203.0.113.10' }, '198.51.100.1');

      expect(response.status).toBe(200);
    });

    it('trusts X-Forwarded-For from a trusted proxy seen as an IPv4 address mapped to IPv6', async () => {
      const limited = createApp({ webRoot, engine, heightAt: flat, trustedProxies });
      await postManyTimes(limited, 60, () => '203.0.113.9', `::ffff:${PROXY}`);

      const response = await postRouteSet(limited, criteria, { 'X-Forwarded-For': '203.0.113.10' }, `::ffff:${PROXY}`);

      expect(response.status).toBe(200);
    });
  });

  it('answers 503 with Retry-After beyond one generation and two waiting', async () => {
    let release!: () => void;
    const busy = new Promise<void>((resolve) => (release = resolve));
    const blocked: RoutingEngine = async (request, signal) => {
      await busy;
      return engine(request, signal);
    };
    const saturated = createApp({ webRoot, engine: blocked, heightAt: flat });

    const requests = Array.from({ length: 4 }, () => postRouteSet(saturated, criteria));
    // Nothing else can answer before the engine is released.
    const turnedAway = await Promise.race(requests);
    release();
    const statuses = (await Promise.all(requests)).map((response) => response.status);

    expect(turnedAway.status).toBe(503);
    expect(turnedAway.headers.get('Retry-After')).toBe('5');
    expect(statuses.sort()).toEqual([200, 200, 200, 503]);
  });

  it('generates any number of route sets at once when limits are off', async () => {
    const unlimited = createApp({ webRoot, engine, heightAt: flat, limits: false });

    const responses = await Promise.all(Array.from({ length: 4 }, () => postRouteSet(unlimited, criteria)));

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
  });

  describe('deadline', () => {
    let stuck: Mock<RoutingEngine>;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      // Like BRouter behind `fetch`: never answers, but rejects once its call is aborted.
      stuck = vi.fn<RoutingEngine>(
        (_, signal) =>
          new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('answers 504 when a generation is not done within 15 s', async () => {
      const slow = createApp({ webRoot, engine: stuck, heightAt: flat });

      const response = postRouteSet(slow, criteria);
      await vi.advanceTimersByTimeAsync(15_000);

      expect((await response).status).toBe(504);
      expect(await (await response).json()).toEqual({ error: expect.any(String) });
    });

    it('aborts the pending routing engine calls at the deadline', async () => {
      const slow = createApp({ webRoot, engine: stuck, heightAt: flat });

      const response = postRouteSet(slow, criteria);
      await vi.advanceTimersByTimeAsync(14_999);
      const signals = stuck.mock.calls.map(([, signal]) => signal);
      expect(signals).toHaveLength(20);
      expect(signals.some((signal) => signal.aborted)).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await response;

      expect(signals.every((signal) => signal.aborted)).toBe(true);
      // No correction call follows an aborted first call.
      expect(stuck).toHaveBeenCalledTimes(20);
    });

    it('answers as usual when a generation is done in time', async () => {
      const response = await postRouteSet(createApp({ webRoot, engine, heightAt: flat }), criteria);

      expect(response.status).toBe(200);
    });
  });
});
