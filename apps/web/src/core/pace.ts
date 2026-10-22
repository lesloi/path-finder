import { byDuration } from '../contract/index.ts';
import { effortFactor } from './effort.ts';
import type { Route, RouteSetRequest } from './route.ts';
import type { PaceUnit } from './units.ts';

/** Minutes per km on flat ground until the user sets a pace. */
export const DEFAULT_PACE = 6;

/** How the pace is written until the user picks another way. */
export const DEFAULT_PACE_UNIT: PaceUnit = 'min/km';

/**
 * The minutes a route takes at a pace: its distance weighted by the slope of each stretch, as the server counts it. A
 * route without heights is flat.
 */
export function estimatedDuration(
  { distance, geometry }: { distance: number; geometry?: number[][] },
  pace: number,
): number {
  return distance * (geometry ? effortFactor(geometry) : 1) * pace;
}

/**
 * The routes of a route set as the list shows them, and the pace their durations are at. By distance, the pace
 * changes no route, only the durations, which follow `pace`. By duration, the routes are those of the pace they
 * were asked for, and a new pace is a new search.
 */
export function routesAtPace(
  request: RouteSetRequest,
  routes: Route[],
  pace: number,
): { routes: Route[]; pace: number } {
  if (byDuration(request)) return { routes, pace: request.pace };
  return { routes: routes.map((route) => ({ ...route, estimatedDuration: estimatedDuration(route, pace) })), pace };
}
