import { buildRouteSet, targetDistance, type Candidate, type Criteria, type Position, type Route } from './index.ts';

const START: Position = [6.1294, 45.8992];

// Metres east and north of the start point.
function at(x: number, y: number): Position {
  return [START[0] + x / (111_320 * Math.cos((START[1] * Math.PI) / 180)), START[1] + y / 110_540];
}

// A wedge-shaped loop of about 5 km heading away from the start point, so loops with
// headings 60° apart share nothing but the start point.
function loop(heading: number): Position[] {
  const corner = (bearing: number) => {
    const radians = (bearing * Math.PI) / 180;
    return at(2_000 * Math.sin(radians), 2_000 * Math.cos(radians));
  };
  return [START, corner(heading - 20), corner(heading + 20), START];
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return { geometry: loop(0), distance: 10, elevationGain: 300, unpavedShare: 0.5, ...overrides };
}

const criteria: Criteria = {
  start: START,
  target: { distance: 10 },
  elevationGain: 300,
  surface: 'any',
  pace: 6,
};

describe('buildRouteSet', () => {
  it('keeps a route within 10 % of the target distance as a match', () => {
    const routeSet = buildRouteSet(criteria, [candidate({ distance: 10.9 })]);

    expect(routeSet).toMatchObject([{ distance: 10.9, kind: 'match', misses: [] }]);
  });

  it('keeps a route within 25 % of the target distance as a suggestion, with the gap', () => {
    const routeSet = buildRouteSet(criteria, [candidate({ distance: 7.6 })]);

    expect(routeSet).toMatchObject([{ kind: 'suggestion', misses: [{ criterion: 'distance', gap: expect.closeTo(-2.4) }] }]);
  });

  it('drops a route more than 25 % off the target distance', () => {
    expect(buildRouteSet(criteria, [candidate({ distance: 12.6 })])).toEqual([]);
  });

  it('marks a route off the target elevation gain by more than 20 % as a suggestion', () => {
    const routeSet = buildRouteSet(criteria, [candidate({ elevationGain: 420 })]);

    expect(routeSet).toMatchObject([{ kind: 'suggestion', misses: [{ criterion: 'elevationGain', gap: 120 }] }]);
  });

  it('drops a route off the target elevation gain by more than 50 %', () => {
    expect(buildRouteSet(criteria, [candidate({ elevationGain: 460 })])).toEqual([]);
  });

  it('allows at least 50 m of elevation gain for a match and 100 m for a suggestion', () => {
    const flat = { ...criteria, elevationGain: 0 };

    const routeSet = buildRouteSet(flat, [
      candidate({ elevationGain: 50, geometry: loop(0) }),
      candidate({ elevationGain: 100, geometry: loop(120) }),
      candidate({ elevationGain: 101, geometry: loop(240) }),
    ]);

    expect(routeSet).toMatchObject([
      { elevationGain: 50, kind: 'match' },
      { elevationGain: 100, kind: 'suggestion', misses: [{ criterion: 'elevationGain', gap: 100 }] },
    ]);
  });

  it('only checks the distance without a target elevation gain', () => {
    const routeSet = buildRouteSet({ ...criteria, elevationGain: undefined }, [candidate({ elevationGain: 2_000 })]);

    expect(routeSet).toMatchObject([{ kind: 'match', misses: [] }]);
  });

  it('only checks the distance on a route without elevation gain', () => {
    const routeSet = buildRouteSet({ ...criteria, elevationGain: 'hilly' }, [candidate({ elevationGain: undefined })]);

    expect(routeSet).toMatchObject([{ kind: 'match', misses: [] }]);
  });

  describe('with the hilly shortcut', () => {
    const hilly: Criteria = { ...criteria, elevationGain: 'hilly' };

    it('keeps a route with at least 10 m of elevation gain per km as a match', () => {
      expect(buildRouteSet(hilly, [candidate({ elevationGain: 900 })])).toMatchObject([{ kind: 'match', misses: [] }]);
    });

    it('marks a route with at least 5 m per km as a suggestion, with the gap below hilly', () => {
      const routeSet = buildRouteSet(hilly, [candidate({ elevationGain: 60 })]);

      expect(routeSet).toMatchObject([{ kind: 'suggestion', misses: [{ criterion: 'elevationGain', gap: -40 }] }]);
    });

    it('drops a route with less than 5 m per km', () => {
      expect(buildRouteSet(hilly, [candidate({ elevationGain: 40 })])).toEqual([]);
    });

    it('ranks routes within the bound on distance alone', () => {
      const routeSet = buildRouteSet(hilly, [
        candidate({ geometry: loop(0), distance: 10.2, elevationGain: 110 }),
        candidate({ geometry: loop(120), distance: 10.1, elevationGain: 800 }),
      ]);

      expect(routeSet.map(({ distance }) => distance)).toEqual([10.1, 10.2]);
    });
  });

  describe('with the flat shortcut', () => {
    const flat: Criteria = { ...criteria, elevationGain: 'flat' };

    it('keeps a route with at most 10 m of elevation gain per km as a match', () => {
      expect(buildRouteSet(flat, [candidate({ elevationGain: 100 })])).toMatchObject([{ kind: 'match', misses: [] }]);
    });

    it('marks a route with up to 20 m per km as a suggestion, with the gap above flat', () => {
      const routeSet = buildRouteSet(flat, [candidate({ elevationGain: 160 })]);

      expect(routeSet).toMatchObject([{ kind: 'suggestion', misses: [{ criterion: 'elevationGain', gap: 60 }] }]);
    });

    it('drops a route with more than 20 m per km', () => {
      expect(buildRouteSet(flat, [candidate({ elevationGain: 210 })])).toEqual([]);
    });
  });

  it('estimates the duration from the effort distance and the pace', () => {
    // 10 km + 300 m of elevation gain = 13 km of effort distance, at 6:00 min/km.
    const routeSet = buildRouteSet(criteria, [candidate({ distance: 10, elevationGain: 300 })]);

    expect(routeSet).toMatchObject([{ estimatedDuration: 78 }]);
  });

  it('estimates the duration from the distance alone on a route without elevation gain', () => {
    const routeSet = buildRouteSet(criteria, [candidate({ distance: 10, elevationGain: undefined })]);

    expect(routeSet).toMatchObject([{ estimatedDuration: 60 }]);
  });

  describe('with a target duration', () => {
    const byDuration: Criteria = { ...criteria, target: { duration: 67 } };

    it('keeps a route within 10 % of the target duration as a match', () => {
      // 8.5 km + 300 m = 11.5 km of effort distance, 69 min at 6:00 min/km.
      const routeSet = buildRouteSet(byDuration, [candidate({ distance: 8.5 })]);

      expect(routeSet).toMatchObject([{ kind: 'match', misses: [] }]);
    });

    it('marks a route off the target duration by more than 10 % as a suggestion', () => {
      const routeSet = buildRouteSet(byDuration, [candidate({ distance: 10 })]);

      expect(routeSet).toMatchObject([{ kind: 'suggestion', misses: [{ criterion: 'duration', gap: 11 }] }]);
    });

    it('drops a route off the target duration by more than 25 %', () => {
      expect(buildRouteSet(byDuration, [candidate({ distance: 12 })])).toEqual([]);
    });
  });
});

describe('buildRouteSet composition', () => {
  const match = (heading: number) => candidate({ geometry: loop(heading) });
  const suggestion = (heading: number) => candidate({ geometry: loop(heading), distance: 8 });
  const kinds = (routeSet: { kind: string }[]) => routeSet.map(({ kind }) => kind);

  it('lists matches before suggestions', () => {
    expect(kinds(buildRouteSet(criteria, [suggestion(0), match(120)]))).toEqual(['match', 'suggestion']);
  });

  it('keeps at most five matches', () => {
    const candidates = [0, 50, 100, 150, 200, 250, 300].map(match);

    expect(kinds(buildRouteSet(criteria, candidates))).toEqual(['match', 'match', 'match', 'match', 'match']);
  });

  it('fills up to three routes with suggestions when there are too few matches', () => {
    const candidates = [match(0), ...[60, 120, 180, 240, 300].map(suggestion)];

    expect(kinds(buildRouteSet(criteria, candidates))).toEqual(['match', 'suggestion', 'suggestion']);
  });

  it('leaves suggestions out once there are three matches', () => {
    const candidates = [...[0, 60, 120, 180].map(match), suggestion(240), suggestion(300)];

    expect(kinds(buildRouteSet(criteria, candidates))).toEqual(['match', 'match', 'match', 'match']);
  });

  it('returns three suggestions when nothing matches', () => {
    const candidates = [0, 60, 120, 180, 240].map(suggestion);

    expect(kinds(buildRouteSet(criteria, candidates))).toEqual(['suggestion', 'suggestion', 'suggestion']);
  });

  it('returns a single route when only one candidate fits', () => {
    expect(buildRouteSet(criteria, [match(0), candidate({ distance: 20 })])).toHaveLength(1);
  });
});

describe('buildRouteSet ranking', () => {
  const distances = (routeSet: { distance: number }[]) => routeSet.map(({ distance }) => distance);

  it('ranks routes closer to the criteria first', () => {
    const routeSet = buildRouteSet(criteria, [
      candidate({ geometry: loop(0), distance: 10.6 }),
      candidate({ geometry: loop(120), distance: 9.8, elevationGain: 305 }),
      candidate({ geometry: loop(240), distance: 10.2 }),
    ]);

    expect(distances(routeSet)).toEqual([10.2, 9.8, 10.6]);
  });

  it('ranks suggestions closer to the criteria first', () => {
    const routeSet = buildRouteSet(criteria, [
      candidate({ geometry: loop(0), distance: 7.6 }),
      candidate({ geometry: loop(120), distance: 11.2 }),
    ]);

    expect(distances(routeSet)).toEqual([11.2, 7.6]);
  });

  it.each([
    ['unpaved', [0.9, 0.2]],
    ['paved', [0.2, 0.9]],
  ] as const)('ranks routes by the %s surface preference without dropping any', (surface, expected) => {
    const routeSet = buildRouteSet({ ...criteria, surface }, [
      candidate({ geometry: loop(0), unpavedShare: 0.2 }),
      candidate({ geometry: loop(120), unpavedShare: 0.9 }),
    ]);

    expect(routeSet.map(({ unpavedShare }) => unpavedShare)).toEqual(expected);
  });

  it('ranks out-and-back routes after loops', () => {
    const outAndBack = [START, at(0, -2_500), START];

    const routeSet = buildRouteSet(criteria, [candidate({ geometry: outAndBack }), candidate({ geometry: loop(0) })]);

    expect(routeSet.map(({ geometry }) => geometry)).toEqual([loop(0), outAndBack]);
  });

  it('does not count weaving along a grid cell edge as walking twice', () => {
    // Heads north zigzagging 3 m either side of the start point's meridian, then comes back
    // along another side.
    const zigzag = [START, ...Array.from({ length: 100 }, (_, i) => at(i % 2 ? 3 : -3, 20 * (i + 1))), at(700, 1_900), START];

    const routeSet = buildRouteSet(criteria, [candidate({ geometry: zigzag }), candidate({ geometry: loop(120) })]);

    expect(routeSet.map(({ geometry }) => geometry)).toEqual([zigzag, loop(120)]);
  });
});

describe('buildRouteSet diversity', () => {
  const headings = (routeSet: Route[]) => routeSet.map(({ geometry }) => geometry);

  it('leaves out a route sharing most of its geometry with a better one', () => {
    const better = candidate({ geometry: loop(0), distance: 10 });
    const same = candidate({ geometry: loop(0), distance: 10.1 });
    const other = candidate({ geometry: loop(120), distance: 10.2 });

    expect(headings(buildRouteSet(criteria, [same, other, better]))).toEqual([loop(0), loop(120)]);
  });

  it('compares shared geometry with the shorter of two routes', () => {
    // Out and back along the first side of the 0° loop: all of it is shared, but only about
    // a third of the loop.
    const [, corner] = loop(0);
    const spur = [START, corner, START];

    const routeSet = buildRouteSet(criteria, [candidate({ geometry: loop(0) }), candidate({ geometry: spur })]);

    expect(headings(routeSet)).toEqual([loop(0)]);
  });

  it('ignores the stretch around the start point', () => {
    // Both routes leave along the same street for 490 m, then make small separate loops.
    const west = [START, at(0, 490), at(-150, 650), at(-150, 490), at(0, 490), START];
    const east = [START, at(0, 490), at(150, 650), at(150, 490), at(0, 490), START];

    const routeSet = buildRouteSet(criteria, [candidate({ geometry: west }), candidate({ geometry: east })]);

    expect(headings(routeSet)).toEqual([west, east]);
  });

  it('shrinks the stretch around the start point for short routes', () => {
    // A 1.2 km loop that stays within 500 m of the start point.
    const small = [START, at(-150, 400), at(150, 400), START];
    const short: Criteria = { ...criteria, target: { distance: 2 } };

    const routeSet = buildRouteSet(short, [candidate({ geometry: small, distance: 2 }), candidate({ geometry: small, distance: 2 })]);

    expect(routeSet).toHaveLength(1);
  });
});

describe('targetDistance', () => {
  it('is the target distance when the criteria give one', () => {
    expect(targetDistance(criteria)).toBe(10);
  });

  it('derives the distance from the target duration, the pace, and the target elevation gain', () => {
    // 78 min at 6:00 min/km = 13 km of effort distance, minus 3 km for 300 m of climb.
    expect(targetDistance({ ...criteria, target: { duration: 78 } })).toBe(10);
  });

  it('derives the distance from the target duration alone without a target elevation gain', () => {
    expect(targetDistance({ ...criteria, target: { duration: 78 }, elevationGain: undefined })).toBe(13);
  });

  it('derives the distance from the target duration alone with the flat shortcut', () => {
    expect(targetDistance({ ...criteria, target: { duration: 78 }, elevationGain: 'flat' })).toBe(13);
  });

  it('leaves room for the least climb of the hilly shortcut', () => {
    // 66 min at 6:00 min/km = 11 km of effort distance: 10 km, plus 100 m of climb at 10 m per km.
    expect(targetDistance({ ...criteria, target: { duration: 66 }, elevationGain: 'hilly' })).toBeCloseTo(10);
  });

  it.each([
    [400, 'too short'],
    [600, 'negative'],
  ])('rejects a target duration too short for %i m of climb (%s distance)', (elevationGain) => {
    // 30 min at 6:00 min/km = 5 km of effort distance, less than the climb alone needs.
    expect(() => targetDistance({ ...criteria, target: { duration: 30 }, elevationGain })).toThrow(RangeError);
  });
});
