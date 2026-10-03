export type Strategy = 'network-first' | 'cache-first' | 'ignore';

/** Files of the app itself that never change under one name: the icons and the manifest. */
const STATIC_FILES = new Set([
  '/manifest.webmanifest',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
]);

/**
 * How the service worker answers a request. Only the app shell is cached: the API carries the start
 * point and other origins (map tiles) are not ours to keep, so both go straight to the network.
 */
export function strategyFor(url: URL, origin: string, method: string, mode: string): Strategy {
  if (method !== 'GET' || url.origin !== origin) return 'ignore';
  if (url.pathname.startsWith('/api/')) return 'ignore';
  if (mode === 'navigate') return 'network-first';
  // Vite fingerprints what it emits under /assets, so a cached copy is never stale.
  if (url.pathname.startsWith('/assets/') || STATIC_FILES.has(url.pathname)) return 'cache-first';
  return 'ignore';
}
