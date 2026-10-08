import { Download, X } from 'lucide-react';

import { DOCK, ElevationProfile, ICON_BUTTON, PRIMARY_BUTTON } from '../components/index.ts';
import { gpxExport, missText, saveGpx, type Display, type Position, type Route } from '../core/index.ts';
import { routesText } from '../i18n/index.ts';
import { RouteFigures, SurfaceShare } from './route-figures.tsx';

/**
 * The desktop dock along the bottom of the map: the figures, the elevation profile and the GPX export of the
 * route selected. It is only there with a selection, and `onClose` deselects. `onHover` hears the place the user
 * points at on the profile.
 */
export function RouteDock({
  display,
  route,
  index,
  count,
  onClose,
  onHover,
}: {
  display: Display;
  route: Route;
  /** Its place in the route set, from 0. */
  index: number;
  count: number;
  onClose: () => void;
  onHover: (position: Position | undefined) => void;
}) {
  const t = routesText[display.language];
  return (
    <section
      data-testid="route-dock"
      className={`${DOCK} items-stretch gap-4 p-4`}
      aria-label={t.route(index + 1, count)}
    >
      <div className="flex w-52 flex-none flex-col justify-center gap-2">
        <strong data-testid="route-position">{t.route(index + 1, count)}</strong>
        <RouteFigures route={route} display={display} />
        {route.misses.map((miss) => (
          <span key={miss.criterion} data-testid="route-miss" className="text-sm font-semibold text-ink">
            {missText(miss, route, display)}
          </span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        <ElevationProfile testId="route-profile" route={route} display={display} onHover={onHover} />
        <div className="flex items-center justify-between gap-3">
          <SurfaceShare route={route} display={display} />
          <div className="w-44 flex-none">
            <button
              type="button"
              data-testid="route-export"
              className={PRIMARY_BUTTON}
              // Nothing awaited before the share sheet: it needs the click that opened it.
              onClick={() => void saveGpx(gpxExport(route, new Date(), display))}
            >
              <Download size={18} aria-hidden />
              {t.exportGpx}
            </button>
          </div>
        </div>
      </div>
      <button
        type="button"
        data-testid="route-close"
        className={`${ICON_BUTTON} absolute top-2 right-2`}
        aria-label={t.closeRoute}
        onClick={onClose}
      >
        <X size={20} aria-hidden />
      </button>
    </section>
  );
}
