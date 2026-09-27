import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bdAltiHeights } from '../src/elevation/bdalti.ts';
import { lambert93, type Position } from '../src/route-generation/index.ts';
import { convertAll, convertTile } from './convert-bdalti.ts';

// Annecy, in the IGN tile BDALTIV2_25M_FXX_0925_6550.
const ANNECY: Position = [6.1294, 45.8992];
const X0 = 925_000;
const Y0 = 6_550_000;

// Height in metres at a Lambert-93 point: a plane rising east.
const plane = (x: number) => 400 + (x - X0) / 100;

// An ASCII tile with `plane` heights, and no data where `noData(col)` holds.
function asc(noData: (col: number) => boolean = () => false): string {
  const header = [
    'ncols 1000',
    'nrows 1000',
    `xllcorner ${X0 - 12.5}`,
    `yllcorner ${Y0 - 999 * 25 - 12.5}`,
    'cellsize 25',
    'NODATA_value -99999.00',
  ];
  const row = Array.from({ length: 1000 }, (_, col) => (noData(col) ? '-99999.00' : plane(X0 + col * 25).toFixed(2)));
  return [...header, ...Array<string>(1000).fill(row.join(' '))].join('\n') + '\n';
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'convert-bdalti-'));
});
afterEach(() => rmSync(dir, { recursive: true }));

describe('convertTile', () => {
  it('names the tile after its north-west cell centre in km, and stores decimetres + 1000', () => {
    const { name, cells } = convertTile(asc((col) => col === 1));

    expect(name).toBe('925_6550');
    expect([...cells.slice(0, 3)]).toEqual([5000, 0, 5005]);
  });

  it('rejects a tile that is not 1000 x 1000 cells of 25 m', () => {
    expect(() => convertTile(asc().replace('cellsize 25', 'cellsize 5'))).toThrow(/Not a BD ALTI 25 m tile/);
  });

  it('rejects a tile without a no-data value', () => {
    expect(() => convertTile(asc().replace('NODATA_value -99999.00', 'unknown 0'))).toThrow(/Not a BD ALTI 25 m tile/);
  });
});

describe('convertAll', () => {
  it('merges a tile delivered by two departments, and writes tiles the API reads', () => {
    const [west, east, output] = ['74/west', '73/east', 'tiles'].map((path) => join(dir, path));
    mkdirSync(west, { recursive: true });
    mkdirSync(east, { recursive: true });
    writeFileSync(join(west, 'BDALTIV2_25M_FXX_0925_6550.asc'), asc((col) => col >= 500));
    writeFileSync(join(east, 'BDALTIV2_25M_FXX_0925_6550.asc'), asc((col) => col < 500));

    expect(convertAll(dir, output)).toBe(2);

    const heightAt = bdAltiHeights(output);
    // Annecy falls in the east half, and 15 km west of it in the west half.
    for (const point of [ANNECY, [ANNECY[0] - 0.2, ANNECY[1]] satisfies Position]) {
      expect(heightAt(...point)).toBeCloseTo(plane(lambert93(...point)[0]), 1);
    }
  });
});
