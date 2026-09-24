// PROTOTYPE (issue #14, copied from the #3 spike with new zones): build the test tracks and their reference elevation. Throwaway.
//
// 1. Asks the local BRouter from the #1 spike (../brouter-loops/data, same files as the
//    prototype/brouter-loops branch) for a few loops, keeping BRouter's SRTM elevation per point
//    and its own ascend figures.
// 2. Resamples each track every 5 m and gets the reference elevation from IGN RGE ALTI
//    (1-5 m LiDAR/photogrammetry terrain model) through the Géoplateforme altimetry API.
//    Only these synthetic test tracks are sent, never user data.
//
// Run: node fetch-tracks.mjs  -> data/tracks.json

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { resample } from "../copernicus-elevation/geo.mjs";

const BROUTER_DIR = new URL("../brouter-loops/data/", import.meta.url).pathname;
const IGN = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";

// name, kind, start [lon, lat], target km, heading, profile overrides
const PAVED = { SAC_scale_limit: 2, path_preference: 0 };
const UNPAVED = { SAC_scale_limit: 3, path_preference: 20 };
const PARIS = [2.3522, 48.8566]; // Hôtel de Ville
const CHEVREUSE = [2.0719, 48.705]; // Saint-Rémy-lès-Chevreuse station
const CHAMONIX = [6.8694, 45.9237];
const TRACKS = [
  ["paris-seine-10", "urban", PARIS, 10, 90, PAVED],
  ["paris-montmartre-10", "urban", PARIS, 10, 0, PAVED],
  ["paris-west-20", "urban", PARIS, 20, 270, PAVED],
  ["chevreuse-road-20", "road", CHEVREUSE, 20, 180, PAVED],
  ["chevreuse-trail-10", "trail", CHEVREUSE, 10, 90, UNPAVED],
  ["chevreuse-trail-20", "trail", CHEVREUSE, 20, 270, UNPAVED],
  ["chamonix-mixed-10", "mixed", CHAMONIX, 10, 36, PAVED],
  ["chamonix-trail-5", "trail", CHAMONIX, 5, 144, UNPAVED],
  ["chamonix-trail-10", "trail", CHAMONIX, 10, 324, UNPAVED],
];

async function brouter([lon, lat], km, heading, overrides) {
  const params = new URLSearchParams({
    lonlats: `${lon},${lat}`, profile: "hiking-mountain", engineMode: "4",
    roundTripDistance: String(Math.round((km * 1000) / 5)), direction: String(heading), format: "geojson",
  });
  for (const [k, v] of Object.entries(overrides)) params.set(`profile:${k}`, String(v));
  const res = await fetch(`http://127.0.0.1:17777/brouter?${params}`);
  const feature = (await res.json()).features[0];
  return {
    coords: feature.geometry.coordinates, // [lon, lat, srtmElevation]
    lengthM: Number(feature.properties["track-length"]),
    brouterFilteredAscend: Number(feature.properties["filtered ascend"]),
    brouterPlainAscend: Number(feature.properties["plain-ascend"]),
  };
}

async function ignElevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 2000) {
    const chunk = points.slice(i, i + 2000);
    const res = await fetch(IGN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lon: chunk.map((p) => p[0].toFixed(6)).join("|"),
        lat: chunk.map((p) => p[1].toFixed(6)).join("|"),
        resource: "ign_rge_alti_wld", zonly: "true", delimiter: "|",
      }),
    });
    out.push(...(await res.json()).elevations);
  }
  return out;
}

const server = spawn("java", [
  "-Xmx2g", "-cp", "brouter-1.7.10/brouter-1.7.10-all.jar", "btools.server.RouteServer",
  "segments", "brouter-1.7.10/profiles2", "customprofiles", "17777", "2",
], { cwd: BROUTER_DIR, stdio: "ignore" });

try {
  for (let i = 0; i < 60; i++) {
    try { await fetch("http://127.0.0.1:17777/"); break; } catch { await sleep(1000); }
  }
  const tracks = [];
  for (const [name, kind, start, km, heading, overrides] of TRACKS) {
    const route = await brouter(start, km, heading, overrides);
    const ref = resample(route.coords, 5);
    const z = await ignElevations(ref);
    tracks.push({ name, kind, ...route, reference: ref.map((p, j) => [p[0], p[1], z[j]]) });
    console.log(name, `${(route.lengthM / 1000).toFixed(1)} km`, `${ref.length} ref points`,
      `BRouter ascend ${route.brouterFilteredAscend} m`, `no-data ${z.filter((v) => v < -1000).length}`);
  }
  writeFileSync(new URL("data/tracks.json", import.meta.url), JSON.stringify(tracks));
} finally {
  server.kill();
}
