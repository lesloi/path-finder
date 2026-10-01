import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { lambert93 } from '../apps/api/src/route-generation/index.ts';

// A stand-in for the converted BD ALTI tiles in end-to-end tests (`pnpm test:e2e`): rolling hills around
// Annecy, the start point of the route scenarios, so routes there have an elevation gain without the IGN data.
// Run: node fake-bdalti.ts <output directory>
const [dir] = process.argv.slice(2);
if (!dir) throw new Error('Usage: node fake-bdalti.ts <output directory>');

const START: [number, number] = [6.1294, 45.8992];
const CELLS = 1000;
const CELL_M = 25;
const TILE_KM = 25;
const [BASE_M, HILL_M, WAVELENGTH_M] = [600, 250, 2_500];

const [x, y] = lambert93(...START);
// Tiles are named after their north-west cell centre in km: the start point's and its eight neighbours, so a
// loop crossing a tile border still has heights.
const [tileX, tileY] = [Math.floor(x / (TILE_KM * 1000)) * TILE_KM, Math.ceil(y / (TILE_KM * 1000)) * TILE_KM];

mkdirSync(dir, { recursive: true });
for (const dx of [-TILE_KM, 0, TILE_KM]) {
  for (const dy of [-TILE_KM, 0, TILE_KM]) {
    const [west, north] = [(tileX + dx) * 1000, (tileY + dy) * 1000];
    // Heights in decimetres + 1000, a product of two waves so that every direction climbs and descends.
    const east = Array.from({ length: CELLS }, (_, col) =>
      Math.sin(((west + col * CELL_M) * 2 * Math.PI) / WAVELENGTH_M),
    );
    const south = Array.from({ length: CELLS }, (_, row) =>
      Math.cos(((north - row * CELL_M) * 2 * Math.PI) / WAVELENGTH_M),
    );
    const cells = new Uint16Array(CELLS * CELLS);
    for (let row = 0; row < CELLS; row++) {
      for (let col = 0; col < CELLS; col++) {
        cells[row * CELLS + col] = Math.round((BASE_M + HILL_M * east[col] * south[row]) * 10) + 1000;
      }
    }
    writeFileSync(join(dir, `${tileX + dx}_${tileY + dy}.u16`), cells);
  }
}
