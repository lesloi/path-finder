import type { SurfaceStretch } from '../contract/index.ts';
import type { Position } from './coordinates.ts';
import { effortFactor } from './effort.ts';
import {
  elevationProfile,
  parseRoutes,
  reverseRoute,
  projectOnSnapshot,
  toMercator,
  positionAt,
  isWithin,
  midpoint,
  midpointWithin,
  markerInterval,
  distanceMarkers,
  projectRoute,
  gradeAt,
  surfaceAt,
  routeTimeline,
  waypointsOnRoute,
  type MapSnapshot,
  type ProfilePoint,
  type Route,
  nearestOnRoute,
} from './route.ts';

// Metres per degree of latitude.
const METRES_PER_DEGREE = 111_195;

// Points due north of the start, `metres` apart, at these heights.
function northward(heights: number[], metres = 100): [number, number, number][] {
  return heights.map((height, k) => [6.1294, 45.8992 + (k * metres) / METRES_PER_DEGREE, height]);
}

const route: Route = {
  geometry: northward([400, 410, 420]),
  distance: 10,
  elevationGain: 400,
  elevationLoss: 390,
  estimatedDuration: 84,
  kind: 'match',
  unpavedShare: 0.3,
  surfaces: [
    { surface: 'paved', from: 0, to: 7 },
    { surface: 'unpaved', from: 7, to: 10 },
  ],
  technical: false,
  technicalStretches: [],
};

describe('parseRoutes', () => {
  const answer = { routes: [route] };

  it('reads the routes of an answer', () => {
    expect(parseRoutes(answer)).toEqual([route]);
  });

  it('reads routes without heights or elevation gain, as without BD ALTI', () => {
    const { elevationGain, elevationLoss, ...flat } = route;
    expect([elevationGain, elevationLoss]).not.toContain(undefined);
    const routes = [{ ...flat, geometry: [[6.1, 45.9] as [number, number]] }];

    expect(parseRoutes({ routes })).toEqual(routes);
  });

  it('reads an empty route set', () => {
    expect(parseRoutes({ routes: [] })).toEqual([]);
  });

  it.each([
    ['not an object', 'routes'],
    ['no routes', {}],
    ['a route that is not an object', { routes: [1] }],
    ['a point that is not a position', { routes: [{ ...route, geometry: [[6.1]] }] }],
    ['a height that is not a number', { routes: [{ ...route, geometry: [[6.1, 45.9, 'high']] }] }],
    ['no distance', { routes: [{ ...route, distance: undefined }] }],
    ['an elevation gain that is not a number', { routes: [{ ...route, elevationGain: '400' }] }],
    ['an elevation loss that is not a number', { routes: [{ ...route, elevationLoss: '390' }] }],
    ['no technical flag', { routes: [{ ...route, technical: undefined }] }],
    ['a technical flag that is not a boolean', { routes: [{ ...route, technical: 'yes' }] }],
    ['no technical stretches', { routes: [{ ...route, technicalStretches: undefined }] }],
    ['a technical stretch without an end', { routes: [{ ...route, technicalStretches: [{ from: 1 }] }] }],
    ['an unknown kind', { routes: [{ ...route, kind: 'perfect' }] }],
    ['an unknown surface', { routes: [{ ...route, surfaces: [{ surface: 'ice', from: 0, to: 10 }] }] }],
  ])('refuses an answer with %s', (_, body) => {
    expect(parseRoutes(body)).toBeUndefined();
  });

  it('reads where the technical stretches are, leaving out what else they hold', () => {
    const technicalStretches = [{ from: 2, to: 3.5 }];

    const [parsed] = parseRoutes({
      routes: [{ ...route, technical: true, technicalStretches: [{ ...technicalStretches[0], extra: 1 }] }],
    })!;

    expect(parsed!.technicalStretches).toEqual(technicalStretches);
  });

  it('leaves out the fields it does not know', () => {
    const [parsed] = parseRoutes({ routes: [{ ...route, extra: true }] })!;

    expect(parsed).not.toHaveProperty('extra');
  });
});

describe('elevationProfile', () => {
  it('samples the heights every 50 m along the route, from its start', () => {
    const profile = elevationProfile(northward([400, 410, 420]))!;

    expect(profile.map(({ distance }) => distance)).toEqual([0, 0.05, 0.1, 0.15, 0.2].map((d) => expect.closeTo(d)));
    expect(profile.map(({ height }) => height)).toEqual([400, 405, 410, 415, 420].map((h) => expect.closeTo(h, 0)));
  });

  it('ends at the last point of the route', () => {
    const profile = elevationProfile(northward([400, 430], 120))!;

    expect(profile.at(-1)).toEqual<ProfilePoint>({ distance: expect.closeTo(0.12), height: 430 });
  });

  it('is undefined for a route without heights', () => {
    expect(
      elevationProfile([
        [6.1, 45.9],
        [6.1, 45.91],
      ]),
    ).toBeUndefined();
  });
});

describe('gradeAt', () => {
  // 50 m apart: 5 m up, flat, then 2.5 m down.
  const profile: ProfilePoint[] = [
    { distance: 0, height: 100 },
    { distance: 0.05, height: 105 },
    { distance: 0.1, height: 105 },
    { distance: 0.15, height: 102.5 },
  ];

  it.each([
    ['uphill', 0.1, 10],
    ['flat', 0.5, 0],
    ['downhill', 0.95, -5],
  ])('gives the grade of the stretch on a %s part', (_, fraction, expected) => {
    expect(gradeAt(profile, fraction)).toBeCloseTo(expected);
  });

  it('gives the last stretch at the end of the route', () => {
    expect(gradeAt(profile, 1)).toBeCloseTo(-5);
  });

  it('is 0 for a profile of a single sample', () => {
    expect(gradeAt([{ distance: 0, height: 100 }], 0.5)).toBe(0);
  });
});

describe('surfaceAt', () => {
  const surfaces: SurfaceStretch[] = [
    { surface: 'paved', from: 0, to: 7 },
    { surface: 'unpaved', from: 7, to: 10 },
  ];

  it.each([
    ['at the start', 0, 'paved'],
    ['in the first stretch', 5, 'paved'],
    ['in the second stretch', 8.5, 'unpaved'],
    ['at the end', 10, 'unpaved'],
  ])('gives the surface %s', (_, distance, expected) => {
    expect(surfaceAt(surfaces, distance)).toBe(expected);
  });

  it('keeps the last surface when the stretches fall short of the end', () => {
    expect(surfaceAt([{ surface: 'unpaved', from: 0, to: 4 }], 9)).toBe('unpaved');
  });

  it('is paved when nothing is known', () => {
    expect(surfaceAt([], 0.5)).toBe('paved');
  });
});

describe('positionAt', () => {
  const geometry = northward([400, 410, 420]);

  it('interpolates between the points around a distance', () => {
    const [lon, lat] = positionAt(geometry, 0.15);

    expect(lon).toBeCloseTo(6.1294);
    expect(lat).toBeCloseTo(45.8992 + 150 / METRES_PER_DEGREE, 6);
  });

  it('stays on the route beyond its ends', () => {
    expect(positionAt(geometry, -1)).toEqual([geometry[0][0], geometry[0][1]]);
    expect(positionAt(geometry, 99)).toEqual([geometry[2][0], geometry[2][1]]);
  });
});

describe('midpoint', () => {
  it('is halfway along the route', () => {
    const [lon, lat] = midpoint(northward([0, 0, 0, 0, 0], 100));

    expect(lon).toBeCloseTo(6.1294);
    expect(lat).toBeCloseTo(45.8992 + 200 / METRES_PER_DEGREE, 6);
  });
});

describe('midpointWithin', () => {
  // A route heading east along the equator, a pixel per hundredth of a degree.
  const line: Position[] = [0, 1, 2, 3, 4].map((lon) => [lon, 0]);
  const project = ([lon]: Position) => ({ x: lon * 100, y: 50 });
  const screen = { left: 0, top: 0, right: 400, bottom: 100 };

  it('is the midpoint when it is inside', () => {
    expect(midpointWithin(line, project, screen)).toEqual([2, 0]);
  });

  it('moves along the route to the nearest place that is inside', () => {
    const [lon] = midpointWithin(line, project, { ...screen, left: 250 })!;

    expect(lon).toBeCloseTo(2.5, 1);
    expect(lon).toBeGreaterThanOrEqual(2.5);
  });

  it('is undefined when no place of the route is inside', () => {
    expect(midpointWithin(line, project, { ...screen, top: 60 })).toBeUndefined();
  });
});

describe('isWithin', () => {
  const project = ([lon, lat]: Position) => ({ x: lon, y: lat });
  const rect = { left: 0, top: 0, right: 10, bottom: 10 };

  it('tells whether a position projects inside the rectangle, edges included', () => {
    expect(isWithin([10, 0], project, rect)).toBe(true);
    expect(isWithin([11, 5], project, rect)).toBe(false);
    expect(isWithin([5, -1], project, rect)).toBe(false);
  });
});

describe('markerInterval', () => {
  it.each([
    [5, 1],
    [40, 1],
    [42, 5],
    [200, 5],
    [250, 10],
  ])('a route of %d is marked every %d', (length, interval) => {
    expect(markerInterval(length)).toBe(interval);
  });
});

describe('distanceMarkers', () => {
  // 2.5 km long.
  const geometry = northward(
    Array.from({ length: 26 }, () => 0),
    100,
  );

  it('puts a numbered marker at every step', () => {
    const markers = distanceMarkers(geometry, 1);

    expect(markers.map(({ count }) => count)).toEqual([1, 2]);
    expect(markers[1].position[1]).toBeCloseTo(45.8992 + 2000 / METRES_PER_DEGREE, 6);
  });

  it('leaves out a marker that would sit on the end of the route', () => {
    expect(
      distanceMarkers(
        northward(
          Array.from({ length: 31 }, () => 0),
          100,
        ),
        1,
      ).map(({ count }) => count),
    ).toEqual([1, 2]);
  });

  it('has none on a route shorter than a step', () => {
    expect(distanceMarkers(geometry, 5)).toEqual([]);
  });
});

describe('projectRoute', () => {
  const box = { width: 100, height: 100, margin: 10 };

  it('fits the route in the box with north up', () => {
    const points = projectRoute(
      [
        [6, 45],
        [6, 45.1],
        [6.1, 45.1],
      ],
      box,
    );

    expect(points[0][1]).toBeGreaterThan(points[1][1]);
    expect(points[2][0]).toBeGreaterThan(points[1][0]);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(x).toBeLessThanOrEqual(90 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(y).toBeLessThanOrEqual(90 + 1e-9);
    }
  });

  it('centres a route that is wider than tall', () => {
    const points = projectRoute(
      [
        [6, 45],
        [6.2, 45],
      ],
      box,
    );

    expect(points.map(([, y]) => y)).toEqual([50, 50]);
    expect(points.map(([x]) => x)).toEqual([expect.closeTo(10), expect.closeTo(90)]);
  });

  it('puts a route of a single place in the middle', () => {
    expect(projectRoute([[6, 45]], box)).toEqual([[50, 50]]);
  });
});

describe('projectOnSnapshot', () => {
  const box = { width: 100, height: 100, margin: 10 };
  // One pixel per kilometre, the origin of the map at the top left of an 800 by 600 snapshot.
  const snapshot: MapSnapshot = {
    url: 'blob:map',
    width: 800,
    height: 600,
    toPixel: ([x, y]) => [x / 1_000, -y / 1_000],
    of: [],
  };
  // A route of `width` by `height` snapshot pixels, its top left at `[left, top]`: positions in Mercator metres.
  const place = (left: number, top: number, width: number, height: number): Route['geometry'] => {
    const at = (px: number, py: number): [number, number] => {
      const x = px * 1_000;
      const y = -py * 1_000;
      return [
        (x * 180) / (Math.PI * 6_378_137),
        (2 * Math.atan(Math.exp(y / 6_378_137)) - Math.PI / 2) * (180 / Math.PI),
      ];
    };
    return [at(left, top), at(left + width, top + height)];
  };

  it('scales the route to fill the box and centres it on the snapshot', () => {
    const { points, image } = projectOnSnapshot(place(300, 200, 100, 100), snapshot, box);

    expect(points[0][0]).toBeCloseTo(10, 1);
    expect(points[1][0]).toBeCloseTo(90, 1);
    // The snapshot is scaled by 0.8 box units per pixel, and offset to the part the route is on.
    expect(image.width).toBeCloseTo(800 * 0.8, 1);
    expect(image.x).toBeCloseTo(-(300 - 12.5) * 0.8, 1);
  });

  it('never shows beyond the snapshot: the box slides back inside it', () => {
    // A route against the right edge: its box would reach past the snapshot, so it slides left.
    const { points, image } = projectOnSnapshot(place(740, 250, 55, 55), snapshot, box);

    expect(image.x + image.width).toBeGreaterThanOrEqual(100 - 1e-6);
    expect(image.x).toBeLessThanOrEqual(1e-6);
    expect(Math.max(...points.map(([x]) => x))).toBeLessThanOrEqual(100);
  });

  it('narrows a wide box for a route too big for it, so the snapshot still covers the box', () => {
    const wide = { width: 250, height: 100, margin: 10 };
    const { width, image } = projectOnSnapshot(place(100, 50, 600, 500), snapshot, wide);

    expect(width).toBeLessThan(250);
    expect(image.x).toBeLessThanOrEqual(1e-6);
    expect(image.x + image.width).toBeGreaterThanOrEqual(width - 1e-6);
    expect(image.y).toBeLessThanOrEqual(1e-6);
    expect(image.y + image.height).toBeGreaterThanOrEqual(100 - 1e-6);
  });

  it('keeps the width of the box when the snapshot covers it', () => {
    expect(projectOnSnapshot(place(300, 250, 60, 60), snapshot, { width: 250, height: 100, margin: 10 }).width).toBe(
      250,
    );
  });

  it('shows a route of a single place as it lies on the map', () => {
    const { points } = projectOnSnapshot(place(400, 300, 0, 0).slice(0, 1), snapshot, box);

    expect(points[0][0]).toBeCloseTo(50, 0);
  });
});

describe('toMercator', () => {
  it('puts the equator and the meridian of Greenwich at the origin', () => {
    const [x, y] = toMercator([0, 0]);

    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it('gives metres, stretching latitudes as the map does', () => {
    const [x, y] = toMercator([1, 45]);

    expect(x).toBeCloseTo(111_319.5, 0);
    expect(y).toBeCloseTo(5_621_521.5, 0);
  });
});

describe('waypointsOnRoute', () => {
  // Five points 100 m apart, due north: 0, 0.1, 0.2, 0.3 and 0.4 km.
  const geometry = northward([450, 460, 470, 480, 490]);
  const near = (k: number): Position => [geometry[k][0] + 0.00001, geometry[k][1] + 0.00001];

  it('puts each waypoint where the route passes it: the distance, the place and the height', () => {
    const [first, second] = waypointsOnRoute(geometry, [near(1), near(3)]);

    expect(first).toMatchObject({ number: 1, position: [geometry[1][0], geometry[1][1]], height: 460 });
    expect(first!.distance).toBeCloseTo(0.1, 2);
    expect(second).toMatchObject({ number: 2, height: 480 });
    expect(second!.distance).toBeCloseTo(0.3, 2);
  });

  it('searches on from the previous waypoint, so a route that passes a place twice keeps the order', () => {
    // Out and back along the same ways: the second waypoint is the same place as the first, on the way back.
    const there = northward([450, 460, 470]);
    const back = [...there, there[1], there[0]];

    const [first, second] = waypointsOnRoute(back, [
      [there[1][0], there[1][1]],
      [there[1][0], there[1][1]],
    ]);

    expect(first!.distance).toBeCloseTo(0.1, 2);
    expect(second!.distance).toBeGreaterThan(first!.distance);
  });

  it('leaves the height out of a route without heights, and finds nothing for no waypoints', () => {
    const flat = geometry.map(([lon, lat]): [number, number] => [lon, lat]);

    expect(waypointsOnRoute(flat, [near(2)])[0]).not.toHaveProperty('height');
    expect(waypointsOnRoute(geometry, [])).toEqual([]);
  });
});

describe('routeTimeline', () => {
  // Points 100 m apart, due north, climbing 10 m each then dropping: 0, 0.1, ... 0.5 km.
  const geometry = northward([400, 410, 420, 415, 425, 425]);
  const at = (k: number): Position => [geometry[k][0], geometry[k][1]];
  const timelineRoute: Route = { ...route, geometry, distance: 0.5, elevationGain: 30, estimatedDuration: 6 };

  it('lists the start, the waypoints in order and the finish, with the distance and the height at each', () => {
    const steps = routeTimeline(timelineRoute, [at(2), at(4)]);

    expect(steps.map(({ kind, number }) => [kind, number])).toEqual([
      ['start', undefined],
      ['waypoint', 1],
      ['waypoint', 2],
      ['finish', undefined],
    ]);
    expect(steps.map(({ height }) => height)).toEqual([400, 420, 425, 425]);
    expect(steps[1]!.distance).toBeCloseTo(0.2, 2);
    expect(steps[3]!.distance).toBeCloseTo(0.5, 2);
  });

  it('weighs the time by the slope, and ends on the estimated duration', () => {
    const steps = routeTimeline({ ...timelineRoute, estimatedDuration: 8 }, [at(2)]);

    // 0.2 km of the 0.5 km would make 4 minutes on flat ground; the climb weighs more than the rest, then it is scaled to 8.
    expect(steps[1]!.elapsed).toBeCloseTo(3.7, 1);
    expect(steps.at(-1)!.elapsed).toBe(8);
  });

  it('leaves the heights and the climb out of a route without heights', () => {
    const flat = { ...timelineRoute, geometry: geometry.map(([lon, lat]) => [lon, lat] as [number, number]) };
    delete flat.elevationGain;

    const [start, , finish] = routeTimeline(flat, [at(2)]);

    expect(start).not.toHaveProperty('height');
    expect(finish!.leg).not.toHaveProperty('climb');
  });

  it('gives each stop the distance, the climb (counted as the server does, a drop within the dead band ignored) and the descent of the leg that ends there', () => {
    // Heights 400 410 420 415 425 425: the drop of 5 m counts as descent.
    const steps = routeTimeline({ ...timelineRoute, elevationLoss: 5 }, [at(2), at(4)]);

    expect(steps[0]).not.toHaveProperty('leg');
    expect(steps.slice(1).map(({ leg }) => leg!.climb)).toEqual([20, 10, 0]);
    expect(steps.slice(1).map(({ leg }) => leg!.descent)).toEqual([0, 5, 0]);
    expect(steps.slice(1).reduce((km, { leg }) => km + leg!.distance, 0)).toBeCloseTo(0.5, 2);
  });

  it('spreads the gap to the route elevation loss over the legs, not onto the last one', () => {
    // The forward count is 5 m, all on the second leg: a loss of 10 m doubles it.
    const steps = routeTimeline({ ...timelineRoute, elevationLoss: 10 }, [at(2), at(4)]);

    expect(steps.slice(1).map(({ leg }) => leg!.descent)).toEqual([0, 10, 0]);
  });

  it('puts the loss on the last leg when the forward count found none', () => {
    const rising = northward([400, 410, 420, 430, 440, 450]);

    const steps = routeTimeline({ ...timelineRoute, geometry: rising, elevationLoss: 4 }, [at(2)]);

    expect(steps.map(({ leg }) => leg?.descent)).toEqual([undefined, 0, 4]);
  });

  it('never gives a leg a negative time, whatever duration the route was estimated at', () => {
    const steps = routeTimeline({ ...timelineRoute, estimatedDuration: 1 }, [at(2), at(4)]);

    expect(steps.slice(1).every(({ leg }) => leg!.duration >= 0)).toBe(true);
    expect(steps.at(-1)!.elapsed).toBe(1);
  });

  it('gives each leg its time, summing to the estimated duration', () => {
    const steps = routeTimeline({ ...timelineRoute, estimatedDuration: 7 }, [at(2)]);

    // The share of the effort the first two legs make up, scaled to the 7 minutes of the route.
    expect(steps[1]!.leg!.duration).toBeCloseTo(3.26, 1);
    expect(steps.slice(1).reduce((minutes, { leg }) => minutes + leg!.duration, 0)).toBeCloseTo(7, 5);
  });

  it('ends the descent on the route elevation loss, which the sum over the points only approaches', () => {
    const steps = routeTimeline({ ...timelineRoute, elevationLoss: 9 }, [at(2)]);

    expect(steps.slice(1).reduce((loss, { leg }) => loss + leg!.descent!, 0)).toBe(9);
  });

  it('leaves the climb and the descent out of the legs of a route without heights', () => {
    const flat = { ...timelineRoute, geometry: geometry.map(([lon, lat]) => [lon, lat] as [number, number]) };

    const [, finish] = routeTimeline(flat, []);

    expect(finish!.leg).not.toHaveProperty('climb');
    expect(finish!.leg).not.toHaveProperty('descent');
  });

  it('lists the start and the finish for a route without waypoints, and its highest point between them', () => {
    const steps = routeTimeline({ ...timelineRoute, geometry: northward([400, 410, 440, 420, 405]) }, []);

    expect(steps.map(({ kind }) => kind)).toEqual(['start', 'summit', 'finish']);
    expect(steps[1]).toMatchObject({ height: 440 });
    expect(steps[1]!.distance).toBeCloseTo(0.2, 2);
  });

  it('adds the lowest point too, in the order of the route, when it falls 20 m below the start and the finish', () => {
    const steps = routeTimeline({ ...timelineRoute, geometry: northward([420, 400, 450, 380, 430]) }, []);

    expect(steps.map(({ kind }) => kind)).toEqual(['start', 'summit', 'lowest', 'finish']);
    expect(steps[2]).toMatchObject({ height: 380 });
  });

  it('has no lowest point that falls less than 20 m below the start and the finish', () => {
    const steps = routeTimeline({ ...timelineRoute, geometry: northward([420, 410, 450, 405, 430]) }, []);

    expect(steps.map(({ kind }) => kind)).toEqual(['start', 'summit', 'finish']);
  });

  it('has no highest point that rises less than 20 m above the start and the finish', () => {
    const steps = routeTimeline({ ...timelineRoute, geometry: northward([400, 410, 419, 405, 400]) }, []);

    expect(steps.map(({ kind }) => kind)).toEqual(['start', 'finish']);
  });

  it('has no highest point when it is the start or the finish', () => {
    const steps = routeTimeline({ ...timelineRoute, geometry: northward([400, 410, 420]) }, []);

    expect(steps.map(({ kind }) => kind)).toEqual(['start', 'finish']);
  });

  it('puts the highest point among the waypoints in the order of the route', () => {
    const steps = routeTimeline({ ...timelineRoute, geometry: northward([400, 440, 420, 405]) }, [at(2)]);

    expect(steps.map(({ kind }) => kind)).toEqual(['start', 'summit', 'waypoint', 'finish']);
  });

  it('leaves out an extreme point that a waypoint already stands on', () => {
    const steps = routeTimeline({ ...timelineRoute, geometry: northward([400, 440, 420, 405]) }, [at(1)]);

    expect(steps.map(({ kind }) => kind)).toEqual(['start', 'waypoint', 'finish']);
  });
});

describe('reverseRoute', () => {
  const geometry = northward([400, 410, 420, 415, 425, 425]);
  const original: Route = {
    ...route,
    geometry,
    distance: 0.5,
    elevationGain: 30,
    elevationLoss: 5,
    estimatedDuration: 6,
    surfaces: [
      { surface: 'paved', from: 0, to: 0.2 },
      { surface: 'unpaved', from: 0.2, to: 0.5 },
    ],
    unpavedShare: 0.6,
  };

  it('runs the route the other way: the points reversed, the climb and the descent swapped', () => {
    const reversed = reverseRoute(original, 6);

    expect(reversed.geometry).toEqual([...geometry].reverse());
    expect(reversed.elevationGain).toBe(5);
    expect(reversed.elevationLoss).toBe(30);
    expect(reversed.distance).toBe(0.5);
    expect(reversed.unpavedShare).toBe(0.6);
  });

  it('turns the surface stretches round, keeping them in order', () => {
    const { surfaces } = reverseRoute(original, 6);

    expect(surfaces.map(({ surface }) => surface)).toEqual(['unpaved', 'paved']);
    expect(surfaces[0]!.from).toBeCloseTo(0, 5);
    expect(surfaces[0]!.to).toBeCloseTo(0.3, 5);
    expect(surfaces[1]!.from).toBeCloseTo(0.3, 5);
    expect(surfaces[1]!.to).toBeCloseTo(0.5, 5);
  });

  it('turns the technical stretches round too', () => {
    const { technicalStretches } = reverseRoute(
      {
        ...original,
        technical: true,
        technicalStretches: [
          { from: 0.1, to: 0.2 },
          { from: 0.4, to: 0.5 },
        ],
      },
      6,
    );

    expect(technicalStretches).toHaveLength(2);
    expect(technicalStretches[0]!.from).toBeCloseTo(0, 5);
    expect(technicalStretches[0]!.to).toBeCloseTo(0.1, 5);
    expect(technicalStretches[1]!.from).toBeCloseTo(0.3, 5);
    expect(technicalStretches[1]!.to).toBeCloseTo(0.4, 5);
  });

  it('estimates the duration again from the new climb, ', () => {
    const reversed = reverseRoute(original, 6);

    expect(reversed.estimatedDuration).toBeCloseTo(0.5 * effortFactor(reversed.geometry) * 6, 5);
  });

  it('leaves a route without heights as it is, but turned round', () => {
    const flat: Route = { ...original, geometry: geometry.map(([lon, lat]): [number, number] => [lon, lat]) };
    delete flat.elevationGain;
    delete flat.elevationLoss;

    const reversed = reverseRoute(flat, 6);

    expect(reversed).not.toHaveProperty('elevationGain');
    expect(reversed.geometry[0]).toEqual([geometry.at(-1)![0], geometry.at(-1)![1]]);
  });

  it('gives the original back when reversed twice', () => {
    const twice = reverseRoute(reverseRoute(original, 6), 6);

    expect(twice.geometry).toEqual(original.geometry);
    expect(twice.elevationGain).toBe(original.elevationGain);
    expect(twice.elevationLoss).toBe(original.elevationLoss);
    expect(twice.surfaces[0]!.to).toBeCloseTo(0.2, 5);
    expect(twice.reversed).toBeUndefined();
  });

  it('keeps the waypoints numbered as on the map, in the order they are met on the way back', () => {
    const at = (k: number): Position => [geometry[k][0], geometry[k][1]];
    const reversed = reverseRoute(original, 6);

    const onRoute = waypointsOnRoute(reversed.geometry, [at(1), at(3)], reversed.reversed);
    const steps = routeTimeline(reversed, [at(1), at(3)]).filter(({ kind }) => kind === 'waypoint');

    expect(onRoute.map(({ number }) => number)).toEqual([1, 2]);
    expect(onRoute[0]!.distance).toBeCloseTo(0.4, 2);
    expect(onRoute[1]!.distance).toBeCloseTo(0.2, 2);
    expect(steps.map(({ number }) => number)).toEqual([2, 1]);
  });
});

describe('nearestOnRoute', () => {
  const geometry = [
    [6, 45],
    [6, 45.01],
  ];

  it('measures to the segment and says where along the route that is', () => {
    const { metres, along } = nearestOnRoute(geometry, [6 + 0.0005, 45.005]);

    expect(metres).toBeCloseTo(0.0005 * Math.cos((45 * Math.PI) / 180) * METRES_PER_DEGREE, 0);
    expect(along).toBeCloseTo(0.5, 5);
  });

  it('gives no distance for a position beyond the reach, so the route is not measured for it', () => {
    expect(nearestOnRoute(geometry, [6.01, 45.005], 100).metres).toBe(Infinity);
    expect(nearestOnRoute(geometry, [6.0005, 45.005], 100).metres).toBeLessThan(100);
  });
});
