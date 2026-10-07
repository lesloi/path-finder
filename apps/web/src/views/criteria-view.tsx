import { Crosshair, LocateFixed, Navigation2, Scan, Settings } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { useSettings } from '../state/index.ts';
import { CriteriaForm, useCriteriaDraft } from './criteria-form.tsx';
import { RouteErrorToast } from './route-error-toast.tsx';
import { RoutesFoundButton } from './routes-found-button.tsx';
import { SearchingPanel } from './searching-panel.tsx';
import { useRouteBrowser } from './use-route-browser.ts';
import { RouteSetView } from './route-set-view.tsx';
import { BASEMAPS, formatPosition, parsePosition, routesAtPace, type Position } from '../core/index.ts';
import { commonText, criteriaText, routesText, type Language } from '../i18n/index.ts';
import {
  StartPointMap,
  type MapHandle,
  type MapView,
  BasemapPicker,
  BottomSheet,
  FLOATING_BUTTON,
  ICON_BUTTON,
  SIDE_COLUMN,
  Toast,
  useToastTimeout,
  useDesktop,
} from '../components/index.ts';

// The bottom-right buttons, from the bottom: the location or reframe one, the basemap, the north. Each
// class is written whole for Tailwind; `below` counts the buttons the one stands on.
const STACKED_ABOVE = [
  'bottom-[calc(var(--sheet-height,0px)+--spacing(3))] desktop:bottom-safe-6',
  'bottom-[calc(var(--sheet-height,0px)+--spacing(3)+var(--spacing-touch)+--spacing(2))] ' +
    'desktop:bottom-[calc(env(safe-area-inset-bottom)+--spacing(6)+var(--spacing-touch)+--spacing(2))]',
  'bottom-[calc(var(--sheet-height,0px)+--spacing(3)+var(--spacing-touch)+--spacing(2)+var(--spacing-touch)+--spacing(2))] ' +
    'desktop:bottom-[calc(env(safe-area-inset-bottom)+--spacing(6)+var(--spacing-touch)+--spacing(2)+var(--spacing-touch)+--spacing(2))]',
];
const stackedAbove = (below: 0 | 1 | 2) =>
  `right-safe-3 transition-[bottom] duration-250 ease-[ease] ${STACKED_ABOVE[below]}`;

/**
 * The first view: where the user sets the criteria of a route set, over a full-screen map. Asking
 * for routes replaces the criteria with the route set, its routes drawn on the map.
 */
export function CriteriaView({ language, pageOpen = false }: { language: Language; pageOpen?: boolean }) {
  const t = { ...commonText[language], ...criteriaText[language], ...routesText[language] };
  const desktop = useDesktop();
  // Kept here: the form is mounted in the column or in the sheet, whichever the screen shows.
  const draft = useCriteriaDraft();
  const [start, setStart] = useState<Position>();
  // Where the map moves to: the device location, or typed coordinates.
  const [focus, setFocus] = useState<Position>();
  const [picking, setPicking] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  // What went wrong, and the start point then: setting a new one drops the toast.
  const [toast, setToast] = useState<{ problem: 'unavailable' | 'unreadable'; start?: Position }>();
  const settingsLink = useRef<HTMLAnchorElement>(null);
  const map = useRef<MapHandle>(null);
  const [mapView, setMapView] = useState<MapView>({ bearing: 0, rotated: false, movedAway: false });
  const pageWasOpen = useRef(pageOpen);
  const [{ units, basemap, pace }, update] = useSettings();
  const browser = useRouteBrowser();
  const { routeSet, loading } = browser;
  const display = useMemo(() => ({ units, language }), [units, language]);
  const atPace = useMemo(() => routeSet && routesAtPace(routeSet.request, routeSet.routes, pace), [routeSet, pace]);
  const summaries = useMemo(
    () => routeSet?.routes.map(({ distance, elevationGain }) => ({ distance, elevationGain })),
    [routeSet],
  );
  const locateShown = !browser.showing && !loading && (desktop || !sheetExpanded);
  // In the place of the location button, which the routes hide.
  const reframeShown = browser.showing && mapView.movedAway && (desktop || !sheetExpanded);

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

  function backToCriteria() {
    browser.leave();
    setSheetExpanded(false);
  }

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

  const panel =
    atPace && routeSet && browser.showing ? (
      <RouteSetView
        display={display}
        request={routeSet.request}
        routes={atPace.routes}
        pace={atPace.pace}
        snapshot={browser.snapshot}
        selected={browser.selected}
        detail={browser.detail}
        onSelect={browser.select}
        onDetailChange={browser.openDetail}
        // By duration, a new pace is another search, which the criteria ask for: the list only says the pace.
        onPaceChange={'distance' in routeSet.request.target ? (value) => update({ pace: value }) : undefined}
        onBack={backToCriteria}
        onHover={browser.setHover}
        condensed={!desktop && !sheetExpanded}
      />
    ) : (
      loading && <SearchingPanel language={language} />
    );
  // The criteria came back with the routes still found: a way to see them again.
  const found = routeSet && !browser.showing && (
    <RoutesFoundButton language={language} count={routeSet.routes.length} onClick={browser.show} />
  );

  return (
    <>
      <StartPointMap
        ref={map}
        onViewChange={setMapView}
        basemap={basemap}
        start={start}
        focus={focus}
        // On desktops, the start point block also arms a click.
        pickOnClick={desktop && picking}
        routes={browser.geometries}
        summaries={summaries}
        display={display}
        selectedRoute={browser.selected}
        framing={browser.detail ? 'selected' : 'all'}
        {...(browser.detail && browser.hover && { hover: browser.hover })}
        routesInteractive={browser.showing}
        onRouteSelect={browser.select}
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
      {(desktop || !sheetExpanded) && (
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
          className={
            `${FLOATING_BUTTON} fixed right-safe-3 bottom-[calc(var(--sheet-height,0px)+--spacing(3))] z-5 ` +
            'transition-[bottom] duration-250 ease-[ease] desktop:bottom-safe-6'
          }
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
          className={
            `${FLOATING_BUTTON} fixed right-safe-3 bottom-[calc(var(--sheet-height,0px)+--spacing(3))] z-5 ` +
            'transition-[bottom] duration-250 ease-[ease] desktop:bottom-safe-6'
          }
          aria-label={t.reframe}
          onClick={() => putBack('reframe')}
        >
          <Scan size={20} aria-hidden />
        </button>
      )}
      {desktop ? (
        <aside className={SIDE_COLUMN}>
          <div data-testid="criteria-title" className="flex items-center gap-2 px-4 pt-4 text-lg font-bold">
            <img className="rounded-sm" src="/favicon.svg" alt="" width="32" height="32" />
            Path finder
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {panel || (
              <>
                {found}
                <StartPointField
                  start={start}
                  language={language}
                  picking={picking}
                  onStartChange={moveStart}
                  onUnreadable={() => warn('unreadable')}
                >
                  <button
                    type="button"
                    data-testid="criteria-start-pick"
                    className={`${ICON_BUTTON} aria-pressed:text-accent`}
                    aria-label={t.chooseOnMap}
                    aria-pressed={picking}
                    onClick={() => setPicking(!picking)}
                  >
                    <Crosshair size={20} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={ICON_BUTTON}
                    data-testid="criteria-start-locate"
                    aria-label={t.myLocation}
                    onClick={locate}
                  >
                    <LocateFixed size={20} aria-hidden />
                  </button>
                </StartPointField>
                <CriteriaForm language={language} start={start} draft={draft} onSubmit={browser.ask} />
              </>
            )}
          </div>
        </aside>
      ) : (
        <BottomSheet
          testId="criteria-sheet"
          label={routeSet ? t.routes : t.criteria}
          expanded={sheetExpanded}
          onExpandedChange={setSheetExpanded}
        >
          {panel || (
            <>
              {found}
              {!start && (
                <p data-testid="criteria-long-press" className="text-center text-sm text-ink-2">
                  {t.longPress}
                </p>
              )}
              <StartPointField
                start={start}
                language={language}
                onStartChange={moveStart}
                onUnreadable={() => warn('unreadable')}
              />
              <CriteriaForm
                language={language}
                start={start}
                draft={draft}
                compact={!sheetExpanded}
                onSubmit={browser.ask}
              />
            </>
          )}
        </BottomSheet>
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
