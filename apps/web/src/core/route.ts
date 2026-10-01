import type { Criteria, Miss, SurfaceStretch } from '../../../api/src/contract.ts';
import { routesText } from '../i18n/index.ts';
import type { Activity } from './activity.ts';
import type { Position } from './coordinates.ts';
import { formatHeight, type Display } from './units.ts';

/** The body of a route set request: the criteria and the activity, as `parseCriteria` accepts them. */
export type RouteSetRequest = Criteria & { activity: Activity };

/**
 * A route of a route set as the API sends it: longitude, latitude, and height in metres on every
 * point, or no heights and no elevation gain when the API has no BD ALTI.
 */
export type Route = {
  geometry: [number, number, number][] | [number, number][];
  /** Kilometres. */
  distance: number;
  /** Metres. */
  elevationGain?: number;
  /** Minutes. */
  estimatedDuration: number;
  kind: 'match' | 'suggestion';
  /** Each criterion a suggestion misses, with its gap in the criterion's unit. */
  misses: Miss[];
  unpavedShare: number;
  surfaces: SurfaceStretch[];
};

/** A sample of the elevation profile: kilometres from the start, and the height there in metres. */
export type ProfilePoint = { distance: number; height: number };

/** Uphill grade classes, from gentle (1) to very steep (4), as the `slope-*` colours. */
export type SlopeClass = 1 | 2 | 3 | 4;

// Kilometres between profile samples: adjacent route points can be a few metres apart, and their
// heights to the decimetre would make noisy grades.
const PROFILE_STEP = 0.05;
// Below this target, in metres, a gap in elevation gain reads better in metres than as a share.
const MIN_SHARED_ELEVATION_GAIN = 100;

const MISS_CRITERIA: Miss['criterion'][] = ['distance', 'duration', 'elevationGain'];
const SURFACES: SurfaceStretch['surface'][] = ['paved', 'unpaved'];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPoint = (value: unknown): value is number[] =>
  Array.isArray(value) && (value.length === 2 || value.length === 3) && value.every(isNumber);

function parseRoute(value: unknown): Route | undefined {
  if (!isObject(value)) return undefined;
  const { geometry, distance, elevationGain, estimatedDuration, kind, misses, unpavedShare, surfaces } = value;
  if (!Array.isArray(geometry) || !geometry.every(isPoint)) return undefined;
  if (!isNumber(distance) || !isNumber(estimatedDuration) || !isNumber(unpavedShare)) return undefined;
  if (elevationGain !== undefined && !isNumber(elevationGain)) return undefined;
  if (kind !== 'match' && kind !== 'suggestion') return undefined;
  const validMisses =
    Array.isArray(misses) &&
    misses.every(
      (miss) => isObject(miss) && MISS_CRITERIA.includes(miss.criterion as Miss['criterion']) && isNumber(miss.gap),
    );
  const validSurfaces =
    Array.isArray(surfaces) &&
    surfaces.every(
      (stretch) =>
        isObject(stretch) && SURFACES.includes(stretch.surface as SurfaceStretch['surface']) && isNumber(stretch.share),
    );
  if (!validMisses || !validSurfaces) return undefined;
  return {
    geometry: geometry as Route['geometry'],
    distance,
    ...(elevationGain !== undefined && { elevationGain }),
    estimatedDuration,
    kind,
    misses: (misses as Miss[]).map(({ criterion, gap }) => ({ criterion, gap })),
    unpavedShare,
    surfaces: (surfaces as SurfaceStretch[]).map(({ surface, share }) => ({ surface, share })),
  };
}

/** The routes of a route set answer, or undefined when the answer is not one. */
export function parseRoutes(body: unknown): Route[] | undefined {
  if (!isObject(body) || !Array.isArray(body.routes)) return undefined;
  const routes = body.routes.map(parseRoute);
  return routes.every((route) => route !== undefined) ? routes : undefined;
}

// Kilometres between two positions, on a local equirectangular projection: close enough along a route.
function kmBetween([lonA, latA]: number[], [lonB, latB]: number[]): number {
  const cos = Math.cos((((latA + latB) / 2) * Math.PI) / 180);
  return Math.hypot((lonB - lonA) * cos, latB - latA) * 111.195;
}

// Kilometres from the start to each point.
function distancesAlong(geometry: number[][]): number[] {
  const distances = [0];
  for (let k = 1; k < geometry.length; k++) distances.push(distances[k - 1] + kmBetween(geometry[k - 1], geometry[k]));
  return distances;
}

// Where `distance` falls between two points: the index of the first one, and how far towards the next (0 to 1).
function locate(distances: number[], distance: number): [number, number] {
  const last = distances.length - 1;
  if (distance <= 0 || last === 0) return [0, 0];
  if (distance >= distances[last]) return [last, 0];
  let k = 0;
  while (distances[k + 1] < distance) k++;
  const span = distances[k + 1] - distances[k];
  return [k, span ? (distance - distances[k]) / span : 0];
}

/**
 * The heights along a route every 50 m from its start, and at its end, or undefined when the route
 * has no heights.
 */
export function elevationProfile(geometry: Route['geometry']): ProfilePoint[] | undefined {
  if (geometry.length === 0 || geometry[0].length < 3) return undefined;
  const points = geometry as [number, number, number][];
  const distances = distancesAlong(points);
  const total = distances.at(-1)!;
  const heightAt = (distance: number) => {
    const [k, t] = locate(distances, distance);
    return t ? points[k][2] + t * (points[k + 1][2] - points[k][2]) : points[k][2];
  };
  const profile: ProfilePoint[] = [];
  // A sample a few metres before the end would only repeat it.
  for (let step = 0; step * PROFILE_STEP < total - PROFILE_STEP / 10; step++) {
    const distance = step * PROFILE_STEP;
    profile.push({ distance, height: heightAt(distance) });
  }
  profile.push({ distance: total, height: points.at(-1)![2] });
  return profile;
}

/** The class of an uphill grade in percent: < 3 %, 3–6 %, 6–10 %, > 10 %. Downhill is gentle. */
export function slopeClass(grade: number): SlopeClass {
  if (grade < 3) return 1;
  if (grade < 6) return 2;
  return grade <= 10 ? 3 : 4;
}

/** The position `distance` kilometres along the route from its start, kept on the route. */
export function positionAt(geometry: Route['geometry'], distance: number): Position {
  const [k, t] = locate(distancesAlong(geometry), distance);
  if (!t) return [geometry[k][0], geometry[k][1]];
  const [lonA, latA] = geometry[k];
  const [lonB, latB] = geometry[k + 1];
  return [lonA + t * (lonB - lonA), latA + t * (latB - latA)];
}

/**
 * A missed criterion of a suggestion as the user reads it, such as "+30% elevation gain": its gap
 * as a share of the target, or in metres or feet for a small target elevation gain.
 */
export function missText({ criterion, gap }: Miss, route: Route, display: Display): string {
  const value = { distance: route.distance, duration: route.estimatedDuration, elevationGain: route.elevationGain }[
    criterion
  ];
  // The route's value minus the gap gives the target, also for the flat and hilly bounds.
  const target = (value ?? 0) - gap;
  const { language } = display;
  const words = routesText[language].misses[criterion];
  if (criterion === 'elevationGain' && target < MIN_SHARED_ELEVATION_GAIN) {
    return `${gap < 0 ? '-' : '+'}${formatHeight(Math.abs(gap), display)} ${words}`;
  }
  const share = new Intl.NumberFormat(language, { style: 'percent', signDisplay: 'always' }).format(gap / target);
  return `${share} ${words}`;
}

// Radius of the sphere of Web Mercator (EPSG:3857), the projection of the map, in metres.
const MERCATOR_RADIUS = 6_378_137;
// Metres a box spans for a route of a single place.
const MIN_SPAN = 1_000;

/** The corners of a box in Web Mercator metres: west, south, east, north. */
export type MercatorBounds = [number, number, number, number];

/** A position in Web Mercator metres, the projection of the map. */
export function toMercator([lon, lat]: Position): [number, number] {
  return [
    (lon * Math.PI * MERCATOR_RADIUS) / 180,
    MERCATOR_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
  ];
}

/**
 * What the map showed when it framed a route set, kept as an image on the device to draw route
 * thumbnails over: nothing is fetched to make them. `toPixel` gives where a Web Mercator position
 * lies in the image, in CSS pixels, and `of` is the geometries of the route set it shows.
 */
export type MapSnapshot = {
  url: string;
  width: number;
  height: number;
  toPixel: (mercator: [number, number]) => [number, number];
  of: Position[][];
};

/**
 * A route drawn in a `width` by `height` box as it lies on the map, in Web Mercator with north up:
 * scaled to fit, centred, and `margin` from the edges. Also returns the area the whole box covers
 * on the map, to fetch a background that matches.
 */
export function projectRoute(
  geometry: Route['geometry'],
  { width, height, margin }: { width: number; height: number; margin: number },
): { points: [number, number][]; bounds: MercatorBounds } {
  const mercator = geometry.map(([lon, lat]) => toMercator([lon, lat]));
  const xs = mercator.map(([x]) => x);
  const ys = mercator.map(([, y]) => y);
  const [west, east, south, north] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [spanX, spanY] = [east - west, north - south];
  // A route along one axis fits by the other axis alone; a single place gets a fixed span.
  const scale =
    Math.min(spanX ? (width - 2 * margin) / spanX : Infinity, spanY ? (height - 2 * margin) / spanY : Infinity) ||
    Infinity;
  const pixelsPerMetre = Number.isFinite(scale) ? scale : (Math.min(width, height) - 2 * margin) / MIN_SPAN;
  const [offsetX, offsetY] = [(width - spanX * pixelsPerMetre) / 2, (height - spanY * pixelsPerMetre) / 2];
  const points = geometry.map((_, k): [number, number] => [
    offsetX + (xs[k] - west) * pixelsPerMetre,
    offsetY + (north - ys[k]) * pixelsPerMetre,
  ]);
  const bounds: MercatorBounds = [
    west - offsetX / pixelsPerMetre,
    south - (height - offsetY - spanY * pixelsPerMetre) / pixelsPerMetre,
    east + (width - offsetX - spanX * pixelsPerMetre) / pixelsPerMetre,
    north + offsetY / pixelsPerMetre,
  ];
  return { points, bounds };
}
