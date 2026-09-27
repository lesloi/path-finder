import { HEADINGS, LOOP_PER_RADIUS, UNPAVED_HIGHWAYS, UNPAVED_SURFACES } from './constants.ts';
import { effortDistance, targetDistance, type Candidate, type Criteria, type Position } from './route-set.ts';

export type Activity = 'run' | 'hike';

/** A loop to ask the routing engine for: `radius` in metres, `heading` in degrees clockwise from north. */
export type LoopRequest = {
  start: Position;
  radius: number;
  heading: number;
  activity: Activity;
  surface: Criteria['surface'];
};

/** A stretch of a loop on one way, with its length in metres and its OSM tags. */
export type Way = { length: number; surface?: string; highway?: string };

/** A loop from the routing engine. `distance` is in kilometres. */
export type EngineLoop = { geometry: Position[]; distance: number; ways: Way[] };

/**
 * Asks the routing engine for a loop. A rejected call is dropped, not retried. The call must
 * reject once `signal` aborts.
 */
export type RoutingEngine = (request: LoopRequest, signal: AbortSignal) => Promise<EngineLoop>;

/** Elevation gain along a geometry, in metres. */
export type ElevationGain = (geometry: Position[]) => number;

/** Share of the length on unpaved ways, from their OSM `surface`, falling back to `highway`. */
export function unpavedShare(ways: Way[]): number {
  let total = 0;
  let unpaved = 0;
  for (const { length, surface, highway } of ways) {
    total += length;
    if (surface === undefined ? UNPAVED_HIGHWAYS.has(highway ?? '') : UNPAVED_SURFACES.has(surface)) unpaved += length;
  }
  return total ? unpaved / total : 0;
}

/**
 * Asks for one loop per heading, then once more per loop with the radius scaled to meet the
 * target, and keeps whichever of the two is closer to it. Throws a `RangeError` as
 * `targetDistance` does, and the abort reason once `signal` aborts.
 */
export async function generateCandidates(
  criteria: Criteria,
  activity: Activity,
  engine: RoutingEngine,
  elevationGain: ElevationGain,
  signal: AbortSignal,
): Promise<Candidate[]> {
  const radius = (targetDistance(criteria) * 1000) / LOOP_PER_RADIUS;
  // Loops are judged as the route set judges them: on distance, or on estimated duration.
  const [target, measure] =
    'distance' in criteria.target
      ? [criteria.target.distance, (candidate: Candidate) => candidate.distance]
      : [
          criteria.target.duration,
          (candidate: Candidate) => effortDistance(candidate.distance, candidate.elevationGain) * criteria.pace,
        ];
  const offTarget = (candidate: Candidate) => Math.abs(measure(candidate) - target);

  // A failed routing call or elevation gain drops the attempt, not the whole generation.
  const requestCandidate = async (radius: number, heading: number): Promise<Candidate | undefined> => {
    try {
      const { start, surface } = criteria;
      const { geometry, distance, ways } = await engine({ start, radius, heading, activity, surface }, signal);
      return { geometry, distance, elevationGain: elevationGain(geometry), unpavedShare: unpavedShare(ways) };
    } catch {
      return undefined;
    }
  };

  const candidates = await Promise.all(
    Array.from({ length: HEADINGS }, async (_, i) => {
      const heading = (360 / HEADINGS) * i;
      const first = await requestCandidate(radius, heading);
      if (!first) return [];
      const second = await requestCandidate((radius * target) / measure(first), heading);
      return [second && offTarget(second) < offTarget(first) ? second : first];
    }),
  );
  signal.throwIfAborted();
  return candidates.flat();
}
