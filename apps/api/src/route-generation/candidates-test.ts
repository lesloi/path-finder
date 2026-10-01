import {
  generateCandidates,
  surfaceStretches,
  unpavedShare,
  type Criteria,
  type EngineLoop,
  type LoopRequest,
  type Position,
  type RoutingEngine,
} from './index.ts';

const START: Position = [6.1294, 45.8992];

const criteria: Criteria = { start: START, target: { distance: 10 }, surface: 'any', pace: 6 };

// A routing engine whose loops come out `ratio` times as long as the radius asked for.
function fakeEngine(ratio = 5): RoutingEngine {
  return async ({ radius, heading }: LoopRequest): Promise<EngineLoop> => ({
    geometry: [START, [heading, radius], START],
    distance: (ratio * radius) / 1000,
    ways: [{ length: ratio * radius, surface: 'gravel' }],
  });
}

const noClimb = () => 0;
const signal = new AbortController().signal;

describe('generateCandidates', () => {
  it('asks for a loop every 18° with a radius of a fifth of the target distance', async () => {
    const engine = vi.fn(fakeEngine(6));

    await generateCandidates(criteria, 'run', engine, noClimb, signal);

    const first = engine.mock.calls.filter(([{ radius }]) => radius === 2_000).map(([{ heading }]) => heading);
    expect(first).toEqual(Array.from({ length: 20 }, (_, i) => i * 18));
  });

  it('asks for loops from the start point with the activity and the surface preference', async () => {
    const engine = vi.fn(fakeEngine());

    await generateCandidates({ ...criteria, surface: 'unpaved' }, 'hike', engine, noClimb, signal);

    expect(engine).toHaveBeenCalledWith(
      expect.objectContaining({ start: START, activity: 'hike', surface: 'unpaved' }),
      signal,
    );
  });

  it('corrects the radius by the target over the first distance and keeps the closer loop', async () => {
    const engine = vi.fn(fakeEngine(6));

    const candidates = await generateCandidates(criteria, 'run', engine, noClimb, signal);

    expect(engine).toHaveBeenCalledTimes(40);
    expect(engine).toHaveBeenCalledWith(expect.objectContaining({ radius: expect.closeTo(2_000 / 1.2) }), signal);
    expect(candidates).toHaveLength(20);
    candidates.forEach(({ distance }) => expect(distance).toBeCloseTo(10));
  });

  it('keeps the first loop when the correction lands farther from the target', async () => {
    const engine: RoutingEngine = (request, signal) => fakeEngine(request.radius === 2_000 ? 5.5 : 7)(request, signal);

    const candidates = await generateCandidates(criteria, 'run', engine, noClimb, signal);

    candidates.forEach(({ distance }) => expect(distance).toBeCloseTo(11));
  });

  it('fills in the elevation gain and the surfaces of each candidate', async () => {
    const elevationGain = vi.fn(() => 120);

    const [candidate] = await generateCandidates(criteria, 'run', fakeEngine(), elevationGain, signal);

    expect(elevationGain).toHaveBeenCalledWith(candidate.geometry);
    expect(candidate).toMatchObject({
      distance: 10,
      elevationGain: 120,
      unpavedShare: 1,
      surfaces: [{ surface: 'unpaved', share: 1 }],
    });
  });

  it('leaves out the elevation gain without a way to measure it', async () => {
    const [candidate] = await generateCandidates(criteria, 'run', fakeEngine(), undefined, signal);

    expect(candidate).not.toHaveProperty('elevationGain');
  });

  it('aims the correction at the target duration with the elevation gain of the first loop', async () => {
    const engine = vi.fn(fakeEngine());
    // 60 min at 6 min/km asks for 10 km; with +300 m that loop is estimated at 78 min.
    const duration: Criteria = { ...criteria, target: { duration: 60 } };

    await generateCandidates(duration, 'run', engine, () => 300, signal);

    expect(engine).toHaveBeenCalledWith(expect.objectContaining({ radius: expect.closeTo((2_000 * 60) / 78) }), signal);
  });

  it('drops a heading whose first call fails, without retrying it', async () => {
    const engine = vi.fn<RoutingEngine>((request, signal) =>
      request.heading === 90 ? Promise.reject(new Error('timeout')) : fakeEngine()(request, signal),
    );

    const candidates = await generateCandidates(criteria, 'run', engine, noClimb, signal);

    expect(candidates).toHaveLength(19);
    expect(engine).toHaveBeenCalledTimes(39);
  });

  it('keeps the first loop when the correction call fails', async () => {
    const engine: RoutingEngine = (request, signal) =>
      request.radius === 2_000 ? fakeEngine(6)(request, signal) : Promise.reject(new Error('timeout'));

    const candidates = await generateCandidates(criteria, 'run', engine, noClimb, signal);

    expect(candidates).toHaveLength(20);
    candidates.forEach(({ distance }) => expect(distance).toBeCloseTo(12));
  });

  it('drops a loop whose elevation gain fails, such as outside France', async () => {
    const elevationGain = ([, [heading]]: Position[]) => {
      if (heading === 90) throw new Error('No BD ALTI data');
      return 0;
    };

    const candidates = await generateCandidates(criteria, 'run', fakeEngine(), elevationGain, signal);

    expect(candidates).toHaveLength(19);
  });

  it('rejects a target duration too short for the target elevation gain', async () => {
    const tooShort: Criteria = { ...criteria, target: { duration: 20 }, elevationGain: 200 };

    await expect(generateCandidates(tooShort, 'run', fakeEngine(), noClimb, signal)).rejects.toThrow(RangeError);
  });
});

describe('unpavedShare', () => {
  it('weighs unpaved surfaces by length', () => {
    expect(
      unpavedShare([
        { length: 300, surface: 'gravel', highway: 'track' },
        { length: 700, surface: 'asphalt', highway: 'residential' },
      ]),
    ).toBeCloseTo(0.3);
  });

  it('falls back to the highway type when a way has no surface', () => {
    expect(unpavedShare([{ length: 100, highway: 'path' }])).toBe(1);
    expect(unpavedShare([{ length: 100, highway: 'footway' }])).toBe(0);
  });

  it('trusts the surface over the highway type', () => {
    expect(unpavedShare([{ length: 100, surface: 'asphalt', highway: 'track' }])).toBe(0);
  });

  it('is 0 for a loop without ways', () => {
    expect(unpavedShare([])).toBe(0);
  });
});

describe('surfaceStretches', () => {
  it('merges consecutive ways of the same surface, in the order of the loop', () => {
    expect(
      surfaceStretches([
        { length: 200, surface: 'asphalt' },
        { length: 200, highway: 'residential' },
        { length: 300, surface: 'gravel' },
        { length: 100, highway: 'path' },
        { length: 200, surface: 'paved' },
      ]),
    ).toEqual([
      { surface: 'paved', share: 0.4 },
      { surface: 'unpaved', share: 0.4 },
      { surface: 'paved', share: 0.2 },
    ]);
  });

  it('gives shares of the length of the ways, which add up to 1', () => {
    const stretches = surfaceStretches([
      { length: 1, surface: 'gravel' },
      { length: 2, surface: 'asphalt' },
    ]);

    expect(stretches.reduce((sum, { share }) => sum + share, 0)).toBeCloseTo(1);
  });

  it('leaves out ways without length', () => {
    expect(
      surfaceStretches([
        { length: 0, surface: 'gravel' },
        { length: 100, surface: 'asphalt' },
      ]),
    ).toEqual([{ surface: 'paved', share: 1 }]);
  });

  it('is empty for a loop without ways', () => {
    expect(surfaceStretches([])).toEqual([]);
  });
});
