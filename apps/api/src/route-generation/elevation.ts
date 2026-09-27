import { BDALTI_CELL, ELEVATION_STEP } from './constants.ts';
import { distance } from './geometry.ts';
import type { Position } from './route-set.ts';

/** Height in metres at a longitude and latitude, in degrees. */
export type HeightAt = (lon: number, lat: number) => number;

const RAD = Math.PI / 180;

// Lambert-93 on the GRS80 ellipsoid (RGF93, the same as WGS84 at this scale), IGN formulas.
const A = 6_378_137;
const E = Math.sqrt(0.006_694_380_022_90);
const isometric = (phi: number) =>
  Math.tan(Math.PI / 4 - phi / 2) / ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2);
const scale = (phi: number) => Math.cos(phi) / Math.sqrt(1 - (E * Math.sin(phi)) ** 2);
const [PHI1, PHI2, PHI0] = [44 * RAD, 49 * RAD, 46.5 * RAD];
const N = Math.log(scale(PHI1) / scale(PHI2)) / Math.log(isometric(PHI1) / isometric(PHI2));
const C = (A * scale(PHI1)) / (N * isometric(PHI1) ** N);
const RHO0 = C * isometric(PHI0) ** N;

/** Lambert-93 easting and northing, in metres. */
export function lambert93(lon: number, lat: number): [number, number] {
  const rho = C * isometric(lat * RAD) ** N;
  const theta = N * (lon - 3) * RAD;
  return [700_000 + rho * Math.sin(theta), 6_600_000 + RHO0 - rho * Math.cos(theta)];
}

/**
 * Height at a point by bilinear interpolation on the BD ALTI grid, where `cellHeight(i, j)`
 * is the height of the cell centred at Lambert-93 (25 i, 25 j).
 */
export function bilinearHeight(lon: number, lat: number, cellHeight: (i: number, j: number) => number): number {
  const [x, y] = lambert93(lon, lat);
  const i = Math.floor(x / BDALTI_CELL);
  const j = Math.floor(y / BDALTI_CELL);
  const fx = x / BDALTI_CELL - i;
  const fy = y / BDALTI_CELL - j;
  return (
    cellHeight(i, j) * (1 - fx) * (1 - fy) +
    cellHeight(i + 1, j) * fx * (1 - fy) +
    cellHeight(i, j + 1) * (1 - fx) * fy +
    cellHeight(i + 1, j + 1) * fx * fy
  );
}

/** Points every `step` metres along a geometry, from its first point, plus its last point. */
export function resample(geometry: Position[], step: number): Position[] {
  const points: Position[] = [geometry[0]];
  let sinceLast = 0;
  for (let k = 1; k < geometry.length; k++) {
    const [a, b] = [geometry[k - 1], geometry[k]];
    const length = distance(a, b);
    let along = step - sinceLast;
    for (; along <= length; along += step) {
      const f = along / length;
      points.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    sinceLast = length - (along - step);
  }
  points.push(geometry[geometry.length - 1]);
  return points;
}

/** Heights in metres every `ELEVATION_STEP` metres along a geometry, and at its last point. */
export function elevationProfile(geometry: Position[], heightAt: HeightAt): number[] {
  return resample(geometry, ELEVATION_STEP).map(([lon, lat]) => heightAt(lon, lat));
}

/** Elevation gain in metres along a geometry: every climb in its profile, with no smoothing or threshold (#14). */
export function elevationGain(geometry: Position[], heightAt: HeightAt): number {
  const profile = elevationProfile(geometry, heightAt);
  let gain = 0;
  for (let k = 1; k < profile.length; k++) gain += Math.max(0, profile[k] - profile[k - 1]);
  return gain;
}
