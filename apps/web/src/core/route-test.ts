import {
  elevationProfile,
  missText,
  parseRoutes,
  toMercator,
  positionAt,
  projectRoute,
  slopeClass,
  type ProfilePoint,
  type Route,
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
  misses: [],
  unpavedShare: 0.3,
  surfaces: [
    { surface: 'paved', share: 0.7 },
    { surface: 'unpaved', share: 0.3 },
  ],
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
    ['an unknown kind', { routes: [{ ...route, kind: 'perfect' }] }],
    ['an unknown missed criterion', { routes: [{ ...route, misses: [{ criterion: 'surface', gap: 1 }] }] }],
    ['an unknown surface', { routes: [{ ...route, surfaces: [{ surface: 'ice', share: 1 }] }] }],
  ])('refuses an answer with %s', (_, body) => {
    expect(parseRoutes(body)).toBeUndefined();
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

describe('slopeClass', () => {
  it.each([
    ['downhill', -12, 1],
    ['flat', 0, 1],
    ['gentle', 2.9, 1],
    ['moderate', 3, 2],
    ['steep', 6, 3],
    ['very steep', 10, 3],
    ['steeper', 10.1, 4],
  ])('classes a %s grade', (_, grade, expected) => {
    expect(slopeClass(grade)).toBe(expected);
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

describe('missText', () => {
  const metric = { units: 'metric', language: 'en' } as const;

  it.each([
    ['a distance too long', { criterion: 'distance', gap: 2 }, { distance: 12 }, '+20% distance'],
    ['a distance too short', { criterion: 'distance', gap: -2 }, { distance: 8 }, '-20% distance'],
    ['a duration too long', { criterion: 'duration', gap: 15 }, { estimatedDuration: 75 }, '+25% duration'],
    ['too much climb', { criterion: 'elevationGain', gap: 120 }, { elevationGain: 520 }, '+30% elevation gain'],
  ] as const)('gives %s as a share of the target', (_, miss, values, expected) => {
    expect(missText(miss, { ...route, ...values }, metric)).toBe(expected);
  });

  it('gives a gap in elevation gain in metres when the target is too small for a share', () => {
    expect(missText({ criterion: 'elevationGain', gap: 80 }, { ...route, elevationGain: 80 }, metric)).toBe(
      '+80 m elevation gain',
    );
  });

  it('follows the language and the units', () => {
    const miss = { criterion: 'elevationGain', gap: 80 } as const;

    expect(missText(miss, { ...route, elevationGain: 90 }, { units: 'imperial', language: 'fr' })).toBe(
      '+262 ft de dénivelé',
    );
  });
});

describe('projectRoute', () => {
  const box = { width: 100, height: 100, margin: 10 };

  it('fits the route in the box with north up', () => {
    const { points } = projectRoute(
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
    const { points } = projectRoute(
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
    expect(projectRoute([[6, 45]], box).points).toEqual([[50, 50]]);
  });

  it('gives the area the box covers on the map, in Web Mercator metres', () => {
    const { bounds } = projectRoute(
      [
        [0, 0],
        [0.1, 0.1],
      ],
      box,
    );

    const [west, south, east, north] = bounds;
    // The route spans 11 132 m by 11 132 m inside a margin of an eighth of the box on each side.
    expect(east - west).toBeCloseTo(11_132 * 1.25, -2);
    expect(north - south).toBeCloseTo(11_132 * 1.25, -2);
    expect((west + east) / 2).toBeCloseTo(5_566, -1);
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
