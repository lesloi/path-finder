import { GRID_CELL, RETRACE_MIN_LOOP } from './constants.ts';
import type { Position } from './route-set.ts';

// Sampling step along the geometry, in metres, fine enough not to skip a cell.
const STEP = 5;

const EARTH_RADIUS = 6_371_000;

/** Great-circle distance between two points, in metres. */
export function distance(a: Position, b: Position): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const h =
    Math.sin(toRad(b[1] - a[1]) / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(toRad(b[0] - a[0]) / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

/** A grid cell a route enters, and how far along the route it does, in metres. */
export type CellVisit = { cell: string; along: number };

/** Grid cells a route passes through, in order, farther than `startRadius` metres from the start point. */
export function cellsAlong(geometry: Position[], start: Position, startRadius: number): CellVisit[] {
  const cosLat = Math.cos((start[1] * Math.PI) / 180);
  const toMetres = ([lon, lat]: Position) => [
    (((lon - start[0]) * Math.PI) / 180) * EARTH_RADIUS * cosLat,
    (((lat - start[1]) * Math.PI) / 180) * EARTH_RADIUS,
  ];
  const visits: CellVisit[] = [];
  const visit = (x: number, y: number, along: number) => {
    if (Math.hypot(x, y) <= startRadius) return;
    const cell = `${Math.floor(x / GRID_CELL)},${Math.floor(y / GRID_CELL)}`;
    if (visits.at(-1)?.cell !== cell) visits.push({ cell, along });
  };
  const points = geometry.map(toMetres);
  let along = 0;
  points.forEach(([x, y], i) => {
    const next = points[i + 1];
    if (!next) return visit(x, y, along);
    const length = Math.hypot(next[0] - x, next[1] - y);
    const steps = Math.max(1, Math.ceil(length / STEP));
    for (let s = 0; s < steps; s++) {
      visit(x + ((next[0] - x) * s) / steps, y + ((next[1] - y) * s) / steps, along + (length * s) / steps);
    }
    along += length;
  });
  return visits;
}

/** Share of the smaller of two sets of cells that the other one also covers. */
export function sharedShare(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return 0;
  let shared = 0;
  for (const cell of small) if (large.has(cell)) shared++;
  return shared / small.size;
}

/**
 * Share of a route walked twice, such as out-and-back stretches, from its cells in order.
 * Coming back to a cell only counts after `RETRACE_MIN_LOOP` metres, so weaving along a
 * cell edge does not.
 */
export function retraceShare(visits: CellVisit[]): number {
  if (visits.length === 0) return 0;
  const last = new Map<string, number>();
  const walkedTwice = new Set<number>();
  visits.forEach(({ cell, along }, i) => {
    const previous = last.get(cell);
    if (previous !== undefined && along - visits[previous].along >= RETRACE_MIN_LOOP) {
      walkedTwice.add(previous).add(i);
    }
    last.set(cell, i);
  });
  return walkedTwice.size / visits.length;
}
