import { AttributionControl, Map, Marker, type MapMouseEvent, type MapTouchEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useEffectEvent, useRef } from 'react';

import './start-point-map.css';

/** A longitude and a latitude, the shape the API's criteria take. */
export type Position = [number, number];

/** How the map sets the start point: a long press (phones), or a click once picking is armed (desktops). */
export type PickBy = 'long-press' | 'click';

const LONG_PRESS_MS = 500;

/** The full-screen map, which shows the start point and sets it the way `pickBy` says. */
export function StartPointMap({
  start,
  located,
  pickBy,
  onStartChange,
}: {
  start?: Position;
  /** The device location, which the map moves to. */
  located?: Position;
  /** Absent: the map never sets the start point. */
  pickBy?: PickBy;
  onStartChange: (start: Position) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map>(null);
  const pick = useEffectEvent((how: PickBy, { lng, lat }: { lng: number; lat: number }) => {
    if (how === pickBy) onStartChange([lng, lat]);
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
    element.className = 'start-marker';
    const marker = new Marker({ element }).setLngLat(start).addTo(mapRef.current!);
    return () => {
      marker.remove();
    };
  }, [start]);

  useEffect(() => {
    if (located) mapRef.current!.easeTo({ center: located, zoom: 14 });
  }, [located]);

  return <div ref={container} className={pickBy === 'click' ? 'map picking' : 'map'} />;
}
