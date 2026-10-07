import cases from '../../../server/contract/testdata/criteria-cases.json' with { type: 'json' };
import routeSet from '../../../server/contract/testdata/route-set.json' with { type: 'json' };
import { parseRoutes } from '../core/index.ts';
import { CriteriaError, ERROR_CODES, parseCriteria, type ErrorCode } from './index.ts';

// What the server's own tests read too: its cases, and the route set it sends.
type Case = {
  name: string;
  body: unknown;
  countElevationGain?: boolean;
  expect: { field: string } | { criteria: unknown };
};

describe('parseCriteria', () => {
  it.each((cases as Case[]).map((c) => [c.name, c] as const))(
    'agrees with the server on %s',
    (_, { body, countElevationGain, expect: expected }) => {
      const options = countElevationGain === undefined ? undefined : { countElevationGain };
      if ('field' in expected) {
        expect(() => parseCriteria(body, options)).toThrow(
          expect.objectContaining({ name: 'CriteriaError', field: expected.field }),
        );
        expect(() => parseCriteria(body, options)).toThrow(RangeError);
      } else {
        expect(parseCriteria(body, options)).toEqual(expected.criteria);
      }
    },
  );

  it('throws a CriteriaError', () => {
    expect(() => parseCriteria(null)).toThrow(CriteriaError);
  });
});

describe('the contract with the server', () => {
  it('words every error code the server sends, and only those', () => {
    const known = {
      'invalid-json': true,
      'invalid-criteria': true,
      'stale-build': true,
      'rate-limited': true,
      overloaded: true,
      'generation-timeout': true,
    } satisfies Record<ErrorCode, true>;

    expect([...ERROR_CODES].sort()).toEqual(Object.keys(known).sort());
  });

  it('reads the route set the server sends', () => {
    const routes = parseRoutes(routeSet);

    expect(routes).toHaveLength(2);
    expect(routes?.[0]).toMatchObject({ kind: 'match', elevationGain: 250, elevationLoss: 240, distance: 10.2 });
    expect(routes?.[0]?.geometry[0]).toEqual([6.1294, 45.8992, 450.5]);
    expect(routes?.[1]).toMatchObject({ kind: 'suggestion', misses: [{ criterion: 'distance', gap: 2.9 }] });
    expect(routes?.[1]).not.toHaveProperty('elevationGain');
  });
});
