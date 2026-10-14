import { useMemo, useState } from 'react';

import { useToastTimeout, type SheetState } from '../components/index.ts';
import type { MapSnapshot, Position, RouteSetRequest } from '../core/index.ts';
import { useRouteSet, type Refusal } from '../state/index.ts';

/**
 * What the user does with a route set: asking for it, the route selected (none until they pick one), the route
 * they point at in the list, the stop of the phone's sheet (its expanded one is the detail of the selected route), and the place they point
 * at on its elevation profile. The route set is gone once cleared.
 */
export function useRouteBrowser() {
  const [refusal, setRefusal] = useState<Refusal>();
  const { routeSet, loading, find, clear } = useRouteSet(setRefusal);
  const [selected, setSelected] = useState<number>();
  // The route a pointer or the focus is on in the list: the map highlights it without selecting it.
  const [preview, setPreview] = useState<number>();
  // The stop of the phone's sheet: folded down to its handle to see more of the map, or expanded for the detail.
  const [sheet, setSheet] = useState<SheetState>('collapsed');
  const [hover, setHover] = useState<Position>();
  const [mapSnapshot, setSnapshot] = useState<MapSnapshot>();
  // Kept while the route set does, so the map's effects only run for a new one.
  const geometries = useMemo(
    () => routeSet?.routes.map(({ geometry }) => geometry.map(([lon, lat]): Position => [lon, lat])),
    [routeSet],
  );

  const changeSheet = (state: SheetState) => {
    setSheet(state);
    setHover(undefined);
  };

  // The notice of a newer version stays: the user has to reload, and a click drops it.
  useToastTimeout(refusal?.error === 'stale-build' ? undefined : refusal, () => setRefusal(undefined));

  // A snapshot of another route set would draw the wrong places.
  const snapshot = mapSnapshot?.of === geometries ? mapSnapshot : undefined;

  return {
    routeSet,
    snapshot,
    setSnapshot,
    loading,
    refusal,
    selected,
    preview,
    sheet,
    detail: sheet === 'expanded',
    hover,
    geometries,
    select: setSelected,
    setPreview,
    setHover,
    dismissError: () => setRefusal(undefined),
    ask(request: RouteSetRequest) {
      setRefusal(undefined);
      setSelected(undefined);
      setPreview(undefined);
      setSheet('collapsed');
      find(request);
    },
    /** Forgets the route set, and any search under way, such as when a new start point makes it stale. */
    drop() {
      clear();
      setSelected(undefined);
      setPreview(undefined);
      setSheet('collapsed');
      setHover(undefined);
    },
    changeSheet,
    openDetail: (open: boolean) => changeSheet(open ? 'expanded' : 'collapsed'),
  };
}
