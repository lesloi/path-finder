import { parseCriteria } from './index.ts';

const valid = {
  start: [6.1294, 45.8992],
  activity: 'run',
  target: { distance: 10 },
  surface: 'any',
  pace: 6,
};

describe('parseCriteria', () => {
  it('returns the criteria and the activity', () => {
    expect(parseCriteria({ ...valid, elevationGain: 300 })).toEqual({
      activity: 'run',
      criteria: { start: [6.1294, 45.8992], target: { distance: 10 }, elevationGain: 300, surface: 'any', pace: 6 },
    });
  });

  it('accepts a target duration and the flat and hilly shortcuts', () => {
    expect(parseCriteria({ ...valid, target: { duration: 90 }, elevationGain: 'hilly' }).criteria).toMatchObject({
      target: { duration: 90 },
      elevationGain: 'hilly',
    });
    expect(parseCriteria({ ...valid, elevationGain: 'flat' }).criteria.elevationGain).toBe('flat');
  });

  it('leaves out fields it does not know', () => {
    expect(parseCriteria({ ...valid, name: 'x' }).criteria).not.toHaveProperty('name');
  });

  it.each([
    ['a body that is not an object', null],
    ['a missing start point', { ...valid, start: undefined }],
    ['a start point that is not a longitude and a latitude', { ...valid, start: [6.1294] }],
    ['a latitude out of range', { ...valid, start: [6.1294, 91] }],
    ['an unknown activity', { ...valid, activity: 'ride' }],
    ['no target', { ...valid, target: {} }],
    ['both a target distance and a target duration', { ...valid, target: { distance: 10, duration: 60 } }],
    ['a target distance under 2 km', { ...valid, target: { distance: 1.9 } }],
    ['a run over 50 km', { ...valid, target: { distance: 51 } }],
    ['a hike over 40 km', { ...valid, activity: 'hike', target: { distance: 41 } }],
    ['a target duration under 15 min', { ...valid, target: { duration: 14 } }],
    ['a target duration over 6 h', { ...valid, target: { duration: 361 } }],
    ['a negative target elevation gain', { ...valid, elevationGain: -1 }],
    ['a target elevation gain over 2,500 m', { ...valid, elevationGain: 2_501 }],
    ['an unknown elevation gain shortcut', { ...valid, elevationGain: 'steep' }],
    ['an unknown surface preference', { ...valid, surface: 'sand' }],
    ['a pace that is not a positive number', { ...valid, pace: 0 }],
    ['a number given as a string', { ...valid, pace: '6' }],
  ])('rejects %s', (_, body) => {
    expect(() => parseCriteria(body)).toThrow(RangeError);
  });

  it('accepts the bounds themselves', () => {
    expect(() => parseCriteria({ ...valid, target: { distance: 50 }, elevationGain: 2_500 })).not.toThrow();
    expect(() => parseCriteria({ ...valid, activity: 'hike', target: { distance: 40 }, elevationGain: 0 })).not.toThrow();
    expect(() => parseCriteria({ ...valid, target: { duration: 360 }, pace: 7.2 })).not.toThrow();
  });

  it('rejects a target duration too short for the target elevation gain', () => {
    expect(() => parseCriteria({ ...valid, target: { duration: 30 }, elevationGain: 2_000 })).toThrow(RangeError);
  });

  describe('without counting elevation gain', () => {
    it('drops the target elevation gain, so it cannot make a target duration too short', () => {
      const { criteria } = parseCriteria(
        { ...valid, target: { duration: 30 }, elevationGain: 2_000 },
        { countElevationGain: false },
      );

      expect(criteria).not.toHaveProperty('elevationGain');
    });

    it('still rejects a target elevation gain out of bounds', () => {
      expect(() => parseCriteria({ ...valid, elevationGain: 2_501 }, { countElevationGain: false })).toThrow(RangeError);
    });
  });

  it('rejects a target duration that makes too long a route for the activity', () => {
    expect(() => parseCriteria({ ...valid, target: { duration: 360 }, pace: 6 })).toThrow(RangeError);
    expect(() => parseCriteria({ ...valid, activity: 'hike', target: { duration: 360 }, pace: 9 })).not.toThrow();
  });
});
