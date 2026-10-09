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
import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from 'react';

import {
  DEFAULT_BASEMAP,
  distanceMarkers,
  formatDistance,
  formatHeight,
  KM_PER_MILE,
  isWithin,
  markerInterval,
  midpointWithin,
  type PixelRect,
  type Basemap,
  type Display,
  type MapSnapshot,
  type Position,
} from '../core/index.ts';
import { basemapStyle } from './basemap-style.ts';
import { DISTANCE_MARKER_RATIO, distanceMarkerImage } from './distance-marker-image.ts';
import { MAP_COLORS, MAP_INK, ROUTE_COLORS, routeColor } from './route-colors.ts';
import {
  ROUTE_TAG_MUTED,
  ROUTE_TAG_PADDING,
  ROUTE_TAG_RATIO,
  ROUTE_TAG_STRETCH,
  routeTagId,
  routeTagImage,
} from './route-tag-image.ts';
import { useDesktop } from './use-desktop.ts';
import { NORTH_EPSILON, useRouteSnapshot } from './use-route-snapshot.ts';

const LONG_PRESS_MS = 500;

// Pixels between a framed route and the edge of the visible map: a margin (`--spacing-6`).
const FRAME_MARGIN = 24;
// Without the stylesheet that sets the room of the desktop panels (`--column-inset`…), they take none.
const NO_ROOM = 0;
// The smallest part of the map, in px, that the panels leave to the routes: a narrow window shrinks their margins.
const MIN_FRAME = 240;
// A width that makes a thin route easy to tap.
const HIT_WIDTH = 22;

// What the panels and their margins cover of the map, as `index.css` gives it: custom properties of the
// stylesheet, read together from one probe. The top is the bar a phone shows over the map.
function reservedSpace() {
  const probe = document.createElement('div');
  probe.style.paddingTop = 'var(--dock-reserved)';
  probe.style.paddingRight = 'var(--list-reserved)';
  probe.style.paddingLeft = 'var(--column-inset)';
  probe.style.paddingBottom = 'var(--top-reserved)';
  document.body.append(probe);
  const { paddingTop, paddingRight, paddingLeft, paddingBottom } = getComputedStyle(probe);
  probe.remove();
  const read = (value: string, fallback: number) =>
    Number.isNaN(Number.parseFloat(value)) ? fallback : Number.parseFloat(value);
  return {
    dock: read(paddingTop, NO_ROOM),
    list: read(paddingRight, NO_ROOM),
    column: read(paddingLeft, NO_ROOM),
    top: read(paddingBottom, NO_ROOM),
  };
}

// The part of the map that stays free of the left column, the sheet and the controls, shrunk by half the size
// of what is drawn there so that all of it stays inside.
function freeArea(
  map: Map,
  desktop: boolean,
  sheetHeight: number,
  space: ReturnType<typeof reservedSpace>,
  [halfWidth, halfHeight]: [number, number],
): PixelRect {
  const { clientWidth, clientHeight } = map.getCanvas();
  // On desktops, the route list and the dock take the right and the bottom, shown or not; on phones, the bar takes
  // the top and the sheet the bottom.
  const sheet = desktop ? space.dock : sheetHeight;
  return {
    left: (desktop ? space.column : 0) + FRAME_MARGIN + halfWidth,
    top: FRAME_MARGIN + (desktop ? 0 : space.top) + halfHeight,
    right: clientWidth - Math.max(CONTROLS_RIGHT, desktop ? space.list : 0) - halfWidth,
    bottom: clientHeight - sheet - CONTROLS_BOTTOM - halfHeight,
  };
}

// The routes the map frames: all of them, or the selected one.
function framedRoutes(routes: Position[][], framed: number | undefined) {
  return framed === undefined ? routes : [routes[framed] ?? routes[0]];
}

// Pixels the controls take from the right of the map (the floating buttons and their margin).
const CONTROLS_RIGHT = 72;
// Pixels the scale and the attribution take from the bottom of the map.
const CONTROLS_BOTTOM = 58;
// Half the width and height of a route's tag, which has to stay inside the map.
const TAG_HALF: [number, number] = [56, 28];
// Half the size of a distance marker.
const MARKER_HALF = 16;

const point = (position: Position) => ({ type: 'Point' as const, coordinates: position });
const emptyRoutes = { type: 'FeatureCollection', features: [] } as const;

// The font stack the IGN style serves glyphs for.
const LABEL_FONT = ['Source Sans Pro Bold'];
const DEFAULT_DISPLAY: Display = { units: 'metric', language: 'en' };

/** How the user left the map, for the buttons that put it back. */
export type MapView = {
  /** Degrees the map is turned from north. */
  bearing: number;
  /** Whether the map is turned away from north up. */
  rotated: boolean;
  /** Whether the user moved the map since it last framed the routes. */
  movedAway: boolean;
};

/** What the buttons over the map ask of it. */
export type MapHandle = {
  /** Turns the map back to north at the top. */
  resetNorth: () => void;
  /** Frames the routes again, or the selected one. */
  reframe: () => void;
};

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
 * no longer sets the start point. It labels each route with its distance. Once the detail of one is open
 * (`framing` is `selected`), it draws only that route, and marks the distance along it.
 * On phones, the part of the map the sheet (`sheetHeight`) and the bar leave free is where it frames.
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
  markedRoute,
  framing = 'all',
  sheetHeight = 0,
  hover,
  routesInteractive = true,
  onRouteSelect,
  onBackgroundClick,
  onSnapshot,
  onStartChange,
  onBasemapFail,
  onViewChange,
  ref,
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
  /** The route that carries distance markers while the others stay drawn, such as the one selected on a desktop. */
  markedRoute?: number;
  /**
   * What the map frames and draws: all the routes; the selected one, the others staying drawn (`follow`, such
   * as the carousel of a phone); or only the selected one, once its detail is open.
   */
  framing?: 'all' | 'follow' | 'selected';
  /** The height in px of the bottom sheet of a phone, which the routes are framed clear of. */
  sheetHeight?: number;
  /** A place along the selected route, such as where the user points at its elevation profile. */
  hover?: Position;
  /**
   * Whether the routes can be tapped, and keep the start point from being set: false while the user
   * edits the criteria with the routes still on the map.
   */
  routesInteractive?: boolean;
  /** A route was tapped on the map. */
  onRouteSelect?: (index: number) => void;
  /** The map was clicked or tapped where there is no route. */
  onBackgroundClick?: () => void;
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
  /** The user turned or moved the map, or it was put back. */
  onViewChange?: (view: MapView) => void;
  ref?: Ref<MapHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map>(null);
  const [loaded, setLoaded] = useState(false);
  // Counts the styles loaded: a new style drops the routes' source and layers, which are made again.
  const [styleVersion, setStyleVersion] = useState(0);
  // Counts the times the map settled or was resized: the tags are placed in the part of it that is in view.
  const [viewVersion, setViewVersion] = useState(0);
  const shownBasemap = useRef(basemap);
  // The basemap a style swap is going back to if the new style fails to load; unset once it has loaded.
  const swappedFrom = useRef<Basemap>(undefined);
  const desktop = useDesktop();
  const scale = useRef<ScaleControl>(null);
  const initialUnits = useEffectEvent(() => display.units);
  // The route set the map has a snapshot of: it draws the routes once it has.
  const drawnFor = useRouteSnapshot({ map: mapRef, loaded, routes, desktop, onSnapshot });
  // Picking the start point on the map comes first: a click then is not on a route.
  const interactive = Boolean(routes?.length) && routesInteractive && !pickOnClick;
  const view = useRef<MapView>({ bearing: 0, rotated: false, movedAway: false });
  // Tells the app what changed in the view, and only when something did: the map moves many times a second.
  const changeView = useEffectEvent((change: Partial<MapView>) => {
    const next = { ...view.current, ...change };
    if ((Object.keys(next) as (keyof MapView)[]).every((key) => next[key] === view.current[key])) return;
    view.current = next;
    onViewChange?.(next);
  });
  const pick = useEffectEvent((how: 'long-press' | 'click', { lng, lat }: { lng: number; lat: number }) => {
    // A tap on a route selects it: it must not move the start point too.
    if (interactive) return;
    if (how === 'long-press' || pickOnClick) onStartChange([lng, lat]);
  });
  const clickedBackground = useEffectEvent(() => {
    if (!pickOnClick) onBackgroundClick?.();
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
      // A flat map: the app draws no relief and no 3D, so a tilt would only skew it.
      maxPitch: 0,
      pitchWithRotate: false,
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
    for (const type of ['moveend', 'resize'] as const) map.on(type, () => setViewVersion((version) => version + 1));
    map.on('move', () => {
      const bearing = map.getBearing();
      changeView({ bearing, rotated: Math.abs(bearing) > NORTH_EPSILON });
    });
    // A gesture carries its event; a framing the app asks for does not.
    map.on('movestart', (event) => {
      if ('originalEvent' in event && event.originalEvent) changeView({ movedAway: true });
    });
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
      // The selected route has a white casing and a dashed white marking along its line, and its own colour;
      // the others are one thin grey line, so the eye goes to the one the user looks at.
      // The others come first, so that where they cross the selected route they pass under its casing.
      map.addLayer({
        id: 'routes-others',
        type: 'line',
        source: 'routes',
        filter: ['!=', ['get', 'selected'], true],
        layout: line,
        paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.85 },
      });
      map.addLayer({
        id: 'routes-casing',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'selected'], true],
        layout: line,
        paint: { 'line-color': MAP_COLORS.white, 'line-width': 11 },
      });
      map.addLayer({
        id: 'routes-line',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'selected'], true],
        layout: line,
        paint: { 'line-color': ['get', 'color'], 'line-width': 6 },
      });
      map.addLayer({
        id: 'routes-marking',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'selected'], true],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': MAP_COLORS.white, 'line-width': 2.6, 'line-dasharray': [3, 5.4] },
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
      // A tag is a rounded box that fits its text: white with a grey rim, or filled in the colour of the
      // selected route.
      const addTag = (id: string, fill: string, border: string) =>
        map.addImage(id, routeTagImage(fill, border), { pixelRatio: ROUTE_TAG_RATIO, ...ROUTE_TAG_STRETCH });
      addTag(ROUTE_TAG_MUTED, MAP_COLORS.white, MAP_COLORS.routeMuted);
      ROUTE_COLORS.forEach((color, index) => addTag(routeTagId(index), color, MAP_COLORS.white));
      map.addSource('route-badges', { type: 'geojson', data: emptyRoutes });
      map.addLayer({
        id: 'route-badges',
        type: 'symbol',
        source: 'route-badges',
        layout: {
          ...label,
          'icon-image': ['get', 'tag'],
          'icon-text-fit': 'both',
          'icon-text-fit-padding': ROUTE_TAG_PADDING,
          'icon-allow-overlap': false,
          'text-field': ['get', 'label'],
          'text-size': 13,
        },
        paint: { 'text-color': ['get', 'textColor'] },
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
      // The place hovered on the elevation profile, over everything else.
      map.addSource('route-hover', { type: 'geojson', data: emptyRoutes });
      map.addLayer({
        id: 'route-hover',
        type: 'circle',
        source: 'route-hover',
        paint: {
          'circle-radius': 6,
          'circle-color': MAP_INK,
          'circle-stroke-color': MAP_COLORS.white,
          'circle-stroke-width': 4,
        },
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

    map.on('click', ({ lngLat, point }) => {
      pick('click', lngLat);
      // A route has its own click, on its wide hit line: anywhere else is the background.
      if (!map.queryRenderedFeatures(point, { layers: ['routes-hit'] }).length) clickedBackground();
    });

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
    const features = (drawnFor === routes ? (routes ?? []) : [])
      .map((geometry, index) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: geometry },
        properties: {
          index,
          selected: index === selectedRoute,
          // Grey unless it is the selected one; with none selected, every route keeps its colour.
          color: selectedRoute === undefined || index === selectedRoute ? routeColor(index) : MAP_COLORS.routeMuted,
        },
      }))
      // Once the detail of a route is open, the others are left out: they are not drawn, nor tappable.
      .filter(({ properties }) => framing !== 'selected' || properties.selected);
    // The selected route last, so it is drawn on top.
    features.sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected));
    source.setData({ type: 'FeatureCollection', features });
  }, [loaded, routes, selectedRoute, framing, drawnFor, styleVersion]);

  useEffect(() => {
    scale.current?.setUnit(display.units);
  }, [display.units]);

  // Drawn with the routes, so that the thumbnails' snapshot, taken without them, has no label either.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map?.getSource('route-badges')) return;
    const drawn = drawnFor === routes ? (routes ?? []) : [];
    const detail = framing === 'selected';
    const project = ([lon, lat]: Position) => map.project([lon, lat]);
    // Read once: it asks the browser for a layout.
    const space = reservedSpace();
    const tagArea = freeArea(map, desktop, sheetHeight, space, TAG_HALF);
    // One tag per route, until the detail of one is open and its markers say it better. It sits on the stretch
    // of its route that is in view, and a route with none in view has no tag.
    const badges = detail
      ? []
      : drawn.flatMap((geometry, index) => {
          // The markers say it better for the route that has them.
          if (index === markedRoute) return [];
          const anchor = midpointWithin(geometry, project, tagArea);
          if (!anchor) return [];
          const summary = summaries?.[index];
          const label = summary ? [formatDistance(summary.distance, display)] : [];
          if (summary?.elevationGain !== undefined) label.push(`+${formatHeight(summary.elevationGain, display)}`);
          const selected = index === selectedRoute;
          // As for the lines, with none selected every tag keeps its route's colour.
          const filled = selected || selectedRoute === undefined;
          return [
            {
              type: 'Feature' as const,
              geometry: point(anchor),
              properties: {
                label: label.join('\n'),
                tag: filled ? routeTagId(index) : ROUTE_TAG_MUTED,
                textColor: filled ? MAP_COLORS.white : MAP_INK,
                priority: selected ? 0 : 1,
              },
            },
          ];
        });
    const kilometres = display.units === 'metric' ? 1 : KM_PER_MILE;
    // The route with markers: the one of the open detail, or the one a desktop marks while it shows the others.
    const marked = detail ? selectedRoute : markedRoute;
    const summary = marked === undefined ? undefined : summaries?.[marked];
    const geometry = marked === undefined ? undefined : drawn[marked];
    const interval = summary && markerInterval(summary.distance / kilometres);
    const markerArea = freeArea(map, desktop, sheetHeight, space, [MARKER_HALF, MARKER_HALF]);
    const markers =
      geometry && interval
        ? distanceMarkers(geometry, interval * kilometres)
            .filter(({ position }) => isWithin(position, project, markerArea))
            .map(({ position, count }) => {
              const label = count * interval;
              return {
                type: 'Feature' as const,
                geometry: point(position),
                // A multiple of ten, then of five, keeps its place when markers crowd.
                properties: {
                  label: String(label),
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
  }, [
    loaded,
    routes,
    summaries,
    display,
    selectedRoute,
    markedRoute,
    framing,
    drawnFor,
    styleVersion,
    viewVersion,
    desktop,
    sheetHeight,
  ]);

  // The routes, or the selected one, in the part of the map the panel leaves free. A new route set is framed north
  // up, as its snapshot maps places to pixels without a turn; framing it again keeps the user's orientation.
  const framed = framing === 'all' ? undefined : selectedRoute;
  const taken = drawnFor === routes;
  // The snapshot is taken after the detail of a route was opened: the map goes on to the route.
  const followsSnapshot = framed !== undefined && taken;
  const snapshotTaken = useEffectEvent(() => taken);
  // Counts the asks to frame the routes again.
  const [reframes, setReframes] = useState(0);
  const frame = (bearing: number) => {
    if (!desktop) {
      const { top } = reservedSpace();
      return {
        bearing,
        padding: {
          top: FRAME_MARGIN + top,
          right: FRAME_MARGIN,
          bottom: FRAME_MARGIN + sheetHeight,
          left: FRAME_MARGIN,
        },
      };
    }
    // The room is kept for the route list and the dock whether they are shown or not, so the map does not move
    // when they come and go. A window too narrow for all of it shrinks the margins, to keep a part of the map.
    const canvas = mapRef.current!.getCanvas();
    const fit = (before: number, after: number, size: number) => {
      const scale = Math.min(1, Math.max(0, size - MIN_FRAME) / (before + after));
      return [before * scale, after * scale];
    };
    const space = reservedSpace();
    const [left, right] = fit(FRAME_MARGIN + space.column, FRAME_MARGIN + space.list, canvas.clientWidth);
    const [top, bottom] = fit(FRAME_MARGIN, FRAME_MARGIN + space.dock, canvas.clientHeight);
    return { bearing, padding: { top, right, bottom, left } };
  };
  useImperativeHandle(ref, () => ({
    resetNorth: () => mapRef.current?.resetNorth(),
    // The framing below runs again.
    reframe: () => setReframes((count) => count + 1),
  }));
  const refit = useEffectEvent(() => {
    const map = mapRef.current!;
    // Not on every selection of a route set that has its snapshot: hovering a row of the list must not
    // move the map. A new route set is framed at once, for the snapshot that is taken of it.
    if (snapshotTaken()) map.fitBounds(boundsOf(framedRoutes(routes!, framed)), frame(map.getBearing()));
    else map.fitBounds(boundsOf(routes!), { ...frame(0), animate: false });
    changeView({ movedAway: false });
  });
  useEffect(() => {
    if (loaded && routes?.length) refit();
  }, [loaded, routes, framed, desktop, followsSnapshot, reframes]);
  // A sheet that changes height leaves another free area, but a map the user moved stays where they put it.
  const framedSheet = useRef(sheetHeight);
  useEffect(() => {
    if (framedSheet.current === sheetHeight) return;
    framedSheet.current = sheetHeight;
    if (loaded && routes?.length && !view.current.movedAway) refit();
  }, [sheetHeight]); // eslint-disable-line react-hooks/exhaustive-deps -- only a new height frames again

  useEffect(() => {
    // A new style drops the source until it has loaded; `styleVersion` brings the effect back then.
    const source = loaded ? (mapRef.current!.getSource('route-hover') as GeoJSONSource | undefined) : undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: hover ? [{ type: 'Feature', properties: {}, geometry: point(hover) }] : [],
    });
  }, [loaded, hover, styleVersion]);

  // The basemap stays light in dark mode. MapLibre makes its container `position: relative`
  // from outside Tailwind's layers, so a wrapper pins it to the screen.
  return (
    <div className={`fixed inset-0 bg-white [color-scheme:light] ${pickOnClick ? 'map-picking' : ''}`}>
      <div ref={container} className="size-full" />
    </div>
  );
}
