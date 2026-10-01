import {
  AttributionControl,
  Map,
  Marker,
  type GeoJSONSource,
  type MapMouseEvent,
  type MapTouchEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import type { Position } from '../core/index.ts';
import { ROUTE_COLORS } from './route-colors.ts';
import { useDesktop } from './use-desktop.ts';

const LONG_PRESS_MS = 500;

// Pixels between a framed route and the edge of the visible map: a margin (`--spacing-6`).
const FRAME_MARGIN = 24;
// The desktop column and its margin, as `--spacing-column` and `--spacing-3` in `index.css`.
const COLUMN_WIDTH = 380 + 12;
// A width that makes a thin route easy to tap.
const HIT_WIDTH = 22;

const emptyRoutes = { type: 'FeatureCollection', features: [] } as const;

// The south-west and north-east corners around some positions.
function boundsOf(geometries: Position[][]): [Position, Position] {
  const points = geometries.flat();
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

/**
 * The full-screen map, which shows the start point and sets it on a long press, or on a click when
 * `pickOnClick`. With `routes`, it draws each in its colour, the selected one thicker and on top, and
 * no longer sets the start point.
 */
export function StartPointMap({
  start,
  focus,
  pickOnClick = false,
  routes,
  selectedRoute,
  framing = 'all',
  hover,
  onRouteSelect,
  onStartChange,
}: {
  /** The geometry of each route of the route set, in order. */
  routes?: Position[][];
  selectedRoute?: number;
  /** What the map frames when the routes or the selection change: all the routes, or the selected one. */
  framing?: 'all' | 'selected';
  /** A place along the selected route, such as where the user points at its elevation profile. */
  hover?: Position;
  /** A route was tapped on the map. */
  onRouteSelect?: (index: number) => void;
  start?: Position;
  /** Where the map moves to: the device location, or coordinates the user typed. */
  focus?: Position;
  /** Desktops arm a click once the user asks to pick the start point. */
  pickOnClick?: boolean;
  onStartChange: (start: Position) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map>(null);
  const [loaded, setLoaded] = useState(false);
  const desktop = useDesktop();
  const hasRoutes = Boolean(routes?.length);
  const pick = useEffectEvent((how: 'long-press' | 'click', { lng, lat }: { lng: number; lat: number }) => {
    // A tap on a route selects it: it must not move the start point too.
    if (hasRoutes) return;
    if (how === 'long-press' || pickOnClick) onStartChange([lng, lat]);
  });
  const selectRoute = useEffectEvent((index: number) => onRouteSelect?.(index));

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
      const line = { 'line-join': 'round', 'line-cap': 'round' } as const;
      map.addSource('routes', { type: 'geojson', data: emptyRoutes });
      // A white casing keeps a route readable over any background; the selected one is thicker.
      map.addLayer({
        id: 'routes-casing',
        type: 'line',
        source: 'routes',
        layout: line,
        paint: {
          'line-color': '#ffffff',
          'line-width': ['case', ['get', 'selected'], 10, 6],
          'line-opacity': ['case', ['get', 'selected'], 1, 0.7],
        },
      });
      map.addLayer({
        id: 'routes-line',
        type: 'line',
        source: 'routes',
        layout: line,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'selected'], 6, 3],
          'line-opacity': ['case', ['get', 'selected'], 1, 0.55],
        },
      });
      map.addLayer({
        id: 'routes-hit',
        type: 'line',
        source: 'routes',
        paint: { 'line-color': '#000000', 'line-width': HIT_WIDTH, 'line-opacity': 0 },
      });
      map.on('click', 'routes-hit', ({ features }) => selectRoute(features![0].properties.index as number));
      map.on('mouseenter', 'routes-hit', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'routes-hit', () => (map.getCanvas().style.cursor = ''));
      setLoaded(true);
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

  // Once the style has loaded, which holds the layers the routes are drawn in.
  useEffect(() => {
    if (!loaded) return;
    const features = (routes ?? []).map((geometry, index) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: geometry },
      properties: { index, selected: index === selectedRoute, color: ROUTE_COLORS[index % ROUTE_COLORS.length] },
    }));
    // The selected route last, so it is drawn on top.
    features.sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected));
    (mapRef.current!.getSource('routes') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [loaded, routes, selectedRoute]);

  // The routes, or the selected one, in the part of the map the panel leaves free.
  const framed = framing === 'selected' ? selectedRoute : undefined;
  useEffect(() => {
    if (!loaded || !routes?.length) return;
    const shown = framed === undefined ? routes : [routes[framed] ?? routes[0]];
    const sheet = Number.parseFloat(document.documentElement.style.getPropertyValue('--sheet-height')) || 0;
    mapRef.current!.fitBounds(boundsOf(shown), {
      padding: {
        top: FRAME_MARGIN,
        right: FRAME_MARGIN,
        bottom: FRAME_MARGIN + (desktop ? 0 : sheet),
        left: FRAME_MARGIN + (desktop ? COLUMN_WIDTH : 0),
      },
    });
    // Not on every selection: hovering a row of the list must not move the map.
  }, [loaded, routes, framed, desktop]);

  useEffect(() => {
    if (!hover) return;
    const element = document.createElement('div');
    element.className = 'size-4 rounded-full border-4 border-white bg-ink shadow-float';
    const marker = new Marker({ element }).setLngLat(hover).addTo(mapRef.current!);
    return () => {
      marker.remove();
    };
  }, [hover]);

  // The Plan IGN map stays light in dark mode. MapLibre makes its container `position: relative`
  // from outside Tailwind's layers, so a wrapper pins it to the screen.
  return (
    <div className={`fixed inset-0 bg-white [color-scheme:light] ${pickOnClick ? 'map-picking' : ''}`}>
      <div ref={container} className="size-full" />
    </div>
  );
}
