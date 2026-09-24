// PROTOTYPE (issue #3): how accurate is elevation gain resampled on Copernicus GLO-30? Throwaway.
//
// For each test track from fetch-tracks.mjs, resample every S metres, read Copernicus heights
// (bilinear) with geotiff.js, optionally smooth and apply a hysteresis threshold, and compare the
// elevation gain with the IGN RGE ALTI reference and with BRouter's SRTM figure.
//
// Run: node spike.mjs  -> results/summary.md

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fromFile } from "geotiff";
import { gain, resample, smooth } from "./geo.mjs";

const TILES = new URL("data/tiles/", import.meta.url).pathname;
const tracks = JSON.parse(readFileSync(process.env.TRACKS ?? new URL("data/tracks.json", import.meta.url)));
const OUT = process.env.OUT ?? new URL("results/summary.md", import.meta.url).pathname;

const STEPS = [10, 20, 30, 50, 90];
const SMOOTH_M = [0, 60, 120, 200]; // moving-average window length in metres
const THRESHOLDS = [0, 1, 2, 3, 5];

// Reference: RGE ALTI every 5 m, lightly smoothed (25 m window) to drop 1 m-scale ground noise.
const referenceGain = (t) => gain(smooth(t.reference.map((p) => p[2]), 5), 0);

// --- Copernicus lookup -------------------------------------------------------------------

const tileFiles = Object.fromEntries(
  readdirSync(TILES).filter((f) => f.endsWith(".tif")).map((f) => {
    const m = f.match(/_N(\d+)_00_([EW])(\d+)_00_DEM/);
    return [`${m[1]}_${m[2] === "W" ? -m[3] : +m[3]}`, TILES + f];
  }),
);
const openImages = new Map();
async function image(lat, lon) {
  const key = `${Math.floor(lat)}_${Math.floor(lon)}`;
  if (!openImages.has(key)) openImages.set(key, (await fromFile(tileFiles[key])).getImage());
  return openImages.get(key);
}

// Reads only the window covering the points (per tile), then bilinear interpolation.
// Copernicus tiles are PixelIsPoint (GTRasterTypeGeoKey = 2): pixel (i, j) centre at west + i * res.
// Checked against RGE ALTI: the half-pixel-shifted reading has up to 1.8x the RMSE in the mountains.
async function copernicus(points) {
  const byTile = new Map();
  points.forEach((p, idx) => {
    const key = `${Math.floor(p[1])}_${Math.floor(p[0])}`;
    if (!byTile.has(key)) byTile.set(key, []);
    byTile.get(key).push(idx);
  });
  const z = new Array(points.length);
  for (const idxs of byTile.values()) {
    const img = await image(points[idxs[0]][1], points[idxs[0]][0]);
    const [west, south, east, north] = img.getBoundingBox();
    const w = img.getWidth();
    const h = img.getHeight();
    const rx = (east - west) / w;
    const ry = (north - south) / h;
    const px = idxs.map((i) => (points[i][0] - west) / rx);
    const py = idxs.map((i) => (north - points[i][1]) / ry);
    const x0 = Math.max(0, Math.floor(Math.min(...px)));
    const y0 = Math.max(0, Math.floor(Math.min(...py)));
    const x1 = Math.min(w, Math.ceil(Math.max(...px)) + 2);
    const y1 = Math.min(h, Math.ceil(Math.max(...py)) + 2);
    const [data] = await img.readRasters({ window: [x0, y0, x1, y1] });
    const ww = x1 - x0;
    const at = (x, y) => data[Math.min(y1 - y0 - 1, Math.max(0, y)) * ww + Math.min(ww - 1, Math.max(0, x))];
    idxs.forEach((i, k) => {
      const x = px[k] - x0;
      const y = py[k] - y0;
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = x - xi;
      const fy = y - yi;
      z[i] = at(xi, yi) * (1 - fx) * (1 - fy) + at(xi + 1, yi) * fx * (1 - fy)
        + at(xi, yi + 1) * (1 - fx) * fy + at(xi + 1, yi + 1) * fx * fy;
    });
  }
  return z;
}

// --- Run -----------------------------------------------------------------------------------

const refs = tracks.map(referenceGain);
const heights = {}; // `${track}|${step}` -> z
const timings = [];
for (const t of tracks) {
  for (const step of STEPS) {
    const pts = resample(t.coords, step);
    openImages.clear(); // cold: open the file and read the window for every route
    const t0 = performance.now();
    heights[`${t.name}|${step}`] = await copernicus(pts);
    const cold = performance.now() - t0;
    const t1 = performance.now();
    await copernicus(pts); // warm: file already open (geotiff re-reads and inflates the window)
    timings.push({ track: t.name, step, points: pts.length, cold, warm: performance.now() - t1 });
  }
}

// Lyon centre tracks run between buildings: Copernicus is a surface model (DSM), not terrain.
const URBAN = new Set([...["lyon-road-10", "lyon-fourviere-10"], ...tracks.filter((t) => t.kind === "urban").map((t) => t.name)]);

// Score: error relative to max(reference, 100 m) so flat routes don't blow up percentages.
const methods = [];
for (const step of STEPS) {
  for (const sm of SMOOTH_M) {
    const win = sm === 0 ? 1 : Math.max(1, Math.round(sm / step) | 1);
    if (sm !== 0 && win === 1) continue;
    for (const thr of THRESHOLDS) {
      const errs = tracks.map((t, i) => {
        const g = gain(smooth(heights[`${t.name}|${step}`], win), thr);
        return { g, err: g - refs[i], rel: (g - refs[i]) / Math.max(refs[i], 100) };
      });
      const absRel = errs.map((e) => Math.abs(e.rel));
      const outside = absRel.filter((_, i) => !URBAN.has(tracks[i].name));
      methods.push({
        step, sm, win, thr, errs,
        meanOutside: outside.reduce((a, b) => a + b, 0) / outside.length,
        meanAbs: absRel.reduce((a, b) => a + b, 0) / absRel.length,
        maxAbs: Math.max(...absRel),
      });
    }
  }
}
methods.sort((a, b) => a.meanAbs - b.meanAbs);
const raw30 = methods.find((m) => m.step === 30 && m.sm === 0 && m.thr === 0);
const best = methods[0];

const pct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)} %`;
const lines = [
  "# Copernicus elevation gain spike: results (PROTOTYPE, issue #3)", "",
  "Reference: IGN RGE ALTI sampled every 5 m, 25 m moving average. Error = (gain − reference) / max(reference, 100 m).", "",
  "## Per track", "",
  `| Track | Kind | km | Reference D+ | BRouter SRTM (filtered) | Copernicus raw, 30 m | Best method (${best.step} m, ${best.sm} m smoothing, ${best.thr} m threshold) |`,
  "|---|---|---|---|---|---|---|",
  ...tracks.map((t, i) => `| ${t.name} | ${t.kind} | ${(t.lengthM / 1000).toFixed(1)} | ${refs[i].toFixed(0)} m | `
    + `${t.brouterFilteredAscend} m (${pct((t.brouterFilteredAscend - refs[i]) / Math.max(refs[i], 100))}) | `
    + `${raw30.errs[i].g.toFixed(0)} m (${pct(raw30.errs[i].rel)}) | ${best.errs[i].g.toFixed(0)} m (${pct(best.errs[i].rel)}) |`),
  "", "## Best 15 methods (of " + methods.length + ")", "",
  "| Step | Smoothing window | Threshold | Mean abs error | Max abs error | " + tracks.map((t) => t.name).join(" | ") + " |",
  "|---|---|---|---|---|" + tracks.map(() => "---").join("|") + "|",
  ...methods.slice(0, 15).map((m) => `| ${m.step} m | ${m.sm ? `${m.sm} m (${m.win} pts)` : "none"} | ${m.thr} m | `
    + `${(m.meanAbs * 100).toFixed(1)} % | ${(m.maxAbs * 100).toFixed(1)} % | ${m.errs.map((e) => pct(e.rel)).join(" | ")} |`),
  "", "## Best 10 methods outside the dense city (Lyon tracks excluded from the ranking)", "",
  "| Step | Smoothing window | Threshold | Mean abs error outside city | " + tracks.map((t) => t.name).join(" | ") + " |",
  "|---|---|---|---|" + tracks.map(() => "---").join("|") + "|",
  ...[...methods].sort((a, b) => a.meanOutside - b.meanOutside).slice(0, 10).map((m) => `| ${m.step} m | ${m.sm ? `${m.sm} m (${m.win} pts)` : "none"} | ${m.thr} m | `
    + `${(m.meanOutside * 100).toFixed(1)} % | ${m.errs.map((e) => pct(e.rel)).join(" | ")} |`),
  "", "## Reference sensitivity (RGE ALTI every 5 m, D+ in m)", "",
  "| Track | Raw | 25 m smoothing (used) | 55 m smoothing | 1 m threshold | 2 m threshold |", "|---|---|---|---|---|---|",
  ...tracks.map((t) => {
    const z = t.reference.map((p) => p[2]);
    return `| ${t.name} | ${[gain(z), gain(smooth(z, 5)), gain(smooth(z, 11)), gain(z, 1), gain(z, 2)].map((v) => v.toFixed(0)).join(" | ")} |`;
  }),
  "", "## Best method per step", "",
  "| Step | Smoothing | Threshold | Mean abs error | Max abs error |", "|---|---|---|---|---|",
  ...STEPS.map((s) => methods.find((m) => m.step === s)).map((m) => `| ${m.step} m | ${m.sm ? `${m.sm} m` : "none"} | ${m.thr} m | ${(m.meanAbs * 100).toFixed(1)} % | ${(m.maxAbs * 100).toFixed(1)} % |`),
  "", "## Lookup time per route (geotiff.js, window read + bilinear)", "",
  "| Step | Median points | Median cold (ms) | Max cold (ms) | Median warm (ms) |", "|---|---|---|---|---|",
  ...STEPS.map((s) => {
    const ts = timings.filter((t) => t.step === s);
    const med = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    return `| ${s} m | ${med(ts.map((t) => t.points))} | ${med(ts.map((t) => t.cold)).toFixed(0)} | ${Math.max(...ts.map((t) => t.cold)).toFixed(0)} | ${med(ts.map((t) => t.warm)).toFixed(0)} |`;
  }),
];
writeFileSync(OUT, lines.join("\n") + "\n");
console.log(lines.join("\n"));
