import { ArrowLeft, ArrowLeftRight, ArrowUpRight, ChevronRight, Clock, Download, Mountain, Trash2 } from 'lucide-react';
import { useRef, type PointerEvent } from 'react';

import {
  ElevationProfile,
  hint,
  PRIMARY_BUTTON,
  ProfileSparkline,
  routeBorder,
  RouteThumbnail,
  SurfaceBar,
  useDesktop,
} from '../components/index.ts';
import {
  formatDistance,
  formatDuration,
  formatHeight,
  exportRoute,
  type Position,
  type WaypointPois,
  type MapSnapshot,
  type Route,
  type PaceUnit,
} from '../core/index.ts';
import { criteriaText, routesText, type Language } from '../i18n/index.ts';
import { Marker, RouteFigures, RouteMarkers, SurfaceShare, surfaceShares } from './route-figures.tsx';
import { RouteTimeline } from './route-timeline.tsx';
import { RouteCarousel } from './route-carousel.tsx';
import { RoutePace } from './route-pace.tsx';

// A horizontal move of the pointer longer than this, in px, and longer than its vertical move, swipes.
const SWIPE_PX = 50;

/** The box of a route's row; the placeholder of the results draws the same. */
export const ROUTE_ROW_BOX = 'flex min-h-13 w-full flex-col gap-2 rounded-md border border-l-4 border-border p-2';

const TEXT_BUTTON = 'flex min-h-touch items-center gap-1 rounded-full px-2 text-sm text-accent hover:bg-surface-2';

// The words of the route set: its own, and the labels it shares with the criteria.
const words = (language: Language) => ({ ...criteriaText[language], ...routesText[language] });

/**
 * The route set the user asked for. On phones, first a carousel of its routes, where settling on a card selects
 * its route and a tap on the selected card opens its detail, which swipes to the next. On desktops, the list
 * alone: the route selected has its detail in the dock (`RouteDock`), and pointing at a row only previews its
 * route. `onSelect` hears the route shown in the carousel, the list or the detail, `onHover` a place the user
 * points at on the elevation profile. The durations of the routes are at `pace`; `onPaceChange`, when given,
 * lets the user change it in the list. `onClear` forgets the route set.
 */
export function RouteSetView({
  language,
  paceUnit,
  routes,
  pace,
  snapshot,
  selected,
  detail,
  onSelect,
  onPreview,
  onDetailChange,
  onPaceChange,
  onClear,
  onReverse,
  onHover,
  waypoints,
  waypointPois,
}: {
  language: Language;
  paceUnit: PaceUnit;
  routes: Route[];
  /** Minutes per km, which the durations of the routes are estimated at. */
  pace: number;
  /** What the map showed for these routes, to draw their thumbnails over. */
  snapshot?: MapSnapshot;
  /** Undefined while the user has picked none, as on a desktop at first. */
  selected?: number;
  /** Whether the detail of the selected route is shown rather than the list. Phones only. */
  detail: boolean;
  onSelect: (index: number) => void;
  /** On desktops, the row the pointer or the focus is on, or none once it leaves. */
  onPreview?: (index: number | undefined) => void;
  onDetailChange: (detail: boolean) => void;
  /** Absent when the pace cannot change the routes' durations alone, such as by duration. */
  onPaceChange?: (pace: number) => void;
  onClear: () => void;
  /** The user asks to run the route at this index the other way. */
  onReverse: (index: number) => void;
  onHover: (position: Position | undefined) => void;
  /** The points the routes were asked to go through, shown on the profile of a route and kept in its GPX file. */
  waypoints?: Position[] | undefined;
  waypointPois?: WaypointPois | undefined;
}) {
  const desktop = useDesktop();

  if (detail && !desktop) {
    return (
      <RouteDetail
        language={language}
        paceUnit={paceUnit}
        routes={routes}
        pace={pace}
        snapshot={snapshot}
        selected={selected ?? 0}
        onSelect={onSelect}
        onBack={() => onDetailChange(false)}
        onReverse={() => onReverse(selected ?? 0)}
        onHover={onHover}
        waypoints={waypoints}
        waypointPois={waypointPois}
      />
    );
  }

  const t = words(language);
  const rows = routes.map((route, index) => (
    <RouteRow
      key={index}
      route={route}
      snapshot={snapshot}
      index={index}
      count={routes.length}
      selected={index === selected}
      language={language}
      desktop={desktop}
      // A tap opens the detail of the route on the card in the middle, and brings another card there; a click on
      // a desktop selects the route.
      onOpen={() => (!desktop && index === selected ? onDetailChange(true) : onSelect(index))}
      // The focus on a card of a phone selects it; a desktop only previews a row, until a click selects it.
      onPreview={() => (desktop ? onPreview?.(index) : onSelect(index))}
      onPreviewEnd={desktop ? () => onPreview?.(undefined) : undefined}
    />
  ));
  return (
    <>
      <div className="flex items-center justify-between gap-2 -mt-2 -mb-5">
        <strong data-testid="routes-count" className="text-lg">
          {t.routeCount(routes.length)}
        </strong>
        {!desktop && selected !== undefined && (
          // Said again as the carousel moves; the cards alone do not tell which one is in the middle.
          <span data-testid="routes-position" className="sr-only" aria-live="polite">
            {t.route(selected + 1, routes.length)}
          </span>
        )}
        <button type="button" data-testid="routes-clear" className={`${TEXT_BUTTON} ml-auto`} onClick={onClear}>
          <Trash2 size={18} aria-hidden />
          {t.clearRoutes}
        </button>
      </div>
      <div className="-mb-2">
        <RoutePace paceUnit={paceUnit} language={language} pace={pace} onChange={onPaceChange} />
      </div>
      {desktop ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="routes-list">
          {rows.map((row, index) => (
            <li key={index}>{row}</li>
          ))}
        </ul>
      ) : (
        <RouteCarousel testId="routes-list" selected={selected} onSelect={onSelect}>
          {rows}
        </RouteCarousel>
      )}
    </>
  );
}

function RouteRow({
  route,
  snapshot,
  index,
  count,
  selected,
  language,
  desktop,
  onOpen,
  onPreview,
  onPreviewEnd,
}: {
  route: Route;
  snapshot?: MapSnapshot;
  index: number;
  count: number;
  selected: boolean;
  language: Language;
  desktop: boolean;
  onOpen: () => void;
  /** The pointer or the focus is on the row: its route is the one the map highlights. */
  onPreview: () => void;
  /** The pointer or the focus left the row. */
  onPreviewEnd?: (() => void) | undefined;
}) {
  const t = words(language);
  // A press focuses the row before its click: only the keyboard selects from the focus, not a tap.
  const pressed = useRef(false);
  const distance = formatDistance(route.distance, language);
  const duration = formatDuration(route.estimatedDuration, language);
  const gain = route.elevationGain === undefined ? undefined : formatHeight(route.elevationGain, language);
  const shares = surfaceShares(route, language);
  const surface = `${t.paved} ${shares.paved} · ${t.unpaved} ${shares.unpaved}`;
  const name = [
    t.route(index + 1, count),
    distance,
    ...(gain ? [`${t.elevationGain} ${gain}`] : []),
    `${t.estimatedDuration} ${duration}`,
    surface,
    ...(route.technical ? [t.technical] : []),
  ].join(', ');
  return (
    <button
      type="button"
      data-testid={`routes-row-${index}`}
      data-selected={selected ? '' : undefined}
      aria-current={selected ? 'true' : undefined}
      className={`${ROUTE_ROW_BOX} text-left ${routeBorder(index)} hover:bg-surface-2 data-selected:bg-surface-2`}
      aria-label={name}
      onPointerDown={() => (pressed.current = true)}
      onPointerCancel={() => (pressed.current = false)}
      onClick={() => {
        pressed.current = false;
        onOpen();
      }}
      // Hovering is for desktops: a tap on a phone opens the route.
      onMouseEnter={desktop ? onPreview : undefined}
      onMouseLeave={onPreviewEnd}
      onFocus={() => {
        if (!pressed.current) onPreview();
      }}
      onBlur={onPreviewEnd}
    >
      <span className="flex w-full items-center gap-3">
        <RouteThumbnail geometry={route.geometry} index={index} {...(snapshot && { snapshot })} />
        <span className="flex min-w-0 flex-none flex-col gap-1">
          <strong data-testid={`routes-row-${index}-distance`} className="text-lg">
            {distance}
          </strong>
          <span className="flex items-center gap-3 text-sm text-ink-2">
            {gain && (
              <span
                data-testid={`routes-row-${index}-gain`}
                {...hint(t.elevationGain, 'top-start')}
                className="flex items-center gap-1"
              >
                <ArrowUpRight size={14} aria-hidden />
                {gain}
              </span>
            )}
            <span {...hint(t.estimatedDuration, 'top-start')} className="flex items-center gap-1">
              <Clock size={14} aria-hidden />
              {duration}
            </span>
          </span>
          {route.technical && <Marker icon={Mountain} text={t.technical} testId={`routes-row-${index}-technical`} />}
        </span>
        {/* The empty width of the row: where the route climbs, at a glance. */}
        <ProfileSparkline testId={`routes-row-${index}-profile`} geometry={route.geometry} index={index} />
        <ChevronRight size={18} aria-hidden className="ml-auto flex-none text-ink-2" />
      </span>
      <SurfaceBar testId={`routes-row-${index}-surface`} unpavedShare={shares.unpavedShare} label={surface} />
    </button>
  );
}

function RouteDetail({
  language,
  paceUnit,
  routes,
  pace,
  snapshot,
  selected,
  onSelect,
  onBack,
  onReverse,
  onHover,
  waypoints,
  waypointPois,
}: {
  language: Language;
  paceUnit: PaceUnit;
  routes: Route[];
  /** Minutes per km, the pace of the durations. */
  pace: number;
  snapshot?: MapSnapshot;
  selected: number;
  onSelect: (index: number) => void;
  onBack: () => void;
  onReverse: () => void;
  onHover: (position: Position | undefined) => void;
  waypoints?: Position[] | undefined;
  waypointPois?: WaypointPois | undefined;
}) {
  const t = words(language);
  const route = routes[selected];
  const swipeFrom = useRef<[number, number]>(undefined);
  const hasPrevious = selected > 0;
  const hasNext = selected < routes.length - 1;

  function swipeEnd(event: PointerEvent) {
    if (!swipeFrom.current) return;
    const dx = event.clientX - swipeFrom.current[0];
    const dy = event.clientY - swipeFrom.current[1];
    swipeFrom.current = undefined;
    // A mostly vertical move scrolls the panel.
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && hasNext) onSelect(selected + 1);
    if (dx > 0 && hasPrevious) onSelect(selected - 1);
  }

  return (
    <div
      data-testid="route-detail"
      // Vertical moves stay the panel's own, to scroll it.
      className="flex touch-pan-y flex-col gap-3"
      // A finger swipes between the routes.
      onPointerDown={(event) => {
        if (event.pointerType !== 'mouse') swipeFrom.current = [event.clientX, event.clientY];
      }}
      onPointerUp={swipeEnd}
      onPointerCancel={() => (swipeFrom.current = undefined)}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="route-back"
          className="flex min-h-touch items-center gap-1 rounded-full pr-3 text-accent"
          onClick={onBack}
        >
          <ArrowLeft size={18} aria-hidden />
          {t.routes}
        </button>
        <button type="button" data-testid="route-reverse" className={TEXT_BUTTON} onClick={onReverse}>
          <ArrowLeftRight size={18} aria-hidden />
          {t.reverseRoute}
        </button>
        <strong data-testid="route-position" aria-label={t.route(selected + 1, routes.length)}>
          {selected + 1}/{routes.length}
        </strong>
      </div>
      <div className="flex items-center gap-3">
        <RouteThumbnail
          testId="route-thumbnail"
          geometry={route.geometry}
          index={selected}
          {...(snapshot && { snapshot })}
        />
        <RouteFigures route={route} language={language} className="flex-1" />
      </div>
      <RouteMarkers route={route} language={language} />
      <ElevationProfile
        testId="route-profile"
        route={route}
        language={language}
        onHover={onHover}
        waypoints={waypoints}
        waypointPois={waypointPois}
      />
      <SurfaceShare route={route} language={language} />
      <RouteTimeline route={route} language={language} pace={pace} waypoints={waypoints} waypointPois={waypointPois} />
      {/* Pinned to the bottom of the sheet's scroll area: on a short phone the profile pushes it under the fold. The top padding masks what scrolls under it; the negative margin takes back the flex gap it replaces. */}
      <div className="sticky bottom-0 -mt-3 bg-surface pt-3">
        <button
          type="button"
          data-testid="route-export"
          className={PRIMARY_BUTTON}
          // Nothing awaited before the share sheet: it needs the tap that opened it.
          onClick={() => void exportRoute(route, { language, paceUnit, waypoints, waypointPois }, pace)}
        >
          <Download size={18} aria-hidden />
          {t.exportGpx}
        </button>
      </div>
    </div>
  );
}
