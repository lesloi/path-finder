// Converts the IGN ADMIN EXPRESS communes into the file src/commune/communes.ts reads.
//
// 1. Download the latest ADMIN EXPRESS GPKG_LAMB93_FXX archive (~250 MB) from
//    https://data.geopf.fr/telechargement/resource/ADMIN-EXPRESS.
// 2. Extract the .gpkg file from it (7z).
// 3. Run: node scripts/convert-admin-express.ts <.gpkg file> <output file>
//
// Rings are simplified to within TOLERANCE metres, which is enough to tell which commune a
// start point is in.

import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import type { Commune } from '../src/commune/communes.ts';

const TOLERANCE = 20;

// Bytes of the envelope in a GeoPackage geometry header, by the envelope code in its flags.
const ENVELOPE_BYTES = [0, 32, 48, 48, 64];

/** The rings of every polygon of a GeoPackage MultiPolygon, each a flat `[x0, y0, x1, y1, …]` list. */
export function readRings(blob: Uint8Array): number[][] {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let offset = 8 + ENVELOPE_BYTES[(view.getUint8(3) >> 1) & 0b111];
  // Each WKB geometry gives its own byte order.
  let littleEndian = true;
  const uint32 = () => ((offset += 4), view.getUint32(offset - 4, littleEndian));
  const expectGeometry = (type: number) => {
    littleEndian = view.getUint8(offset++) === 1;
    if (uint32() !== type) throw new Error('Not a MultiPolygon of 2D polygons');
  };
  const rings: number[][] = [];
  expectGeometry(6);
  for (let polygons = uint32(); polygons > 0; polygons--) {
    expectGeometry(3);
    for (let count = uint32(); count > 0; count--) {
      const ring = Array.from({ length: 2 * uint32() }, (_, k) => view.getFloat64(offset + 8 * k, littleEndian));
      offset += 8 * ring.length;
      rings.push(ring);
    }
  }
  return rings;
}

// Distance from point `p` to the segment from `a` to `b`, all indices of x in a flat ring.
function segmentDistance(ring: number[], p: number, a: number, b: number): number {
  const [dx, dy] = [ring[b] - ring[a], ring[b + 1] - ring[a + 1]];
  const [px, py] = [ring[p] - ring[a], ring[p + 1] - ring[a + 1]];
  const t = dx || dy ? Math.min(1, Math.max(0, (px * dx + py * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - t * dx, py - t * dy);
}

/** Douglas–Peucker on a closed flat ring: keeps the points farther than `tolerance` from the simplified ring. */
export function simplify(ring: number[], tolerance: number): number[] {
  const keep = new Set([0, ring.length - 2]);
  const spans = [[0, ring.length - 2]];
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [a, b] = span;
    let [farthest, distance] = [0, tolerance];
    for (let p = a + 2; p < b; p += 2) {
      const d = segmentDistance(ring, p, a, b);
      if (d > distance) [farthest, distance] = [p, d];
    }
    if (farthest) {
      keep.add(farthest);
      spans.push([a, farthest], [farthest, b]);
    }
  }
  return [...keep].sort((p, q) => p - q).flatMap((p) => [ring[p], ring[p + 1]]);
}

/**
 * Converts the communes of an ADMIN EXPRESS GeoPackage, leaving out rings simplified to less
 * than a triangle and communes left without rings. Returns how many communes it wrote.
 */
export function convertCommunes(gpkg: string, output: string): number {
  const db = new DatabaseSync(gpkg, { readOnly: true });
  const communes: Commune[] = [];
  for (const row of db.prepare('SELECT nom_officiel, geometrie FROM commune').iterate()) {
    const rings = readRings(row.geometrie as Uint8Array)
      .map((ring) => simplify(ring, TOLERANCE).map(Math.round))
      .filter((ring) => ring.length >= 8)
      // Whole metres, each point after the first as an offset from the one before.
      .map((ring) => ring.map((value, k) => (k < 2 ? value : value - ring[k - 2])));
    if (rings.length > 0) communes.push({ name: row.nom_officiel as string, rings });
  }
  db.close();
  writeFileSync(output, JSON.stringify(communes));
  return communes.length;
}

if (import.meta.main) {
  const [gpkg, output] = process.argv.slice(2);
  if (!gpkg || !output) {
    console.error('Usage: node scripts/convert-admin-express.ts <.gpkg file> <output file>');
    process.exit(1);
  }
  console.log(`Converted ${convertCommunes(gpkg, output)} communes into ${output}`);
}
