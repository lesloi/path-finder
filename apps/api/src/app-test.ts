import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

function postRouteSet(app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = {}) {
  return app.request('/api/v1/route-sets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
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
    app = createApp({ webRoot, engine, heightAt: flat });
  });

  afterAll(async () => {
    await rm(webRoot, { recursive: true });
  });

  it('answers the health check', async () => {
    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
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

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ start: START, activity: 'hike', surface: 'any' }));
    const { routes } = await response.json();
    expect(routes[0].elevationGain).toBeGreaterThan(0);
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
});
