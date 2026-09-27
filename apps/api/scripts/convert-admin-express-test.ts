import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { loadCommunes, type Commune } from '../src/commune/communes.ts';
import { lambert93, type Position } from '../src/route-generation/index.ts';
import { convertCommunes, readRings, simplify } from './convert-admin-express.ts';

const ANNECY: Position = [6.1294, 45.8992];

// A closed square ring in Lambert-93 metres, `half` metres each side of a point.
function around(point: Position, half: number): number[] {
  const [x, y] = lambert93(...point);
  return [x - half, y - half, x - half, y + half, x + half, y + half, x + half, y - half, x - half, y - half];
}

// A GeoPackage geometry: its header with an XY envelope, then a little-endian WKB
// MultiPolygon of one polygon per group of rings.
function multiPolygon(polygons: number[][][]): Buffer {
  const header = Buffer.alloc(40);
  header.write('GP', 0, 'latin1');
  header.writeUInt8(0b011, 3);
  header.writeInt32LE(2154, 4);
  const int = (value: number) => Buffer.from(Uint32Array.of(value).buffer);
  const wkb = [Buffer.from([1]), int(6), int(polygons.length)];
  for (const rings of polygons) {
    wkb.push(Buffer.from([1]), int(3), int(rings.length));
    for (const ring of rings) wkb.push(int(ring.length / 2), Buffer.from(Float64Array.from(ring).buffer));
  }
  return Buffer.concat([header, ...wkb]);
}

// An ADMIN EXPRESS GeoPackage holding only what the conversion reads.
function adminExpress(path: string, communes: { name: string; polygons: number[][][] }[]) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE commune (fid INTEGER PRIMARY KEY, geometrie BLOB, nom_officiel TEXT)');
  const insert = db.prepare('INSERT INTO commune (geometrie, nom_officiel) VALUES (?, ?)');
  for (const { name, polygons } of communes) insert.run(multiPolygon(polygons), name);
  db.close();
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'convert-admin-express-'));
});
afterEach(() => rmSync(dir, { recursive: true }));

describe('readRings', () => {
  it('reads every ring of every polygon of a GeoPackage MultiPolygon', () => {
    const polygons = [[around(ANNECY, 2000), around(ANNECY, 500)], [around([6.2, 45.9], 1000)]];

    expect(readRings(multiPolygon(polygons))).toEqual(polygons.flat());
  });
});

describe('simplify', () => {
  it('drops the points within the tolerance of the simplified ring, and keeps it closed', () => {
    // A 100 m square with a 3 m bump in two of its sides.
    const ring = [0, 0, 50, 3, 100, 0, 103, 50, 100, 100, 0, 100, 0, 0];

    expect(simplify(ring, 20)).toEqual([0, 0, 100, 0, 100, 100, 0, 100, 0, 0]);
    expect(simplify(ring, 1)).toEqual(ring);
  });
});

describe('convertCommunes', () => {
  it('writes simplified communes the API looks up', () => {
    const gpkg = join(dir, 'ADE.gpkg');
    const output = join(dir, 'communes.json');
    adminExpress(gpkg, [
      { name: 'Annecy', polygons: [[around(ANNECY, 1000)]] },
      { name: 'Épagny Metz-Tessy', polygons: [[around([6.0856, 45.9334], 1000)], [around([6.2, 45.9334], 1000)]] },
      { name: 'Îlot', polygons: [[around([6.3, 45.9], 5)]] },
    ]);

    // Îlot's only ring is within the tolerance, so it is left out.
    expect(convertCommunes(gpkg, output)).toBe(2);

    const communeAt = loadCommunes(output);
    expect(communeAt(...ANNECY)).toBe('Annecy');
    expect(communeAt(6.2, 45.9334)).toBe('Épagny Metz-Tessy');
    const communes: Commune[] = JSON.parse(readFileSync(output, 'utf8'));
    expect(communes.map(({ name }) => name)).toEqual(['Annecy', 'Épagny Metz-Tessy']);
    // Whole metres, each point after the first as an offset from the one before.
    expect(communes[0].rings[0].slice(2)).toEqual([0, 2000, 2000, 0, 0, -2000, -2000, 0]);
  });
});
