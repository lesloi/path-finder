import {
  AttributionControl,
  Map,
  Marker,
  Popup,
  ScaleControl,
  type GeoJSONSource,
  type MapMouseEvent,
  type MapTouchEvent,
  type PopupOptions,
  type SymbolLayerSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';

import { AVOIDED_AREA_RADIUS, type AvoidedArea } from '../contract/index.ts';

import {
  AVOIDED_RADIUS_STEP,
  circlePolygon,
  DEFAULT_BASEMAP,
  distanceMarkers,
  formatDistance,
  formatHeight,
  isCovered,
  samePositions,
  isWithin,
  POI_MIN_ZOOM,
  poiLabel,
  poiTilesCovering,
  type PoiCategory,
  isPoiCategory,
  POI_CATEGORIES,
  markerInterval,
  midpointWithin,
  type PixelRect,
  type Basemap,
  type MapSnapshot,
  type CoverageCell,
  type Position,
  type WaypointPoi,
  veilPolygon,
} from '../core/index.ts';
import { commonText, criteriaText, type Language } from '../i18n/index.ts';
import { requestPoiTile } from '../state/index.ts';
import { basemapStyle, veilPaint } from './basemap-style.ts';
import { DISTANCE_MARKER_RATIO, distanceMarkerImage } from './distance-marker-image.ts';
import { POI_IMAGE_RATIO, poiImage, poiImageId } from './poi-image.ts';
import { ROUTE_ARROW_RATIO, ROUTE_ARROW_SPACING, routeArrowImage } from './route-arrow-image.ts';
import { MAP_COLORS, MAP_INK, ROUTE_COLORS, routeColor } from './route-colors.ts';
import { Slider } from './slider.tsx';
import {
  ROUTE_TAG_MUTED,
  ROUTE_TAG_PADDING,
  ROUTE_TAG_RATIO,
  ROUTE_TAG_STRETCH,
  routeTagId,
  routeTagImage,
} from './route-tag-image.ts';
import { useDesktop } from './use-desktop.ts';
import { AvoidedAreaBadge } from './avoided-area-badge.tsx';
import { WaypointPin } from './waypoint-pin.tsx';
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

// The names MapLibre gives its controls, in the language of the app.
const mapLocale = (language: Language) => ({
  'Map.Title': commonText[language].mapName,
  'AttributionControl.ToggleAttribution': commonText[language].toggleAttribution,
});

// Pixels the controls take from the right of the map (the floating buttons and their margin).
const CONTROLS_RIGHT = 72;
// Pixels the scale and the attribution take from the bottom of the map.
const CONTROLS_BOTTOM = 40;
// Half the width and height of a route's tag, which has to stay inside the map.
const TAG_HALF: [number, number] = [56, 28];
// Half the size of a distance marker.
const MARKER_HALF = 16;

// Where the bubble of a waypoint sits around its pin, which rises 29 px above the point: clear of the pin, above it or
// beside it, and just under the point when there is no room above.
const ABOVE_PIN: [number, number] = [0, -33];
const BELOW_PIN: [number, number] = [0, 6];
const PIN_BUBBLE_OFFSET = {
  center: ABOVE_PIN,
  bottom: ABOVE_PIN,
  'bottom-left': ABOVE_PIN,
  'bottom-right': ABOVE_PIN,
  top: BELOW_PIN,
  'top-left': BELOW_PIN,
  'top-right': BELOW_PIN,
  left: [8, -15],
  right: [-8, -15],
} satisfies Record<string, [number, number]>;

// A default that keeps its identity, so that the markers are not drawn again on every render.
const NO_WAYPOINTS: Position[] = [];
const NO_AREAS: AvoidedArea[] = [];

// The bubble of an avoided area opens above its badge, which is centred on the point.
const AREA_BUBBLE_OFFSET = 16;

const poiLayerId = (category: PoiCategory) => `pois-${category}`;
const point = (position: Position) => ({ type: 'Point' as const, coordinates: position });
const emptyRoutes = { type: 'FeatureCollection', features: [] } as const;

// The font stack the IGN style serves glyphs for.
const LABEL_FONT = ['Source Sans Pro Bold'];

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
  /** Moves the map to a position, at the zoom it has. */
  centerOn: (position: Position) => void;
  /** Sets the pin of a waypoint apart, larger and in the accent colour: the one the user points at in a list. */
  highlightWaypoint: (index: number | undefined) => void;
  /** Sets the circle and the number of an avoided area apart, the one the user points at in the list. */
  highlightArea: (index: number | undefined) => void;
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
  waypoints = NO_WAYPOINTS,
  placing = false,
  avoidedAreas = NO_AREAS,
  avoiding = false,
  routes,
  summaries,
  directedRoutes,
  coverage,
  language = 'en',
  poiCategories = [],
  poiSeasonal = true,
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
  onWaypointAdd,
  onAvoidedAreaAdd,
  onWaypointRefused,
  onWaypointRemove,
  onAvoidedAreaResize,
  onAvoidedAreaRemove,
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
  /**
   * The geometry of each route in the way the user runs it, which the arrows and the distance markers follow.
   * `routes` stays the same when a route is reversed, as it keys the framing; without this, they follow it.
   */
  directedRoutes?: Position[][];
  /** The cells where the server can route: the rest of the map is veiled. None draws no veil. */
  coverage?: CoverageCell[] | undefined;
  /** The language of the labels. */
  language?: Language;
  /** The categories of points of interest to draw, from zoom 11; no tile is asked for while there are none. */
  poiCategories?: PoiCategory[];
  /** Whether seasonal water points are drawn among them. */
  poiSeasonal?: boolean;
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
  /** The waypoints, numbered in this order. Tapping a marker offers to remove it. */
  waypoints?: Position[];
  /** A click or a tap places a waypoint, and a long press no longer sets the start point. */
  placing?: boolean;
  /** The circles routes keep out of, drawn under the routes. */
  avoidedAreas?: AvoidedArea[];
  /** A click or a tap places an area to avoid, and a long press no longer sets the start point. */
  avoiding?: boolean;
  onAvoidedAreaAdd?: (center: Position) => void;
  /** `poi` is given when the tap fell on a point of interest: the waypoint is then at the point. */
  onWaypointAdd?: (waypoint: Position, poi?: WaypointPoi) => void;
  /** A tap fell on the veiled part of the map, where the server cannot route: no waypoint was placed. */
  onWaypointRefused?: () => void;
  /** The user asked to remove the waypoint at this index, from its bubble. */
  onWaypointRemove?: (index: number) => void;
  /** The user asked to remove the avoided area at this index, from its bubble. */
  onAvoidedAreaRemove?: (index: number) => void;
  /** The user set the radius of the avoided area at this index, from its bubble. */
  onAvoidedAreaResize?: (index: number, radius: number) => void;
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
  const languageNow = useEffectEvent(() => language);
  // The label of the point of interest under the pointer.
  const labelRef = useRef<Popup>(undefined);
  // The route set the map has a snapshot of: it draws the routes once it has.
  const drawnFor = useRouteSnapshot({ map: mapRef, loaded, routes, desktop, onSnapshot });
  // Picking the start point on the map comes first: a click then is not on a route.
  const interactive = Boolean(routes?.length) && routesInteractive && !pickOnClick && !(placing || avoiding);
  const view = useRef<MapView>({ bearing: 0, rotated: false, movedAway: false });
  // Tells the app what changed in the view, and only when something did: the map moves many times a second.
  const changeView = useEffectEvent((change: Partial<MapView>) => {
    const next = { ...view.current, ...change };
    if ((Object.keys(next) as (keyof MapView)[]).every((key) => next[key] === view.current[key])) return;
    view.current = next;
    onViewChange?.(next);
  });
  // The veiled part of the map is where the server cannot route: a waypoint there would only be refused.
  const canPlace = useEffectEvent(([lng, lat]: Position) => !coverage || isCovered(coverage, [lng, lat]));
  // What the pointer looks like where nothing else sets it: a crosshair while placing, which says a tap places a waypoint.
  const marking = placing || avoiding;
  const isPlacing = useEffectEvent(() => marking);
  const idleCursor = useEffectEvent(() => (marking ? 'crosshair' : ''));
  const pick = useEffectEvent(
    (
      how: 'long-press' | 'click',
      { lng, lat }: { lng: number; lat: number },
      poi?: { position: Position; poi: WaypointPoi },
    ) => {
      if (avoiding) {
        if (how === 'click') onAvoidedAreaAdd?.([lng, lat]);
        return;
      }
      if (placing) {
        if (how === 'click') {
          const position = poi?.position ?? [lng, lat];
          if (!canPlace(position)) onWaypointRefused?.();
          else if (poi) onWaypointAdd?.(position, poi.poi);
          else onWaypointAdd?.(position);
        }
        return;
      }
      // A tap on a route selects it: it must not move the start point too.
      if (interactive) return;
      if (how === 'long-press' || pickOnClick) onStartChange([lng, lat]);
    },
  );
  const clickedBackground = useEffectEvent(() => {
    if (!pickOnClick && !(placing || avoiding)) onBackgroundClick?.();
  });
  const basemapFailed = useEffectEvent((previous: Basemap) => onBasemapFail?.(previous));
  const selectRoute = useEffectEvent((index: number) => {
    if (interactive) onRouteSelect?.(index);
  });
  const removeWaypoint = useEffectEvent((index: number) => onWaypointRemove?.(index));
  // The bubble that offers to remove a waypoint.
  const bubbleRef = useRef<Popup>(undefined);
  const closeBubble = () => bubbleRef.current?.remove();
  // The bubble over an avoided area: its radius and its removal. Its content is React, so that the slider follows
  // the area as it changes; the popup itself belongs to the map.
  const [areaBubble, setAreaBubble] = useState<{ index: number; host: HTMLElement; button: HTMLElement }>();
  const areaPopup = useRef<Popup>(undefined);
  const closeAreaBubble = useEffectEvent((back = false) => {
    const button = areaBubble?.button;
    areaPopup.current?.remove();
    areaPopup.current = undefined;
    setAreaBubble(undefined);
    // Escape gives the keyboard back to the badge that opened the bubble.
    if (back) button?.focus();
  });
  const openAreaBubble = useEffectEvent((index: number, at: Position, button: HTMLElement) => {
    closeAreaBubble();
    closeBubble();
    const host = document.createElement('div');
    areaPopup.current = new Popup({ closeButton: false, offset: AREA_BUBBLE_OFFSET, className: 'waypoint-bubble' })
      .setLngLat(at)
      .setDOMContent(host)
      .addTo(mapRef.current!);
    setAreaBubble({ index, host, button });
  });
  const toggleAreaBubble = useEffectEvent((index: number, at: Position, button: HTMLElement) => {
    if (areaBubble?.index === index) closeAreaBubble();
    else openAreaBubble(index, at, button);
  });
  // Escape puts the bubble away, as it does a popover, before the view acts on the key.
  useEffect(() => {
    if (!areaBubble) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeAreaBubble(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [areaBubble]); // eslint-disable-line react-hooks/exhaustive-deps -- `closeAreaBubble` is an effect event

  useEffect(() => {
    const map = new Map({
      container: container.current!,
      style: basemapStyle(shownBasemap.current),
      center: [2.5, 46.6],
      zoom: 5,
      attributionControl: false,
      // MapLibre words the names of its controls in English: ours are in the language of the app.
      locale: mapLocale(languageNow()),
      // A flat map: the app draws no relief and no 3D, so a tilt would only skew it.
      maxPitch: 0,
      pitchWithRotate: false,
    });
    // Routes come from OpenStreetMap: credit it from this map on, before any route is drawn.
    // The stylesheet puts it in the bottom left corner, beside the scale.
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
    // MapLibre opens a compact attribution by itself: a credit stays closed until the user asks for it.
    map.getContainer().querySelector<HTMLElement>('.maplibregl-compact-show .maplibregl-ctrl-attrib-button')?.click();
    // The ruler: a bar whose length is a round distance, so a route can be sized up by eye.
    scale.current = new ScaleControl({ unit: 'metric' });
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
      // Under the routes, and no outline: with one, the edges that two covered cells share would show as lines.
      map.addSource('coverage', { type: 'geojson', data: emptyRoutes });
      map.addLayer({
        id: 'coverage-veil',
        type: 'fill',
        source: 'coverage',
        paint: veilPaint(shownBasemap.current),
      });
      // The areas to avoid, over the veil and under the points of interest and the routes.
      map.addSource('avoided-areas', { type: 'geojson', data: emptyRoutes });
      map.addLayer({
        id: 'avoided-areas-fill',
        type: 'fill',
        source: 'avoided-areas',
        paint: { 'fill-color': MAP_COLORS.avoided, 'fill-opacity': ['case', ['get', 'highlighted'], 0.4, 0.22] },
      });
      map.addLayer({
        id: 'avoided-areas-line',
        type: 'line',
        source: 'avoided-areas',
        paint: {
          'line-color': MAP_COLORS.avoided,
          'line-width': ['case', ['get', 'highlighted'], 4, 2],
          'line-dasharray': [2, 2],
        },
      });
      // Above the veil and under the routes. A seasonal point has the reverse badge: it may be dry.
      for (const category of POI_CATEGORIES) {
        for (const seasonal of [false, true]) {
          map.addImage(poiImageId(category, seasonal), poiImage(category, seasonal), { pixelRatio: POI_IMAGE_RATIO });
        }
      }
      map.addSource('pois', { type: 'geojson', data: emptyRoutes });
      for (const category of POI_CATEGORIES) {
        map.addLayer({
          id: poiLayerId(category),
          type: 'symbol',
          source: 'pois',
          minzoom: POI_MIN_ZOOM,
          filter: ['==', ['get', 'category'], category],
          layout: {
            'icon-image': ['case', ['get', 'seasonal'], poiImageId(category, true), poiImageId(category, false)],
            'icon-allow-overlap': true,
          },
        });
      }
      const line = { 'line-join': 'round', 'line-cap': 'round' } as const;
      map.addSource('routes', { type: 'geojson', data: emptyRoutes });
      // The selected route has a white casing, white arrows along its line, and its own colour;
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
      map.addImage('route-arrow', routeArrowImage(), { pixelRatio: ROUTE_ARROW_RATIO });
      map.addLayer({
        id: 'routes-arrows',
        type: 'symbol',
        source: 'routes',
        filter: ['==', ['get', 'selected'], true],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': ROUTE_ARROW_SPACING,
          'icon-image': 'route-arrow',
          // Placed after the badges and the markers above them, an arrow yields to them rather than hiding under
          // a label; and left out of the collisions, it does not push the basemap's labels away.
          'icon-allow-overlap': false,
          'icon-ignore-placement': true,
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
    map.on('mouseleave', 'routes-hit', () => (map.getCanvas().style.cursor = idleCursor()));

    // The label of a point of interest: its name, else what it is. By hover where there is a pointer, and on a tap
    // where there is not. OSM names come from anyone, so they are text, never markup.
    const poiLayers = POI_CATEGORIES.map(poiLayerId);
    const label = labelRef;
    // A rendered feature as a point of interest, and where it sits.
    const poiOf = (feature?: {
      properties?: Record<string, unknown> | null;
      geometry: unknown;
    }): { position: Position; poi: WaypointPoi } | undefined => {
      const { category, seasonal, name } = feature?.properties ?? {};
      if (!isPoiCategory(category)) return undefined;
      const [lon, lat] = (feature!.geometry as { coordinates: number[] }).coordinates;
      return {
        position: [lon!, lat!] as Position,
        poi: {
          category,
          seasonal: Boolean(seasonal),
          ...(typeof name === 'string' && name && { name }),
        },
      };
    };
    const showLabel = ({ features }: { features?: { properties: Record<string, unknown>; geometry: unknown }[] }) => {
      const found = poiOf(features?.[0]);
      if (!found) return;
      label.current?.remove();
      label.current = new Popup({ closeButton: false, offset: 14 })
        .setLngLat(found.position)
        .setText(poiLabel(found.poi, languageNow()))
        .addTo(map);
    };
    for (const layer of poiLayers) {
      map.on('mouseenter', layer, (event) => {
        map.getCanvas().style.cursor = 'pointer';
        showLabel(event as never);
      });
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = idleCursor();
        label.current?.remove();
      });
      // While placing, a tap makes the point a waypoint: its label would only sit over the new pin.
      map.on('click', layer, (event) => !isPlacing() && showLabel(event as never));
    }

    // The point of interest under a tap, when the style has its layers yet.
    const poiAt = (point: MapMouseEvent['point']) => {
      const present = poiLayers.filter((id) => map.getLayer(id));
      return present.length ? poiOf(map.queryRenderedFeatures(point, { layers: present })[0]) : undefined;
    };

    map.on('click', ({ lngLat, point }) => {
      // A tap elsewhere puts the bubble of an area away, as a popover does.
      closeAreaBubble();
      // Only placing makes a point of interest of a tap: otherwise it is a label.
      pick('click', lngLat, isPlacing() ? poiAt(point) : undefined);
      // A route has its own click, on its wide hit line, and a point of interest its label: anywhere else is the
      // background.
      // A style on its way holds none of these layers yet, and asking for a layer that is not there is an error.
      const present = ['routes-hit', ...poiLayers].filter((id) => map.getLayer(id));
      if (!present.length || !map.queryRenderedFeatures(point, { layers: present }).length) clickedBackground();
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
      label.current?.remove();
      bubbleRef.current?.remove();
      areaPopup.current?.remove();
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
    element.className = 'size-4 rounded-full border-4 border-start bg-white shadow-float';
    const marker = new Marker({ element }).setLngLat(start).addTo(mapRef.current!);
    return () => {
      marker.remove();
    };
  }, [start]);

  // A forbidden sign over the veiled part of the map, while placing.
  useEffect(() => {
    const map = mapRef.current!;
    map.getCanvas().style.cursor = idleCursor();
    if (!placing) return;
    const follow = ({ lngLat }: MapMouseEvent) => {
      const cursor = canPlace([lngLat.lng, lngLat.lat]) ? 'crosshair' : 'not-allowed';
      if (map.getCanvas().style.cursor !== cursor) map.getCanvas().style.cursor = cursor;
    };
    map.on('mousemove', follow);
    return () => void map.off('mousemove', follow);
  }, [placing, avoiding]);

  // The waypoints' markers: a button each, which the pins (`WaypointPin`) are drawn into. Tapping one opens a bubble with a
  // button to remove it. The marker's own events stop here, as MapLibre would hear them as the map's: a click that
  // closes the bubble, or adds a waypoint, and a press that starts a long press.
  // A change keeps the markers before the first one that moved, and an open bubble with them.
  // The button of a marker, which brings the focus and the keyboard with it: tapping it opens a bubble with a button to
  // remove what the marker stands for. Its own events stop here, as the map would hear them as its own: a click that
  // adds a point, a press that starts a long press. `bubbleFor` is the waypoint the bubble belongs to, or -1.
  const markerButton = useEffectEvent(
    ({
      label,
      at,
      offset,
      removeLabel,
      onRemove,
      bubbleFor,
    }: {
      label: string;
      at: Position;
      offset: PopupOptions['offset'];
      removeLabel: string;
      onRemove: () => void;
      bubbleFor: number;
    }) => {
      const host = document.createElement('button');
      host.type = 'button';
      host.className = 'block cursor-pointer p-0';
      host.setAttribute('aria-label', label);
      for (const type of ['mousedown', 'touchstart']) host.addEventListener(type, (event) => event.stopPropagation());
      host.addEventListener('click', (event) => {
        event.stopPropagation();
        closeBubble();
        closeAreaBubble();
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = removeLabel;
        remove.className = 'rounded-md px-2 py-1.5 font-semibold text-accent';
        remove.addEventListener('click', () => {
          closeBubble();
          onRemove();
        });
        bubbleRef.current = new Popup({ closeButton: false, offset, className: 'waypoint-bubble' })
          .setLngLat(at)
          .setDOMContent(remove)
          .addTo(mapRef.current!);
        bubbleOn.current = bubbleFor;
      });
      return host;
    },
  );
  const [pinHosts, setPinHosts] = useState<HTMLElement[]>([]);
  const placed = useRef<{ marker: Marker; host: HTMLElement; waypoint: Position }[]>([]);
  const placedIn = useRef(language);
  const bubbleOn = useRef(-1);
  // Kept here, not in the app: pointing at a row must not draw the whole view again.
  const [highlightedWaypoint, setHighlightedWaypoint] = useState<number>();
  const [highlightedArea, setHighlightedArea] = useState<number>();
  useEffect(() => {
    const map = mapRef.current!;
    let keep = 0;
    if (placedIn.current === language) {
      while (
        keep < placed.current.length &&
        samePositions([placed.current[keep]!.waypoint], waypoints.slice(keep, keep + 1))
      ) {
        keep++;
      }
    }
    placedIn.current = language;
    for (const { marker } of placed.current.splice(keep)) marker.remove();
    if (bubbleOn.current >= keep) closeBubble();
    for (const [index, waypoint] of waypoints.slice(keep).entries()) {
      const number = keep + index + 1;
      const host = markerButton({
        label: criteriaText[language].waypointName(number),
        at: waypoint,
        offset: PIN_BUBBLE_OFFSET,
        removeLabel: criteriaText[language].removeWaypoint,
        onRemove: () => removeWaypoint(number - 1),
        bubbleFor: number - 1,
      });
      host.dataset.waypoint = String(number);
      placed.current.push({
        marker: new Marker({ element: host, anchor: 'bottom' }).setLngLat(waypoint).addTo(map),
        host,
        waypoint,
      });
    }
    setPinHosts(placed.current.map(({ host }) => host));
  }, [waypoints, language]);
  // The number of each avoided area, at the centre of its circle. A marker moves with its circle, which a resize leaves
  // where it is: the markers are made again only when a centre changes.
  const [areaHosts, setAreaHosts] = useState<HTMLElement[]>([]);
  const centres = avoidedAreas.map(({ center }) => center.join(','));
  useEffect(() => {
    const map = mapRef.current!;
    const markers = avoidedAreas.map(({ center }, index) => {
      const host = document.createElement('button');
      host.type = 'button';
      // The badge is a target on a phone too: the padding gives it the size of a touch.
      host.dataset.area = String(index + 1);
      host.dataset.testid = 'criteria-avoided-marker';
      host.className = 'grid cursor-pointer place-items-center p-2.5';
      host.setAttribute('aria-label', criteriaText[language].avoidedAreaName(index + 1));
      for (const type of ['mousedown', 'touchstart']) host.addEventListener(type, (event) => event.stopPropagation());
      host.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleAreaBubble(index, center, host);
      });
      return { host, marker: new Marker({ element: host }).setLngLat(center).addTo(map) };
    });
    setAreaHosts(markers.map(({ host }) => host));
    return () => {
      closeAreaBubble();
      markers.forEach(({ marker }) => marker.remove());
    };
  }, [centres.join(';'), language]); // eslint-disable-line react-hooks/exhaustive-deps -- `avoidedAreas` changes with every resize
  // The pin set apart goes over the ones around it.
  useEffect(() => {
    for (const [index, { host }] of placed.current.entries()) {
      host.style.zIndex = index === highlightedWaypoint ? '1' : '';
    }
  }, [highlightedWaypoint, pinHosts]);
  // Gone with the map.
  useEffect(
    () => () => {
      closeBubble();
      for (const { marker } of placed.current.splice(0)) marker.remove();
    },
    [],
  );

  useEffect(() => {
    if (focus) mapRef.current!.easeTo({ center: focus, zoom: 14 });
  }, [focus]);

  // Once the style has loaded, which holds the layers the routes are drawn in: a new style has none until
  // it loads, and the routes are drawn again then.
  useEffect(() => {
    const source = mapRef.current?.getSource('routes') as GeoJSONSource | undefined;
    if (!loaded || !source) return;
    const features = (drawnFor === routes ? (directedRoutes ?? routes ?? []) : [])
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
  }, [loaded, routes, directedRoutes, selectedRoute, framing, drawnFor, styleVersion]);

  // The veil covers what no cell does; a new style drops it, so it is set again.
  useEffect(() => {
    const source = mapRef.current?.getSource('coverage') as GeoJSONSource | undefined;
    if (!loaded || !source) return;
    source.setData(coverage?.length ? veilPolygon(coverage) : emptyRoutes);
  }, [loaded, coverage, styleVersion]);

  // The areas to avoid, drawn as circles; a new style drops them, so they are set again.
  useEffect(() => {
    const source = mapRef.current?.getSource('avoided-areas') as GeoJSONSource | undefined;
    if (!loaded || !source) return;
    source.setData({
      type: 'FeatureCollection',
      features: avoidedAreas.map((area, index) => ({
        type: 'Feature' as const,
        properties: { highlighted: index === highlightedArea },
        geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(area)] },
      })),
    });
  }, [loaded, avoidedAreas, highlightedArea, styleVersion]);

  // The points of interest in view: the tiles of the view are asked for only from zoom 11 and while a category is on,
  // since a tile says which ~30 km the user looks at. A view that moved on meanwhile drops the late answer.
  const categoriesKey = poiCategories.join();
  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource('pois') as GeoJSONSource | undefined;
    if (!map || !loaded || !source) return;
    // The point it names may be gone with the new data, and a pointer leaving a point that is gone is never heard.
    labelRef.current?.remove();
    const categories = categoriesKey ? (categoriesKey.split(',') as PoiCategory[]) : [];
    if (categories.length === 0 || map.getZoom() < POI_MIN_ZOOM) {
      source.setData(emptyRoutes);
      return;
    }
    let current = true;
    const [[west, south], [east, north]] = map.getBounds().toArray();
    void Promise.all(poiTilesCovering([west!, south!, east!, north!]).map(([x, y]) => requestPoiTile(x, y))).then(
      (tiles) => {
        if (!current) return;
        const features = tiles
          .flat()
          .filter(({ category, seasonal }) => categories.includes(category) && (poiSeasonal || !seasonal))
          .map(({ category, position, seasonal, name }) => ({
            type: 'Feature' as const,
            geometry: point(position),
            properties: { category, seasonal, ...(name && { name }) },
          }));
        source.setData({ type: 'FeatureCollection', features });
      },
    );
    return () => {
      current = false;
    };
  }, [loaded, categoriesKey, poiSeasonal, viewVersion, styleVersion]);

  // MapLibre names its controls once, when it draws them: a language picked since is applied by hand.
  useEffect(() => {
    const map = mapRef.current!;
    const { mapName, toggleAttribution } = commonText[language];
    map.getCanvas().setAttribute('aria-label', mapName);
    for (const toggle of map.getContainer().querySelectorAll('.maplibregl-ctrl-attrib-button')) {
      toggle.setAttribute('aria-label', toggleAttribution);
      // The tooltip of the app replaces MapLibre's native one.
      toggle.removeAttribute('title');
      Object.assign((toggle as HTMLElement).dataset, { tip: toggleAttribution, tipSide: 'top-start' });
    }
  }, [language]);

  // Drawn with the routes, so that the thumbnails' snapshot, taken without them, has no label either.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map?.getSource('route-badges')) return;
    const drawn = drawnFor === routes ? (directedRoutes ?? routes ?? []) : [];
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
          const label = summary ? [formatDistance(summary.distance, language)] : [];
          if (summary?.elevationGain !== undefined) label.push(`+${formatHeight(summary.elevationGain, language)}`);
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
    // The route with markers: the one of the open detail, or the one a desktop marks while it shows the others.
    const marked = detail ? selectedRoute : markedRoute;
    const summary = marked === undefined ? undefined : summaries?.[marked];
    const geometry = marked === undefined ? undefined : drawn[marked];
    const interval = summary && markerInterval(summary.distance);
    const markerArea = freeArea(map, desktop, sheetHeight, space, [MARKER_HALF, MARKER_HALF]);
    const markers =
      geometry && interval
        ? distanceMarkers(geometry, interval)
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
    directedRoutes,
    summaries,
    language,
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
    centerOn: (center) => mapRef.current?.easeTo({ center }),
    highlightWaypoint: setHighlightedWaypoint,
    highlightArea: setHighlightedArea,
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

  // The basemap stays light in dark mode (see index.css). MapLibre makes its container `position: relative`
  // from outside Tailwind's layers, so a wrapper pins it to the screen.
  return (
    <div className={`fixed inset-0 bg-white ${pickOnClick ? 'map-picking' : ''}`}>
      <div ref={container} className="size-full" />
      {areaHosts.map((host, index) =>
        createPortal(
          <AvoidedAreaBadge number={index + 1} highlighted={index === highlightedArea} />,
          host,
          `area-${index}`,
        ),
      )}
      {pinHosts.map((host, index) =>
        createPortal(
          <WaypointPin number={index + 1} variant="map" highlighted={index === highlightedWaypoint} />,
          host,
          index,
        ),
      )}
      {areaBubble &&
        avoidedAreas[areaBubble.index] &&
        createPortal(
          <AvoidedAreaBubble
            language={language}
            index={areaBubble.index}
            area={avoidedAreas[areaBubble.index]}
            onResize={(radius) => onAvoidedAreaResize?.(areaBubble.index, radius)}
            onRemove={() => onAvoidedAreaRemove?.(areaBubble.index)}
          />,
          areaBubble.host,
          'area-bubble',
        )}
    </div>
  );
}

/** The bubble over an avoided area: its radius, and the button that takes it off the map. */
function AvoidedAreaBubble({
  language,
  index,
  area,
  onResize,
  onRemove,
}: {
  language: Language;
  index: number;
  area: AvoidedArea;
  onResize: (radius: number) => void;
  onRemove: () => void;
}) {
  const t = criteriaText[language];
  const name = t.avoidedAreaName(index + 1);
  const root = useRef<HTMLDivElement>(null);
  // A keyboard or a screen reader lands on the radius at once: it is why the bubble is here.
  useEffect(() => {
    root.current?.querySelector<HTMLInputElement>('input[type="range"]')?.focus();
  }, []);
  return (
    <div ref={root} className="flex w-60 flex-col px-2 pt-2 pb-0">
      <div className="flex items-center gap-2 px-2 pb-1 text-sm font-semibold text-ink-2">
        <AvoidedAreaBadge number={index + 1} />
        {name}
      </div>
      <Slider
        language={language}
        testId="criteria-avoided-radius"
        label={t.avoidedAreaRadiusOf(name)}
        value={area.radius}
        shown={t.avoidedAreaRadius(area.radius)}
        align="center"
        compact
        min={AVOIDED_AREA_RADIUS.min}
        max={AVOIDED_AREA_RADIUS.max}
        step={AVOIDED_RADIUS_STEP}
        onChange={onResize}
      />
      <button
        type="button"
        data-testid="criteria-avoided-bubble-remove"
        className="rounded-md px-2 py-1.5 font-semibold text-accent"
        onClick={onRemove}
      >
        {t.removeAvoidedArea}
      </button>
    </div>
  );
}
