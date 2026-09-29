import { Crosshair, LocateFixed, Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { formatPosition, parsePosition } from './coordinates.ts';
import type { Language } from './language.ts';
import { StartPointMap, type Position } from './start-point-map.tsx';
import {
  BottomSheet,
  FLOATING_BUTTON,
  ICON_BUTTON,
  SECONDARY_BUTTON,
  SIDE_COLUMN,
  TOAST,
  useDesktop,
} from './ui/index.ts';

const TOAST_MS = 6_000;

const text = {
  en: {
    settings: 'Settings',
    criteria: 'Criteria',
    myLocation: 'My location',
    longPress: 'Long-press the map to choose your start point',
    startPoint: 'Start point',
    chooseOnMap: 'Choose on the map',
    clickMap: 'Click the map',
    coordinates: 'Latitude, longitude',
    unreadable: 'Incorrect coordinates.',
    // Paris.
    coordinatesHint: 'For example: 48.85, 2.35 (latitude, longitude)',
    unavailable: 'Your location is unavailable.',
    pickHint: 'Long-press the map to pick your start point.',
    pickHintDesktop: 'Long-press the map or type coordinates.',
  },
  fr: {
    settings: 'Réglages',
    criteria: 'Critères',
    myLocation: 'Ma position',
    longPress: 'Appuyez longuement sur la carte pour choisir votre point de départ',
    startPoint: 'Point de départ',
    chooseOnMap: 'Choisir sur la carte',
    clickMap: 'Cliquez sur la carte',
    coordinates: 'Latitude, longitude',
    unreadable: 'Coordonnées incorrectes.',
    coordinatesHint: 'Exemple : 48.85, 2.35 (latitude, longitude)',
    unavailable: 'Votre position n’est pas disponible.',
    // One line on a phone.
    pickHint: 'Choisissez le départ d’un appui long sur la carte.',
    pickHintDesktop: 'Faites un appui long sur la carte ou saisissez des coordonnées.',
  },
} satisfies Record<Language, unknown>;

/** The first view: where the user sets the criteria of a route set, over a full-screen map. */
export function CriteriaView({
  language,
  pageOpen = false,
}: {
  language: Language;
  /** A sub-page is open over the view. */
  pageOpen?: boolean;
}) {
  const t = text[language];
  const desktop = useDesktop();
  const [start, setStart] = useState<Position>();
  // Where the map moves to: the device location, or typed coordinates.
  const [focus, setFocus] = useState<Position>();
  const [picking, setPicking] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  // What went wrong, and the start point then: setting a new one drops the toast.
  const [toast, setToast] = useState<{ problem: 'unavailable' | 'unreadable'; start?: Position }>();
  const settingsLink = useRef<HTMLAnchorElement>(null);
  const pageWasOpen = useRef(pageOpen);

  // Keyboard users go on from the button that opened the page.
  useEffect(() => {
    if (pageWasOpen.current && !pageOpen) settingsLink.current?.focus();
    pageWasOpen.current = pageOpen;
  }, [pageOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  function changeStart(position: Position) {
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

  return (
    <>
      <StartPointMap
        start={start}
        focus={focus}
        // On desktops, the start point block also arms a click.
        pickOnClick={desktop && picking}
        onStartChange={changeStart}
      />
      {/* The settings are open, or another page with a way back to them. */}
      {!pageOpen && (
        <a
          ref={settingsLink}
          className={`${FLOATING_BUTTON} fixed top-safe-3 right-safe-3 z-5`}
          href="#/settings"
          aria-label={t.settings}
          // Back from the settings, a crosshair armed before them would come as a surprise.
          onClick={() => setPicking(false)}
        >
          <Settings size={20} aria-hidden />
        </a>
      )}
      {/* Above the sheet on phones, whatever its height; an expanded sheet leaves it no room. */}
      {(desktop || !sheetExpanded) && (
        <button
          type="button"
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
      {desktop ? (
        <aside className={SIDE_COLUMN}>
          <div className="flex items-center gap-2 px-4 pt-4 text-lg font-bold">
            <img className="rounded-sm" src="/favicon.svg" alt="" width="32" height="32" />
            Path finder
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <StartPointField
              start={start}
              language={language}
              picking={picking}
              onStartChange={moveStart}
              onUnreadable={() => warn('unreadable')}
            >
              <button
                type="button"
                className={`${ICON_BUTTON} aria-pressed:text-accent`}
                aria-label={t.chooseOnMap}
                aria-pressed={picking}
                onClick={() => setPicking(!picking)}
              >
                <Crosshair size={20} aria-hidden />
              </button>
              <button type="button" className={ICON_BUTTON} aria-label={t.myLocation} onClick={locate}>
                <LocateFixed size={20} aria-hidden />
              </button>
            </StartPointField>
          </div>
        </aside>
      ) : (
        <BottomSheet label={t.criteria} expanded={sheetExpanded} onExpandedChange={setSheetExpanded}>
          {!start && <p className="text-center text-sm text-ink-2">{t.longPress}</p>}
          <StartPointField
            start={start}
            language={language}
            onStartChange={moveStart}
            onUnreadable={() => warn('unreadable')}
          />
          {!start && (
            <button type="button" className={SECONDARY_BUTTON} onClick={locate}>
              <LocateFixed size={18} aria-hidden />
              {t.myLocation}
            </button>
          )}
        </BottomSheet>
      )}
      {toast && toast.start === start && (
        // A click drops it at once.
        <p className={TOAST} role="alert" onClick={() => setToast(undefined)}>
          {toast.problem === 'unavailable' ? t.unavailable : t.unreadable}
          <br />
          {toast.problem === 'unreadable' ? t.coordinatesHint : desktop ? t.pickHintDesktop : t.pickHint}
        </p>
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
  const t = text[language];
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
        <p id={noteId} className="mt-1 px-3 text-sm text-ink-2">
          {t.clickMap}
        </p>
      )}
    </div>
  );
}
