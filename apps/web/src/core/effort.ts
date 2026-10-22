import { SLOPE_EFFORT } from '../contract/index.ts';
import { distancesAlong } from './distance.ts';

/**
 * The effort distance in kilometres from the start to each point of a route: the length of each stretch weighted by
 * its slope, so that climbs and steep descents weigh more than flat ground and gentle descents less (Tobler's hiking
 * function, relative to flat ground). The heights are read over stretches of at least `stretchMetres`, since the grade
 * between two neighbouring points is mostly noise, and the server counts them the same way. A route without heights is
 * flat. `distances` are those of `distancesAlong`, when the caller has them already.
 */
export function effortAlong(geometry: number[][], distances = distancesAlong(geometry)): number[] {
  const { decay, easiestGrade, maxGrade, stretchMetres } = SLOPE_EFFORT;
  if (geometry.length === 0 || geometry[0]!.length < 3) return distances;
  const along = [0];
  let [from, startHeight] = [0, geometry[0]![2]!];
  for (let k = 1; k < geometry.length; k++) {
    const stretch = (distances[k]! - distances[from]!) * 1000;
    along.push(along[from]! + (distances[k]! - distances[from]!));
    if (stretch < stretchMetres && k < geometry.length - 1) continue;
    if (stretch > 0) {
      const grade = Math.max(-maxGrade, Math.min(maxGrade, (geometry[k]![2]! - startHeight) / stretch));
      const weight = Math.exp(decay * (Math.abs(grade - easiestGrade) - Math.abs(easiestGrade)));
      // Every point of the stretch carries its share, so that a stop in the middle has an effort too.
      for (let j = from + 1; j <= k; j++) along[j] = along[from]! + (distances[j]! - distances[from]!) * weight;
    }
    [from, startHeight] = [k, geometry[k]![2]!];
  }
  return along;
}

/** How much harder than flat ground a route is, by the slope of its stretches: its effort distance over its distance. */
export function effortFactor(geometry: number[][]): number {
  const distances = distancesAlong(geometry);
  const total = distances.at(-1)!;
  return total > 0 ? effortAlong(geometry, distances).at(-1)! / total : 1;
}
