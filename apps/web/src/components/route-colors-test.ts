import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAP_COLORS, ROUTE_COLORS, routeBorder, routeColor } from './route-colors.ts';

const css = readFileSync(join(import.meta.dirname, 'index.css'), 'utf8');

describe('route colours', () => {
  it('match the route tokens of the stylesheet, which paint the rest of the interface', () => {
    const tokens = [1, 2, 3, 4, 5].map((n) => new RegExp(`--color-route-${n}: (#\\w+);`).exec(css)?.[1]);

    expect(tokens).toEqual(ROUTE_COLORS);
  });

  it('match the white and start tokens for the other colours the map paints', () => {
    expect(new RegExp(`--color-white: ${MAP_COLORS.white};`).test(css)).toBe(true);
    expect(new RegExp(`--color-start: ${MAP_COLORS.start};`).test(css)).toBe(true);
    expect(new RegExp(`--color-route-muted: ${MAP_COLORS.routeMuted};`).test(css)).toBe(true);
  });

  it('give a route its colour and its border by its position, wrapping past the last', () => {
    expect(routeColor(1)).toBe(ROUTE_COLORS[1]);
    expect(routeColor(ROUTE_COLORS.length)).toBe(ROUTE_COLORS[0]);
    expect(routeBorder(2)).toBe('border-l-route-3');
    expect(routeBorder(5)).toBe('border-l-route-1');
  });
});
