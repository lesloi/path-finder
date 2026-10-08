import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Clock,
  Download,
  Mountain,
  Ruler,
  Timer,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useRef, type PointerEvent } from 'react';

import type { Miss } from '../contract/index.ts';
import {
  ElevationProfile,
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
  gpxExport,
  missText,
  saveGpx,
  type Position,
  type MapSnapshot,
  type Route,
  type Display,
} from '../core/index.ts';
import { criteriaText, routesText } from '../i18n/index.ts';
import { RouteFigures, SurfaceShare, surfaceShares } from './route-figures.tsx';
import { RoutePace } from './route-pace.tsx';

// A horizontal move of the pointer longer than this, in px, and longer than its vertical move, swipes.
const SWIPE_PX = 50;

const MISS_ICONS = { distance: Ruler, duration: Timer, elevationGain: TrendingUp } satisfies Record<
  Miss['criterion'],
  LucideIcon
>;

// The words of the route set: its own, and the labels it shares with the criteria.
const words = ({ language }: Display) => ({ ...criteriaText[language], ...routesText[language] });

/**
 * The route set the user asked for. On phones, first a list of its routes, then the detail of one, which swipes
 * to the next. On desktops, the list alone: the route selected has its detail in the dock (`RouteDock`), and
 * pointing at a row only previews its route. `onSelect` hears the route shown in the list or the detail,
 * `onHover` a place the user points at on the elevation profile. The durations of the routes are at `pace`;
 * `onPaceChange`, when given, lets the user change it in the list.
 */
export function RouteSetView({
  display,
  routes,
  pace,
  snapshot,
  selected,
  detail,
  onSelect,
  onPreview,
  onDetailChange,
  onPaceChange,
  onBack,
  onHover,
  condensed = false,
}: {
  display: Display;
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
  /** Back to the criteria. Phones only: a desktop shows them beside the list. */
  onBack: () => void;
  onHover: (position: Position | undefined) => void;
  /** On a phone with its sheet collapsed, the detail stops at the figures: the rest is for the expanded sheet. */
  condensed?: boolean;
}) {
  const desktop = useDesktop();

  if (detail && !desktop) {
    return (
      <RouteDetail
        display={display}
        routes={routes}
        snapshot={snapshot}
        selected={selected ?? 0}
        onSelect={onSelect}
        onBack={() => onDetailChange(false)}
        onHover={onHover}
        condensed={condensed}
      />
    );
  }

  const t = words(display);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        {!desktop && (
          <button
            type="button"
            data-testid="routes-back"
            className="flex min-h-touch items-center gap-1 rounded-full pr-3 text-accent"
            onClick={onBack}
          >
            <ArrowLeft size={18} aria-hidden />
            {t.criteria}
          </button>
        )}
        <strong data-testid="routes-count">{t.routeCount(routes.length)}</strong>
      </div>
      <RoutePace display={display} pace={pace} onChange={onPaceChange} />
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="routes-list">
        {routes.map((route, index) => (
          <li key={index}>
            <RouteRow
              route={route}
              snapshot={snapshot}
              index={index}
              count={routes.length}
              selected={index === selected}
              display={display}
              desktop={desktop}
              onOpen={() => {
                onSelect(index);
                if (!desktop) onDetailChange(true);
              }}
              // A tap on a phone opens the route; a desktop only previews it, until a click selects it.
              onPreview={() => (desktop ? onPreview?.(index) : onSelect(index))}
              onPreviewEnd={desktop ? () => onPreview?.(undefined) : undefined}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function RouteRow({
  route,
  snapshot,
  index,
  count,
  selected,
  display,
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
  display: Display;
  desktop: boolean;
  onOpen: () => void;
  /** The pointer or the focus is on the row: its route is the one the map highlights. */
  onPreview: () => void;
  /** The pointer or the focus left the row. */
  onPreviewEnd?: (() => void) | undefined;
}) {
  const t = words(display);
  const distance = formatDistance(route.distance, display);
  const duration = formatDuration(route.estimatedDuration, display.language);
  const gain = route.elevationGain === undefined ? undefined : formatHeight(route.elevationGain, display);
  const misses = route.misses.map((miss) => missText(miss, route, display));
  const shares = surfaceShares(route, display);
  const surface = `${t.paved} ${shares.paved} · ${t.unpaved} ${shares.unpaved}`;
  const name = [
    t.route(index + 1, count),
    distance,
    ...(gain ? [`${t.elevationGain} ${gain}`] : []),
    `${t.estimatedDuration} ${duration}`,
    surface,
    ...misses,
    ...(route.technical ? [t.technical] : []),
  ].join(', ');
  return (
    <button
      type="button"
      data-testid={`routes-row-${index}`}
      data-selected={selected ? '' : undefined}
      className={
        `flex min-h-13 w-full flex-col gap-2 rounded-md border border-l-4 border-border p-2 text-left ` +
        `${routeBorder(index)} hover:bg-surface-2 data-selected:bg-surface-2`
      }
      aria-label={name}
      onClick={onOpen}
      // Hovering is for desktops: a tap on a phone opens the route.
      onMouseEnter={desktop ? onPreview : undefined}
      onMouseLeave={onPreviewEnd}
      onFocus={onPreview}
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
              <span data-testid={`routes-row-${index}-gain`} className="flex items-center gap-1">
                <ArrowUpRight size={14} aria-hidden />
                {gain}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={14} aria-hidden />
              {duration}
            </span>
          </span>
          {route.misses.map((miss, k) => (
            <MissMarker key={miss.criterion} miss={miss} text={misses[k]} testId={`routes-row-${index}-miss`} />
          ))}
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

/** A criterion a suggestion misses, with its gap, such as "+30% elevation gain". */
function MissMarker({ miss, text, testId }: { miss: Miss; text: string; testId: string }) {
  return <Marker icon={MISS_ICONS[miss.criterion]} text={text} testId={`${testId}-${miss.criterion}`} />;
}

function Marker({ icon: Icon, text, testId }: { icon: LucideIcon; text: string; testId: string }) {
  return (
    <span data-testid={testId} className="flex items-center gap-1 text-sm font-semibold text-ink">
      <Icon size={14} aria-hidden className="text-miss" />
      {text}
    </span>
  );
}

function RouteDetail({
  display,
  routes,
  snapshot,
  selected,
  onSelect,
  onBack,
  onHover,
  condensed,
}: {
  display: Display;
  routes: Route[];
  snapshot?: MapSnapshot;
  selected: number;
  condensed: boolean;
  onSelect: (index: number) => void;
  onBack: () => void;
  onHover: (position: Position | undefined) => void;
}) {
  const t = words(display);
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
        <RouteFigures route={route} display={display} />
      </div>
      {route.misses.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {route.misses.map((miss) => (
            <MissMarker key={miss.criterion} miss={miss} text={missText(miss, route, display)} testId="route-miss" />
          ))}
        </div>
      )}
      {!condensed && (
        <>
          <ElevationProfile testId="route-profile" route={route} display={display} onHover={onHover} />
          <SurfaceShare route={route} display={display} />
          <button
            type="button"
            data-testid="route-export"
            className={PRIMARY_BUTTON}
            // Nothing awaited before the share sheet: it needs the tap that opened it.
            onClick={() => void saveGpx(gpxExport(route, new Date(), display))}
          >
            <Download size={18} aria-hidden />
            {t.exportGpx}
          </button>
        </>
      )}
    </div>
  );
}
