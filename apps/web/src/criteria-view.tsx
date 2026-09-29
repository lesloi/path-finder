import { LocateFixed, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';

import './criteria-view.css';
import type { Language } from './language.ts';
import { StartPointMap, type Position } from './start-point-map.tsx';
import { BottomSheet, useDesktop } from './ui/index.ts';

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
    unavailable: 'Your location is unavailable. Long-press the map to pick your start point.',
    unavailableDesktop: 'Your location is unavailable. Press Start point, then click the map.',
    north: 'N',
    south: 'S',
    east: 'E',
    west: 'W',
  },
  fr: {
    settings: 'Réglages',
    criteria: 'Critères',
    myLocation: 'Ma position',
    longPress: 'Appuyez longuement sur la carte pour choisir votre point de départ',
    startPoint: 'Point de départ',
    chooseOnMap: 'Choisir sur la carte',
    clickMap: 'Cliquez sur la carte',
    unavailable:
      'Votre position n’est pas disponible. Appuyez longuement sur la carte pour choisir votre point de départ.',
    unavailableDesktop:
      'Votre position n’est pas disponible. Appuyez sur Point de départ, puis cliquez sur la carte.',
    north: 'N',
    south: 'S',
    east: 'E',
    west: 'O',
  },
} satisfies Record<Language, unknown>;

/** The first view: where the user sets the criteria of a route set, over a full-screen map. */
export function CriteriaView({ language }: { language: Language }) {
  const t = text[language];
  const desktop = useDesktop();
  const [start, setStart] = useState<Position>();
  const [located, setLocated] = useState<Position>();
  const [picking, setPicking] = useState(false);
  // The start point when the location was unavailable: setting a new one drops the toast.
  const [unavailableAt, setUnavailableAt] = useState<{ start?: Position }>();

  useEffect(() => {
    if (!unavailableAt) return;
    const timer = setTimeout(() => setUnavailableAt(undefined), TOAST_MS);
    return () => clearTimeout(timer);
  }, [unavailableAt]);

  function changeStart(position: Position) {
    setStart(position);
    setPicking(false);
  }

  // Geolocation is asked for only here, when the user taps a "My location" button.
  function locate() {
    setUnavailableAt(undefined);
    if (!navigator.geolocation) return setUnavailableAt({ start });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const location: Position = [coords.longitude, coords.latitude];
        setLocated(location);
        changeStart(location);
      },
      () => setUnavailableAt({ start }),
      // Without a timeout, a position that never comes would never show the toast.
      { timeout: 10_000 },
    );
  }

  const locateButton = (
    <button type="button" className="floating-button" aria-label={t.myLocation} onClick={locate}>
      <LocateFixed size={20} aria-hidden />
    </button>
  );

  return (
    <>
      <StartPointMap
        start={start}
        located={located}
        // On desktops, a long press does nothing: the start point block arms a click instead.
        pickBy={!desktop ? 'long-press' : picking ? 'click' : undefined}
        onStartChange={changeStart}
      />
      <a className="floating-button map-settings" href="#/settings" aria-label={t.settings}>
        <Settings size={20} aria-hidden />
      </a>
      <div className="map-locate">{locateButton}</div>
      {desktop ? (
        <aside className="side-column">
          <div className="side-column-brand">
            <img src="/favicon.svg" alt="" width="32" height="32" />
            Path finder
          </div>
          <div className="side-column-body">
            <div className={picking ? 'start-block picking' : 'start-block'}>
              <button
                type="button"
                className="start-block-pick"
                aria-pressed={picking}
                onClick={() => setPicking(!picking)}
              >
                <span className="start-block-dot" />
                <span>
                  <span className="start-block-label">{t.startPoint}</span>{' '}
                  {/* Coordinates only: naming the place would send it to a geocoding service. */}
                  <span>{picking ? t.clickMap : start ? formatPosition(start, language) : t.chooseOnMap}</span>
                </span>
              </button>
              <button type="button" className="icon-button" aria-label={t.myLocation} onClick={locate}>
                <LocateFixed size={20} aria-hidden />
              </button>
            </div>
          </div>
        </aside>
      ) : (
        <BottomSheet label={t.criteria}>
          {!start && (
            <>
              <p className="hint">{t.longPress}</p>
              <button type="button" className="button button-secondary" onClick={locate}>
                <LocateFixed size={18} aria-hidden />
                {t.myLocation}
              </button>
            </>
          )}
        </BottomSheet>
      )}
      {unavailableAt && unavailableAt.start === start && (
        <p className="toast" role="alert">
          {desktop ? t.unavailableDesktop : t.unavailable}
        </p>
      )}
    </>
  );
}

// "45.8000° N · 6.2000° E", about 10 m apart at the last digit.
function formatPosition([longitude, latitude]: Position, language: Language): string {
  const t = text[language];
  const format = new Intl.NumberFormat(language, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const latitudeText = `${format.format(Math.abs(latitude))}° ${latitude < 0 ? t.south : t.north}`;
  const longitudeText = `${format.format(Math.abs(longitude))}° ${longitude < 0 ? t.west : t.east}`;
  return `${latitudeText} · ${longitudeText}`;
}
