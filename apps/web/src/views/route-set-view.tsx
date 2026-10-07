import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Ruler,
  SlidersHorizontal,
  Timer,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

import type { Miss } from '../contract/index.ts';
import {
  ElevationProfile,
  ICON_BUTTON,
  PaceSlider,
  PRIMARY_BUTTON,
  ProfileSparkline,
  routeBorder,
  RouteThumbnail,
  SURFACE_CLASSES,
  useDesktop,
} from '../components/index.ts';
import {
  criteriaSummary,
  formatDistance,
  formatDuration,
  formatHeight,
  formatPace,
  gpxExport,
  paceUnit,
  missText,
  saveGpx,
  type Position,
  type MapSnapshot,
  type Route,
  type RouteSetRequest,
  type Display,
} from '../core/index.ts';
import { criteriaText, routesText } from '../i18n/index.ts';

// A horizontal move of the pointer longer than this, in px, and longer than its vertical move, swipes.
const SWIPE_PX = 50;

const MISS_ICONS = { distance: Ruler, duration: Timer, elevationGain: TrendingUp } satisfies Record<
  Miss['criterion'],
  LucideIcon
>;

// The words of the route set: its own, and the labels it shares with the criteria.
const words = ({ language }: Display) => ({ ...criteriaText[language], ...routesText[language] });

/**
 * The route set the user asked for: first a list of its routes, then the detail of one, which
 * swipes (or the arrow buttons on desktops) to the next. `onSelect` hears the route shown in the
 * list or the detail, `onHover` a place the user points at on the elevation profile. The durations of the
 * routes are at `pace`; `onPaceChange`, when given, lets the user change it in the list.
 */
export function RouteSetView({
  display,
  request,
  routes,
  pace,
  snapshot,
  selected,
  detail,
  onSelect,
  onDetailChange,
  onPaceChange,
  onBack,
  onHover,
  condensed = false,
}: {
  display: Display;
  /** The criteria the routes were generated for. */
  request: RouteSetRequest;
  routes: Route[];
  /** Minutes per km, which the durations of the routes are estimated at. */
  pace: number;
  /** What the map showed for these routes, to draw their thumbnails over. */
  snapshot?: MapSnapshot;
  selected: number;
  /** Whether the detail of the selected route is shown rather than the list. */
  detail: boolean;
  onSelect: (index: number) => void;
  onDetailChange: (detail: boolean) => void;
  /** Absent when the pace cannot change the routes' durations alone, such as by duration. */
  onPaceChange?: (pace: number) => void;
  /** Back to the criteria. */
  onBack: () => void;
  onHover: (position: Position | undefined) => void;
  /** On a phone with its sheet collapsed, the detail stops at the figures: the rest is for the expanded sheet. */
  condensed?: boolean;
}) {
  const desktop = useDesktop();

  if (detail) {
    return (
      <RouteDetail
        display={display}
        routes={routes}
        snapshot={snapshot}
        selected={selected}
        desktop={desktop}
        onSelect={onSelect}
        onBack={() => onDetailChange(false)}
        onHover={onHover}
        condensed={condensed}
      />
    );
  }

  const t = words(display);
  const summary = criteriaSummary(request, display);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="routes-back"
          className="flex min-h-touch items-center gap-1 rounded-full pr-3 text-accent"
          onClick={onBack}
        >
          <ArrowLeft size={18} aria-hidden />
          {t.criteria}
        </button>
        <strong data-testid="routes-count">{t.routeCount(routes.length)}</strong>
      </div>
      {desktop && (
        <div data-testid="routes-summary" className="flex items-center gap-1 rounded-md bg-surface-2 pr-3 text-sm">
          {/* What the routes were asked for, with a way to change it. */}
          <button
            type="button"
            data-testid="routes-change"
            className={ICON_BUTTON}
            aria-label={t.changeCriteria(summary)}
            onClick={onBack}
          >
            <SlidersHorizontal size={16} aria-hidden />
          </button>
          <span className="min-w-0 flex-1 truncate">{summary}</span>
        </div>
      )}
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
                onDetailChange(true);
              }}
              onPreview={() => onSelect(index)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

// The pace the durations are estimated at, and a way to change it.
function RoutePace({ display, pace, onChange }: { display: Display; pace: number; onChange?: (pace: number) => void }) {
  const t = words(display);
  const [editing, setEditing] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  // The slider opens where the user asked to edit, and closes when it loses the focus.
  useEffect(() => {
    if (editing) editor.current?.querySelector('input')?.focus();
  }, [editing]);
  if (editing && onChange) {
    return (
      <div ref={editor}>
        <PaceSlider
          label={t.pace}
          pace={pace}
          units={display.units}
          testId="routes-pace-input"
          onChange={onChange}
          onDone={() => setEditing(false)}
        />
      </div>
    );
  }
  return (
    <p data-testid="routes-pace" className="m-0 text-sm text-ink-2">
      {t.estimatedAt(`${formatPace(pace, display.units)} ${paceUnit(display.units)}`)}
      {onChange && (
        <>
          {' '}
          ·{' '}
          <button
            type="button"
            data-testid="routes-pace-edit"
            className="min-h-touch text-accent underline"
            onClick={() => setEditing(true)}
          >
            {t.editPace}
          </button>
        </>
      )}
    </p>
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
}) {
  const t = words(display);
  const distance = formatDistance(route.distance, display);
  const duration = formatDuration(route.estimatedDuration, display.language);
  const gain = route.elevationGain === undefined ? undefined : formatHeight(route.elevationGain, display);
  const misses = route.misses.map((miss) => missText(miss, route, display));
  const name = [
    t.route(index + 1, count),
    distance,
    ...(gain ? [`${t.elevationGain} ${gain}`] : []),
    `${t.estimatedDuration} ${duration}`,
    ...misses,
  ].join(', ');
  return (
    <button
      type="button"
      data-testid={`routes-row-${index}`}
      data-selected={selected ? '' : undefined}
      className={
        `flex min-h-13 w-full items-center gap-3 rounded-md border border-l-4 border-border p-2 text-left ` +
        `${routeBorder(index)} hover:bg-surface-2 data-selected:bg-surface-2`
      }
      aria-label={name}
      onClick={onOpen}
      // Hovering is for desktops: a tap on a phone opens the route.
      onMouseEnter={desktop ? onPreview : undefined}
      onFocus={onPreview}
    >
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
      </span>
      {/* The empty width of the row: where the route climbs, at a glance. */}
      <ProfileSparkline testId={`routes-row-${index}-profile`} geometry={route.geometry} index={index} />
      <ChevronRight size={18} aria-hidden className="ml-auto flex-none text-ink-2" />
    </button>
  );
}

/** A criterion a suggestion misses, with its gap, such as "+30% elevation gain". */
function MissMarker({ miss, text, testId }: { miss: Miss; text: string; testId: string }) {
  const Icon = MISS_ICONS[miss.criterion];
  return (
    <span
      data-testid={`${testId}-${miss.criterion}`}
      className="flex items-center gap-1 text-sm font-semibold text-ink"
    >
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
  desktop,
  onSelect,
  onBack,
  onHover,
  condensed,
}: {
  display: Display;
  routes: Route[];
  snapshot?: MapSnapshot;
  selected: number;
  desktop: boolean;
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
  const percent = new Intl.NumberFormat(display.language, { style: 'percent' });
  const unpaved = route.unpavedShare;

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

  const figures = (
    <dl className="m-0 grid flex-1 grid-cols-2 gap-x-4 gap-y-2" data-testid="route-figures">
      <Figure label={t.distance} testId="route-distance">
        {formatDistance(route.distance, display)}
      </Figure>
      <Figure label={t.estimatedDuration} testId="route-duration">
        {formatDuration(route.estimatedDuration, display.language)}
      </Figure>
      {route.elevationGain !== undefined && (
        <Figure label={t.climb} testId="route-climb" icon={<ArrowUpRight size={16} aria-hidden />}>
          {formatHeight(route.elevationGain, display)}
        </Figure>
      )}
      {route.elevationLoss !== undefined && (
        <Figure label={t.descent} testId="route-descent" icon={<ArrowDownRight size={16} aria-hidden />}>
          {formatHeight(route.elevationLoss, display)}
        </Figure>
      )}
    </dl>
  );

  return (
    <div
      data-testid="route-detail"
      // Vertical moves stay the panel's own, to scroll it.
      className="flex touch-pan-y flex-col gap-3"
      // A finger swipes; on desktops, the arrow buttons move between routes.
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
        <div className="flex items-center">
          {desktop && hasPrevious && (
            <button
              type="button"
              data-testid="route-previous"
              className={ICON_BUTTON}
              aria-label={t.previous}
              onClick={() => onSelect(selected - 1)}
            >
              <ChevronLeft size={20} aria-hidden />
            </button>
          )}
          <strong data-testid="route-position" aria-label={t.route(selected + 1, routes.length)}>
            {selected + 1}/{routes.length}
          </strong>
          {desktop && hasNext && (
            <button
              type="button"
              data-testid="route-next"
              className={ICON_BUTTON}
              aria-label={t.next}
              onClick={() => onSelect(selected + 1)}
            >
              <ChevronRight size={20} aria-hidden />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {!desktop && (
          <RouteThumbnail
            testId="route-thumbnail"
            geometry={route.geometry}
            index={selected}
            {...(snapshot && { snapshot })}
          />
        )}
        {figures}
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
          {/* The legend of the colours of the profile. */}
          <p data-testid="route-surface" className="m-0 flex items-center gap-1 text-sm text-ink-2">
            <i className={`size-2 rounded-full ${SURFACE_CLASSES.paved.dot}`} aria-hidden />
            {t.paved} {percent.format(1 - unpaved)}
            <span className="whitespace-pre"> · </span>
            <i className={`size-2 rounded-full ${SURFACE_CLASSES.unpaved.dot}`} aria-hidden />
            {t.unpaved} {percent.format(unpaved)}
          </p>
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

function Figure({
  label,
  icon,
  testId,
  children,
}: {
  label: string;
  icon?: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd data-testid={testId} className="m-0 flex items-center gap-1 text-lg font-bold">
        {icon}
        {children}
      </dd>
    </div>
  );
}
