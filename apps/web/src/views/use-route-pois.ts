import { useEffect, useState } from 'react';

import { poiTilesAround, WATER_POINT_MAX_METRES, type Poi, type Route } from '../core/index.ts';
import { requestPoiTile } from '../state/index.ts';

/**
 * The points of interest around a route, for its GPX export. Nothing is asked until `load` is called, when the
 * user reaches for the export: a route that is only looked at sends no tile request. The export reads `pois` at the
 * tap and awaits nothing, since a share sheet needs that tap. A tile that is not there yet means fewer points,
 * never an error. The tiles are the ones the map asks for, and the map's category toggles do not matter here.
 */
export function useRoutePois(geometry: Route['geometry']): { pois: Poi[]; load: () => void } {
  const [wanted, setWanted] = useState<Route['geometry']>();
  const [loaded, setLoaded] = useState<{ geometry: Route['geometry']; pois: Poi[] }>();
  useEffect(() => {
    if (wanted !== geometry) return;
    let current = true;
    void Promise.all(poiTilesAround(geometry, WATER_POINT_MAX_METRES).map(([x, y]) => requestPoiTile(x, y))).then(
      (tiles) => {
        if (current) setLoaded({ geometry, pois: tiles.flat() });
      },
    );
    return () => {
      current = false;
    };
  }, [geometry, wanted]);
  // Another route's points are not this one's, even for the moment before its own arrive.
  return { pois: loaded?.geometry === geometry ? loaded.pois : [], load: () => setWanted(geometry) };
}
