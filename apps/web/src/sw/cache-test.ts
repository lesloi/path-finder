import { createCacheHandlers } from './cache.ts';

const key = (request: Request | string) =>
  typeof request === 'string' ? new URL(request, 'https://app.test').href : request.url;

/** An in-memory `CacheStorage`: just what the handlers use. */
function fakeCaches(initial: Record<string, Record<string, string>> = {}) {
  const stores = new Map(
    Object.entries(initial).map(([name, files]) => [
      name,
      new Map(Object.entries(files).map(([url, body]) => [new URL(url, 'https://app.test').href, new Response(body)])),
    ]),
  );
  const open = (name: string) => {
    const files = stores.get(name) ?? stores.set(name, new Map()).get(name)!;
    return Promise.resolve({
      match: (request: Request | string) => Promise.resolve(files.get(key(request))?.clone()),
      put: (request: Request | string, response: Response) => {
        files.set(key(request), response);
        return Promise.resolve();
      },
    });
  };
  const storage = {
    open,
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
  } as unknown as CacheStorage;
  return { storage, stores };
}

function setup(fetch: (request: Request) => Promise<Response>, initial?: Record<string, Record<string, string>>) {
  const { storage, stores } = fakeCaches(initial);
  const pending: Promise<unknown>[] = [];
  const handlers = createCacheHandlers({
    caches: storage,
    cacheName: 'build-2',
    fetch,
    keepAlive: (work) => pending.push(work),
  });
  return { handlers, stores, settled: () => Promise.all(pending) };
}

const page = new Request('https://app.test/?lat=45&lng=5');
const text = async (response: Response | undefined) => response?.text();

describe('networkFirst', () => {
  it('answers with the network and keeps the shell for later', async () => {
    const { handlers, stores, settled } = setup(() => Promise.resolve(new Response('new shell')));
    expect(await text(await handlers.networkFirst(page))).toBe('new shell');
    await settled();
    expect(await text(stores.get('build-2')?.get('https://app.test/'))).toBe('new shell');
  });

  it('falls back to the one cached shell when the network fails, whatever the query string', async () => {
    const { handlers } = setup(() => Promise.reject(new TypeError('offline')), { 'build-2': { '/': 'old shell' } });
    expect(await text(await handlers.networkFirst(page))).toBe('old shell');
  });

  it('rethrows when the network fails and nothing is cached', async () => {
    const { handlers } = setup(() => Promise.reject(new TypeError('offline')));
    await expect(handlers.networkFirst(page)).rejects.toThrow('offline');
  });

  it('does not take the shell from another build', async () => {
    const { handlers } = setup(() => Promise.reject(new TypeError('offline')), { 'build-1': { '/': 'older shell' } });
    await expect(handlers.networkFirst(page)).rejects.toThrow('offline');
  });

  it.each([
    ['an error', new Response('oops', { status: 500 })],
    ['a partial answer', new Response('part', { status: 206 })],
    ['a redirected answer', Object.defineProperty(new Response('moved'), 'redirected', { value: true })],
  ])('answers with %s and does not keep it', async (_name, response) => {
    const { handlers, stores, settled } = setup(() => Promise.resolve(response));
    expect(await handlers.networkFirst(page)).toBe(response);
    await settled();
    expect(stores.get('build-2')?.size ?? 0).toBe(0);
  });

  it('answers even when the write fails, a full quota for instance', async () => {
    const full = { put: () => Promise.reject(new Error('quota')), match: () => Promise.resolve(undefined) };
    const caches = { open: () => Promise.resolve(full) } as unknown as CacheStorage;
    const pending: Promise<unknown>[] = [];
    const handlers = createCacheHandlers({
      caches,
      cacheName: 'build-2',
      fetch: () => Promise.resolve(new Response('shell')),
      keepAlive: (work) => pending.push(work),
    });
    expect(await text(await handlers.networkFirst(page))).toBe('shell');
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });
});

describe('cacheFirst', () => {
  const icon = new Request('https://app.test/icon-192.png');

  it('answers from this build without the network', async () => {
    const fetch = vi.fn();
    const { handlers } = setup(fetch, { 'build-2': { '/icon-192.png': 'icon' } });
    expect(await text(await handlers.cacheFirst(icon))).toBe('icon');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores the same URL in an older build', async () => {
    const { handlers, stores, settled } = setup(() => Promise.resolve(new Response('new icon')), {
      'build-1': { '/icon-192.png': 'old icon' },
    });
    expect(await text(await handlers.cacheFirst(icon))).toBe('new icon');
    await settled();
    expect(await text(stores.get('build-2')?.get(icon.url))).toBe('new icon');
  });

  it('does not keep a partial answer to a Range request', async () => {
    const { handlers, stores, settled } = setup(() => Promise.resolve(new Response('part', { status: 206 })));
    expect((await handlers.cacheFirst(icon)).status).toBe(206);
    await settled();
    expect(stores.get('build-2')?.size ?? 0).toBe(0);
  });
});

describe('cleanup', () => {
  it('drops every cache but the current one', async () => {
    const { handlers, stores } = setup(() => Promise.reject(new Error('unused')), {
      'build-1': {},
      'build-2': {},
      other: {},
    });
    await handlers.cleanup();
    expect([...stores.keys()]).toEqual(['build-2']);
  });
});
