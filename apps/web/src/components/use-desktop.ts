import { useSyncExternalStore } from 'react';

// The left column replaces the bottom sheet from this size on, as in the stylesheets. A phone in landscape is wide
// enough but too short for it, so it keeps the bottom sheet.
const DESKTOP_QUERY = '(min-width: 768px) and (min-height: 500px)';

function subscribe(onChange: () => void) {
  const query = matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Whether the screen is wide enough for the desktop layout. */
export function useDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(DESKTOP_QUERY).matches);
}
