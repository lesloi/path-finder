import { useSyncExternalStore } from 'react';

// The left column replaces the bottom sheet from this width on, as in the stylesheets.
const DESKTOP_QUERY = '(min-width: 768px)';

function subscribe(onChange: () => void) {
  const query = matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Whether the screen is wide enough for the desktop layout. */
export function useDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(DESKTOP_QUERY).matches);
}
