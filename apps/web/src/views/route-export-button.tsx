import { Download } from 'lucide-react';

import { PRIMARY_BUTTON } from '../components/index.ts';
import { exportRoute, type PaceUnit, type Position, type Route, type WaypointPois } from '../core/index.ts';
import { routesText, type Language } from '../i18n/index.ts';
import { useRoutePois } from './use-route-pois.ts';

/** A loaded track is already a file on the device: it is exported only once the user has run it the other way. */
export const canExport = ({ imported, reversed }: Route) => !imported || Boolean(reversed);

/**
 * The button that exports a route as a GPX file, with the drinking water around it. The tiles of the points of
 * interest are asked as the user reaches for it (pointer, touch or focus), so the tap finds them ready.
 */
export function RouteExportButton({
  route,
  language,
  paceUnit,
  pace,
  waypoints,
  waypointPois,
}: {
  route: Route;
  language: Language;
  paceUnit: PaceUnit;
  /** Minutes per km, the pace of the route's duration. */
  pace: number;
  waypoints?: Position[] | undefined;
  waypointPois?: WaypointPois | undefined;
}) {
  const { pois, load } = useRoutePois(route.geometry);
  return (
    <button
      type="button"
      data-testid="route-export"
      className={PRIMARY_BUTTON}
      onPointerEnter={load}
      onPointerDown={load}
      onFocus={load}
      // Nothing awaited before the share sheet: it needs the tap that opened it.
      onClick={() => void exportRoute(route, { language, paceUnit, waypoints, waypointPois, pois }, pace)}
    >
      <Download size={18} aria-hidden />
      {routesText[language].exportGpx}
    </button>
  );
}
