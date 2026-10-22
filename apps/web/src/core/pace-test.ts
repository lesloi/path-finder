import { effortFactor } from './effort.ts';
import { estimatedDuration, routesAtPace } from './pace.ts';
import type { LoopCriteria } from '../contract/index.ts';
import type { Route, RouteSetRequest } from './route.ts';

describe('estimatedDuration', () => {
  const northward = (heights: number[]): [number, number, number][] =>
    heights.map((height, k) => [6, 45 + (k * 10) / 111_195, height]);

  it('is the distance at the pace on flat ground', () => {
    expect(estimatedDuration({ distance: 10 }, 6)).toBe(60);
  });

  it('counts the slope of each stretch as effort, as the server does', () => {
    const geometry = northward(Array.from({ length: 101 }, (_, k) => k));

    expect(estimatedDuration({ distance: 10, geometry }, 6)).toBeCloseTo(10 * effortFactor(geometry) * 6, 9);
    expect(estimatedDuration({ distance: 10, geometry }, 6)).toBeGreaterThan(60);
  });

  it('is the distance at the pace when the route has no heights', () => {
    const geometry = northward([0, 0, 0]).map(([lon, lat]): [number, number] => [lon, lat]);

    expect(estimatedDuration({ distance: 10, geometry }, 6)).toBe(60);
  });

  it('follows the pace', () => {
    expect(estimatedDuration({ distance: 10 }, 7.5)).toBe(75);
  });
});

describe('routesAtPace', () => {
  const routes = [{ distance: 10, elevationGain: 0, estimatedDuration: 60 }] as Route[];
  const asked: Omit<LoopCriteria, 'target' | 'elevationGain' | 'shape' | 'destination'> = {
    start: [6, 45],
    surface: 'any',
    pace: 6,
  };

  it('recomputes the durations at the pace by distance', () => {
    const request: RouteSetRequest = { ...asked, target: { distance: 10 } };

    expect(routesAtPace(request, routes, 5)).toEqual({ routes: [{ ...routes[0], estimatedDuration: 50 }], pace: 5 });
  });

  it('recomputes the durations of an out-and-back route, which has no target', () => {
    const request: RouteSetRequest = { ...asked, shape: 'outAndBack', destination: [6.1, 45.1] };

    expect(routesAtPace(request, routes, 5)).toEqual({ routes: [{ ...routes[0], estimatedDuration: 50 }], pace: 5 });
  });

  it('keeps the routes and the pace they were asked at by duration', () => {
    const request: RouteSetRequest = { ...asked, target: { duration: 60 } };

    expect(routesAtPace(request, routes, 5)).toEqual({ routes, pace: 6 });
  });
});
