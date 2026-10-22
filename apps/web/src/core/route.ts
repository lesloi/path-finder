import { METRES_PER_DEGREE, type Criteria, type SurfaceStretch, type TechnicalStretch } from '../contract/index.ts';
import type { Position } from './coordinates.ts';
import { distancesAlong, kmBetween } from './distance.ts';
import { effortAlong } from './effort.ts';
import { estimatedDuration } from './pace.ts';

/** The body of a route set request: the criteria, as `parseCriteria` accepts them. */
export type RouteSetRequest = Criteria;

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
  /** Metres, sampled as the elevation gain is. */
  elevationLoss?: number;
  /** Minutes. */
  estimatedDuration: number;
  kind: 'match' | 'suggestion';
  unpavedShare: number;
  surfaces: SurfaceStretch[];
  /** Holds a technical stretch: a way where the hands, ropes or chains are needed. */
  technical: boolean;
  /** Where they are along the route, in order. */
  technicalStretches: TechnicalStretch[];
  /** A track the user loaded from a GPX file: nothing is known of its surfaces or its technical stretches. */
  imported?: { name?: string };
  /** Set once the user runs the route the other way: its waypoints are met from the last to the first. */
  reversed?: true;
};

/** A sample of the elevation profile: kilometres from the start, and the height there in metres. */
export type ProfilePoint = { distance: number; height: number };

// Kilometres between profile samples: adjacent route points can be a few metres apart, and their
// heights to the decimetre would make noisy grades.
const PROFILE_STEP = 0.05;

const SURFACES: SurfaceStretch['surface'][] = ['paved', 'unpaved'];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPoint = (value: unknown): value is number[] =>
  Array.isArray(value) && (value.length === 2 || value.length === 3) && value.every(isNumber);

function parseRoute(value: unknown): Route | undefined {
  if (!isObject(value)) return undefined;
  const {
    geometry,
    distance,
    elevationGain,
    elevationLoss,
    estimatedDuration,
    kind,
    unpavedShare,
    surfaces,
    technical,
    technicalStretches,
  } = value;
  if (!Array.isArray(geometry) || !geometry.every(isPoint)) return undefined;
  if (!isNumber(distance) || !isNumber(estimatedDuration) || !isNumber(unpavedShare)) return undefined;
  if (elevationGain !== undefined && !isNumber(elevationGain)) return undefined;
  if (elevationLoss !== undefined && !isNumber(elevationLoss)) return undefined;
  if (kind !== 'match' && kind !== 'suggestion') return undefined;
  if (typeof technical !== 'boolean') return undefined;
  const validSurfaces =
    Array.isArray(surfaces) &&
    surfaces.every(
      (stretch) =>
        isObject(stretch) &&
        SURFACES.includes(stretch.surface as SurfaceStretch['surface']) &&
        isNumber(stretch.from) &&
        isNumber(stretch.to),
    );
  if (!validSurfaces) return undefined;
  const validTechnical =
    Array.isArray(technicalStretches) &&
    technicalStretches.every((stretch) => isObject(stretch) && isNumber(stretch.from) && isNumber(stretch.to));
  if (!validTechnical) return undefined;
  return {
    geometry: geometry as Route['geometry'],
    distance,
    ...(elevationGain !== undefined && { elevationGain }),
    ...(elevationLoss !== undefined && { elevationLoss }),
    estimatedDuration,
    kind,
    unpavedShare,
    surfaces: (surfaces as SurfaceStretch[]).map(({ surface, from, to }) => ({ surface, from, to })),
    technical,
    technicalStretches: (technicalStretches as TechnicalStretch[]).map(({ from, to }) => ({ from, to })),
  };
}

/** The routes of a route set answer, or undefined when the answer is not one. */
export function parseRoutes(body: unknown): Route[] | undefined {
  if (!isObject(body) || !Array.isArray(body.routes)) return undefined;
  const routes = body.routes.map(parseRoute);
  return routes.every((route) => route !== undefined) ? routes : undefined;
}

/**
 * How far a position is from the route, in metres, and where along it the nearest spot is, as the index of a
 * point plus how far towards the next (so it sorts along the route). Measured to the segments, since a leg of a
 * route can be longer than the distances that matter. Beyond `reach` metres the distance is left as Infinity,
 * which spares the projection of every segment that is clearly too far.
 */
export function nearestOnRoute(
  geometry: number[][],
  [lon, lat]: number[],
  reach = Infinity,
): { metres: number; along: number } {
  const cos = Math.cos((lat * Math.PI) / 180);
  const degrees = reach / METRES_PER_DEGREE;
  let [metres, along] = [Infinity, 0];
  let [ax, ay] = [(geometry[0][0] - lon) * cos, geometry[0][1] - lat];
  for (let k = 1; k < geometry.length; k++) {
    const [bx, by] = [(geometry[k][0] - lon) * cos, geometry[k][1] - lat];
    const far =
      (ax > degrees && bx > degrees) ||
      (ax < -degrees && bx < -degrees) ||
      (ay > degrees && by > degrees) ||
      (ay < -degrees && by < -degrees);
    if (!far) {
      const [dx, dy] = [bx - ax, by - ay];
      const span = dx * dx + dy * dy;
      const t = span ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / span)) : 0;
      const distance = Math.hypot(ax + t * dx, ay + t * dy) * METRES_PER_DEGREE;
      if (distance < metres && distance <= reach) [metres, along] = [distance, k - 1 + t];
    }
    [ax, ay] = [bx, by];
  }
  return { metres, along };
}

/** West, south, east and north of a route and a margin around it, in metres. */
export function boundsAround(geometry: number[][], margin: number): [number, number, number, number] {
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of geometry) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  const dLat = margin / METRES_PER_DEGREE;
  const dLon = dLat / Math.cos((Math.max(Math.abs(south), Math.abs(north)) * Math.PI) / 180);
  return [west - dLon, south - dLat, east + dLon, north + dLat];
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

/**
 * The grade in percent of the profile at `fraction` (0 to 1) of the route: between the two samples
 * around it, 50 m apart. Positive uphill.
 */
export function gradeAt(profile: ProfilePoint[], fraction: number): number {
  const last = profile.length - 1;
  if (last < 1) return 0;
  const from = Math.min(Math.floor(fraction * last), last - 1);
  const [a, b] = [profile[from], profile[from + 1]];
  return b.distance === a.distance ? 0 : ((b.height - a.height) / ((b.distance - a.distance) * 1000)) * 100;
}

/** The surface of the route `distance` kilometres along it, from its stretches in order. */
export function surfaceAt(surfaces: SurfaceStretch[], distance: number): SurfaceStretch['surface'] {
  const stretch = surfaces.find(({ to }) => distance <= to) ?? surfaces.at(-1);
  return stretch?.surface ?? 'paved';
}

// The position `distance` kilometres along a route whose distances along are known.
function positionAlong(geometry: number[][], distances: number[], distance: number): Position {
  const [k, t] = locate(distances, distance);
  if (!t) return [geometry[k][0], geometry[k][1]];
  const [lonA, latA] = geometry[k];
  const [lonB, latB] = geometry[k + 1];
  return [lonA + t * (lonB - lonA), latA + t * (latB - latA)];
}

/** The position `distance` kilometres along the route from its start, kept on the route. */
export function positionAt(geometry: Route['geometry'], distance: number): Position {
  return positionAlong(geometry, distancesAlong(geometry), distance);
}

/** A waypoint as the route passes it, numbered as on the map. */
export type WaypointOnRoute = {
  /** From 1, in the order placed. */
  number: number;
  /** Kilometres from the start. */
  distance: number;
  /** Where the route passes it, which may be a little off the point placed: the API moved it to a way. */
  position: Position;
  /** Metres, when the route has heights. */
  height?: number;
};

// The index of the point of the route nearest to each waypoint, looked for after the one found for the previous
// waypoint, so that waypoints keep their order on a route that goes by the same place twice.
function nearestIndexes(geometry: Route['geometry'], waypoints: Position[], reversed = false): number[] {
  // A route run the other way meets the last waypoint first.
  if (reversed) return nearestIndexes(geometry, [...waypoints].reverse()).reverse();
  let from = 0;
  return waypoints.map((waypoint) => {
    let nearest = Math.min(from, geometry.length - 1);
    let best = kmBetween(geometry[nearest], waypoint);
    for (let j = nearest + 1; j < geometry.length; j++) {
      const km = kmBetween(geometry[j], waypoint);
      if (km < best) [nearest, best] = [j, km];
    }
    from = nearest + 1;
    return nearest;
  });
}

/** Where a route passes each waypoint: the point of the route nearest to it, the waypoints keeping their order. */
export function waypointsOnRoute(
  geometry: Route['geometry'],
  waypoints: Position[],
  reversed = false,
): WaypointOnRoute[] {
  if (geometry.length === 0) return [];
  const distances = distancesAlong(geometry);
  return nearestIndexes(geometry, waypoints, reversed).map((index, k) => {
    const [lon, lat, height] = geometry[index] as [number, number, number?];
    return {
      number: k + 1,
      distance: distances[index],
      position: [lon, lat],
      ...(height !== undefined && { height }),
    };
  });
}

/** A stop of the route's timeline: its start, a waypoint as the route passes it, its highest or lowest point, or its finish. */
export type TimelineStep = {
  kind: 'start' | 'waypoint' | 'summit' | 'lowest' | 'finish';
  /** The waypoint's number, from 1, as on the map. */
  number?: number;
  /** Kilometres from the start. */
  distance: number;
  /** Metres, when the route has heights. */
  height?: number;
  /** Minutes since the start: the estimated duration shared out by the effort so far. */
  elapsed: number;
  /** The stretch from the previous stop to this one. The start has none. The legs add up to the route's figures. */
  leg?: { distance: number; /** Minutes. */ duration: number; climb?: number; descent?: number };
};

// The dead band of the API's count of the climb and the descent, in metres: copied here, as the API sends no figure for
// each stretch. `endedOn` makes up for any drift.
const DEAD_BAND = 2;

// The climb and the descent up to each of the points at `wanted` (ascending indexes), counted on the same heights as
// the API does.
function climbsAndDescentsAt(points: number[][], wanted: number[]): { climbs: number[]; descents: number[] } {
  let [up, down, ref] = [0, 0, points[0][2]];
  const climbs: number[] = [];
  const descents: number[] = [];
  let next = 0;
  for (let k = 0; next < wanted.length && k < points.length; k++) {
    const z = points[k][2];
    if (Math.abs(z - ref) >= DEAD_BAND) {
      if (z > ref) up += z - ref;
      else down += ref - z;
      ref = z;
    }
    for (; wanted[next] === k; next++) {
      climbs.push(up);
      descents.push(down);
    }
  }
  return { climbs, descents };
}

/** The climb and the descent in metres of a profile, counted as the API counts them. */
export function climbAndDescent(profile: ProfilePoint[]): { climb: number; descent: number } {
  const { climbs, descents } = climbsAndDescentsAt(
    profile.map(({ height }) => [0, 0, height]),
    [profile.length - 1],
  );
  return { climb: climbs[0]!, descent: descents[0]! };
}

// The totals at each stop, scaled so that the last is the API's figure: the sum over the points can only approach it,
// and the descent, which the API counts backwards, is not the one counted forwards. Its gap is spread over the legs
// rather than put on the last, unless nothing was counted to spread it over.
function endedOn(counted: number[], total: number | undefined): number[] {
  const last = counted.length - 1;
  if (total === undefined) return counted;
  if (counted[last] === 0) return counted.map((value, i) => (i === last ? total : value));
  return counted.map((value) => (value * total) / counted[last]!);
}

// A highest or lowest point that is less than this above or below both the start and the finish is not worth a stop.
const EXTREME_MIN_GAP = 20;

// The index of the highest point (`sign` 1) or the lowest (-1), or undefined when it is the start or the finish or is
// not far enough from them.
function extremeIndex(points: number[][], sign: 1 | -1): number | undefined {
  let best = 0;
  for (let k = 1; k < points.length; k++) if (sign * points[k][2] > sign * points[best][2]) best = k;
  const ends = sign === 1 ? Math.max(points[0][2], points.at(-1)![2]) : Math.min(points[0][2], points.at(-1)![2]);
  return best === 0 || best === points.length - 1 || sign * (points[best][2] - ends) < EXTREME_MIN_GAP
    ? undefined
    : best;
}

/**
 * The start, the waypoints in order and the finish of a route, each with the distance, height and time since the
 * start, and the leg that ends there. The highest and lowest points of the route join them when they stand out
 * from the start and the finish.
 */
export function routeTimeline(route: Route, waypoints: Position[]): TimelineStep[] {
  const { geometry } = route;
  if (geometry.length === 0) return [];
  const distances = distancesAlong(geometry);
  const hasHeights = geometry[0].length >= 3;
  const stopsAlong: [TimelineStep['kind'], number, number?][] = nearestIndexes(geometry, waypoints, route.reversed).map(
    (index, k) => ['waypoint', index, k + 1],
  );
  if (hasHeights) {
    const extremes: [TimelineStep['kind'], number | undefined][] = [
      ['summit', extremeIndex(geometry, 1)],
      ['lowest', extremeIndex(geometry, -1)],
    ];
    // Not where a waypoint already stands: it says as much.
    for (const [kind, index] of extremes) {
      if (index !== undefined && !stopsAlong.some(([, k]) => k === index)) stopsAlong.push([kind, index]);
    }
  }
  // Waypoints are already in the order of the route, and the sort keeps it.
  const indexes: [TimelineStep['kind'], number, number?][] = [
    ['start', 0],
    ...stopsAlong.sort(([, a], [, b]) => a - b),
    ['finish', geometry.length - 1],
  ];

  const counted = hasHeights
    ? climbsAndDescentsAt(
        geometry,
        indexes.map(([, k]) => k),
      )
    : undefined;
  const climbs = counted && endedOn(counted.climbs, route.elevationGain);
  const descents = counted && endedOn(counted.descents, route.elevationLoss);
  const effort = effortAlong(geometry, distances);
  const total = effort.at(-1)!;

  const stops = indexes.map(([kind, k, number]): TimelineStep => {
    const height = (geometry[k] as [number, number, number?])[2];
    return {
      kind,
      ...(number !== undefined && { number }),
      distance: distances[k],
      ...(height !== undefined && { height }),
      // The share first, so that the finish is exactly the estimated duration.
      elapsed: total > 0 ? (effort[k]! / total) * route.estimatedDuration : 0,
    };
  });
  return stops.map((stop, i) => {
    if (i === 0) return stop;
    const leg: NonNullable<TimelineStep['leg']> = {
      distance: stop.distance - stops[i - 1]!.distance,
      duration: stop.elapsed - stops[i - 1]!.elapsed,
    };
    if (climbs && descents) {
      leg.climb = climbs[i]! - climbs[i - 1]!;
      leg.descent = descents[i]! - descents[i - 1]!;
    }
    return { ...stop, leg };
  });
}

/**
 * The route run the other way, as the user asks to: the same ways from the finish back to the start, with the climb and
 * the descent swapped. The duration is estimated again at `pace`.
 * Reversing twice gives the route back.
 */
export function reverseRoute(route: Route, pace: number): Route {
  const { reversed, elevationGain, elevationLoss, surfaces, technicalStretches, ...rest } = route;
  const total = surfaces.at(-1)?.to ?? route.distance;
  const mirror = ({ from, to }: TechnicalStretch) => ({ from: total - to, to: total - from });
  const turned: Route = {
    ...rest,
    geometry: [...route.geometry].reverse() as Route['geometry'],
    surfaces: surfaces.map((stretch) => ({ surface: stretch.surface, ...mirror(stretch) })).reverse(),
    technicalStretches: technicalStretches.map(mirror).reverse(),
    ...(elevationLoss !== undefined && { elevationGain: elevationLoss }),
    ...(elevationGain !== undefined && { elevationLoss: elevationGain }),
    ...(!reversed && { reversed: true as const }),
  };
  turned.estimatedDuration = estimatedDuration(turned, pace);
  return turned;
}

/** The position halfway along the route: the far side of a loop. */
export function midpoint(geometry: Route['geometry']): Position {
  const distances = distancesAlong(geometry);
  return positionAlong(geometry, distances, distances[distances.length - 1] / 2);
}

/** A rectangle of the screen, in pixels from its top left. */
export type PixelRect = { left: number; top: number; right: number; bottom: number };

/** Where a position falls on the screen, in pixels from its top left. */
export type Projection = (position: Position) => { x: number; y: number };

/** Whether `project` puts the position inside `rect`. */
export function isWithin(position: Position, project: Projection, rect: PixelRect): boolean {
  const { x, y } = project(position);
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// Places tried on either side of the midpoint of a route that is not all inside the rectangle.
const VISIBLE_STEPS = 50;

/**
 * The place on the route nearest its midpoint, along the route, that `project` puts inside `rect`:
 * where a label stays in view. Undefined when no place of the route is inside.
 */
export function midpointWithin(
  geometry: Route['geometry'],
  project: Projection,
  rect: PixelRect,
): Position | undefined {
  const distances = distancesAlong(geometry);
  const total = distances[distances.length - 1];
  // Outward from the middle, so that the common case, a midpoint in view, is one projection.
  for (let step = 0; step <= VISIBLE_STEPS; step++) {
    for (const fraction of [0.5 - step / (2 * VISIBLE_STEPS), 0.5 + step / (2 * VISIBLE_STEPS)]) {
      const position = positionAlong(geometry, distances, fraction * total);
      if (isWithin(position, project, rect)) return position;
    }
  }
  return undefined;
}

/** A mark `count` steps along a route, such as the 3rd kilometre. */
export type DistanceMarker = { position: Position; count: number };

/** The distance in kilometres or miles between two markers, so that a route has a handful of them. */
export function markerInterval(length: number): number {
  if (length <= 40) return 1;
  return length <= 200 ? 5 : 10;
}

/**
 * A marker every `step` kilometres along the route, counted from 1. The last one is left out when it
 * would sit on the end of the route, where the finish is.
 */
export function distanceMarkers(geometry: Route['geometry'], step: number): DistanceMarker[] {
  const distances = distancesAlong(geometry);
  const total = distances[distances.length - 1];
  const markers: DistanceMarker[] = [];
  for (let count = 1; count * step < total - step / 5; count++) {
    markers.push({ position: positionAlong(geometry, distances, count * step), count });
  }
  return markers;
}

// Radius of the sphere of Web Mercator (EPSG:3857), the projection of the map, in metres.
const MERCATOR_RADIUS = 6_378_137;
// Metres a box spans for a route of a single place.
const MIN_SPAN = 1_000;

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

/** The size of a thumbnail's box and the margin its route keeps from the edges, in its own units. */
export type ThumbnailBox = { width: number; height: number; margin: number };

/**
 * A route drawn in a box as it lies on the map, in Web Mercator with north up: scaled to fit, centred,
 * and `margin` from the edges. For a thumbnail without a map snapshot.
 */
export function projectRoute(geometry: Route['geometry'], { width, height, margin }: ThumbnailBox): [number, number][] {
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
  return geometry.map((_, k): [number, number] => [
    offsetX + (xs[k] - west) * pixelsPerMetre,
    offsetY + (north - ys[k]) * pixelsPerMetre,
  ]);
}

/**
 * A route drawn over the part of a map snapshot it runs through, scaled to fit the box and centred
 * as far as the snapshot reaches. The part shown never leaves the snapshot, so no blank edge shows: a
 * route too big for the box's width gets a narrower box, whose `width` is returned with the route's
 * points in it and where the whole snapshot lies in it.
 */
export function projectOnSnapshot(
  geometry: Route['geometry'],
  snapshot: MapSnapshot,
  { width, height, margin }: ThumbnailBox,
): { points: [number, number][]; image: { x: number; y: number; width: number; height: number }; width: number } {
  const pixels = geometry.map(([lon, lat]) => snapshot.toPixel(toMercator([lon, lat])));
  const xs = pixels.map(([x]) => x);
  const ys = pixels.map(([, y]) => y);
  const [west, east, north, south] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [spanX, spanY] = [east - west, south - north];
  const fit = Math.min(
    spanX ? (width - 2 * margin) / spanX : Infinity,
    spanY ? (height - 2 * margin) / spanY : Infinity,
  );
  // A single place shows as it lies on the map. Never smaller than what makes the snapshot cover the height.
  const scale = Math.max(Number.isFinite(fit) ? fit : 1, height / snapshot.height);
  const boxWidth = Math.min(width, snapshot.width * scale);
  // The part of the snapshot the box shows, in its pixels, kept inside it.
  const [shownWidth, shownHeight] = [boxWidth / scale, height / scale];
  const place = (centre: number, shown: number, size: number) =>
    Math.min(Math.max(centre - shown / 2, 0), size - shown);
  const left = place((west + east) / 2, shownWidth, snapshot.width);
  const top = place((north + south) / 2, shownHeight, snapshot.height);
  return {
    points: pixels.map(([x, y]): [number, number] => [(x - left) * scale, (y - top) * scale]),
    image: { x: -left * scale, y: -top * scale, width: snapshot.width * scale, height: snapshot.height * scale },
    width: boxWidth,
  };
}
