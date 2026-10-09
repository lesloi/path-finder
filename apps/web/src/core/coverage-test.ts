import sample from '../../../server/contract/testdata/coverage.json' with { type: 'json' };
import { isCovered, parseCoverage, veilPolygon, type CoverageCell } from './coverage.ts';

const cells: CoverageCell[] = [
  [6, 45.8, 6.1, 45.9],
  [-2.6, 48, -2.5, 48.1],
];

describe('parseCoverage', () => {
  it('reads the sample answer of the server', () => {
    expect(parseCoverage(sample)).toEqual(sample.cells);
  });

  it('reads an answer with no cell', () => {
    expect(parseCoverage({ cells: [] })).toEqual([]);
  });

  it.each([
    ['null', null],
    ['text', 'cells'],
    ['no cells', {}],
    ['cells that are not a list', { cells: 3 }],
    ['a cell that is not a list', { cells: [3] }],
    ['a cell of three numbers', { cells: [[1, 2, 3]] }],
    ['a cell with text', { cells: [[1, 2, 3, '4']] }],
    ['a cell with a number that is not finite', { cells: [[1, 2, 3, null]] }],
  ])('refuses %s', (_, body) => {
    expect(parseCoverage(body)).toBeUndefined();
  });
});

describe('isCovered', () => {
  it('holds a place inside a cell', () => {
    expect(isCovered(cells, [6.05, 45.85])).toBe(true);
    expect(isCovered(cells, [-2.55, 48.05])).toBe(true);
  });

  it('leaves out a place in none', () => {
    expect(isCovered(cells, [2.3, 48.8])).toBe(false);
    expect(isCovered([], [6.05, 45.85])).toBe(false);
  });

  it('holds the west and south edges of a cell, not the east and north ones, which are the next cell’s', () => {
    expect(isCovered(cells, [6, 45.8])).toBe(true);
    expect(isCovered(cells, [6.1, 45.85])).toBe(false);
    expect(isCovered(cells, [6.05, 45.9])).toBe(false);
  });
});

describe('veilPolygon', () => {
  it('is the world with a hole for each cell, adjacent cells kept apart', () => {
    const adjacent: CoverageCell[] = [
      [6, 45.8, 6.1, 45.9],
      [6.1, 45.8, 6.2, 45.9],
    ];

    const { geometry } = veilPolygon(adjacent);

    const [world, ...holes] = geometry.coordinates;
    expect(world[0]).toEqual(world.at(-1));
    expect(Math.min(...world.map(([lon]) => lon))).toBe(-180);
    expect(holes).toEqual([
      [
        [6, 45.8],
        [6, 45.9],
        [6.1, 45.9],
        [6.1, 45.8],
        [6, 45.8],
      ],
      [
        [6.1, 45.8],
        [6.1, 45.9],
        [6.2, 45.9],
        [6.2, 45.8],
        [6.1, 45.8],
      ],
    ]);
  });
});
