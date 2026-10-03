import { createCacheHandlers, NETWORK_TIMEOUT_MS } from './cache.ts';

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

describe('networkFirst on a weak connection', () => {
  const deferred = () => {
    let resolve!: (response: Response) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Response>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses the cached shell when the network is too slow, and the late answer refreshes it', async () => {
    const network = deferred();
    const { handlers, stores, settled } = setup(() => network.promise, { 'build-2': { '/': 'old shell' } });
    const answer = handlers.networkFirst(page);
    await vi.advanceTimersByTimeAsync(NETWORK_TIMEOUT_MS);
    expect(await text(await answer)).toBe('old shell');
    network.resolve(new Response('new shell'));
    await settled();
    expect(await text(stores.get('build-2')?.get('https://app.test/'))).toBe('new shell');
  });

  it('does not leave an unhandled rejection when the slow network fails after the shell was used', async () => {
    const network = deferred();
    const { handlers, settled } = setup(() => network.promise, { 'build-2': { '/': 'old shell' } });
    const answer = handlers.networkFirst(page);
    await vi.advanceTimersByTimeAsync(NETWORK_TIMEOUT_MS);
    expect(await text(await answer)).toBe('old shell');
    network.reject(new TypeError('offline'));
    await expect(settled()).resolves.toBeDefined();
  });

  it('keeps waiting for the network when nothing is cached', async () => {
    const network = deferred();
    const { handlers } = setup(() => network.promise);
    const answer = handlers.networkFirst(page);
    await vi.advanceTimersByTimeAsync(NETWORK_TIMEOUT_MS * 3);
    network.resolve(new Response('slow shell'));
    expect(await text(await answer)).toBe('slow shell');
  });

  it('rethrows a failure that comes after the timeout when nothing is cached', async () => {
    const network = deferred();
    const { handlers } = setup(() => network.promise);
    const answer = handlers.networkFirst(page);
    const failure = expect(answer).rejects.toThrow('offline');
    await vi.advanceTimersByTimeAsync(NETWORK_TIMEOUT_MS);
    network.reject(new TypeError('offline'));
    await failure;
  });

  it('uses the cached shell when the server answers with an error', async () => {
    const { handlers } = setup(() => Promise.resolve(new Response('bad gateway', { status: 502 })), {
      'build-2': { '/': 'old shell' },
    });
    expect(await text(await handlers.networkFirst(page))).toBe('old shell');
  });

  it('shows the server error when there is no shell to use', async () => {
    const { handlers } = setup(() => Promise.resolve(new Response('bad gateway', { status: 502 })));
    expect((await handlers.networkFirst(page)).status).toBe(502);
  });

  it('does not use the shell for a client error, which the app has to see', async () => {
    const { handlers } = setup(() => Promise.resolve(new Response('upgrade', { status: 426 })), {
      'build-2': { '/': 'old shell' },
    });
    expect((await handlers.networkFirst(page)).status).toBe(426);
  });

  it('stops the timer once the network has answered', async () => {
    const { handlers } = setup(() => Promise.resolve(new Response('shell')));
    await handlers.networkFirst(page);
    expect(vi.getTimerCount()).toBe(0);
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
