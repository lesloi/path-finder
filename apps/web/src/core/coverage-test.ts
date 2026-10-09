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
    ['a cell with no width', { cells: [[1, 2, 1, 3]] }],
    ['a cell with no height', { cells: [[1, 2, 3, 2]] }],
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
  const rectangles = (covered: CoverageCell[]) => veilPolygon(covered).geometry.coordinates.map(([outline]) => outline);
  const area = (outline: number[][]) =>
    Math.abs(outline[2][0] - outline[0][0]) * Math.abs(outline[2][1] - outline[0][1]);
  const holeFree = (covered: CoverageCell[]) => veilPolygon(covered).geometry.coordinates.every((p) => p.length === 1);

  it('is the whole world when no cell is covered', () => {
    expect(rectangles([])).toEqual([
      [
        [-180, -85.0511],
        [180, -85.0511],
        [180, 85.0511],
        [-180, 85.0511],
        [-180, -85.0511],
      ],
    ]);
  });

  it('is the four rectangles around a lone cell, which has no hole', () => {
    const outlines = rectangles([[6, 45.8, 6.1, 45.9]]);

    expect(outlines).toHaveLength(4);
    expect(holeFree([[6, 45.8, 6.1, 45.9]])).toBe(true);
    expect(outlines.reduce((sum, outline) => sum + area(outline), 0)).toBeCloseTo(360 * 2 * 85.0511 - 0.1 * 0.1, 6);
  });

  it('leaves no rectangle between adjacent cells', () => {
    const adjacent: CoverageCell[] = [
      [6, 45.8, 6.1, 45.9],
      [6.1, 45.8, 6.2, 45.9],
    ];

    expect(rectangles(adjacent)).toHaveLength(4);
  });

  it('is one rectangle for a gap inside the cells, however many cells tall', () => {
    const around: CoverageCell[] = [];
    for (const lon of [6, 6.1, 6.2]) {
      for (const lat of [45.8, 45.9, 46, 46.1]) {
        // Everything but the two cells of the middle column, at 45.9 and 46.
        if (lon !== 6.1 || lat === 45.8 || lat === 46.1) around.push([lon, lat, lon + 0.1, lat + 0.1]);
      }
    }

    const outlines = rectangles(around);

    expect(outlines).toHaveLength(5);
    expect(outlines.at(-1)).toEqual([
      [6.1, 45.9],
      [6.2, 45.9],
      [6.2, 46.1],
      [6.1, 46.1],
      [6.1, 45.9],
    ]);
  });

  it('is a rectangle for each run of gaps of a row, and for a row with no cell', () => {
    const cells: CoverageCell[] = [
      [6, 45.8, 6.1, 45.9],
      [6.2, 45.8, 6.3, 45.9],
      [6, 46, 6.1, 46.1],
      [6.2, 46, 6.3, 46.1],
    ];

    const outlines = rectangles(cells);

    // The frame, the gap of the first row, the row with no cell, and the gap of the third row.
    expect(outlines).toHaveLength(4 + 3);
    expect(outlines).toContainEqual([
      [6.1, 45.8],
      [6.2, 45.8],
      [6.2, 45.9],
      [6.1, 45.9],
      [6.1, 45.8],
    ]);
    expect(outlines).toContainEqual([
      [6.1, 46],
      [6.2, 46],
      [6.2, 46.1],
      [6.1, 46.1],
      [6.1, 46],
    ]);
    expect(outlines).toContainEqual([
      [6, 45.9],
      [6.3, 45.9],
      [6.3, 46],
      [6, 46],
      [6, 45.9],
    ]);
  });

  it('leaves out a cell that is off the grid of the first one, so that it stays veiled', () => {
    const first: CoverageCell = [6, 45.8, 6.1, 45.9];

    const outlines = rectangles([
      first,
      [6.25, 45.8, 6.35, 45.9], // shifted by half a cell
      [6.3, 45.8, 6.5, 45.9], // twice as wide
    ]);

    expect(outlines).toEqual(rectangles([first]));
  });

  it('is the whole world when the first cell has no size', () => {
    expect(rectangles([[6, 45.8, 6, 45.8]])).toEqual(rectangles([]));
  });
});
