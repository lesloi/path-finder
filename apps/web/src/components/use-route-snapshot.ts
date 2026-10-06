import type { Map } from 'maplibre-gl';
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';

import { toMercator, type MapSnapshot, type Position } from '../core/index.ts';

/** Degrees below which a map counts as north up: a bearing comes back as a float. */
export const NORTH_EPSILON = 0.1;

// Milliseconds the map may take to settle before its snapshot is taken as it is.
const SNAPSHOT_TIMEOUT_MS = 5_000;

/**
 * Takes a snapshot of the map as it frames a new route set, before the routes are drawn over it, and
 * hands it to `onSnapshot` (undefined once there is no route set). Returns the route set it has a
 * snapshot of: the one the routes can be drawn for. A snapshot maps places to pixels without a turn, so
 * the map is turned back to north before one is taken, and a snapshot already taken is not taken again
 * while the map is turned.
 */
export function useRouteSnapshot({
  map: mapRef,
  loaded,
  routes,
  desktop,
  onSnapshot,
}: {
  map: RefObject<Map | null>;
  loaded: boolean;
  routes: Position[][] | undefined;
  /** Whether the layout is the desktop one: the map is framed differently, so it is taken again. */
  desktop: boolean;
  onSnapshot?: (snapshot: MapSnapshot | undefined) => void;
}) {
  const [takenFor, setTakenFor] = useState<Position[][]>();
  const url = useRef<string>(undefined);
  const alreadyTaken = useEffectEvent(() => takenFor === routes);
  const report = useEffectEvent((snapshot: MapSnapshot | undefined) => onSnapshot?.(snapshot));

  useEffect(() => {
    // Already taken for this route set: only a new one, or a new layout, is taken afresh.
    if (!loaded || !routes?.length) return;
    const map = mapRef.current!;
    // A new layout takes it afresh, but not from a map the user has turned: the one it has still holds.
    if (alreadyTaken() && Math.abs(map.getBearing()) > NORTH_EPSILON) return;
    let cancelled = false;
    // Read in the frame's own render event, while the canvas still holds it: the browser clears it after.
    const capture = () => {
      if (cancelled) return;
      const canvas = map.getCanvas();
      const [centre, width, height] = [map.getCenter(), canvas.clientWidth, canvas.clientHeight];
      // Pixels are linear in Web Mercator: two places give the whole mapping.
      const from: Position = [centre.lng, centre.lat];
      const to: Position = [centre.lng + 0.01, centre.lat + 0.01];
      const [pixelFrom, pixelTo] = [map.project(from), map.project(to)];
      const [mercatorFrom, mercatorTo] = [toMercator(from), toMercator(to)];
      const scaleX = (pixelTo.x - pixelFrom.x) / (mercatorTo[0] - mercatorFrom[0]);
      const scaleY = (pixelTo.y - pixelFrom.y) / (mercatorTo[1] - mercatorFrom[1]);
      canvas.toBlob(
        (blob) => {
          if (cancelled) return;
          if (url.current) URL.revokeObjectURL(url.current);
          url.current = blob ? URL.createObjectURL(blob) : undefined;
          setTakenFor(routes);
          if (!url.current) return report(undefined);
          report({
            url: url.current,
            width,
            height,
            toPixel: ([x, y]) => [
              pixelFrom.x + (x - mercatorFrom[0]) * scaleX,
              pixelFrom.y + (y - mercatorFrom[1]) * scaleY,
            ],
            of: routes,
          });
        },
        'image/jpeg',
        0.85,
      );
    };
    const finish = () => {
      clearTimeout(timer);
      map.off('idle', finish);
      // Turned by the user while the map settled: back to north, and wait for it to settle again.
      if (Math.abs(map.getBearing()) > NORTH_EPSILON) {
        map.jumpTo({ bearing: 0 });
        map.on('idle', finish);
        timer = setTimeout(finish, SNAPSHOT_TIMEOUT_MS);
        return;
      }
      map.once('render', capture);
      map.triggerRepaint();
    };
    map.on('idle', finish);
    // A map that never settles (a tile that does not load) still gets its routes.
    let timer = setTimeout(finish, SNAPSHOT_TIMEOUT_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      map.off('idle', finish);
      map.off('render', capture);
    };
  }, [loaded, routes, desktop, mapRef]);

  // No route set: no snapshot, and the next one is taken afresh.
  useEffect(() => {
    if (routes?.length) return;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = undefined;
    report(undefined);
  }, [routes]);

  return takenFor;
}
