import { AttributionControl, Map, Marker, type MapMouseEvent, type MapTouchEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useEffectEvent, useRef } from 'react';

/** A longitude and a latitude, the shape the API's criteria take. */
export type Position = [number, number];

const LONG_PRESS_MS = 500;

/** The full-screen map, which shows the start point and sets it on a long press, or on a click when `pickOnClick`. */
export function StartPointMap({
  start,
  focus,
  pickOnClick = false,
  onStartChange,
}: {
  start?: Position;
  /** Where the map moves to: the device location, or coordinates the user typed. */
  focus?: Position;
  /** Desktops arm a click once the user asks to pick the start point. */
  pickOnClick?: boolean;
  onStartChange: (start: Position) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map>(null);
  const pick = useEffectEvent((how: 'long-press' | 'click', { lng, lat }: { lng: number; lat: number }) => {
    if (how === 'long-press' || pickOnClick) onStartChange([lng, lat]);
  });

  useEffect(() => {
    const map = new Map({
      container: container.current!,
      style: 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json',
      center: [2.5, 46.6],
      zoom: 5,
      attributionControl: false,
    });
    // Routes come from OpenStreetMap: credit it from this map on, before any route is drawn.
    // The stylesheet moves it above the sheet on phones and to the centre of the map on desktops.
    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: [
          '<a href="https://www.ign.fr">© IGN</a>',
          '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>',
        ],
      }),
      'bottom-left',
    );
    mapRef.current = map;
    // The IGN style paints its background from the tiles, so tiles still loading would show
    // whatever is behind the canvas (black in dark mode).
    map.on('load', () => {
      map.addLayer(
        { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
        map.getStyle().layers[0].id,
      );
    });

    map.on('click', ({ lngLat }) => pick('click', lngLat));

    let timer: ReturnType<typeof setTimeout> | undefined;
    const press = ({ lngLat }: MapMouseEvent | MapTouchEvent) => {
      clearTimeout(timer);
      timer = setTimeout(() => pick('long-press', lngLat), LONG_PRESS_MS);
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
    const element = document.createElement('div');
    // A white dot with a brown ring, like the start of the logo's trail.
    element.className = 'size-6 rounded-full border-6 border-start bg-white shadow-float';
    const marker = new Marker({ element }).setLngLat(start).addTo(mapRef.current!);
    return () => {
      marker.remove();
    };
  }, [start]);

  useEffect(() => {
    if (focus) mapRef.current!.easeTo({ center: focus, zoom: 14 });
  }, [focus]);

  // The Plan IGN map stays light in dark mode. MapLibre makes its container `position: relative`
  // from outside Tailwind's layers, so a wrapper pins it to the screen.
  return (
    <div className={`fixed inset-0 bg-white [color-scheme:light] ${pickOnClick ? 'map-picking' : ''}`}>
      <div ref={container} className="size-full" />
    </div>
  );
}
