import { useSyncExternalStore } from 'react';

// The map's hash, which a URL without one also shows.
const HOME = '#/';

const currentHash = () => window.location.hash || HOME;

// The hashes that led to the current history entry, oldest first, ending with its own. Each
// entry keeps its trail in its state, so the trail survives going back, forward, and reloading.
let trail: string[] = [];

// How many entries of the app are behind the current one. The Navigation API counts them exactly; without it, the
// history length is an upper bound (it also counts the entries ahead).
function entriesBehind(): number {
  const { navigation } = window as { navigation?: { currentEntry: { index: number } | null } };
  return navigation?.currentEntry?.index ?? window.history.length - 1;
}

function syncTrail() {
  const state: unknown = window.history.state;
  const saved =
    typeof state === 'object' && state !== null && 'trail' in state && isHashList(state.trail)
      ? state.trail
      : undefined;
  if (saved) {
    // A system that restores the app, or a browser that caps its history, leaves fewer entries than the trail has
    // hashes. Going back through a hash with no entry would leave the app, and close an installed one.
    trail = saved.slice(-(entriesBehind() + 1));
    return;
  }
  // A new entry, from a link or the address bar: it follows the one before.
  trail = [...trail, currentHash()];
  window.history.replaceState({ ...(state as object | null), trail }, '');
}

function isHashList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

syncTrail();
window.addEventListener('hashchange', syncTrail);

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The hash of the page shown, `#/` for the map. Hash URLs need no server-side routes. */
export function useHash(): string {
  return useSyncExternalStore(subscribe, currentHash);
}

/**
 * Shows the page at `hash`. When the tab came from it, this goes back through the history
 * rather than adding an entry, so the system's back gesture then leaves the page for good.
 */
export function goTo(hash: string) {
  const index = trail.lastIndexOf(hash);
  if (index === -1 || index === trail.length - 1) window.location.hash = hash;
  else window.history.go(index - (trail.length - 1));
}
