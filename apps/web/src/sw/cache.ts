export interface CacheDeps {
  caches: CacheStorage;
  /** One cache per build: `cleanup` drops the others. */
  cacheName: string;
  fetch: (request: Request) => Promise<Response>;
  /** Keeps the worker alive for a write that must not delay the answer. */
  keepAlive: (work: Promise<unknown>) => void;
}

/** Every navigation falls back to this one entry: they all get the same shell. */
const SHELL = '/';

export function createCacheHandlers({ caches, cacheName, fetch, keepAlive }: CacheDeps) {
  // Only a plain 200 is kept: a 206 makes `put` throw, and a redirected answer is refused for a navigation.
  // The write runs on its own, so a full quota never turns a good answer into an error.
  const store = (key: Request | string, response: Response) => {
    if (response.status !== 200 || response.redirected) return;
    const copy = response.clone();
    keepAlive(
      caches
        .open(cacheName)
        .then((cache) => cache.put(key, copy))
        .catch(() => undefined),
    );
  };

  return {
    /** The network first, so the reload that follows a `426` fetches the new build; the cache is the way out offline. */
    async networkFirst(request: Request): Promise<Response> {
      try {
        const response = await fetch(request);
        store(SHELL, response);
        return response;
      } catch (error) {
        const cached = await (await caches.open(cacheName)).match(SHELL);
        if (cached) return cached;
        throw error;
      }
    },

    /** Only this build's cache, so a fixed URL (icon, manifest) never comes from an older build. */
    async cacheFirst(request: Request): Promise<Response> {
      const cached = await (await caches.open(cacheName)).match(request);
      if (cached) return cached;
      const response = await fetch(request);
      store(request, response);
      return response;
    },

    async cleanup(): Promise<void> {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== cacheName).map((name) => caches.delete(name)));
    },
  };
}
