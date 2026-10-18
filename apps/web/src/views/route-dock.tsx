import { ArrowLeftRight, X } from 'lucide-react';

import { DOCK, ElevationProfile, ICON_BUTTON, tip } from '../components/index.ts';
import { type PaceUnit, type Position, type Route, type WaypointPois } from '../core/index.ts';
import { routesText, type Language } from '../i18n/index.ts';
import { RouteExportButton } from './route-export-button.tsx';
import { RouteFigures, SurfaceShare, TechnicalMarker } from './route-figures.tsx';

/**
 * The desktop dock along the bottom of the map: the figures, the elevation profile and the GPX export of the
 * route selected. It is only there with a selection, and `onClose` deselects. `onHover` hears the place the user
 * points at on the profile.
 */
export function RouteDock({
  language,
  paceUnit,
  pace,
  route,
  index,
  count,
  onClose,
  onReverse,
  onHover,
  waypoints,
  waypointPois,
}: {
  language: Language;
  paceUnit: PaceUnit;
  /** Minutes per km, the pace of the route's duration. */
  pace: number;
  route: Route;
  /** Its place in the route set, from 0. */
  index: number;
  count: number;
  onClose: () => void;
  onReverse: () => void;
  onHover: (position: Position | undefined) => void;
  /** The points the route was asked to go through, shown on its profile and kept in its GPX file. */
  waypoints?: Position[] | undefined;
  waypointPois?: WaypointPois | undefined;
}) {
  const t = routesText[language];
  return (
    <section
      data-testid="route-dock"
      className={`${DOCK} items-stretch gap-4 p-4`}
      aria-label={t.route(index + 1, count)}
    >
      <div className="flex w-52 flex-none flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <strong data-testid="route-position">{t.route(index + 1, count)}</strong>
          <button
            type="button"
            data-testid="route-reverse"
            className={ICON_BUTTON}
            {...tip(t.reverseRoute, 'bottom-end')}
            onClick={onReverse}
          >
            <ArrowLeftRight size={18} aria-hidden />
          </button>
        </div>
        {/* Centred in the room above the export. */}
        <div className="flex flex-1 flex-col justify-center">
          <RouteFigures route={route} language={language} />
        </div>
        <div className="self-center">
          <RouteExportButton
            route={route}
            language={language}
            paceUnit={paceUnit}
            pace={pace}
            waypoints={waypoints}
            waypointPois={waypointPois}
          />
        </div>
      </div>
      {/* Room on the right for the close button, which the pins of the profile would otherwise sit under. */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 pr-10">
        <ElevationProfile
          testId="route-profile"
          route={route}
          language={language}
          onHover={onHover}
          waypoints={waypoints}
          waypointPois={waypointPois}
        />
        <SurfaceShare route={route} language={language} />
        {/* Here rather than in the figures' column, which has no room left for them. */}
        {route.technical && <TechnicalMarker text={t.technical} testId="route-technical" className="justify-center" />}
      </div>
      <button
        type="button"
        data-testid="route-close"
        className={`${ICON_BUTTON} absolute top-2 right-2`}
        {...tip(t.closeRoute, 'bottom-end')}
        onClick={onClose}
      >
        <X size={20} aria-hidden />
      </button>
    </section>
  );
}
