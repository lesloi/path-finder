import type { Route } from './route.ts';

/** How the list of a route set orders its routes. */
export type RouteSort = 'relevance' | 'distance' | 'gain' | 'duration';

// The figure a sort orders the routes by; a route without heights has no gain.
function figure(route: Route, sort: Exclude<RouteSort, 'relevance'>): number | undefined {
  if (sort === 'distance') return route.distance;
  if (sort === 'duration') return route.estimatedDuration;
  return route.elevationGain;
}

/**
 * The places of the routes in the list, from their places in the route set: the API already ranked the routes, so
 * relevance keeps its order, and the others go from the smallest figure up. Equal routes keep the order they were
 * given, and a route without elevation gain comes after the others.
 */
export function routeOrder(routes: Route[], sort: RouteSort): number[] {
  const places = routes.map((_, index) => index);
  if (sort === 'relevance') return places;
  return places.sort((a, b) => {
    const [first, second] = [figure(routes[a]!, sort), figure(routes[b]!, sort)];
    if (first === undefined || second === undefined) {
      if (first === second) return a - b;
      return first === undefined ? 1 : -1;
    }
    return first - second || a - b;
  });
}
