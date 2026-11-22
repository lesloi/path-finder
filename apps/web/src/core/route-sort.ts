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
 * The places of the routes in the list, from their places in the route set: an ascending order goes from the
 * smallest figure up, and a descending one, which the list starts with, from the largest down. Relevance has no
 * figure: descending keeps the order the API ranked, the most relevant first, and ascending reverses it. Equal routes
 * keep the order they were given, and a route without elevation gain comes after the others either way.
 */
export function routeOrder(routes: Route[], sort: RouteSort, descending = false): number[] {
  const places = routes.map((_, index) => index);
  if (sort === 'relevance') return descending ? places : places.toReversed();
  return places.sort((a, b) => {
    const [first, second] = [figure(routes[a]!, sort), figure(routes[b]!, sort)];
    if (first === undefined || second === undefined) {
      if (first === second) return a - b;
      return first === undefined ? 1 : -1;
    }
    return (descending ? second - first : first - second) || a - b;
  });
}
