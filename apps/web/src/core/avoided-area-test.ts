import {
  AVOIDED_RADIUS_STEP,
  circlePolygon,
  DEFAULT_AVOIDED_RADIUS,
  fitRadius,
  maxRadiusAround,
} from './avoided-area.ts';
import { kmBetween } from './distance.ts';

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

describe('maxRadiusAround', () => {
  const centre: [number, number] = [6.1294, 45.8992];
  // About 222 m north of the centre.
  const north: [number, number] = [6.1294, 45.9012];

  it('stops short of the nearest point, so that no point is inside or touching', () => {
    const radius = maxRadiusAround(centre, [north, [6.2, 45.95]]);

    expect(radius).toBeLessThan(kmBetween(centre, north) * 1000);
    expect(radius).toBeGreaterThan(kmBetween(centre, north) * 1000 - 10);
  });

  it('has no limit without a point', () => {
    expect(maxRadiusAround(centre, [])).toBe(Infinity);
  });
});

describe('fitRadius', () => {
  const centre: [number, number] = [6.1294, 45.8992];
  // About 222 m north of the centre.
  const north: [number, number] = [6.1294, 45.9012];
  // About 56 m north of the centre.
  const close: [number, number] = [6.1294, 45.8997];

  it('keeps the radius asked for when no point is in the way', () => {
    expect(fitRadius(400, centre, [])).toBe(400);
  });

  it('stops at a step of the slider short of the nearest point', () => {
    const radius = fitRadius(400, centre, [north]);

    expect(radius % AVOIDED_RADIUS_STEP).toBe(0);
    expect(radius).toBeLessThan(222);
    expect(radius).toBeGreaterThan(222 - 2 * AVOIDED_RADIUS_STEP);
  });

  it('never goes under the smallest radius the server takes', () => {
    expect(fitRadius(400, centre, [close])).toBe(50);
  });
});
