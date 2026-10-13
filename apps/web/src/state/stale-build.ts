import { parseCriteria } from '../contract/index.ts';
import type { RouteSetRequest } from '../core/index.ts';

const RELOADED_FROM = 'path-finder.reloaded-from';
const PENDING = 'path-finder.pending-search';

// Outside a build there is no id: a page then reloads once per tab, which is enough as no API answers 426 to it.
const currentBuild = (): string => {
  const buildId: unknown = import.meta.env.VITE_BUILD_ID;
  return typeof buildId === 'string' ? buildId : '';
};

/**
 * The app is older than the API: reloads the page to get the new build, and keeps `request` for after it.
 * A page reloads once per build: the marker is the build that reloaded, so a build that stays stale (a rollout
 * reaching an old server) cannot loop, and a page of a newer build may reload again with no state to clear.
 * Returns false when it did not reload, and the user has to be told.
 * The session storage stays on the device, is private to the tab and goes with it.
 */
export function reloadForNewBuild(request?: RouteSetRequest): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_FROM) === currentBuild()) return false;
    sessionStorage.setItem(RELOADED_FROM, currentBuild());
    if (request) sessionStorage.setItem(PENDING, JSON.stringify(request));
  } catch {
    // Without storage nothing would stop a loop.
    return false;
  }
  location.reload();
  return true;
}

/**
 * The search a reload for a new build interrupted, if there is one. It only reads, so that a render that runs twice
 * sees the same search; `forgetPendingSearch` ends it once it is taken up.
 */
export function pendingSearch(): RouteSetRequest | undefined {
  try {
    const stored = sessionStorage.getItem(PENDING);
    return stored ? parseCriteria(JSON.parse(stored)) : undefined;
  } catch {
    // Unreadable, or not criteria this build accepts: there is nothing to resume.
    return undefined;
  }
}

export function forgetPendingSearch() {
  try {
    sessionStorage.removeItem(PENDING);
  } catch {
    // Nothing was stored.
  }
}
