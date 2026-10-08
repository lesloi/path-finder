import type { Position } from './coordinates.ts';
import { roadbookCues, type Poi } from './roadbook.ts';
import type { Route } from './route.ts';

const METRES_PER_DEGREE = 111_195;
const [LON, LAT] = [6.1294, 45.8992];
const COS = Math.cos((LAT * Math.PI) / 180);

// A position `east` and `north` metres from the start.
const at = (east: number, north: number): Position => [
  LON + east / (METRES_PER_DEGREE * COS),
  LAT + north / METRES_PER_DEGREE,
];

// A route through these corners (metres east and north of the start), with a heights per corner when given.
function routeThrough(corners: [number, number][], heights?: number[], overrides: Partial<Route> = {}): Route {
  const geometry = corners.map(([east, north], k) => (heights ? [...at(east, north), heights[k]] : at(east, north)));
  let metres = 0;
  for (let k = 1; k < corners.length; k++) {
    metres += Math.hypot(corners[k][0] - corners[k - 1][0], corners[k][1] - corners[k - 1][1]);
  }
  return {
    geometry: geometry as Route['geometry'],
    distance: metres / 1000,
    estimatedDuration: 60,
    kind: 'match',
    misses: [],
    unpavedShare: 0,
    surfaces: [{ surface: 'paved', from: 0, to: metres / 1000 }],
    technical: false,
    ...overrides,
  };
}

const metric = { units: 'metric', language: 'en' } as const;
const kinds = (cues: { kind: string }[]) => cues.map(({ kind }) => kind);
const water = (east: number, north: number, seasonal = false): Poi => ({
  position: at(east, north),
  category: 'water',
  seasonal,
});

describe('roadbookCues', () => {
  it('holds the start and the finish of a straight line, and nothing else', () => {
    const cues = roadbookCues(
      routeThrough([
        [0, 0],
        [0, 2000],
      ]),
      [],
      [],
      metric,
    );

    expect(cues).toEqual([
      { kind: 'start', distance: 0, text: 'Start' },
      { kind: 'finish', distance: 2, text: 'Finish: back at the start' },
    ]);
  });

  it('holds the start and the finish of a route under 1 km', () => {
    const cues = roadbookCues(
      routeThrough([
        [0, 0],
        [0, 400],
      ]),
      [],
      [],
      metric,
    );

    expect(cues.map(({ kind, distance }) => [kind, distance])).toEqual([
      ['start', 0],
      ['finish', 0.4],
    ]);
  });

  describe('turns', () => {
    it('marks a sharp turn at the corner, on the side it turns to', () => {
      const cues = roadbookCues(
        routeThrough([
          [0, 0],
          [0, 1000],
          [1000, 1000],
        ]),
        [],
        [],
        metric,
      );

      expect(cues.map(({ kind, text }) => [kind, text])).toEqual([
        ['start', 'Start'],
        ['turn', 'Turn right'],
        ['finish', 'Finish: back at the start'],
      ]);
      expect(cues[1].distance).toBeCloseTo(1, 1);
    });

    it('turns left and in French', () => {
      const cues = roadbookCues(
        routeThrough([
          [0, 0],
          [0, 1000],
          [-1000, 1000],
        ]),
        [],
        [],
        {
          units: 'metric',
          language: 'fr',
        },
      );

      expect(cues[1].text).toBe('Tourner à gauche');
    });

    it('leaves out a bend under the threshold', () => {
      const cues = roadbookCues(
        routeThrough([
          [0, 0],
          [0, 1000],
          [700, 1700],
        ]),
        [],
        [],
        metric,
      );

      expect(kinds(cues)).toEqual(['start', 'finish']);
    });

    it('leaves out a wide bend made of small turns', () => {
      const bend = Array.from({ length: 19 }, (_, k): [number, number] => {
        const angle = (k * 5 * Math.PI) / 180;
        return [300 * (1 - Math.cos(angle)), 1000 + 300 * Math.sin(angle)];
      });
      const cues = roadbookCues(routeThrough([[0, 0], [0, 1000], ...bend, [1300, 1300]]), [], [], metric);

      expect(kinds(cues)).toEqual(['start', 'finish']);
    });

    it('keeps the first of two turns within 100 m', () => {
      const cues = roadbookCues(
        routeThrough([
          [0, 0],
          [0, 1000],
          [60, 1000],
          [60, 2000],
        ]),
        [],
        [],
        metric,
      );

      expect(kinds(cues)).toEqual(['start', 'turn', 'finish']);
      expect(cues[1].text).toBe('Turn right');
    });

    it('keeps both turns when they are further than 100 m apart', () => {
      const cues = roadbookCues(
        routeThrough([
          [0, 0],
          [0, 1000],
          [200, 1000],
          [200, 2000],
        ]),
        [],
        [],
        metric,
      );

      expect(kinds(cues)).toEqual(['start', 'turn', 'turn', 'finish']);
    });
  });

  describe('surfaces', () => {
    it('marks where a stretch of 200 m or more starts', () => {
      const route = routeThrough(
        [
          [0, 0],
          [0, 2000],
        ],
        undefined,
        {
          surfaces: [
            { surface: 'paved', from: 0, to: 1 },
            { surface: 'unpaved', from: 1, to: 2 },
          ],
        },
      );

      const cues = roadbookCues(route, [], [], metric);

      expect(cues.map(({ kind, distance, text }) => [kind, distance, text])).toEqual([
        ['start', 0, 'Start'],
        ['surface', 1, 'Unpaved section'],
        ['finish', 2, 'Finish: back at the start'],
      ]);
    });

    it('ignores a flicker under 200 m', () => {
      const route = routeThrough(
        [
          [0, 0],
          [0, 2000],
        ],
        undefined,
        {
          surfaces: [
            { surface: 'paved', from: 0, to: 0.9 },
            { surface: 'unpaved', from: 0.9, to: 1.05 },
            { surface: 'paved', from: 1.05, to: 2 },
          ],
        },
      );

      expect(kinds(roadbookCues(route, [], [], metric))).toEqual(['start', 'finish']);
    });

    it('keeps a change that follows a flicker', () => {
      const route = routeThrough(
        [
          [0, 0],
          [0, 2000],
        ],
        undefined,
        {
          surfaces: [
            { surface: 'paved', from: 0, to: 0.5 },
            { surface: 'unpaved', from: 0.5, to: 0.6 },
            { surface: 'paved', from: 0.6, to: 1 },
            { surface: 'unpaved', from: 1, to: 2 },
          ],
        },
      );

      const cues = roadbookCues(route, [], [], metric);

      expect(cues.filter(({ kind }) => kind === 'surface').map(({ distance }) => distance)).toEqual([1]);
    });

    it('ignores a short stretch at the end, and one at the start', () => {
      const route = routeThrough(
        [
          [0, 0],
          [0, 2000],
        ],
        undefined,
        {
          surfaces: [
            { surface: 'unpaved', from: 0, to: 0.1 },
            { surface: 'paved', from: 0.1, to: 1.9 },
            { surface: 'unpaved', from: 1.9, to: 2 },
          ],
        },
      );

      expect(kinds(roadbookCues(route, [], [], metric))).toEqual(['start', 'finish']);
    });

    it('words the surfaces in French', () => {
      const route = routeThrough(
        [
          [0, 0],
          [0, 2000],
        ],
        undefined,
        {
          surfaces: [
            { surface: 'unpaved', from: 0, to: 1 },
            { surface: 'paved', from: 1, to: 2 },
          ],
        },
      );

      const cues = roadbookCues(route, [], [], { units: 'metric', language: 'fr' });

      expect(cues[1].text).toBe('Section goudronnée');
    });
  });

  describe('climbs and descents', () => {
    // A straight line north, a point every 100 m at these heights.
    const climbing = (heights: number[]) =>
      routeThrough(
        heights.map((_, k): [number, number] => [0, k * 100]),
        heights,
      );

    it('marks a sustained climb where it starts', () => {
      const cues = roadbookCues(climbing([100, 100, 100, 130, 160, 190, 190, 190]), [], [], metric);

      expect(cues.map(({ kind, distance, text }) => [kind, distance, text])).toEqual([
        ['start', 0, 'Start'],
        ['climb', 0.2, 'Climb: +90 m over 0.3 km (30%)'],
        ['finish', 0.7, 'Finish: back at the start'],
      ]);
    });

    it('marks a sustained descent', () => {
      const cues = roadbookCues(climbing([190, 190, 160, 130, 100, 100]), [], [], metric);

      expect(cues.filter(({ kind }) => kind !== 'start' && kind !== 'finish')).toEqual([
        { kind: 'descent', distance: 0.1, text: 'Descent: -90 m over 0.3 km (30%)' },
      ]);
    });

    it('marks a descent that follows a climb', () => {
      const cues = roadbookCues(climbing([100, 100, 130, 160, 190, 160, 130, 100, 100]), [], [], metric);

      expect(cues.filter(({ kind }) => kind === 'climb' || kind === 'descent').map(({ kind }) => kind)).toEqual([
        'climb',
        'descent',
      ]);
    });

    it('needs 20 m of gain even when the grade is steep', () => {
      const cues = roadbookCues(climbing([100, 106, 112, 118, 118, 118]), [], [], metric);

      expect(kinds(cues)).toEqual(['start', 'finish']);
    });

    it('needs a 5 % grade', () => {
      const cues = roadbookCues(climbing([100, 104, 108, 112, 116, 120, 124, 128, 132, 136]), [], [], metric);

      expect(kinds(cues)).toEqual(['start', 'finish']);
    });

    it('needs 300 m', () => {
      const cues = roadbookCues(climbing([100, 100, 150, 150, 150]), [], [], metric);

      expect(kinds(cues)).toEqual(['start', 'finish']);
    });

    it('holds none without elevation data', () => {
      const flat = routeThrough([
        [0, 0],
        [0, 1000],
      ]);

      expect(kinds(roadbookCues(flat, [], [], metric))).toEqual(['start', 'finish']);
    });

    it('writes heights in feet and lengths in miles in imperial units', () => {
      const cues = roadbookCues(climbing([100, 100, 100, 130, 160, 190, 190, 190]), [], [], {
        units: 'imperial',
        language: 'en',
      });

      expect(cues[1].text).toBe('Climb: +295 ft over 0.2 mi (30%)');
    });

    it('words a climb in French', () => {
      const cues = roadbookCues(climbing([100, 100, 100, 130, 160, 190, 190, 190]), [], [], {
        units: 'metric',
        language: 'fr',
      });

      expect(cues[1].text).toBe('Montée : +90 m sur 0,3 km (30\u00a0%)');
    });
  });

  describe('technical stretches', () => {
    it('are noted right after the start when the route holds one', () => {
      const cues = roadbookCues(
        routeThrough(
          [
            [0, 0],
            [0, 2000],
          ],
          undefined,
          { technical: true },
        ),
        [],
        [],
        metric,
      );

      expect(cues.map(({ kind, distance }) => [kind, distance])).toEqual([
        ['start', 0],
        ['technical', 0],
        ['finish', 2],
      ]);
    });
  });

  describe('points of interest', () => {
    const straight = routeThrough([
      [0, 0],
      [0, 2000],
    ]);

    it('marks a shown point within 50 m of the route', () => {
      const cues = roadbookCues(straight, [water(40, 1000)], ['water'], metric);

      expect(cues.map(({ kind, text }) => [kind, text])).toEqual([
        ['start', 'Start'],
        ['poi', 'Water point'],
        ['finish', 'Finish: back at the start'],
      ]);
      expect(cues[1].distance).toBeCloseTo(1, 3);
    });

    it('leaves out a point beyond 50 m', () => {
      expect(kinds(roadbookCues(straight, [water(60, 1000)], ['water'], metric))).toEqual(['start', 'finish']);
    });

    it('leaves out a category the user does not show', () => {
      const viewpoint: Poi = { position: at(10, 1000), category: 'viewpoint' };

      expect(kinds(roadbookCues(straight, [water(10, 500), viewpoint], ['viewpoint'], metric))).toEqual([
        'start',
        'poi',
        'finish',
      ]);
      expect(kinds(roadbookCues(straight, [viewpoint], [], metric))).toEqual(['start', 'finish']);
    });

    it('marks a seasonal water point as seasonal', () => {
      const [, cue] = roadbookCues(straight, [water(0, 1000, true)], ['water'], metric);

      expect(cue.text).toBe('Water point (seasonal)');
      expect(
        roadbookCues(straight, [water(0, 1000, true)], ['water'], { units: 'metric', language: 'fr' })[1].text,
      ).toBe('Point d’eau (saisonnier)');
    });

    it('marks a point once for each pass of a loop through the same place', () => {
      const loop = routeThrough([
        [0, 0],
        [0, 1000],
        [1000, 1000],
        [1000, 0],
        [0, 0],
        [0, -1000],
        [-1000, -1000],
        [-1000, 0],
        [0, 0],
      ]);
      const cues = roadbookCues(loop, [water(0, 0)], ['water'], metric);

      const passes = cues.filter(({ kind }) => kind === 'poi').map(({ distance }) => distance);
      expect(passes).toHaveLength(3);
      passes.forEach((distance, k) => expect(distance).toBeCloseTo(k * 4, 2));
    });
  });

  describe('order', () => {
    it('follows the distance, from the start to the finish, whatever the kind', () => {
      const route = routeThrough(
        [
          [0, 0],
          [0, 1000],
          [1000, 1000],
        ],
        [100, 100, 100],
        {
          technical: true,
          surfaces: [
            { surface: 'paved', from: 0, to: 1.6 },
            { surface: 'unpaved', from: 1.6, to: 2 },
          ],
        },
      );

      const cues = roadbookCues(route, [water(500, 1000), water(0, 400)], ['water'], metric);

      expect(kinds(cues)).toEqual(['start', 'technical', 'poi', 'turn', 'poi', 'surface', 'finish']);
      const distances = cues.map(({ distance }) => distance);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
    });

    it('puts the finish last even when the route is a little shorter than its stretches', () => {
      const route = routeThrough(
        [
          [0, 0],
          [0, 2000],
        ],
        undefined,
        {
          distance: 1.99,
          surfaces: [
            { surface: 'paved', from: 0, to: 1 },
            { surface: 'unpaved', from: 1, to: 2.01 },
          ],
        },
      );

      expect(kinds(roadbookCues(route, [water(0, 1995)], ['water'], metric)).at(-1)).toBe('finish');
    });
  });
});
