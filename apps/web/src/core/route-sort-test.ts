import { routeOrder } from './route-sort.ts';
import type { Route } from './route.ts';

function route(overrides: Partial<Route> = {}): Route {
  return {
    geometry: [
      [6, 45],
      [6, 45.01],
    ],
    distance: 10,
    elevationGain: 200,
    estimatedDuration: 60,
    kind: 'match',
    unpavedShare: 0,
    surfaces: [{ surface: 'paved', from: 0, to: 10 }],
    technical: false,
    technicalStretches: [],
    ...overrides,
  };
}

describe('routeOrder', () => {
  it('lists every route once, in the order it was given, for relevance', () => {
    expect(routeOrder([route(), route(), route()], 'relevance')).toEqual([0, 1, 2]);
  });

  it('puts the shortest route first by distance', () => {
    const routes = [route({ distance: 12 }), route({ distance: 8 }), route({ distance: 10 })];

    expect(routeOrder(routes, 'distance')).toEqual([1, 2, 0]);
  });

  it('puts the flattest route first by elevation gain', () => {
    const routes = [route({ elevationGain: 500 }), route({ elevationGain: 120 }), route({ elevationGain: 300 })];

    expect(routeOrder(routes, 'gain')).toEqual([1, 2, 0]);
  });

  it('puts a route without elevation gain after the others, whatever they gain', () => {
    const { elevationGain, ...flat } = route({ elevationGain: 50 });
    expect(elevationGain).toBe(50);
    const routes = [flat, route({ elevationGain: 900 }), route({ elevationGain: 300 })];

    expect(routeOrder(routes, 'gain')).toEqual([2, 1, 0]);
  });

  it('puts the quickest route first by estimated duration', () => {
    const routes = [
      route({ estimatedDuration: 90 }),
      route({ estimatedDuration: 45 }),
      route({ estimatedDuration: 70 }),
    ];

    expect(routeOrder(routes, 'duration')).toEqual([1, 2, 0]);
  });

  it('keeps the order it was given between equal routes', () => {
    const routes = [route({ distance: 10 }), route({ distance: 8 }), route({ distance: 10 }), route({ distance: 8 })];

    expect(routeOrder(routes, 'distance')).toEqual([1, 3, 0, 2]);
  });
});
