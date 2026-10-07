import { CLIMB_PER_EFFORT_KM } from '../contract/index.ts';
import { estimatedDuration, routesAtPace } from './pace.ts';
import type { Route, RouteSetRequest } from './route.ts';

describe('estimatedDuration', () => {
  it('is the distance at the pace on flat ground', () => {
    expect(estimatedDuration({ distance: 10 }, 6)).toBe(60);
  });

  it('counts the climb as effort kilometres, as the server does', () => {
    expect(estimatedDuration({ distance: 10, elevationGain: CLIMB_PER_EFFORT_KM }, 6)).toBe(66);
  });

  it('follows the pace', () => {
    expect(estimatedDuration({ distance: 10, elevationGain: 0 }, 7.5)).toBe(75);
  });
});

describe('routesAtPace', () => {
  const routes = [{ distance: 10, elevationGain: 0, estimatedDuration: 60 }] as Route[];
  const asked: Omit<RouteSetRequest, 'target'> = { start: [6, 45], surface: 'any', pace: 6 };

  it('recomputes the durations at the pace by distance', () => {
    const request: RouteSetRequest = { ...asked, target: { distance: 10 } };

    expect(routesAtPace(request, routes, 5)).toEqual({ routes: [{ ...routes[0], estimatedDuration: 50 }], pace: 5 });
  });

  it('keeps the routes and the pace they were asked at by duration', () => {
    const request: RouteSetRequest = { ...asked, target: { duration: 60 } };

    expect(routesAtPace(request, routes, 5)).toEqual({ routes, pace: 6 });
  });
});
