import { CLIMB_PER_EFFORT_KM } from '../contract/index.ts';

/** Minutes per km on flat ground until the user sets a pace. */
export const DEFAULT_PACE = 6;

/**
 * The minutes a route takes at a pace: its distance plus its climb as effort kilometres, as the
 * server counts them. A route without elevation data has no climb.
 */
export function estimatedDuration(
  { distance, elevationGain }: { distance: number; elevationGain?: number },
  pace: number,
): number {
  return (distance + (elevationGain ?? 0) / CLIMB_PER_EFFORT_KM) * pace;
}
