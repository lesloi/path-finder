import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lambert93, type Position } from '../route-generation/index.ts';
import { bdAltiHeights, hasBdAltiTiles } from './bdalti.ts';

// Annecy, in tile 925_6550, and a point 30 km east, in tile 950_6550.
const ANNECY: Position = [6.1294, 45.8992];
const EAST: Position = [6.5294, 45.8992];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bdalti-'));
});
afterEach(() => rmSync(dir, { recursive: true }));

// Height of a plane in metres at a Lambert-93 point, rising east and north.
const plane = (x: number, y: number) => 400 + x / 250 + y / 125 - 52_000;

// A tile named after its north-west cell centre in km, with `plane` heights (or `value` everywhere).
function writeTile(name: string, value?: number) {
  const [xKm, yKm] = name.split('_').map(Number);
  const cells = new Uint16Array(1000 * 1000);
  for (let row = 0; row < 1000; row++) {
    for (let col = 0; col < 1000; col++) {
      const height = plane(xKm * 1000 + col * 25, yKm * 1000 - row * 25);
      cells[row * 1000 + col] = value ?? Math.round(height * 10) + 1000;
    }
  }
  writeFileSync(join(dir, `${name}.u16`), cells);
}

describe('bdAltiHeights', () => {
  it('interpolates the height between cells of a tile', () => {
    writeTile('925_6550');

    const height = bdAltiHeights(dir)(...ANNECY);

    expect(height).toBeCloseTo(plane(...lambert93(...ANNECY)), 1);
  });

  it('throws without a tile, such as outside France', () => {
    expect(() => bdAltiHeights(dir)(...ANNECY)).toThrow(/No BD ALTI elevation data here/);
  });

  it('throws on cells with no data', () => {
    writeTile('925_6550', 0);

    expect(() => bdAltiHeights(dir)(...ANNECY)).toThrow(/No BD ALTI elevation data here/);
  });

  it('keeps the most recently used tiles in memory', () => {
    writeTile('925_6550');
    writeTile('950_6550');
    const heightAt = bdAltiHeights(dir, 1);

    heightAt(...ANNECY);
    rmSync(join(dir, '925_6550.u16'));
    expect(heightAt(...ANNECY)).toBeCloseTo(plane(...lambert93(...ANNECY)), 1);

    heightAt(...EAST);
    expect(() => heightAt(...ANNECY)).toThrow(/No BD ALTI elevation data here/);
  });
});

describe('hasBdAltiTiles', () => {
  it('is false for an empty directory or one with other files', () => {
    expect(hasBdAltiTiles(dir)).toBe(false);

    writeFileSync(join(dir, 'notes.txt'), '');

    expect(hasBdAltiTiles(dir)).toBe(false);
  });

  it('is false for a directory that does not exist', () => {
    expect(hasBdAltiTiles(join(dir, 'missing'))).toBe(false);
  });

  it('is true once a tile is there', () => {
    writeFileSync(join(dir, '925_6550.u16'), '');

    expect(hasBdAltiTiles(dir)).toBe(true);
  });
});
