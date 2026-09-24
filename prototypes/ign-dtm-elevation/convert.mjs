// PROTOTYPE (issue #14): convert BD ALTI 25 m ASCII tiles into raw binary tiles. Throwaway.
//
// Each 1000 x 1000 ASC tile (25 km, Lambert-93) becomes a 2 MB file of little-endian Uint16:
// height in decimetres + 1000 (so -100 m .. 6453 m fits), 0 = no data. The API can then read
// any cell with one pread, no decoding.
//
// Run: node convert.mjs  -> data/grid/<xkm>_<ykm>.u16

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA = new URL("data/", import.meta.url).pathname;
const OUT = join(DATA, "grid");
mkdirSync(OUT, { recursive: true });

function* ascFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) yield* ascFiles(join(dir, e.name));
    else if (e.name.endsWith(".asc")) yield join(dir, e.name);
  }
}

let asc = 0;
let tiles = 0;
let bytes = 0;
const t0 = performance.now();
for (const file of ascFiles(DATA)) {
  const text = readFileSync(file, "latin1");
  asc += statSync(file).size;
  const lines = text.split("\n");
  const header = Object.fromEntries(lines.slice(0, 6).map((l) => l.trim().split(/\s+/)).map(([k, v]) => [k.toLowerCase(), Number(v)]));
  const { ncols, nrows, xllcorner, yllcorner, cellsize, nodata_value: nodata } = header;
  const out = new Uint16Array(ncols * nrows);
  for (let r = 0; r < nrows; r++) {
    const vals = lines[6 + r].trim().split(/\s+/);
    for (let c = 0; c < ncols; c++) {
      const v = Number(vals[c]);
      out[r * ncols + c] = v === nodata ? 0 : Math.round(v * 10) + 1000;
    }
  }
  // Name by the centre of the upper-left cell, in km (matches the IGN file name).
  const xKm = Math.round((xllcorner + cellsize / 2) / 1000);
  const yKm = Math.round((yllcorner + cellsize / 2 + (nrows - 1) * cellsize) / 1000);
  const name = join(OUT, `${xKm}_${yKm}.u16`);
  // Tiles on a department border come in both deliveries: merge, keeping any non-empty cell.
  let merged = out;
  try {
    const prev = new Uint16Array(readFileSync(name).buffer.slice(0));
    merged = prev.map((v, i) => v || out[i]);
  } catch {
    tiles++;
  }
  writeFileSync(name, Buffer.from(merged.buffer));
}
for (const f of readdirSync(OUT)) bytes += statSync(join(OUT, f)).size;
console.log(`ASC ${(asc / 1e6).toFixed(0)} MB -> ${tiles} binary tiles, ${(bytes / 1e6).toFixed(0)} MB, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
