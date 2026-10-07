import { CLIMB_PER_EFFORT_KM } from '../contract/index.ts';
import type { Route, RouteSetRequest } from './route.ts';

/** Minutes per km on flat ground until the user sets a pace. */
export const DEFAULT_PACE = 6;

/**
 * The minutes a route takes at a pace: its distance plus its climb as effort kilometres, as the
 * server counts them. A route without elevation data has no climb.
 */
export function estimatedDuration(
  { distance, elevationGain }: { distance: number; elevationGain?: number },
  pace: number,
): number {
  return (distance + (elevationGain ?? 0) / CLIMB_PER_EFFORT_KM) * pace;
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
  if ('duration' in request.target) return { routes, pace: request.pace };
  return { routes: routes.map((route) => ({ ...route, estimatedDuration: estimatedDuration(route, pace) })), pace };
}
