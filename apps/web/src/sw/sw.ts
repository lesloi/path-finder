import { createCacheHandlers } from './cache.ts';
import { strategyFor } from './strategy.ts';

// Built as its own file (`/sw.js`) by the `serviceWorker` plugin of vite.config.ts; the page registers it.
// The `DOM` lib is on, so the few worker types used here are declared by hand.
interface WorkerEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends WorkerEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
const worker = self as unknown as {
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (event: WorkerEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
};

const cacheName = `path-finder-${String(import.meta.env.VITE_BUILD_ID)}`;

worker.addEventListener('install', (event) => {
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener('activate', (event) => {
  const { cleanup } = createCacheHandlers({ caches, cacheName, fetch, keepAlive: () => undefined });
  event.waitUntil(cleanup().then(() => worker.clients.claim()));
});

worker.addEventListener('fetch', (event) => {
  const { request } = event;
  const strategy = strategyFor(new URL(request.url), worker.location.origin, request.method, request.mode);
  if (strategy === 'ignore') return;
  const handlers = createCacheHandlers({ caches, cacheName, fetch, keepAlive: (work) => event.waitUntil(work) });
  event.respondWith(strategy === 'network-first' ? handlers.networkFirst(request) : handlers.cacheFirst(request));
});
