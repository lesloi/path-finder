import cases from '../../../server/contract/testdata/slope-effort-cases.json' with { type: 'json' };
import { effortAlong, effortFactor } from './effort.ts';

describe('effortFactor', () => {
  // The server's tests run the same cases through its own count.
  it.each(cases)('is the same as the server counts it: $name', ({ geometry, factor }) => {
    expect(effortFactor(geometry)).toBeCloseTo(factor, 9);
  });
});

describe('effortAlong', () => {
  const climb = cases.find(({ name }) => name === 'a climb then the same descent')!.geometry;

  it('starts at nothing and never goes back', () => {
    const along = effortAlong(climb);

    expect(along[0]).toBe(0);
    expect(along.every((effort, k) => k === 0 || effort >= along[k - 1]!)).toBe(true);
  });

  it('ends on the distance weighted by the factor', () => {
    const along = effortAlong(climb);
    const flat = effortAlong(climb.map(([lon, lat]) => [lon, lat]));

    expect(along.at(-1)! / flat.at(-1)!).toBeCloseTo(effortFactor(climb), 9);
  });
});
