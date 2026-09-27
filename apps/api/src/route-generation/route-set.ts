import {
  CLIMB_PER_EFFORT_KM,
  MAX_ROUTES,
  MAX_SHARED,
  MIN_ROUTES,
  MIN_TARGET_DISTANCE,
  START_RADIUS,
  START_RADIUS_SHARE,
  TOLERANCES,
} from './constants.ts';
import { cellsAlong, retraceShare, sharedShare } from './geometry.ts';

/** Longitude and latitude, in degrees. */
export type Position = [number, number];

/** Distances in kilometres, durations in minutes, elevation gain in metres. */
export type Criteria = {
  start: Position;
  target: { distance: number } | { duration: number };
  elevationGain?: number;
  surface: 'paved' | 'unpaved' | 'any';
  /** Minutes per kilometre on flat ground. */
  pace: number;
};

/** A loop from the routing engine, with its elevation gain from BD ALTI. */
export type Candidate = {
  geometry: Position[];
  /** Kilometres. */
  distance: number;
  /** Metres. */
  elevationGain: number;
  unpavedShare: number;
};

/** `gap` is in the criterion's unit: kilometres, minutes, or metres. */
export type Miss = { criterion: 'distance' | 'duration' | 'elevationGain'; gap: number };

export type Route = Candidate & {
  /** Minutes. */
  estimatedDuration: number;
  kind: 'match' | 'suggestion';
  misses: Miss[];
};

function effortDistance(distance: number, elevationGain: number): number {
  return distance + elevationGain / CLIMB_PER_EFFORT_KM;
}

/**
 * The distance to ask the routing engine for, in kilometres. Throws a `RangeError` when a
 * target duration is too short for the target elevation gain.
 */
export function targetDistance(criteria: Criteria): number {
  if ('distance' in criteria.target) return criteria.target.distance;
  const distance = criteria.target.duration / criteria.pace - (criteria.elevationGain ?? 0) / CLIMB_PER_EFFORT_KM;
  if (distance < MIN_TARGET_DISTANCE) {
    throw new RangeError(`Target duration leaves ${distance} km, under ${MIN_TARGET_DISTANCE} km`);
  }
  return distance;
}

/** `scale` turns a gap into a relative gap, for ranking. */
type Check = { criterion: Miss['criterion']; gap: number; scale: number; match: number; suggestion: number };

function checks(criteria: Criteria, route: Candidate & { estimatedDuration: number }): Check[] {
  const { match, suggestion } = TOLERANCES;
  const result: Check[] = [];
  if ('distance' in criteria.target) {
    const target = criteria.target.distance;
    result.push({
      criterion: 'distance',
      gap: route.distance - target,
      scale: target,
      match: match.distance * target,
      suggestion: suggestion.distance * target,
    });
  } else {
    const target = criteria.target.duration;
    result.push({
      criterion: 'duration',
      gap: route.estimatedDuration - target,
      scale: target,
      match: match.distance * target,
      suggestion: suggestion.distance * target,
    });
  }
  if (criteria.elevationGain !== undefined) {
    const target = criteria.elevationGain;
    result.push({
      criterion: 'elevationGain',
      gap: route.elevationGain - target,
      // Below this target, the floor of the match tolerance applies.
      scale: Math.max(target, match.elevationGainFloor / match.elevationGain),
      match: Math.max(match.elevationGain * target, match.elevationGainFloor),
      suggestion: Math.max(suggestion.elevationGain * target, suggestion.elevationGainFloor),
    });
  }
  return result;
}

/** Share of the route on the surface the user did not ask for. */
function surfaceMismatch(surface: Criteria['surface'], unpavedShare: number): number {
  if (surface === 'unpaved') return 1 - unpavedShare;
  if (surface === 'paved') return unpavedShare;
  return 0;
}

type Ranked = { route: Route; score: number; cells: Set<string> };

function classify(criteria: Criteria, candidate: Candidate, startRadius: number): Ranked | undefined {
  const estimatedDuration = effortDistance(candidate.distance, candidate.elevationGain) * criteria.pace;
  const results = checks(criteria, { ...candidate, estimatedDuration });
  if (results.some(({ gap, suggestion }) => Math.abs(gap) > suggestion)) return undefined;
  const misses = results
    .filter(({ gap, match }) => Math.abs(gap) > match)
    .map(({ criterion, gap }) => ({ criterion, gap }));
  const cells = cellsAlong(candidate.geometry, criteria.start, startRadius);
  const score =
    results.reduce((sum, { gap, scale }) => sum + Math.abs(gap) / scale, 0) +
    surfaceMismatch(criteria.surface, candidate.unpavedShare) +
    retraceShare(cells);
  return {
    route: { ...candidate, estimatedDuration, kind: misses.length ? 'suggestion' : 'match', misses },
    score,
    cells: new Set(cells.map(({ cell }) => cell)),
  };
}

export function buildRouteSet(criteria: Criteria, candidates: Candidate[]): Route[] {
  const startRadius = Math.min(START_RADIUS, START_RADIUS_SHARE * targetDistance(criteria) * 1000);
  const ranked = candidates
    .flatMap((candidate) => classify(criteria, candidate, startRadius) ?? [])
    .sort((a, b) => a.score - b.score);

  const picked: Ranked[] = [];
  const pick = (kind: Route['kind'], size: number) => {
    for (const entry of ranked) {
      if (picked.length >= size) return;
      if (entry.route.kind !== kind) continue;
      if (picked.some(({ cells }) => sharedShare(cells, entry.cells) > MAX_SHARED)) continue;
      picked.push(entry);
    }
  };
  pick('match', MAX_ROUTES);
  pick('suggestion', MIN_ROUTES);
  return picked.map(({ route }) => route);
}
