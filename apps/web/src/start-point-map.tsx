import { Map, Marker, type MapMouseEvent, type MapTouchEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import type { Language } from './language.ts';

/** A longitude and a latitude, the shape the API's criteria take. */
export type Position = [number, number];

const LONG_PRESS_MS = 500;

const text = {
  en: {
    myLocation: 'My location',
    unavailable: 'Your location is unavailable. Long-press the map to pick your start point.',
  },
  fr: {
    myLocation: 'Ma position',
    unavailable:
      'Votre position n’est pas disponible. Appuyez longuement sur la carte pour choisir votre point de départ.',
  },
} satisfies Record<Language, unknown>;

export function StartPointMap({
  language,
  start,
  onStartChange,
}: {
  language: Language;
  start?: Position;
  onStartChange: (start: Position) => void;
}) {
  const t = text[language];
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map>(null);
  // The start point when the location was unavailable: setting a new one drops the message.
  const [unavailableAt, setUnavailableAt] = useState<{ start?: Position }>();
  const pickStart = useEffectEvent(onStartChange);

  useEffect(() => {
    const map = new Map({
      container: container.current!,
      style: 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json',
      center: [2.5, 46.6],
      zoom: 5,
      // Routes come from OpenStreetMap: credit it from this map on, before any route is drawn.
      attributionControl: {
        customAttribution: [
          '<a href="https://www.ign.fr">© IGN</a>',
          '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>',
        ],
      },
    });
    mapRef.current = map;
    // The IGN style paints its background from the tiles, so tiles still loading would show
    // whatever is behind the canvas (black in dark mode).
    map.on('load', () => {
      map.addLayer(
        { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
        map.getStyle().layers[0].id,
      );
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const press = ({ lngLat }: MapMouseEvent | MapTouchEvent) => {
      clearTimeout(timer);
      timer = setTimeout(() => pickStart([lngLat.lng, lngLat.lat]), LONG_PRESS_MS);
    };
    const cancel = () => clearTimeout(timer);
    map.on('mousedown', (event) => {
      if (event.originalEvent.button === 0) press(event);
    });
    // A second finger starts a pinch, not a long press.
    map.on('touchstart', (event) => (event.originalEvent.touches.length === 1 ? press(event) : cancel()));
    // A click, a tap, a pan, a box zoom or a touch the system took over is not a long press.
    for (const type of ['mouseup', 'touchend', 'touchcancel', 'movestart', 'boxzoomstart'] as const) {
      map.on(type, cancel);
    }

    return () => {
      clearTimeout(timer);
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (!start) return;
    const marker = new Marker().setLngLat(start).addTo(mapRef.current!);
    return () => {
      marker.remove();
    };
  }, [start]);

  // Geolocation is asked for only here, when the user taps the button.
  function locate() {
    setUnavailableAt(undefined);
    if (!navigator.geolocation) return setUnavailableAt({ start });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const location: Position = [coords.longitude, coords.latitude];
        mapRef.current?.easeTo({ center: location, zoom: 14 });
        onStartChange(location);
      },
      () => setUnavailableAt({ start }),
      // Without a timeout, a position that never comes would never show the message.
      { timeout: 10_000 },
    );
  }

  return (
    <>
      <div ref={container} style={{ height: '60vh' }} />
      <button type="button" onClick={locate}>
        {t.myLocation}
      </button>
      {unavailableAt && unavailableAt.start === start && <p role="alert">{t.unavailable}</p>}
    </>
  );
}
