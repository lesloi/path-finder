import { readFileSync } from 'node:fs';

import { lambert93 } from '../route-generation/index.ts';

/**
 * A commune with its polygons as closed Lambert-93 rings in metres, each a flat
 * `[x0, y0, x1, y1, …]` list. A point lies in the commune when it is inside an odd number of
 * its rings, so holes (enclaves) and separate parts need no marking.
 */
export type Commune = { name: string; rings: number[][] };

/** Name of the commune at a longitude and latitude, in degrees, or `null` outside every commune. */
export type CommuneAt = (lon: number, lat: number) => string | null;

function inRing(ring: number[], x: number, y: number): boolean {
  let inside = false;
  for (let k = 0, previous = ring.length - 2; k < ring.length; previous = k, k += 2) {
    const [x1, y1, x2, y2] = [ring[previous], ring[previous + 1], ring[k], ring[k + 1]];
    if (y1 > y !== y2 > y && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}

function bounds(rings: number[][]): [number, number, number, number] {
  const xs = rings.flatMap((ring) => ring.filter((_, k) => k % 2 === 0));
  const ys = rings.flatMap((ring) => ring.filter((_, k) => k % 2 === 1));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Local lookup in the given communes: no third party learns the start point. */
export function communeLookup(communes: Commune[]): CommuneAt {
  const withBounds = communes.map((commune) => ({ ...commune, bounds: bounds(commune.rings) }));
  return (lon, lat) => {
    const [x, y] = lambert93(lon, lat);
    const commune = withBounds.find(
      ({ bounds: [minX, minY, maxX, maxY], rings }) =>
        x >= minX && x <= maxX && y >= minY && y <= maxY && rings.filter((ring) => inRing(ring, x, y)).length % 2 === 1,
    );
    return commune?.name ?? null;
  };
}

/**
 * Communes from a file written by scripts/convert-admin-express.ts: the same communes, with
 * each ring in whole metres as its first point then the offset of each next point.
 */
export function loadCommunes(file: string): CommuneAt {
  const communes: Commune[] = JSON.parse(readFileSync(file, 'utf8'));
  for (const { rings } of communes) {
    for (const ring of rings) for (let k = 2; k < ring.length; k++) ring[k] += ring[k - 2];
  }
  return communeLookup(communes);
}
