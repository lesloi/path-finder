import { Crosshair, LocateFixed, Navigation2, Scan, Settings } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useCoverage, useSettings, useUnits } from '../state/index.ts';
import { CriteriaBar } from './criteria-bar.tsx';
import { CriteriaForm, criteriaChanged, criteriaRequest, invalidField, useCriteriaDraft } from './criteria-form.tsx';
import { RouteDock } from './route-dock.tsx';
import { RouteErrorToast } from './route-error-toast.tsx';
import { SearchingPanel } from './searching-panel.tsx';
import { useRouteBrowser } from './use-route-browser.ts';
import { RouteSetView } from './route-set-view.tsx';
import {
  BASEMAPS,
  criteriaSummary,
  formatPosition,
  isCovered,
  parsePosition,
  routesAtPace,
  type Position,
  type RouteSetRequest,
} from '../core/index.ts';
import { commonText, criteriaText, routesText, type Language } from '../i18n/index.ts';
import {
  StartPointMap,
  type MapHandle,
  type MapView,
  BasemapPicker,
  BottomSheet,
  FLOATING_BUTTON,
  ICON_BUTTON,
  LIST_COLUMN,
  PRIMARY_BUTTON,
  SIDE_COLUMN,
  SubPage,
  Toast,
  useToastTimeout,
  useDesktop,
} from '../components/index.ts';

// The bottom-right buttons: the location or reframe one, the basemap, the north. On phones they stack up from the
// bottom, over the sheet; on desktops they line up from the right, above the dock when it is shown (`--edge-bottom`).
// Each class is written whole for Tailwind; `below` counts the buttons the one stands on or beside.
const STACKED_ABOVE = [
  'bottom-[calc(var(--sheet-height,0px)+--spacing(3))]',
  'bottom-[calc(var(--sheet-height,0px)+--spacing(3)+var(--spacing-touch)+--spacing(2))] ' +
    'desktop:right-[calc(env(safe-area-inset-right)+--spacing(3)+var(--spacing-touch)+--spacing(2))]',
  'bottom-[calc(var(--sheet-height,0px)+--spacing(3)+var(--spacing-touch)+--spacing(2)+var(--spacing-touch)+--spacing(2))] ' +
    'desktop:right-[calc(env(safe-area-inset-right)+--spacing(3)+var(--spacing-touch)+--spacing(2)+var(--spacing-touch)+--spacing(2))]',
];
const stackedAbove = (below: 0 | 1 | 2) =>
  `right-safe-3 transition-[bottom] duration-250 ease-[ease] motion-reduce:transition-none desktop:bottom-(--edge-bottom) ${STACKED_ABOVE[below]}`;

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

// The start point of a request that is not there yet, for the summary of the criteria alone.
const NO_START: Position = [0, 0];

/**
 * The first view: where the user sets the criteria of a route set, over a full-screen map. Asking
 * for routes replaces the criteria with the route set, its routes drawn on the map.
 */
export function CriteriaView({ language, pageOpen = false }: { language: Language; pageOpen?: boolean }) {
  const t = { ...commonText[language], ...criteriaText[language], ...routesText[language] };
  const desktop = useDesktop();
  // Kept here: the form is mounted in the column or in the sheet, whichever the screen shows.
  const draft = useCriteriaDraft(language);
  const [start, setStart] = useState<Position>();
  // Where the server can route; unknown until it says, or if it cannot: then the server's own refusal stands.
  const coverage = useCoverage();
  const startUncovered = Boolean(start && coverage && !isCovered(coverage, start));
  // Where the map moves to: the device location, or typed coordinates.
  const [focus, setFocus] = useState<Position>();
  const [picking, setPicking] = useState(false);
  // On phones, the criteria are a layer over the map; the height of the sheet is what the routes are framed clear of.
  const [layerOpen, setLayerOpen] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  // What went wrong, and the start point then: setting a new one drops the toast.
  const [toast, setToast] = useState<{ problem: 'unavailable' | 'unreadable'; start?: Position }>();
  const settingsLink = useRef<HTMLAnchorElement>(null);
  const map = useRef<MapHandle>(null);
  const [mapView, setMapView] = useState<MapView>({ bearing: 0, rotated: false, movedAway: false });
  const pageWasOpen = useRef(pageOpen);
  const [{ basemap, pace }, update] = useSettings();
  const units = useUnits(language);
  const browser = useRouteBrowser();
  const { routeSet, loading } = browser;
  const display = useMemo(() => ({ units, language }), [units, language]);
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
  const current = criteriaRequest(draft[0], { units, pace, start });
  // Every search keeps the criteria it was made with, whichever button asked for it.
  const search = (request: RouteSetRequest) => {
    draft[2]();
    browser.ask(request);
  };
  const stale = Boolean(routeSet && current && criteriaChanged(current, routeSet.request, units));
  useRootProperty('--list-inset', 'var(--list-reserved)', listShown);
  useRootProperty('--dock-inset', 'var(--dock-reserved)', dockShown);
  // The floating buttons and the map attribution sit above the sheet, whatever its height.
  useRootProperty('--sheet-height', `${sheetHeight}px`, !desktop && sheetHeight > 0);
  // The detail of a route takes more than half of a phone's screen: the buttons over the map leave it room.
  const detailOpen = !desktop && browser.detail;
  const locateShown = !routesShown && !loading && !detailOpen;
  // In the place of the location button, which the routes hide.
  const reframeShown = routesShown && mapView.movedAway && !detailOpen;

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

  // Escape steps back on a desktop: first out of picking the start point on the map, then out of the route selected.
  const deselect = () => {
    browser.select(undefined);
    browser.setPreview(undefined);
    browser.setHover(undefined);
  };
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (picking) setPicking(false);
    else if (dockShown) deselect();
  });
  useEffect(() => {
    if (!desktop || pageOpen) return;
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [desktop, pageOpen]);

  function changeStart(position: Position) {
    // Routes from another start point would be stale.
    if (start && (start[0] !== position[0] || start[1] !== position[1])) browser.drop();
    setStart(position);
    setPicking(false);
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

  const routeSetView =
    atPace && routeSet && routesShown ? (
      <RouteSetView
        display={display}
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
        onHover={browser.setHover}
      />
    ) : undefined;
  const panel = routeSetView ?? (loading && <SearchingPanel language={language} />);
  // Asking is only for criteria the form would let through.
  const staleNotice = stale && (
    <div role="status" data-testid="routes-stale" className="flex flex-col gap-2 rounded-md bg-accent-soft p-3 text-sm">
      <span>
        <strong>{t.stale}.</strong> {t.staleHint}
      </span>
      {current && !invalidField(current) && (
        <button
          type="button"
          data-testid="routes-search-again"
          // Not a second primary button: the form's own, or the sheet's, is the view's.
          className="min-h-touch rounded-full font-semibold text-accent"
          onClick={() => search(current)}
        >
          {t.searchAgain}
        </button>
      )}
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
  const criteriaFields = (
    <CriteriaFields
      start={start}
      startUncovered={startUncovered}
      language={language}
      picking={picking}
      draft={draft}
      onStartChange={moveStart}
      onUnreadable={() => warn('unreadable')}
      onPick={() => {
        setPicking(!picking);
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
        {routeSet && !loading ? t.routeCount(routeSet.routes.length) : ''}
      </p>
      <StartPointMap
        ref={map}
        onViewChange={setMapView}
        basemap={basemap}
        start={start}
        focus={focus}
        // The start point field also arms a click, or a tap.
        pickOnClick={picking}
        routes={browser.geometries}
        summaries={summaries}
        {...(coverage && { coverage })}
        display={display}
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
        onBasemapFail={(previous) => update({ basemap: previous })}
      />
      <a
        ref={settingsLink}
        data-testid="criteria-settings"
        className={`${FLOATING_BUTTON} fixed top-safe-3 right-safe-3 z-5`}
        href="#/settings"
        aria-label={t.settings}
        // Back from the settings, a crosshair armed before them would come as a surprise.
        onClick={() => setPicking(false)}
      >
        <Settings size={20} aria-hidden />
      </a>
      {!detailOpen && (
        <>
          <BasemapPicker
            // Over the location button, or in its place while that one is hidden.
            className={stackedAbove(locateShown || reframeShown ? 1 : 0)}
            label={t.basemap}
            value={basemap}
            options={BASEMAPS.map((value) => ({ value, label: t[value] }))}
            onChange={(picked) => update({ basemap: picked })}
          />
          {mapView.rotated && (
            <button
              type="button"
              data-testid="criteria-north"
              className={`${FLOATING_BUTTON} fixed z-5 ${stackedAbove(locateShown || reframeShown ? 2 : 1)}`}
              aria-label={t.resetNorth}
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
          className={`${FLOATING_BUTTON} fixed z-5 ${stackedAbove(0)}`}
          aria-label={t.myLocation}
          onClick={locate}
        >
          <LocateFixed size={20} aria-hidden />
        </button>
      )}
      {reframeShown && (
        <button
          type="button"
          data-testid="criteria-reframe"
          className={`${FLOATING_BUTTON} fixed z-5 ${stackedAbove(0)}`}
          aria-label={t.reframe}
          onClick={() => putBack('reframe')}
        >
          <Scan size={20} aria-hidden />
        </button>
      )}
      {desktop ? (
        <>
          <aside className={SIDE_COLUMN}>
            <div data-testid="criteria-title" className="flex items-center gap-2 px-4 pt-4 text-lg font-bold">
              <img className="rounded-sm" src="/favicon.svg" alt="" width="32" height="32" />
              Path finder
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">{criteriaFields}</div>
          </aside>
          {listShown && (
            <aside className={LIST_COLUMN} aria-label={t.routes}>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
                {staleNotice}
                {panel}
                {cancelButton}
              </div>
            </aside>
          )}
        </>
      ) : (
        <>
          <CriteriaBar
            language={language}
            summary={criteriaSummary(criteriaRequest(draft[0], { units, pace, start: start ?? NO_START })!, display)}
            start={start && formatPosition(start, language)}
            onClick={() => setLayerOpen(true)}
          />
          <BottomSheet
            testId="criteria-sheet"
            label={t.routes}
            expanded={browser.detail}
            {...(routeSetView && { onExpandedChange: browser.openDetail })}
            onHeightChange={setSheetHeight}
          >
            {!browser.detail && staleNotice}
            {panel || (
              <>
                {!start && (
                  <p data-testid="criteria-long-press" className="text-center text-sm text-ink-2">
                    {t.longPress}
                  </p>
                )}
                <button
                  type="button"
                  data-testid="criteria-open"
                  className={PRIMARY_BUTTON}
                  onClick={() => setLayerOpen(true)}
                >
                  {t.setCriteria}
                </button>
              </>
            )}
            {cancelButton}
          </BottomSheet>
          {layerOpen && (
            <SubPage title={t.criteria} back="#/" language={language} navigate={() => setLayerOpen(false)}>
              <div className="flex flex-col gap-3">{criteriaFields}</div>
            </SubPage>
          )}
        </>
      )}
      {dockRoute && atPace && selected !== undefined && (
        <RouteDock
          display={display}
          route={dockRoute}
          index={selected}
          count={atPace.routes.length}
          onClose={deselect}
          onHover={browser.setHover}
        />
      )}
      {picking && (
        <div data-testid="criteria-pick-bar" className={`${MAP_NOTICE} flex items-center gap-3 py-1 pr-1 pl-4`}>
          {desktop ? t.pickStart : t.pickStartTouch}
          <button
            type="button"
            data-testid="criteria-pick-cancel"
            className="min-h-touch rounded-full px-3 font-semibold text-accent"
            onClick={() => setPicking(false)}
          >
            {t.cancelPick}
          </button>
        </div>
      )}
      {browser.error && <RouteErrorToast language={language} error={browser.error} onDismiss={browser.dismissError} />}
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
  draft,
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
  draft: ReturnType<typeof useCriteriaDraft>;
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
          aria-label={t.chooseOnMap}
          aria-pressed={picking}
          onClick={onPick}
        >
          <Crosshair size={20} aria-hidden />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          data-testid="criteria-start-locate"
          aria-label={t.myLocation}
          onClick={onLocate}
        >
          <LocateFixed size={20} aria-hidden />
        </button>
      </StartPointField>
      <CriteriaForm
        language={language}
        start={start}
        startUncovered={startUncovered}
        draft={draft}
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
