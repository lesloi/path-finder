import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bilinearHeight, type HeightAt } from '../route-generation/index.ts';

// Tiles written by scripts/convert-bdalti.ts: 1000 x 1000 cells of 25 m in Lambert-93, as
// little-endian Uint16 rows from north to south, holding the height in decimetres + 1000
// (0 = no data). A tile is named `<x>_<y>.u16` after its north-west cell centre, in km.
const TILE_CELLS = 1000;
const TILE_KM = 25;

/**
 * Heights from the BD ALTI tiles in `dir`, keeping the last `cacheSize` tiles used in memory
 * (2 MB each). Throws where there is no data, such as outside metropolitan France.
 */
export function bdAltiHeights(dir: string, cacheSize = 64): HeightAt {
  const tiles = new Map<string, Uint16Array>(); // least recently used first

  function tile(name: string): Uint16Array {
    let cells = tiles.get(name);
    if (cells) {
      tiles.delete(name);
    } else {
      let bytes: Buffer;
      try {
        bytes = readFileSync(join(dir, `${name}.u16`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw noData();
        throw error;
      }
      cells = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
      if (tiles.size >= cacheSize) tiles.delete(tiles.keys().next().value!);
    }
    tiles.set(name, cells);
    return cells;
  }

  function cellHeight(i: number, j: number): number {
    const x = Math.floor(i / TILE_CELLS);
    const y = Math.ceil(j / TILE_CELLS);
    const value = tile(`${x * TILE_KM}_${y * TILE_KM}`)[(y * TILE_CELLS - j) * TILE_CELLS + i - x * TILE_CELLS];
    if (value === 0) throw noData();
    return (value - 1000) / 10;
  }

  return (lon, lat) => bilinearHeight(lon, lat, cellHeight);
}

// No coordinates in the message: the API logs no locations.
const noData = () =>
  new Error('No BD ALTI elevation data here: outside metropolitan France, or a tile missing from BDALTI_DIR');

/** Whether `dir` holds at least one tile: a missing or empty directory gives no elevation. */
export function hasBdAltiTiles(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => name.endsWith('.u16'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
