import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from './app.ts';

describe('api', () => {
  let webRoot: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    webRoot = await mkdtemp(join(tmpdir(), 'web-'));
    await mkdir(join(webRoot, 'assets'));
    await writeFile(join(webRoot, 'index.html'), '<h1>Path finder</h1>');
    await writeFile(join(webRoot, 'assets', 'index-a1b2c3.js'), 'console.log(1);');
    app = createApp({ webRoot });
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

  it.each(['/health', '/', '/assets/index-a1b2c3.js', '/missing'])(
    'sends no referrer from %s',
    async (path) => {
      const response = await app.request(path);

      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    },
  );
});
