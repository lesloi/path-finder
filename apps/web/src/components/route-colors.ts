/**
 * The colour of each route on the map, as the `route-*` tokens of `index.css`: MapLibre and the
 * thumbnails paint with raw colours, so change both together (DESIGN.md).
 */
export const ROUTE_COLORS = ['#e0115f', '#2563eb', '#7a3fc4', '#0b7a75', '#c25e00'];

/** The left border of a route's row, in the route's colour. */
const ROUTE_BORDERS = [
  'border-l-route-1',
  'border-l-route-2',
  'border-l-route-3',
  'border-l-route-4',
  'border-l-route-5',
];

/** The colour of the route at this position in its route set, which wraps past the last colour. */
export const routeColor = (index: number) => ROUTE_COLORS[index % ROUTE_COLORS.length];

/** The border class of the row of the route at this position in its route set. */
export const routeBorder = (index: number) => ROUTE_BORDERS[index % ROUTE_BORDERS.length];

/**
 * The other colours the map and the thumbnails paint raw, as the `white`, `start`, `route-muted` and `veil` tokens
 * of `index.css` (a route that is not selected is grey; the veil covers where there are no routes) and the colour of the Plan IGN's land, which a
 * thumbnail shows until its snapshot is taken.
 */
export const MAP_COLORS = {
  white: '#ffffff',
  land: '#f4f2ea',
  start: '#6b4f33',
  routeMuted: '#9aa595',
  veil: '#4a4f47',
};

/** The ink of a tag over the map, which stays light in dark mode: the light theme's, as the scale's. */
export const MAP_INK = '#1c1d1b';
