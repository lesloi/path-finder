import { useMemo, useState } from 'react';

import { useToastTimeout } from '../components/index.ts';
import type { MapSnapshot, Position, RouteSetRequest } from '../core/index.ts';
import { useRouteSet, type RouteSetError } from '../state/index.ts';

/**
 * What the user does with a route set: asking for it, the route selected (none until they pick one), the route
 * they point at in the list, whether the detail of the selected one is open (on phones), and the place they point
 * at on its elevation profile. The route set is gone once cleared.
 */
export function useRouteBrowser() {
  const [error, setError] = useState<RouteSetError | 'no-routes'>();
  const { routeSet, loading, find, clear } = useRouteSet(setError);
  const [selected, setSelected] = useState<number>();
  // The route a pointer or the focus is on in the list: the map highlights it without selecting it.
  const [preview, setPreview] = useState<number>();
  const [detail, setDetail] = useState(false);
  const [hover, setHover] = useState<Position>();
  // Whether the route set is shown rather than the criteria: leaving it for the criteria keeps it.
  const [showing, setShowing] = useState(false);
  const [mapSnapshot, setSnapshot] = useState<MapSnapshot>();
  // Kept while the route set does, so the map's effects only run for a new one.
  const geometries = useMemo(
    () => routeSet?.routes.map(({ geometry }) => geometry.map(([lon, lat]): Position => [lon, lat])),
    [routeSet],
  );

  useToastTimeout(error, () => setError(undefined));

  // A snapshot of another route set would draw the wrong places.
  const snapshot = mapSnapshot?.of === geometries ? mapSnapshot : undefined;

  return {
    routeSet,
    showing: showing && Boolean(routeSet),
    snapshot,
    setSnapshot,
    loading,
    error,
    selected,
    preview,
    detail,
    hover,
    geometries,
    select: setSelected,
    setPreview,
    setHover,
    dismissError: () => setError(undefined),
    ask(request: RouteSetRequest) {
      setError(undefined);
      setSelected(undefined);
      setPreview(undefined);
      setDetail(false);
      setShowing(true);
      find(request);
    },
    /** Back to the criteria: the routes stay on the map, and can be shown again. */
    leave() {
      setShowing(false);
      setDetail(false);
      setHover(undefined);
    },
    show() {
      setShowing(true);
    },
    /** Forgets the route set, and any search under way, such as when a new start point makes it stale. */
    drop() {
      clear();
      setSelected(undefined);
      setPreview(undefined);
      setShowing(false);
      setDetail(false);
      setHover(undefined);
    },
    openDetail(open: boolean) {
      setDetail(open);
      setHover(undefined);
    },
  };
}
