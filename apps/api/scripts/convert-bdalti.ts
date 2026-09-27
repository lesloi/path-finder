// Converts BD ALTI 25 m ASCII tiles into the tiles src/elevation/bdalti.ts reads.
//
// 1. Download the BD ALTI 25 m ASC archive of each department you need (~30 MB each, ~3 GB
//    for metropolitan France) from https://data.geopf.fr/telechargement/resource/BDALTI.
// 2. Extract the archives (7z) into one directory.
// 3. Run: node scripts/convert-bdalti.ts <directory of extracted .asc files> <output directory>
//
// Output is ~2 MB per 25 km tile. Tiles shared by two departments are merged, so run it again
// after adding departments.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CELLS = 1000;
const CELL = 25;

/** One ASCII tile as heights in decimetres + 1000 (0 = no data), named after its north-west cell centre in km. */
export function convertTile(text: string): { name: string; cells: Uint16Array } {
  const lines = text.split('\n');
  const header = new Map(lines.slice(0, 6).map((line) => {
    const [key, value] = line.trim().split(/\s+/);
    return [key.toLowerCase(), Number(value)];
  }));
  const [ncols, nrows, xll, yll, cellsize, nodata] = ['ncols', 'nrows', 'xllcorner', 'yllcorner', 'cellsize', 'nodata_value']
    .map((key) => header.get(key));
  if (ncols !== CELLS || nrows !== CELLS || cellsize !== CELL || xll === undefined || yll === undefined || nodata === undefined) {
    throw new Error(`Not a BD ALTI 25 m tile of ${CELLS} x ${CELLS} cells`);
  }
  const cells = new Uint16Array(CELLS * CELLS);
  for (let row = 0; row < CELLS; row++) {
    const values = lines[6 + row].trim().split(/\s+/);
    for (let col = 0; col < CELLS; col++) {
      const height = Number(values[col]);
      cells[row * CELLS + col] = height === nodata ? 0 : Math.round(height * 10) + 1000;
    }
  }
  const x = Math.round((xll + CELL / 2) / 1000);
  const y = Math.round((yll + CELL / 2 + (CELLS - 1) * CELL) / 1000);
  return { name: `${x}_${y}`, cells };
}

/** Converts every .asc file under `input`. Tiles on a department border come in both deliveries: keeps any cell with data. */
export function convertAll(input: string, output: string): number {
  mkdirSync(output, { recursive: true });
  let count = 0;
  for (const file of readdirSync(input, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.asc')) continue;
    const { name, cells } = convertTile(readFileSync(join(input, file), 'latin1'));
    const path = join(output, `${name}.u16`);
    if (existsSync(path)) {
      const bytes = readFileSync(path);
      const previous = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
      cells.forEach((value, k) => (cells[k] = value || previous[k]));
    }
    writeFileSync(path, cells);
    count++;
  }
  return count;
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Usage: node scripts/convert-bdalti.ts <asc directory> <output directory>');
    process.exit(1);
  }
  console.log(`Converted ${convertAll(input, output)} ASCII tiles into ${output}`);
}
