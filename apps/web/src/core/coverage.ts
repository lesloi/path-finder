import type { Position } from './coordinates.ts';

/** A cell of the grid where routes can start, as west, south, east and north in degrees. */
export type CoverageCell = [number, number, number, number];

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The cells of an answer of `GET /api/v1/coverage`, or none when the answer is not one (a cell has an area). */
export function parseCoverage(body: unknown): CoverageCell[] | undefined {
  if (typeof body !== 'object' || body === null || !('cells' in body) || !Array.isArray(body.cells)) return undefined;
  const cells: unknown[] = body.cells;
  const valid = cells.every(
    (cell) =>
      Array.isArray(cell) && cell.length === 4 && cell.every(isNumber) && cell[2] > cell[0] && cell[3] > cell[1],
  );
  return valid ? (cells as CoverageCell[]) : undefined;
}

/** Whether a place is inside one of the cells. A cell holds its west and south edges, not the others. */
export function isCovered(cells: CoverageCell[], [lon, lat]: Position): boolean {
  return cells.some(([west, south, east, north]) => lon >= west && lon < east && lat >= south && lat < north);
}

// The latitude the Web Mercator map stops at.
const MAX_LATITUDE = 85.0511;

/** A rectangle as a closed ring, west and south first, going counter-clockwise. */
const ring = (west: number, south: number, east: number, north: number): Position[] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];

// How far from a whole number of cells a coordinate may be and still be on the grid, in cells.
const GRID_TOLERANCE = 1e-6;

// The coordinates of a grid computed in floats, rounded to the 1e-7 degree the server works in.
const tidy = (degrees: number) => Math.round(degrees * 1e7) / 1e7;

/**
 * The veil over the places with no routes, as plain rectangles that neither overlap nor hold a hole: four around
 * the cells, and the cells of their bounding box that no cell covers, merged into the fewest rectangles.
 * A world with a hole for each cell would not do: MapLibre cuts it into tiles and triangulates each, and at a low
 * zoom a tile holds thousands of holes that touch each other, so the triangulation fails and the veil is drawn
 * in streaks, over places that have routes.
 */
export function veilPolygon(allCells: CoverageCell[]) {
  const rings: Position[][] = [];
  // The grid is that of the first cell, as the server's is one size. A cell off it (another size, or between two
  // cells of the grid) cannot be placed in a row and a column, so it is left out: it stays under the veil.
  const [west0, south0, east0, north0] = allCells[0] ?? [0, 0, 0, 0];
  const width = east0 - west0;
  const height = north0 - south0;
  const whole = (value: number) => Math.abs(value - Math.round(value)) < GRID_TOLERANCE;
  const cells = allCells.filter(
    ([west, south, east, north]) =>
      Math.abs((east - west) / width - 1) < GRID_TOLERANCE &&
      Math.abs((north - south) / height - 1) < GRID_TOLERANCE &&
      whole((west - west0) / width) &&
      whole((south - south0) / height),
  );
  if (cells.length === 0) {
    rings.push(ring(-180, -MAX_LATITUDE, 180, MAX_LATITUDE));
  } else {
    let [west, south, east, north] = cells[0];
    for (const cell of cells) {
      west = Math.min(west, cell[0]);
      south = Math.min(south, cell[1]);
      east = Math.max(east, cell[2]);
      north = Math.max(north, cell[3]);
    }
    rings.push(
      ring(-180, -MAX_LATITUDE, west, MAX_LATITUDE),
      ring(east, -MAX_LATITUDE, 180, MAX_LATITUDE),
      ring(west, -MAX_LATITUDE, east, south),
      ring(west, north, east, MAX_LATITUDE),
    );
    const column = (lon: number) => Math.round((lon - west) / width);
    const columns = column(east);
    const rows = Math.round((north - south) / height);
    const covered = Array.from({ length: rows }, () => new Array<boolean>(columns).fill(false));
    for (const [cellWest, cellSouth, cellEast] of cells) {
      const row = Math.round((cellSouth - south) / height);
      for (let x = column(cellWest); x < column(cellEast); x++) covered[row][x] = true;
    }
    // The runs of uncovered cells of a row; one that the row below also has, from the same column to the same
    // column, stays open and grows, so that a gap that is several cells tall is one rectangle.
    let open = new Map<string, number>();
    const close = (key: string, from: number, to: number) => {
      const [x0, x1] = key.split(':').map(Number);
      rings.push(
        ring(tidy(west + x0 * width), tidy(south + from * height), tidy(west + x1 * width), tidy(south + to * height)),
      );
    };
    for (let row = 0; row <= rows; row++) {
      const next = new Map<string, number>();
      for (let x = 0; row < rows && x < columns; x++) {
        if (covered[row][x]) continue;
        const start = x;
        while (x + 1 < columns && !covered[row][x + 1]) x++;
        const key = `${start}:${x + 1}`;
        next.set(key, open.get(key) ?? row);
      }
      for (const [key, from] of open) if (!next.has(key)) close(key, from, row);
      open = next;
    }
  }
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'MultiPolygon' as const, coordinates: rings.map((outline) => [outline]) },
  };
}
