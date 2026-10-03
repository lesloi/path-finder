export interface CacheDeps {
  caches: CacheStorage;
  /** One cache per build: `cleanup` drops the others. */
  cacheName: string;
  fetch: (request: Request) => Promise<Response>;
  /** Keeps the worker alive for a write that must not delay the answer. */
  keepAlive: (work: Promise<unknown>) => void;
}

/** The one page of the app, and the only entry a navigation falls back to. */
const SHELL = '/';

/** On a weak signal the network may answer after a long time or never: past this, the cached shell is used. */
export const NETWORK_TIMEOUT_MS = 4000;

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
    /**
     * The network first, so the reload that follows a `426` fetches the new build. The cached shell is the way
     * out when the network fails, is too slow or answers with a server error; with no shell, the network is awaited.
     */
    async networkFirst(request: Request): Promise<Response> {
      const shell = async () => (await caches.open(cacheName)).match(SHELL);
      const network = fetch(request).then((response) => {
        store(SHELL, response);
        return response;
      });
      // A late answer still refreshes the cache, and must not be an unhandled rejection once we stopped waiting.
      keepAlive(network.catch(() => undefined));
      let stopTimer = () => {};
      const timeout = new Promise<undefined>((resolve) => {
        const timer = setTimeout(resolve, NETWORK_TIMEOUT_MS);
        stopTimer = () => clearTimeout(timer);
      });
      try {
        const response = await Promise.race([network, timeout]);
        if (response && response.status < 500) return response;
        return (await shell()) ?? response ?? network;
      } catch (error) {
        const cached = await shell();
        if (cached) return cached;
        throw error;
      } finally {
        stopTimer();
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
