// PROTOTYPE (issue #14): elevation gain from IGN BD ALTI 25 m. Throwaway.
//
// Loops in Paris, the Vallée de Chevreuse, and Chamonix, with the same RGE ALTI reference and
// method as the Copernicus spike (#3), from fetch-tracks.mjs. Heights come from the binary tiles written by
// convert.mjs (bilinear on the 25 m grid, Lambert-93).
//
// Run: node fetch-tracks.mjs && node convert.mjs && node spike.mjs  -> results/summary.md

import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { gain, resample, smooth } from "../copernicus-elevation/geo.mjs";

const GRID = new URL("data/grid/", import.meta.url).pathname;
const tracks = JSON.parse(readFileSync(new URL("data/tracks.json", import.meta.url)));

// --- Lambert-93 (RGF93 ~ WGS84 at this scale), IGN formulas ---------------------------------

const A = 6378137;
const E = Math.sqrt(0.00669438002290);
const rad = Math.PI / 180;
const m = (phi) => Math.cos(phi) / Math.sqrt(1 - (E * Math.sin(phi)) ** 2);
const t = (phi) => Math.tan(Math.PI / 4 - phi / 2) / ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2);
const [P1, P2, P0] = [44 * rad, 49 * rad, 46.5 * rad];
const N = Math.log(m(P1) / m(P2)) / Math.log(t(P1) / t(P2));
const F = m(P1) / (N * t(P1) ** N);
const RHO0 = A * F * t(P0) ** N;
export function lambert93(lon, lat) {
  const rho = A * F * t(lat * rad) ** N;
  const theta = N * (lon - 3) * rad;
  return [700000 + rho * Math.sin(theta), 6600000 + RHO0 - rho * Math.cos(theta)];
}

// --- Grid lookup ----------------------------------------------------------------------------
// Global cell indices: cell (i, j) is centred at (25 i, 25 j) metres. A tile holds
// i in [i0, i0 + 999] and j in [j0 - 999, j0], with i0, j0 multiples of 1000.

const CELL = 25;
const cache = new Map(); // tile key -> Uint16Array (LRU by insertion order)
let mode = "memory";
const stats = { tileReads: 0, preads: 0 };

function tileOf(i, j) {
  const i0 = Math.floor(i / 1000) * 1000;
  const j0 = Math.ceil(j / 1000) * 1000;
  return { key: `${(i0 * CELL) / 1000}_${(j0 * CELL) / 1000}`, c: i - i0, r: j0 - j };
}

const fds = new Map();
const one = Buffer.alloc(2);
function cell(i, j) {
  const { key, c, r } = tileOf(i, j);
  let v;
  if (mode === "memory") {
    let tile = cache.get(key);
    if (!tile) {
      tile = new Uint16Array(readFileSync(`${GRID}${key}.u16`).buffer.slice(0));
      stats.tileReads++;
      cache.set(key, tile);
      if (cache.size > 64) cache.delete(cache.keys().next().value); // ~128 MB
    }
    v = tile[r * 1000 + c];
  } else {
    if (!fds.has(key)) fds.set(key, openSync(`${GRID}${key}.u16`, "r"));
    readSync(fds.get(key), one, 0, 2, (r * 1000 + c) * 2);
    stats.preads++;
    v = one.readUInt16LE(0);
  }
  if (v === 0) throw new Error(`no data at tile ${key}`);
  return (v - 1000) / 10;
}

function height(lon, lat) {
  const [x, y] = lambert93(lon, lat);
  const fi = x / CELL;
  const fj = y / CELL;
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const fx = fi - i;
  const fy = fj - j;
  return cell(i, j) * (1 - fx) * (1 - fy) + cell(i + 1, j) * fx * (1 - fy)
    + cell(i, j + 1) * (1 - fx) * fy + cell(i + 1, j + 1) * fx * fy;
}

// --- Run ------------------------------------------------------------------------------------

const refs = tracks.map((tr) => gain(smooth(tr.reference.map((p) => p[2]), 5)));

// Pointwise check against RGE ALTI (validates projection and registration).
const pointwise = tracks.map((tr) => {
  let s = 0;
  let s2 = 0;
  for (const [lon, lat, z] of tr.reference) {
    const d = height(lon, lat) - z;
    s += d;
    s2 += d * d;
  }
  return { bias: s / tr.reference.length, rmse: Math.sqrt(s2 / tr.reference.length) };
});

const STEPS = [10, 25, 30, 50];
const heights = {};
for (const tr of tracks) for (const s of STEPS) heights[`${tr.name}|${s}`] = resample(tr.coords, s).map((p) => height(p[0], p[1]));

const methods = [];
for (const step of STEPS) {
  for (const sm of [0, 60]) {
    const win = sm === 0 ? 1 : Math.max(1, Math.round(sm / step) | 1);
    if (sm !== 0 && win === 1) continue;
    for (const thr of [0, 1, 2]) {
      const errs = tracks.map((tr, i) => {
        const g = gain(smooth(heights[`${tr.name}|${step}`], win), thr);
        return { g, rel: (g - refs[i]) / Math.max(refs[i], 100) };
      });
      const abs = errs.map((e) => Math.abs(e.rel));
      const out = abs.filter((_, i) => tracks[i].kind !== "urban");
      methods.push({
        step, sm, win, thr, errs,
        mean: abs.reduce((a, b) => a + b, 0) / abs.length,
        max: Math.max(...abs),
        meanOutside: out.reduce((a, b) => a + b, 0) / out.length,
      });
    }
  }
}
methods.sort((a, b) => a.mean - b.mean);
const chosen = methods.find((x) => x.step === 30 && x.sm === 0 && x.thr === 1);

// Lookup time per route (30 m step): cold = empty tile cache, warm = cached, pread = no cache.
const timing = [];
for (const tr of tracks) {
  const pts = resample(tr.coords, 30);
  mode = "memory";
  cache.clear();
  let t0 = performance.now();
  pts.forEach((p) => height(p[0], p[1]));
  const cold = performance.now() - t0;
  t0 = performance.now();
  pts.forEach((p) => height(p[0], p[1]));
  const warm = performance.now() - t0;
  mode = "pread";
  stats.preads = 0;
  t0 = performance.now();
  pts.forEach((p) => height(p[0], p[1]));
  const pread = performance.now() - t0;
  timing.push({ name: tr.name, points: pts.length, cold, warm, pread, preads: stats.preads });
}
for (const fd of fds.values()) closeSync(fd);

const pct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)} %`;
const fmt = (x) => `${x.step} m | ${x.sm ? `${x.sm} m (${x.win} pts)` : "none"} | ${x.thr} m | ${(x.mean * 100).toFixed(1)} % | ${(x.meanOutside * 100).toFixed(1)} % | ${(x.max * 100).toFixed(1)} % | ${x.errs.map((e) => pct(e.rel)).join(" | ")}`;
const lines = [
  "# BD ALTI 25 m elevation gain spike: results (PROTOTYPE, issue #14)", "",
  "Reference: IGN RGE ALTI every 5 m, 25 m moving average (same as #3). Error = (gain − reference) / max(reference, 100 m).", "",
  "## Per track (chosen method: 30 m step, no smoothing, 1 m threshold)", "",
  "| Track | Reference D+ | BD ALTI 25 m | Height bias vs RGE ALTI | Height RMSE |", "|---|---|---|---|---|",
  ...tracks.map((tr, i) => `| ${tr.name} | ${refs[i].toFixed(0)} m | ${chosen.errs[i].g.toFixed(0)} m (${pct(chosen.errs[i].rel)}) | ${pointwise[i].bias.toFixed(1)} m | ${pointwise[i].rmse.toFixed(1)} m |`),
  "", `## All methods (${methods.length}), sorted by mean abs error`, "",
  `| Step | Smoothing | Threshold | Mean abs | Mean abs outside Paris | Max abs | ${tracks.map((tr) => tr.name).join(" | ")} |`,
  `|---|---|---|---|---|---|${tracks.map(() => "---").join("|")}|`,
  ...methods.map((x) => `| ${fmt(x)} |`),
  "", "## Lookup time per route (30 m step)", "",
  "| Track | Points | Cold, tiles read from disk (ms) | Warm, tiles cached (ms) | No cache, one pread per cell (ms) |", "|---|---|---|---|---|",
  ...timing.map((x) => `| ${x.name} | ${x.points} | ${x.cold.toFixed(1)} | ${x.warm.toFixed(1)} | ${x.pread.toFixed(1)} |`),
];
mkdirSync(new URL("results/", import.meta.url), { recursive: true });
writeFileSync(new URL("results/summary.md", import.meta.url), lines.join("\n") + "\n");
console.log(lines.join("\n"));
