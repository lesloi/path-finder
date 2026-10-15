import { circlePolygon, DEFAULT_AVOIDED_RADIUS } from './avoided-area.ts';
import { kmBetween } from './route.ts';

describe('circlePolygon', () => {
  const area = { center: [6.1294, 45.8992] as [number, number], radius: 400 };

  it('closes its ring on its first point', () => {
    const ring = circlePolygon(area);

    expect(ring[0]).toEqual(ring.at(-1));
  });

  it('keeps every point at the radius from the centre', () => {
    const ring = circlePolygon(area);

    for (const point of ring) expect(kmBetween(area.center, point) * 1000).toBeCloseTo(area.radius, -1);
  });

  it('has more points for the same circle when asked for', () => {
    expect(circlePolygon(area, 8)).toHaveLength(9);
  });

  it('starts at a radius the criteria bounds hold', () => {
    expect(DEFAULT_AVOIDED_RADIUS).toBeGreaterThanOrEqual(50);
    expect(DEFAULT_AVOIDED_RADIUS).toBeLessThanOrEqual(1500);
  });
});
