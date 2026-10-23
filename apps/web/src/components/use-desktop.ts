import { useSyncExternalStore } from 'react';

// One subscription per query, built once: `useSyncExternalStore` resubscribes when `subscribe` changes identity.
function mediaHook(query: string) {
  const subscribe = (onChange: () => void) => {
    const list = matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  };
  return () => useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}

/** Whether the screen is wide enough for the desktop layout: the left column replaces the bottom sheet from there. */
export const useDesktop = mediaHook('(min-width: 768px)');

/** Whether the pointer can hover, which is when tooltips show (see `data-tip` in index.css). */
export const useHover = mediaHook('(hover: hover)');
