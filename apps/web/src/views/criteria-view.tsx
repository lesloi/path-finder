import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  LocateFixed,
  MapPinCheck,
  MapPinPlus,
  Navigation2,
  Scan,
  Settings,
} from 'lucide-react';
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import {
  areaContains,
  AVOIDED_AREA_RADIUS,
  MAX_AVOIDED_AREAS,
  MAX_WAYPOINTS,
  type AvoidedArea,
} from '../contract/index.ts';
import { useCoverage, useSettings } from '../state/index.ts';
import { CriteriaBar } from './criteria-bar.tsx';
import { CriteriaForm, criteriaChanged, criteriaRequest, useCriteriaDraft } from './criteria-form.tsx';
import { RouteDock } from './route-dock.tsx';
import { RouteErrorToast } from './route-error-toast.tsx';
import { AvoidedAreaList } from './avoided-area-list.tsx';
import { WaypointList } from './waypoint-list.tsx';
import { SearchingPanel } from './searching-panel.tsx';
import { useRouteBrowser } from './use-route-browser.ts';
import { RouteSetView } from './route-set-view.tsx';
import {
  criteriaSummary,
  DEFAULT_AVOIDED_RADIUS,
  maxRadiusAround,
  formatPosition,
  isCovered,
  parsePosition,
  routesAtPace,
  type Position,
  type RouteSetRequest,
  kmBetween,
  waypointPoiAt,
  waypointPoiKey,
  type WaypointPoi,
  type WaypointPois,
  shownPoiCategories,
} from '../core/index.ts';
import { commonText, criteriaText, routesText, type Language } from '../i18n/index.ts';
import {
  LazyStartPointMap,
  type MapHandle,
  type MapView,
  BottomSheet,
  FLOATING_BUTTON,
  ICON_BUTTON,
  LayersControl,
  LIST_FRAME,
  LIST_FRAME_FOLDED,
  PANEL,
  PANEL_FOLDED,
  PRIMARY_BUTTON,
  SIDE_FRAME,
  SIDE_FRAME_FOLDED,
  SubPage,
  tip,
  Toast,
  useToastTimeout,
  useDesktop,
} from '../components/index.ts';

// A route set can fold its sheet down to the handle, the sheet of the form cannot.
const SHEET_STOPS = ['folded', 'collapsed', 'expanded'] as const;

// The bottom-right buttons: the location or reframe one, the waypoint one, the layers, the north. On phones they stack up
// from the bottom, over the sheet; on desktops they line up from the right, above the dock when it is shown
// (`--edge-bottom`). `--slot` counts the buttons the one stands on or beside.
const STACKED =
  'right-safe-3 bottom-[calc(var(--sheet-height,0px)+--spacing(3)+var(--slot)*(var(--spacing-touch)+--spacing(2)))] ' +
  'desktop:right-[calc(env(safe-area-inset-right)+--spacing(3)+var(--slot)*(var(--spacing-touch)+--spacing(2)))] ' +
  'desktop:bottom-(--edge-bottom) transition-[bottom] duration-250 ease-[ease] motion-reduce:transition-none';
const slotStyle = (slot: number) => ({ '--slot': slot }) as CSSProperties;

// A folded desktop panel is gone from the map but for its tab, against the edge of the screen; an unfolded one carries
// the tab on its outer edge, in the middle. The panel is hidden, not unmounted: what is typed in the form stays.
const FOLD_TAB =
  'pointer-events-auto absolute top-1/2 grid h-12 w-6 -translate-y-1/2 place-items-center bg-surface text-ink shadow-float hover:bg-surface-2';

function FoldablePanel({
  testId,
  side,
  folded,
  label,
  ariaLabel,
  onToggle,
  children,
}: {
  testId: string;
  side: 'left' | 'right';
  folded: boolean;
  label: string;
  ariaLabel?: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const tab = useRef<HTMLButtonElement>(null);
  const left = side === 'left';
  const frame = left ? (folded ? SIDE_FRAME_FOLDED : SIDE_FRAME) : folded ? LIST_FRAME_FOLDED : LIST_FRAME;
  // The chevron points where the panel goes, or where it comes from.
  const Icon = left === folded ? ChevronRight : ChevronLeft;
  return (
    <div className={frame}>
      <aside
        id={id}
        ref={panel}
        className={folded ? `${PANEL} ${PANEL_FOLDED}` : PANEL}
        aria-label={ariaLabel}
        inert={folded}
      >
        {children}
      </aside>
      <button
        ref={tab}
        type="button"
        data-testid={testId}
        className={`${FOLD_TAB} ${left ? 'left-full rounded-r-md' : 'right-full rounded-l-md'}`}
        aria-expanded={!folded}
        aria-controls={id}
        {...tip(label, left ? 'bottom-start' : 'bottom-end')}
        onClick={() => {
          // The panel is about to be hidden: the focus would be lost with it.
          if (panel.current?.contains(document.activeElement)) tab.current?.focus();
          onToggle();
        }}
      >
        <Icon size={16} aria-hidden />
      </button>
    </div>
  );
}

// Sets a custom property of the page while `shown`.
function useRootProperty(name: string, value: string, shown: boolean) {
  useLayoutEffect(() => {
    if (!shown) return;
    const root = document.documentElement.style;
    root.setProperty(name, value);
    return () => void root.removeProperty(name);
  }, [name, value, shown]);
}

// A notice over the map: on desktops at the bottom, centred between the columns and above the dock; on phones
// under the bar at the top.
const MAP_NOTICE =
  'fixed z-4 w-max -translate-x-1/2 rounded-md bg-surface text-sm text-ink-2 shadow-float ' +
  'top-[calc(var(--top-reserved)+--spacing(2))] left-1/2 max-w-[calc(100vw-2*--spacing(4))] ' +
  'desktop:top-auto desktop:bottom-[calc(var(--edge-bottom)+--spacing(8))] desktop:left-(--map-centre) ' +
  'desktop:max-w-none';

// The notices over the top of the map, one under the other, under the bar on phones; on desktops in line with the settings button, clear of
// the buttons at the bottom right.
const TOP_NOTICES =
  'fixed z-4 flex w-max -translate-x-1/2 flex-col items-center gap-2 text-sm ' +
  'top-[calc(var(--top-reserved)+--spacing(2))] left-1/2 max-w-[calc(100vw-2*--spacing(4))] ' +
  'desktop:top-safe-3 desktop:left-(--map-centre) desktop:max-w-[calc(100vw-var(--column-inset)-2*var(--spacing-touch)-(--spacing(12)))]';

// The start point of a request that is not there yet, for the summary of the criteria alone.
const NO_START: Position = [0, 0];

/**
 * The first view: where the user sets the criteria of a route set, over a full-screen map. Asking
 * for routes replaces the criteria with the route set, its routes drawn on the map.
 */
// Two readings of a point of interest this close are the same point.
const SAME_POI_KM = 0.005;

export function CriteriaView({ language, pageOpen = false }: { language: Language; pageOpen?: boolean }) {
  const t = { ...commonText[language], ...criteriaText[language], ...routesText[language] };
  const desktop = useDesktop();
  // Kept here: the form is mounted in the column or in the sheet, whichever the screen shows.
  const draft = useCriteriaDraft();
  const [start, setStart] = useState<Position>();
  // Where the server can route; unknown until it says, or if it cannot: then the server's own refusal stands.
  const coverage = useCoverage();
  const uncoveredId = useId();
  const startUncovered = useMemo(() => Boolean(start && coverage && !isCovered(coverage, start)), [start, coverage]);
  // Where the map moves to: the device location, or typed coordinates.
  const [focus, setFocus] = useState<Position>();
  // What a tap on the map is for: the start point (`pick`, from the crosshair) or a waypoint (`place`); one at a time.
  const [mode, setMode] = useState<'pick' | 'place' | 'avoid'>();
  const picking = mode === 'pick';
  const placing = mode === 'place';
  const avoiding = mode === 'avoid';
  // The points the routes go through, in the order placed: kept here with the start point, not in the criteria kept.
  const [waypoints, setWaypoints] = useState<Position[]>([]);
  // The circles routes keep out of: kept here too, for this visit only, as the waypoints are.
  const [avoidedAreas, setAvoidedAreas] = useState<AvoidedArea[]>([]);
  // A tap on the veiled part of the map was refused: the banner says why for a while.
  const [refused, setRefused] = useState<'uncovered' | 'duplicate' | 'inside' | 'inArea'>();
  // The points of interest some waypoints were made from, by position; kept for the routes found, as for the criteria.
  const [waypointPois, setWaypointPois] = useState<WaypointPois>({});
  // On phones, the criteria are a layer over the map; the height of the sheet is what the routes are framed clear of.
  const [layerOpen, setLayerOpen] = useState(false);
  // The sheet says it, and describes its button by it, only while the form does not show its own message.
  const sheetUncovered = startUncovered && !layerOpen;
  const [sheetHeight, setSheetHeight] = useState(0);
  // On desktops, each panel folds down to its button, to free the map.
  const [formFolded, setFormFolded] = useState(false);
  const [listFolded, setListFolded] = useState(false);
  // What went wrong, and the start point then: setting a new one drops the toast.
  const [toast, setToast] = useState<{ problem: 'unavailable' | 'unreadable'; start?: Position }>();
  const settingsLink = useRef<HTMLAnchorElement>(null);
  const map = useRef<MapHandle>(null);
  const [mapView, setMapView] = useState<MapView>({ bearing: 0, rotated: false, movedAway: false });
  const pageWasOpen = useRef(pageOpen);
  const [{ basemap, pace, paceUnit, poiLayers }, update] = useSettings();
  const browser = useRouteBrowser();
  // Clearing leaves nothing on screen: a status says it, for those who cannot see the list go.
  const [cleared, setCleared] = useState(false);
  const { routeSet, loading } = browser;
  const atPace = useMemo(() => routeSet && routesAtPace(routeSet.request, routeSet.routes, pace), [routeSet, pace]);
  const summaries = useMemo(
    () => routeSet?.routes.map(({ distance, elevationGain }) => ({ distance, elevationGain })),
    [routeSet],
  );
  const routesShown = Boolean(routeSet);
  const listShown = desktop && (loading || Boolean(routeSet));
  // Nothing is selected until the user picks a route; a phone opens the first one's detail from its list.
  const selected = desktop ? browser.selected : (browser.selected ?? 0);
  const dockRoute = desktop ? atPace?.routes[selected ?? -1] : undefined;
  const dockShown = Boolean(dockRoute);
  const current = criteriaRequest(draft[0], { pace, start, waypoints, avoidedAreas });
  // Every search keeps the criteria it was made with, whichever button asked for it.
  const search = (request: RouteSetRequest) => {
    setCleared(false);
    // The routes would be found out of sight.
    setListFolded(false);
    setMode((current) => (current === 'place' || current === 'avoid' ? undefined : current));
    draft[2]();
    browser.ask(request);
  };
  const stale = Boolean(routeSet && current && criteriaChanged(current, routeSet.request));
  useRootProperty('--column-inset', '0px', desktop && formFolded);
  useRootProperty('--list-inset', listFolded ? '0px' : 'var(--list-reserved)', listShown);
  useRootProperty('--dock-inset', 'var(--dock-reserved)', dockShown);
  // The floating buttons and the map attribution sit above the sheet, whatever its height.
  useRootProperty('--sheet-height', `${sheetHeight}px`, !desktop && sheetHeight > 0);
  // The detail of a route takes more than half of a phone's screen: the buttons over the map leave it room.
  const detailOpen = !desktop && browser.detail;
  // Not on a desktop, where the form has its own button.
  const locateShown = !desktop && !routesShown && !loading && !detailOpen;
  // On phones, in the place of the location button, which the routes hide.
  const reframeShown = routesShown && mapView.movedAway && !detailOpen;

  // The button of a phone goes away with the route set, and with the search; a desktop has the list of the criteria.
  const waypointButtonShown = Boolean(start) && !routesShown && !loading && !desktop;

  // The place of each button in the stack: the location (or reframe) button keeps the corner, within reach of the
  // thumb, then the waypoint one, then the layers, then the north.
  const stack = [locateShown || reframeShown, waypointButtonShown, true, mapView.rotated];
  const slotOf = (button: number) => stack.slice(0, button).filter(Boolean).length;

  // A button that puts the map back goes away once it has: the focus goes on from the settings.
  function putBack(action: 'resetNorth' | 'reframe') {
    map.current?.[action]();
    settingsLink.current?.focus();
  }

  // Keyboard users go on from the button that opened the page.
  useEffect(() => {
    if (pageWasOpen.current && !pageOpen) settingsLink.current?.focus();
    pageWasOpen.current = pageOpen;
  }, [pageOpen]);

  useToastTimeout(toast, () => setToast(undefined));
  useToastTimeout(refused, () => setRefused(undefined));

  // Escape steps back on a desktop: first out of placing waypoints, then out of picking the start point on the map, then out of the route selected.
  const deselect = () => {
    browser.select(undefined);
    browser.setPreview(undefined);
    browser.setHover(undefined);
  };
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (mode) setMode(undefined);
    else if (dockShown) deselect();
  });
  useEffect(() => {
    if (!desktop || pageOpen) return;
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [desktop, pageOpen]);

  // The routes found are not dropped when the waypoints change: they are told stale, as for any other criterion, but
  // the route selected goes, as its dock numbers the waypoints it was found with.
  function toggleMode(next: 'place' | 'avoid') {
    if (mode === next) return setMode(undefined);
    deselect();
    setRefused(undefined);
    setMode(next);
  }
  const togglePlacing = () => toggleMode('place');
  const toggleAvoiding = () => toggleMode('avoid');

  // The points no area may hold or touch.
  const points = [...(start ? [start] : []), ...waypoints];

  function addAvoidedArea(center: Position) {
    if (avoidedAreas.length >= MAX_AVOIDED_AREAS) return;
    // A new area shrinks to stay clear of the start point and the waypoints, which the server refuses to find inside
    // one; it is refused only when there is no room left for the smallest.
    const radius = Math.min(DEFAULT_AVOIDED_RADIUS, maxRadiusAround(center, points));
    if (radius < AVOIDED_AREA_RADIUS.min) return setRefused('inside');
    setRefused(undefined);
    deselect();
    setAvoidedAreas([...avoidedAreas, { center, radius }]);
    if (avoidedAreas.length + 1 >= MAX_AVOIDED_AREAS) setMode(undefined);
  }

  function resizeAvoidedArea(index: number, radius: number) {
    deselect();
    // An area grows up to the nearest point, not over it.
    setAvoidedAreas(
      avoidedAreas.map((area, i) =>
        i === index ? { ...area, radius: Math.min(radius, maxRadiusAround(area.center, points)) } : area,
      ),
    );
  }

  function removeAvoidedArea(index: number) {
    deselect();
    setAvoidedAreas(avoidedAreas.filter((_, i) => i !== index));
  }

  function addWaypoint(position: Position, poi?: WaypointPoi) {
    if (waypoints.length >= MAX_WAYPOINTS) return;
    if (avoidedAreas.some((area) => areaContains(area, position))) return setRefused('inArea');
    // The map reads a point's position to within metres, as the zoom changes: a point of interest tapped twice is
    // the same one when the two readings are this close.
    if (
      poi &&
      waypoints.some((waypoint) => waypointPoiAt(waypointPois, waypoint) && kmBetween(waypoint, position) < SAME_POI_KM)
    ) {
      return setRefused('duplicate');
    }
    setRefused(undefined);
    if (poi) setWaypointPois({ ...waypointPois, [waypointPoiKey(position)]: poi });
    setWaypoints([...waypoints, position]);
    // The last one ends placing on its own.
    if (waypoints.length + 1 >= MAX_WAYPOINTS) setMode(undefined);
  }

  function removeWaypoint(index: number) {
    deselect();
    // The row under the pointer is gone, and with it the event that would clear the pin set apart.
    map.current?.highlightWaypoint(undefined);
    // Its point of interest stays in `waypointPois`: the routes found keep drawing and naming it, and a lookup is by exact position.
    setWaypoints(waypoints.filter((_, i) => i !== index));
  }

  function moveWaypoint(from: number, to: number) {
    deselect();
    const moved = [...waypoints];
    moved.splice(to, 0, moved.splice(from, 1)[0]!);
    setWaypoints(moved);
  }

  function changeStart(position: Position) {
    // Routes from another start point would be stale.
    if (start && (start[0] !== position[0] || start[1] !== position[1])) browser.drop();
    setStart(position);
    setMode((current) => (current === 'pick' ? undefined : current));
  }

  // The device location and typed coordinates move the map there; a pick on the map does not.
  function moveStart(position: Position) {
    setFocus(position);
    changeStart(position);
  }

  function warn(problem: 'unavailable' | 'unreadable') {
    setToast({ problem, start });
  }

  // Geolocation is asked for only here, when the user taps a "My location" button.
  function locate() {
    setToast(undefined);
    if (!navigator.geolocation) return warn('unavailable');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => moveStart([coords.longitude, coords.latitude]),
      () => warn('unavailable'),
      // Without a timeout, a position that never comes would never show the toast.
      { timeout: 10_000 },
    );
  }

  const refusals = {
    uncovered: t.waypointUncovered,
    duplicate: t.waypointDuplicate,
    inside: t.avoidedAreaOnPoint,
    inArea: t.waypointInAvoidedArea,
  };

  const routeSetView =
    atPace && routeSet && routesShown ? (
      <RouteSetView
        language={language}
        paceUnit={paceUnit}
        routes={atPace.routes}
        pace={atPace.pace}
        snapshot={browser.snapshot}
        selected={selected}
        detail={browser.detail}
        onSelect={browser.select}
        onPreview={browser.setPreview}
        onDetailChange={browser.openDetail}
        // By duration, a new pace is another search, which the criteria ask for: the list only says the pace.
        onPaceChange={'distance' in routeSet.request.target ? (value) => update({ pace: value }) : undefined}
        onClear={() => {
          browser.drop();
          setCleared(true);
          // The button is gone: the focus goes on from the settings, as after a button that puts the map back.
          settingsLink.current?.focus();
        }}
        onHover={browser.setHover}
        waypoints={routeSet.request.waypoints}
        waypointPois={waypointPois}
      />
    ) : undefined;
  const panel = routeSetView ?? (loading && <SearchingPanel language={language} />);
  const staleNotice = stale && (
    <div role="status" data-testid="routes-stale" className="rounded-md bg-accent-soft p-3 text-sm">
      <strong>{t.stale}.</strong> {t.staleHint}
    </div>
  );
  const cancelButton = loading && (
    <button
      type="button"
      data-testid="routes-cancel"
      className="min-h-touch rounded-full text-accent"
      onClick={browser.drop}
    >
      {t.cancelSearch}
    </button>
  );
  // A phone has the button over the map, and no pointer to highlight a pin with.
  const waypointTools = desktop && {
    add: { placing, full: waypoints.length >= MAX_WAYPOINTS, onToggle: togglePlacing },
    onCenter: (index: number) => map.current?.centerOn(waypoints[index]!),
    onPoint: (index: number | undefined) => map.current?.highlightWaypoint(index),
  };
  const criteriaFields = (
    <CriteriaFields
      start={start}
      startUncovered={startUncovered}
      language={language}
      picking={picking}
      waypoints={waypoints}
      avoidedAreas={avoidedAreas}
      draft={draft}
      searched={routesShown}
      waypointList={
        start && (desktop || waypoints.length > 0) ? (
          <WaypointList
            language={language}
            waypoints={waypoints}
            waypointPois={waypointPois}
            onMove={moveWaypoint}
            onRemove={removeWaypoint}
            {...waypointTools}
          />
        ) : undefined
      }
      avoidedList={
        // Placing areas needs a pointer and room: a phone has neither the button nor the list yet.
        desktop && start ? (
          <AvoidedAreaList
            language={language}
            areas={avoidedAreas}
            placing={avoiding}
            full={avoidedAreas.length >= MAX_AVOIDED_AREAS}
            onToggle={toggleAvoiding}
            onResize={resizeAvoidedArea}
            onRemove={removeAvoidedArea}
            onCenter={(index) => map.current?.centerOn(avoidedAreas[index]!.center)}
            onPoint={(index) => map.current?.highlightArea(index)}
          />
        ) : undefined
      }
      onStartChange={moveStart}
      onUnreadable={() => warn('unreadable')}
      onPick={() => {
        setMode(picking ? undefined : 'pick');
        setLayerOpen(false);
      }}
      onLocate={locate}
      onSubmit={(request) => {
        setLayerOpen(false);
        search(request);
      }}
    />
  );

  return (
    <>
      {/* Always there, and empty while the search goes on, which has its own status: a region that comes with its
          text is not announced. Its text changes when the routes arrive, even for a count that did not. */}
      <p role="status" className="sr-only" data-testid="routes-announcement">
        {routeSet && !loading ? t.routeCount(routeSet.routes.length) : cleared ? t.routesCleared : ''}
      </p>
      <LazyStartPointMap
        ref={map}
        onViewChange={setMapView}
        basemap={basemap}
        start={start}
        focus={focus}
        // The start point field also arms a click, or a tap.
        pickOnClick={picking}
        routes={browser.geometries}
        summaries={summaries}
        coverage={coverage}
        language={language}
        poiCategories={shownPoiCategories(poiLayers)}
        poiSeasonal={poiLayers.seasonal}
        // A desktop highlights the route it points at in the list, and marks the one selected.
        selectedRoute={desktop ? (browser.preview ?? selected) : selected}
        {...(desktop && { markedRoute: selected })}
        // A desktop never reframes on a selection: the map stays where it is as the dock opens and closes.
        // A phone's carousel moves the map to the route in the middle; its detail draws that route alone.
        framing={desktop ? 'all' : browser.detail ? 'selected' : 'follow'}
        sheetHeight={desktop ? 0 : sheetHeight}
        {...((desktop ? selected !== undefined : browser.detail) && browser.hover && { hover: browser.hover })}
        routesInteractive={routesShown}
        onRouteSelect={browser.select}
        {...(desktop && { onBackgroundClick: deselect })}
        onSnapshot={browser.setSnapshot}
        onStartChange={changeStart}
        waypoints={waypoints}
        avoidedAreas={avoidedAreas}
        avoiding={avoiding}
        onAvoidedAreaAdd={addAvoidedArea}
        placing={placing}
        onWaypointAdd={addWaypoint}
        onWaypointRefused={() => setRefused('uncovered')}
        onWaypointRemove={removeWaypoint}
        onAvoidedAreaRemove={removeAvoidedArea}
        onBasemapFail={(previous) => update({ basemap: previous })}
      />
      <a
        ref={settingsLink}
        data-testid="criteria-settings"
        className={`${FLOATING_BUTTON} fixed top-safe-3 right-safe-3 z-5`}
        href="#/settings"
        {...tip(t.settings, 'bottom-end')}
        // Back from the settings, a crosshair armed before them would come as a surprise.
        onClick={() => {
          setMode(undefined);
        }}
      >
        <Settings size={20} aria-hidden />
      </a>
      {!detailOpen && (
        <>
          <LayersControl
            language={language}
            layers={poiLayers}
            onChange={(layers) => update({ poiLayers: layers })}
            className={`fixed z-5 ${STACKED}`}
            style={slotStyle(slotOf(2))}
          />
          {waypointButtonShown && (
            <button
              type="button"
              data-testid="criteria-waypoint"
              className={`${FLOATING_BUTTON} fixed z-5 aria-pressed:bg-accent! aria-pressed:text-on-accent! disabled:text-ink-2 ${STACKED}`}
              style={slotStyle(slotOf(1))}
              {...tip(t.addWaypoint, 'stack')}
              aria-pressed={placing}
              disabled={!placing && waypoints.length >= MAX_WAYPOINTS}
              onClick={togglePlacing}
            >
              {placing ? <MapPinCheck size={20} aria-hidden /> : <MapPinPlus size={20} aria-hidden />}
            </button>
          )}
          {mapView.rotated && (
            <button
              type="button"
              data-testid="criteria-north"
              className={`${FLOATING_BUTTON} fixed z-5 ${STACKED}`}
              style={slotStyle(slotOf(3))}
              {...tip(t.resetNorth, 'stack')}
              onClick={() => putBack('resetNorth')}
            >
              {/* The arrow turns against the map, so it keeps pointing north. */}
              <Navigation2 size={20} aria-hidden style={{ transform: `rotate(${-mapView.bearing}deg)` }} />
            </button>
          )}
        </>
      )}
      {/* Above the sheet on phones, whatever its height; an expanded sheet leaves it no room. */}
      {locateShown && (
        <button
          type="button"
          data-testid="criteria-locate"
          className={`${FLOATING_BUTTON} fixed z-5 ${STACKED}`}
          style={slotStyle(0)}
          {...tip(t.myLocation, 'stack')}
          onClick={locate}
        >
          <LocateFixed size={20} aria-hidden />
        </button>
      )}
      {reframeShown && (
        <button
          type="button"
          data-testid="criteria-reframe"
          className={`${FLOATING_BUTTON} fixed z-5 ${STACKED}`}
          style={slotStyle(0)}
          {...tip(t.reframe, 'stack')}
          onClick={() => putBack('reframe')}
        >
          <Scan size={20} aria-hidden />
        </button>
      )}
      {desktop ? (
        <>
          <FoldablePanel
            testId="criteria-fold"
            side="left"
            folded={formFolded}
            label={formFolded ? t.showSearch : t.hideSearch}
            onToggle={() => setFormFolded(!formFolded)}
          >
            <div data-testid="criteria-title" className="flex items-center gap-2 px-4 pt-4 text-lg font-bold">
              <img className="rounded-sm" src="/favicon.svg" alt="" width="32" height="32" />
              Path finder
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">{criteriaFields}</div>
          </FoldablePanel>
          {listShown && (
            <FoldablePanel
              testId="routes-fold"
              side="right"
              folded={listFolded}
              label={listFolded ? t.showRoutes : t.hideRoutes}
              ariaLabel={t.routes}
              onToggle={() => setListFolded(!listFolded)}
            >
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
                {staleNotice}
                {panel}
                {cancelButton}
              </div>
            </FoldablePanel>
          )}
        </>
      ) : (
        <>
          <CriteriaBar
            language={language}
            summary={criteriaSummary(
              criteriaRequest(draft[0], { pace, start: start ?? NO_START, waypoints, avoidedAreas })!,
              language,
            )}
            start={start && formatPosition(start, language)}
            onClick={() => setLayerOpen(true)}
          />
          <BottomSheet
            testId="criteria-sheet"
            label={t.routes}
            state={browser.sheet}
            {...(routeSetView && {
              onStateChange: browser.changeSheet,
              stops: SHEET_STOPS,
              foldedLabel: t.routesFolded,
            })}
            onHeightChange={setSheetHeight}
          >
            {!browser.detail && staleNotice}
            {panel || (
              <>
                {/* Always mounted, so that a change of its text is announced. Not while the layer is open: the form shows its own message, and both would be announced. */}
                <p
                  id={uncoveredId}
                  role="status"
                  data-testid="criteria-sheet-uncovered"
                  className="text-center text-sm text-ink empty:hidden"
                >
                  {sheetUncovered ? t.uncoveredStart : ''}
                </p>
                {!start && (
                  <p data-testid="criteria-long-press" className="text-center text-sm text-ink-2">
                    {t.longPress}
                  </p>
                )}
                <button
                  type="button"
                  data-testid="criteria-open"
                  className={PRIMARY_BUTTON}
                  // Nothing to set from a start point the server cannot route from: the notice above says why.
                  disabled={startUncovered}
                  {...(sheetUncovered && { 'aria-describedby': uncoveredId })}
                  onClick={() => setLayerOpen(true)}
                >
                  {t.setCriteria}
                </button>
              </>
            )}
            {cancelButton}
          </BottomSheet>
          {layerOpen && (
            <SubPage title={t.search} back="#/" language={language} navigate={() => setLayerOpen(false)}>
              <div className="flex flex-col gap-3">{criteriaFields}</div>
            </SubPage>
          )}
        </>
      )}
      {dockRoute && atPace && selected !== undefined && (
        <RouteDock
          language={language}
          paceUnit={paceUnit}
          pace={atPace.pace}
          route={dockRoute}
          index={selected}
          count={atPace.routes.length}
          onClose={deselect}
          onHover={browser.setHover}
          waypoints={routeSet?.request.waypoints}
          waypointPois={waypointPois}
        />
      )}
      {picking && (
        <div data-testid="criteria-pick-bar" className={`${MAP_NOTICE} flex items-center gap-3 py-1 pr-1 pl-4`}>
          {desktop ? t.pickStart : t.pickStartTouch}
          <button
            type="button"
            data-testid="criteria-pick-cancel"
            className="min-h-touch rounded-full px-3 font-semibold text-accent"
            onClick={() => setMode(undefined)}
          >
            {t.cancelPick}
          </button>
        </div>
      )}
      {/* Always there, so that what a refused tap says is announced: a region that comes with its text is not. */}
      <div className={TOP_NOTICES}>
        {placing && (
          <div
            data-testid="criteria-waypoint-bar"
            className="flex items-center gap-3 rounded-md bg-surface py-1 pr-1 pl-4 text-ink-2 shadow-float"
          >
            {desktop ? t.placeWaypoint : t.placeWaypointTouch}
            <button
              type="button"
              data-testid="criteria-waypoint-done"
              className="min-h-touch rounded-full px-3 font-semibold text-accent"
              onClick={() => setMode(undefined)}
            >
              {t.waypointsDone}
            </button>
          </div>
        )}
        {avoiding && (
          <div
            data-testid="criteria-avoided-bar"
            className="flex items-center gap-3 rounded-md bg-surface py-1 pr-1 pl-4 text-ink-2 shadow-float"
          >
            {desktop ? t.placeAvoidedArea : t.placeAvoidedAreaTouch}
            <button
              type="button"
              data-testid="criteria-avoided-done"
              className="min-h-touch rounded-full px-3 font-semibold text-accent"
              onClick={() => setMode(undefined)}
            >
              {t.waypointsDone}
            </button>
          </div>
        )}
        {/* Under the banner, which keeps asking for a point. */}
        <p
          role="status"
          data-testid="criteria-waypoint-refused"
          className="m-0 rounded-md bg-surface px-4 py-2 text-ink shadow-float empty:hidden"
        >
          {mode && refused ? refusals[refused] : ''}
        </p>
      </div>
      {browser.refusal && (
        <RouteErrorToast language={language} refusal={browser.refusal} onDismiss={browser.dismissError} />
      )}
      {toast && toast.start === start && (
        <Toast testId="criteria-toast" onDismiss={() => setToast(undefined)}>
          {toast.problem === 'unavailable' ? t.unavailable : t.unreadable}
          <br />
          {toast.problem === 'unreadable' ? t.coordinatesHint : desktop ? t.pickHintDesktop : t.pickHint}
        </Toast>
      )}
    </>
  );
}

// The start point and the criteria, in the left column of a desktop or in the layer of a phone.
function CriteriaFields({
  start,
  startUncovered,
  language,
  picking,
  waypoints,
  avoidedAreas,
  draft,
  searched,
  waypointList,
  avoidedList,
  onStartChange,
  onUnreadable,
  onPick,
  onLocate,
  onSubmit,
}: {
  start?: Position | undefined;
  startUncovered: boolean;
  language: Language;
  picking: boolean;
  waypoints: Position[];
  avoidedAreas: AvoidedArea[];
  draft: ReturnType<typeof useCriteriaDraft>;
  searched: boolean;
  waypointList: ReactNode;
  avoidedList: ReactNode;
  onStartChange: (start: Position) => void;
  onUnreadable: () => void;
  onPick: () => void;
  onLocate: () => void;
  onSubmit: (request: RouteSetRequest) => void;
}) {
  const t = criteriaText[language];
  return (
    <>
      <StartPointField
        start={start}
        language={language}
        picking={picking}
        onStartChange={onStartChange}
        onUnreadable={onUnreadable}
      >
        <button
          type="button"
          data-testid="criteria-start-pick"
          className={`${ICON_BUTTON} aria-pressed:text-accent`}
          {...tip(t.chooseOnMap, 'bottom-end')}
          aria-pressed={picking}
          onClick={onPick}
        >
          <Crosshair size={20} aria-hidden />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          data-testid="criteria-start-locate"
          {...tip(t.myLocation, 'bottom-end')}
          onClick={onLocate}
        >
          <LocateFixed size={20} aria-hidden />
        </button>
      </StartPointField>
      <CriteriaForm
        language={language}
        start={start}
        startUncovered={startUncovered}
        waypoints={waypoints}
        avoidedAreas={avoidedAreas}
        draft={draft}
        searched={searched}
        waypointList={waypointList}
        avoidedList={avoidedList}
        onSubmit={onSubmit}
      />
    </>
  );
}

// The start point as coordinates, to copy, or to type or paste to set it. Only coordinates:
// naming the place would send it to a geocoding service.
function StartPointField({
  start,
  language,
  picking = false,
  onStartChange,
  onUnreadable,
  children,
}: {
  start?: Position;
  language: Language;
  picking?: boolean;
  onStartChange: (start: Position) => void;
  /** Coordinates that cannot be read were typed: the view says so in a toast. */
  onUnreadable: () => void;
  /** Buttons at the end of the field. */
  children?: ReactNode;
}) {
  const t = criteriaText[language];
  const shown = start ? formatPosition(start, language) : '';
  const [draft, setDraft] = useState(shown);
  const [unreadable, setUnreadable] = useState(false);
  const [shownBefore, setShownBefore] = useState(shown);
  // A new start point, from the map or the location, replaces what is typed.
  if (shown !== shownBefore) {
    setShownBefore(shown);
    setDraft(shown);
    setUnreadable(false);
  }
  const inputId = useId();
  const noteId = useId();

  function reset() {
    setDraft(shown);
    setUnreadable(false);
  }

  function commit() {
    // Enter then a blur would say it twice.
    if (unreadable) return;
    if (draft.trim() === '' || draft === shown) return reset();
    const position = parsePosition(draft);
    if (!position) {
      setUnreadable(true);
      return onUnreadable();
    }
    // Written back the usual way, even when it is the start point already.
    setDraft(formatPosition(position, language));
    onStartChange(position);
  }

  return (
    <div>
      <div
        className={
          'flex items-center gap-1 rounded-md bg-surface-2 pr-1 focus-within:ring-2 focus-within:ring-accent ' +
          `focus-within:ring-inset ${picking ? 'ring-2 ring-accent ring-inset' : ''}`
        }
      >
        <span className="ml-3 size-4 flex-none rounded-full border-4 border-start bg-white" />
        <div className="flex min-h-14 min-w-0 flex-1 flex-col justify-center px-3 py-2">
          <label className="text-sm text-ink-2" htmlFor={inputId}>
            {t.startPoint}
          </label>
          <input
            id={inputId}
            data-testid="criteria-start"
            className="w-full bg-transparent outline-none placeholder:text-ink-2"
            value={draft}
            placeholder={t.coordinates}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={unreadable}
            {...(picking && { 'aria-describedby': noteId })}
            onChange={(event) => {
              setDraft(event.target.value);
              setUnreadable(false);
            }}
            // Selected at once, to copy or to replace.
            onFocus={(event) => event.target.select()}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') reset();
            }}
          />
        </div>
        {children}
      </div>
      {picking && (
        <p id={noteId} data-testid="criteria-pick-note" className="mt-1 px-3 text-sm text-ink-2">
          {t.clickMap}
        </p>
      )}
    </div>
  );
}
