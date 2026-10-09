import type { Position } from './coordinates.ts';

/** A cell of the grid where routes can start, as west, south, east and north in degrees. */
export type CoverageCell = [number, number, number, number];

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The cells of an answer of `GET /api/v1/coverage`, or none when the answer is not one. */
export function parseCoverage(body: unknown): CoverageCell[] | undefined {
  if (typeof body !== 'object' || body === null || !('cells' in body) || !Array.isArray(body.cells)) return undefined;
  const cells: unknown[] = body.cells;
  const valid = cells.every((cell) => Array.isArray(cell) && cell.length === 4 && cell.every(isNumber));
  return valid ? (cells as CoverageCell[]) : undefined;
}

/** Whether a place is inside one of the cells. A cell holds its west and south edges, not the others. */
export function isCovered(cells: CoverageCell[], [lon, lat]: Position): boolean {
  return cells.some(([west, south, east, north]) => lon >= west && lon < east && lat >= south && lat < north);
}

// The latitude the Web Mercator map stops at.
const MAX_LATITUDE = 85.0511;

/**
 * The veil over the places with no routes: the world, with a hole for each cell. Adjacent cells stay apart,
 * and the layer draws no outline, so no line shows between two covered cells.
 */
export function veilPolygon(cells: CoverageCell[]) {
  const world: Position[] = [
    [-180, -MAX_LATITUDE],
    [180, -MAX_LATITUDE],
    [180, MAX_LATITUDE],
    [-180, MAX_LATITUDE],
    [-180, -MAX_LATITUDE],
  ];
  // Holes run the other way round than the outline.
  const holes = cells.map(([west, south, east, north]): Position[] => [
    [west, south],
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ]);
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [world, ...holes] },
  };
}
