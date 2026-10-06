import {
  AttributionControl,
  Map,
  Marker,
  ScaleControl,
  type GeoJSONSource,
  type MapMouseEvent,
  type MapTouchEvent,
  type SymbolLayerSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import {
  DEFAULT_BASEMAP,
  distanceMarkers,
  formatDistance,
  formatHeight,
  KM_PER_MILE,
  markerInterval,
  midpoint,
  type Basemap,
  type Display,
  type MapSnapshot,
  type Position,
} from '../core/index.ts';
import { basemapStyle } from './basemap-style.ts';
import { DISTANCE_MARKER_RATIO, distanceMarkerImage } from './distance-marker-image.ts';
import { MAP_COLORS, routeColor } from './route-colors.ts';
import { useDesktop } from './use-desktop.ts';
import { useRouteSnapshot } from './use-route-snapshot.ts';

const LONG_PRESS_MS = 500;

// Pixels between a framed route and the edge of the visible map: a margin (`--spacing-6`).
const FRAME_MARGIN = 24;
// Pixels the desktop column and its margin take from the left of the map, when the stylesheet cannot say.
const COLUMN_INSET_FALLBACK = 380 + 12;
// A width that makes a thin route easy to tap.
const HIT_WIDTH = 22;

// The width the desktop column and its margin cover, as `--column-inset` in `index.css` gives it.
function columnInset() {
  const probe = document.createElement('div');
  probe.style.paddingLeft = 'var(--column-inset)';
  document.body.append(probe);
  const inset = Number.parseFloat(getComputedStyle(probe).paddingLeft);
  probe.remove();
  return Number.isNaN(inset) ? COLUMN_INSET_FALLBACK : inset;
}

const emptyRoutes = { type: 'FeatureCollection', features: [] } as const;

// The font stack the IGN style serves glyphs for.
const LABEL_FONT = ['Source Sans Pro Bold'];
const DEFAULT_DISPLAY: Display = { units: 'metric', language: 'en' };

/** What the map writes on a route: its distance and, when known, its elevation gain. */
export type RouteSummary = { distance: number; elevationGain?: number };

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
 * no longer sets the start point. It labels each route with its distance, and marks the distance along
 * the selected one once its detail is open (`framing` is `selected`).
 */
export function StartPointMap({
  basemap = DEFAULT_BASEMAP,
  start,
  focus,
  pickOnClick = false,
  routes,
  summaries,
  display = DEFAULT_DISPLAY,
  selectedRoute,
  framing = 'all',
  hover,
  routesInteractive = true,
  onRouteSelect,
  onSnapshot,
  onStartChange,
  onBasemapFail,
}: {
  /** The map background: changing it swaps the style, and the map keeps its view and routes. */
  basemap?: Basemap;
  /** The geometry of each route of the route set, in order. */
  routes?: Position[][];
  /** The distance and elevation gain of each route, in the same order, for its label. */
  summaries?: RouteSummary[];
  /** The units of the scale, the labels and the distance markers, and the language of the labels. */
  display?: Display;
  selectedRoute?: number;
  /** What the map frames when the routes or the selection change: all the routes, or the selected one. */
  framing?: 'all' | 'selected';
  /** A place along the selected route, such as where the user points at its elevation profile. */
  hover?: Position;
  /**
   * Whether the routes can be tapped, and keep the start point from being set: false while the user
   * edits the criteria with the routes still on the map.
   */
  routesInteractive?: boolean;
  /** A route was tapped on the map. */
  onRouteSelect?: (index: number) => void;
  /**
   * The map as it framed a new route set, without the routes drawn, so thumbnails of them can show
   * the place. Undefined once there is no route set.
   */
  onSnapshot?: (snapshot: MapSnapshot | undefined) => void;
  start?: Position;
  /** Where the map moves to: the device location, or coordinates the user typed. */
  focus?: Position;
  /** Desktops arm a click once the user asks to pick the start point. */
  pickOnClick?: boolean;
  onStartChange: (start: Position) => void;
  /** The style of a new basemap could not be loaded: the map went back to this one, which the app should show. */
  onBasemapFail?: (basemap: Basemap) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map>(null);
  const [loaded, setLoaded] = useState(false);
  // Counts the styles loaded: a new style drops the routes' source and layers, which are made again.
  const [styleVersion, setStyleVersion] = useState(0);
  const shownBasemap = useRef(basemap);
  // The basemap a style swap is going back to if the new style fails to load; unset once it has loaded.
  const swappedFrom = useRef<Basemap>(undefined);
  const desktop = useDesktop();
  const scale = useRef<ScaleControl>(null);
  const initialUnits = useEffectEvent(() => display.units);
  // The route set the map has a snapshot of: it draws the routes once it has.
  const drawnFor = useRouteSnapshot({ map: mapRef, loaded, routes, desktop, onSnapshot });
  const interactive = Boolean(routes?.length) && routesInteractive;
  const pick = useEffectEvent((how: 'long-press' | 'click', { lng, lat }: { lng: number; lat: number }) => {
    // A tap on a route selects it: it must not move the start point too.
    if (interactive) return;
    if (how === 'long-press' || pickOnClick) onStartChange([lng, lat]);
  });
  const basemapFailed = useEffectEvent((previous: Basemap) => onBasemapFail?.(previous));
  const selectRoute = useEffectEvent((index: number) => {
    if (interactive) onRouteSelect?.(index);
  });

  useEffect(() => {
    const map = new Map({
      container: container.current!,
      style: basemapStyle(shownBasemap.current),
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
    // The ruler: a bar whose length is a round distance, so a route can be sized up by eye.
    scale.current = new ScaleControl({ unit: initialUnits() });
    map.addControl(scale.current, 'bottom-left');
    mapRef.current = map;
    // A style drops what the app added to the map, so this runs for the first style and each one after it.
    // The Plan IGN vector style paints its background from the tiles, so tiles still loading would show
    // whatever is behind the canvas (black in dark mode).
    map.on('style.load', () => {
      swappedFrom.current = undefined;
      map.addLayer(
        { id: 'background', type: 'background', paint: { 'background-color': MAP_COLORS.white } },
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
          'line-color': MAP_COLORS.white,
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
        paint: { 'line-color': MAP_COLORS.white, 'line-width': HIT_WIDTH, 'line-opacity': 0 },
      });
      // The labels sit on top, so they are placed first: the basemap's own give way, and ours yield to a
      // more important one.
      const label: SymbolLayerSpecification['layout'] = {
        'text-font': LABEL_FONT,
        'text-allow-overlap': false,
        'symbol-sort-key': ['get', 'priority'],
      };
      const halo: SymbolLayerSpecification['paint'] = {
        'text-halo-color': MAP_COLORS.white,
        'text-halo-width': 3,
        'text-color': ['get', 'color'],
      };
      map.addSource('route-badges', { type: 'geojson', data: emptyRoutes });
      map.addLayer({
        id: 'route-badges',
        type: 'symbol',
        source: 'route-badges',
        layout: { ...label, 'text-field': ['get', 'label'], 'text-size': 14 },
        paint: halo,
      });
      map.addImage('distance-marker', distanceMarkerImage(), { pixelRatio: DISTANCE_MARKER_RATIO });
      map.addSource('route-markers', { type: 'geojson', data: emptyRoutes });
      map.addLayer({
        id: 'route-markers',
        type: 'symbol',
        source: 'route-markers',
        layout: {
          ...label,
          'icon-image': 'distance-marker',
          'icon-allow-overlap': false,
          'text-field': ['get', 'label'],
          'text-size': 12,
        },
        // White figures on a dark disc: they read over the route and over any map.
        paint: { 'text-color': MAP_COLORS.white },
      });
      setLoaded(true);
      setStyleVersion((version) => version + 1);
    });
    // A style that fails to load leaves an empty map, with no routes: go back to the one that worked. Tiles
    // only fail once their style has loaded, so an error before that is the style's.
    map.on('error', () => {
      const previous = swappedFrom.current;
      if (!previous) return;
      swappedFrom.current = undefined;
      shownBasemap.current = previous;
      map.setStyle(basemapStyle(previous), { diff: false });
      basemapFailed(previous);
    });
    // Once, not per style: the listeners belong to the map and look the layer up when they fire.
    map.on('click', 'routes-hit', ({ features }) => selectRoute(features![0].properties.index as number));
    map.on('mouseenter', 'routes-hit', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'routes-hit', () => (map.getCanvas().style.cursor = ''));

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

  // A full reload (no diff): the routes' layers are not in the new style, and `style.load` makes them again.
  useEffect(() => {
    if (shownBasemap.current === basemap) return;
    swappedFrom.current = shownBasemap.current;
    shownBasemap.current = basemap;
    mapRef.current!.setStyle(basemapStyle(basemap), { diff: false });
  }, [basemap]);

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

  // Once the style has loaded, which holds the layers the routes are drawn in: a new style has none until
  // it loads, and the routes are drawn again then.
  useEffect(() => {
    const source = mapRef.current?.getSource('routes') as GeoJSONSource | undefined;
    if (!loaded || !source) return;
    const features = (drawnFor === routes ? (routes ?? []) : []).map((geometry, index) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: geometry },
      properties: { index, selected: index === selectedRoute, color: routeColor(index) },
    }));
    // The selected route last, so it is drawn on top.
    features.sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected));
    source.setData({ type: 'FeatureCollection', features });
  }, [loaded, routes, selectedRoute, drawnFor, styleVersion]);

  useEffect(() => {
    scale.current?.setUnit(display.units);
  }, [display.units]);

  // Drawn with the routes, so that the thumbnails' snapshot, taken without them, has no label either.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map?.getSource('route-badges')) return;
    const drawn = drawnFor === routes ? (routes ?? []) : [];
    const detail = framing === 'selected';
    const point = (position: Position) => ({ type: 'Point' as const, coordinates: position });
    // One label per route, until the detail of one is open and its markers say it better.
    const badges = detail
      ? []
      : drawn.map((geometry, index) => {
          const summary = summaries?.[index];
          const label = summary ? [formatDistance(summary.distance, display)] : [];
          if (summary?.elevationGain !== undefined) label.push(`+${formatHeight(summary.elevationGain, display)}`);
          return {
            type: 'Feature' as const,
            geometry: point(midpoint(geometry)),
            properties: {
              label: label.join('\n'),
              color: routeColor(index),
              priority: index === selectedRoute ? 0 : 1,
            },
          };
        });
    const kilometres = display.units === 'metric' ? 1 : KM_PER_MILE;
    const summary = selectedRoute === undefined ? undefined : summaries?.[selectedRoute];
    const geometry = detail && selectedRoute !== undefined ? drawn[selectedRoute] : undefined;
    const interval = summary && markerInterval(summary.distance / kilometres);
    const markers =
      geometry && interval
        ? distanceMarkers(geometry, interval * kilometres).map(({ position, count }) => {
            const label = count * interval;
            return {
              type: 'Feature' as const,
              geometry: point(position),
              // A multiple of ten, then of five, keeps its place when markers crowd.
              properties: {
                label: String(label),
                color: routeColor(selectedRoute!),
                priority: label % 10 === 0 ? 0 : label % 5 === 0 ? 1 : 2,
              },
            };
          })
        : [];
    for (const [id, features] of [
      ['route-badges', badges],
      ['route-markers', markers],
    ] as const) {
      (map.getSource(id) as GeoJSONSource).setData({ type: 'FeatureCollection', features });
    }
  }, [loaded, routes, summaries, display, selectedRoute, framing, drawnFor, styleVersion]);

  // The routes, or the selected one, in the part of the map the panel leaves free.
  const framed = framing === 'selected' ? selectedRoute : undefined;
  const taken = drawnFor === routes;
  // The snapshot is taken after the detail of a route was opened: the map goes on to the route.
  const followsSnapshot = framed !== undefined && taken;
  const snapshotTaken = useEffectEvent(() => taken);
  useEffect(() => {
    if (!loaded || !routes?.length) return;
    const map = mapRef.current!;
    const shown = framed === undefined ? routes : [routes[framed] ?? routes[0]];
    const sheet = Number.parseFloat(document.documentElement.style.getPropertyValue('--sheet-height')) || 0;
    const frame = {
      padding: {
        top: FRAME_MARGIN,
        right: FRAME_MARGIN,
        bottom: FRAME_MARGIN + (desktop ? 0 : sheet),
        left: FRAME_MARGIN + (desktop ? columnInset() : 0),
      },
    };
    // Not on every selection of a route set that has its snapshot: hovering a row of the list must not
    // move the map. A new route set is framed at once, for the snapshot that is taken of it.
    if (snapshotTaken()) map.fitBounds(boundsOf(shown), frame);
    else map.fitBounds(boundsOf(routes), { ...frame, animate: false });
  }, [loaded, routes, framed, desktop, followsSnapshot]);

  useEffect(() => {
    if (!hover) return;
    const element = document.createElement('div');
    element.className = 'size-4 rounded-full border-4 border-white bg-ink shadow-float';
    const marker = new Marker({ element }).setLngLat(hover).addTo(mapRef.current!);
    return () => {
      marker.remove();
    };
  }, [hover]);

  // The basemap stays light in dark mode. MapLibre makes its container `position: relative`
  // from outside Tailwind's layers, so a wrapper pins it to the screen.
  return (
    <div className={`fixed inset-0 bg-white [color-scheme:light] ${pickOnClick ? 'map-picking' : ''}`}>
      <div ref={container} className="size-full" />
    </div>
  );
}
