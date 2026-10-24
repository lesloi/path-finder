import { AVOIDED_AREA_RADIUS, METRES_PER_DEGREE, type AvoidedArea } from '../contract/index.ts';
import type { Position } from './coordinates.ts';
import { kmBetween } from './distance.ts';

// The server refuses an area that holds a point: the margin keeps a drawn circle clear of it.
const MARGIN_M = 5;

/** The radius of a new area, in metres. */
export const DEFAULT_AVOIDED_RADIUS = 200;

/**
 * The largest radius, in metres, a circle around `center` can have without holding or touching any of the points: the
 * server refuses an area that holds the start point or a waypoint, so the limit keeps a margin from the nearest one.
 */
export function maxRadiusAround(center: Position, points: Position[]): number {
  const nearest = Math.min(...points.map((point) => kmBetween(center, point) * 1000));
  return Math.floor(nearest) - MARGIN_M;
}

/** The step of the radius slider, in metres: a radius is always a multiple of it. */
export const AVOIDED_RADIUS_STEP = 10;

/**
 * The radius to give an area around `center`: the one asked for, stopped short of the nearest point and rounded down
 * to a step of the slider, but never under the smallest radius the server takes.
 */
export function fitRadius(radius: number, center: Position, points: Position[]): number {
  const limit = Math.min(radius, maxRadiusAround(center, points));
  return Math.max(AVOIDED_AREA_RADIUS.min, Math.floor(limit / AVOIDED_RADIUS_STEP) * AVOIDED_RADIUS_STEP);
}

/** The ring of a polygon that draws the area, closed on its first point. */
export function circlePolygon({ center, radius }: AvoidedArea, steps = 64): Position[] {
  const [lon, lat] = center;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return Array.from({ length: steps + 1 }, (_, i): Position => {
    const angle = ((i % steps) / steps) * 2 * Math.PI;
    return [
      lon + (radius * Math.cos(angle)) / (METRES_PER_DEGREE * cosLat),
      lat + (radius * Math.sin(angle)) / METRES_PER_DEGREE,
    ];
  });
}
