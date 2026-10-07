import type { SurfaceStretch } from '../contract/index.ts';
import {
  elevationProfile,
  missText,
  parseRoutes,
  projectOnSnapshot,
  toMercator,
  positionAt,
  midpoint,
  markerInterval,
  distanceMarkers,
  projectRoute,
  gradeAt,
  surfaceAt,
  type MapSnapshot,
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
  technical: false,
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
    { surface: 'paved', share: 0.7 },
    { surface: 'unpaved', share: 0.3 },
  ];

  it.each([
    ['at the start', 0, 'paved'],
    ['in the first stretch', 0.5, 'paved'],
    ['in the second stretch', 0.85, 'unpaved'],
    ['at the end', 1, 'unpaved'],
  ])('gives the surface %s', (_, fraction, expected) => {
    expect(surfaceAt(surfaces, fraction)).toBe(expected);
  });

  it('keeps the last surface when the shares fall short of the end', () => {
    expect(surfaceAt([{ surface: 'unpaved', share: 0.4 }], 0.9)).toBe('unpaved');
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
