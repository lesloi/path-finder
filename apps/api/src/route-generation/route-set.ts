import {
  CLIMB_PER_EFFORT_KM,
  ELEVATION_LEVELS,
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
  /** A target in metres, or the flat or hilly shortcut. Without one, elevation gain does not count. */
  elevationGain?: number | 'flat' | 'hilly';
  surface: 'paved' | 'unpaved' | 'any';
  /** Minutes per kilometre on flat ground. */
  pace: number;
};

/** A loop from the routing engine, with its elevation gain from BD ALTI. */
export type Candidate = {
  geometry: Position[];
  /** Kilometres. */
  distance: number;
  /** Metres. Without BD ALTI, unknown and not counted. */
  elevationGain?: number;
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

/** Without an elevation gain, the distance alone. */
export function effortDistance(distance: number, elevationGain: number | undefined): number {
  return distance + (elevationGain ?? 0) / CLIMB_PER_EFFORT_KM;
}

/**
 * The distance to ask the routing engine for, in kilometres. Throws a `RangeError` when a
 * target duration is too short for the target elevation gain.
 */
export function targetDistance(criteria: Criteria): number {
  if ('distance' in criteria.target) return criteria.target.distance;
  const effort = criteria.target.duration / criteria.pace;
  const { elevationGain } = criteria;
  let distance: number;
  if (elevationGain === 'hilly') {
    // The distance plus its least climb, at `match` metres per km, makes the effort distance.
    distance = effort / (1 + ELEVATION_LEVELS.hilly.match / CLIMB_PER_EFFORT_KM);
  } else {
    distance = effort - (typeof elevationGain === 'number' ? elevationGain : 0) / CLIMB_PER_EFFORT_KM;
  }
  if (distance < MIN_TARGET_DISTANCE) {
    throw new RangeError(`Target duration leaves ${distance} km, under ${MIN_TARGET_DISTANCE} km`);
  }
  return distance;
}

/** How a route fares against one criterion. `relative` is its gap relative to the criterion, for ranking. */
type Check = { criterion: Miss['criterion']; gap: number; relative: number; match: boolean; suggestion: boolean };

function againstTarget(
  criterion: Miss['criterion'],
  gap: number,
  scale: number,
  match: number,
  suggestion: number,
): Check {
  const size = Math.abs(gap);
  return { criterion, gap, relative: size / scale, match: size <= match, suggestion: size <= suggestion };
}

function againstLevel(route: Candidate & { elevationGain: number }, level: 'flat' | 'hilly'): Check {
  const { match, suggestion } = ELEVATION_LEVELS[level];
  const perKm = route.elevationGain / route.distance;
  const bound = match * route.distance;
  const gap = route.elevationGain - bound;
  const flat = level === 'flat';
  return {
    criterion: 'elevationGain',
    gap,
    relative: Math.max(0, flat ? gap : -gap) / bound,
    match: flat ? perKm <= match : perKm >= match,
    suggestion: flat ? perKm <= suggestion : perKm >= suggestion,
  };
}

function checks(criteria: Criteria, route: Candidate & { estimatedDuration: number }): Check[] {
  const { match, suggestion } = TOLERANCES;
  const result: Check[] = [];
  if ('distance' in criteria.target) {
    const target = criteria.target.distance;
    result.push(
      againstTarget('distance', route.distance - target, target, match.distance * target, suggestion.distance * target),
    );
  } else {
    const target = criteria.target.duration;
    result.push(
      againstTarget(
        'duration',
        route.estimatedDuration - target,
        target,
        match.distance * target,
        suggestion.distance * target,
      ),
    );
  }
  const elevationGain = criteria.elevationGain;
  // Without BD ALTI, routes have no elevation gain to check.
  if (route.elevationGain === undefined) return result;
  if (elevationGain === 'flat' || elevationGain === 'hilly') {
    result.push(againstLevel({ ...route, elevationGain: route.elevationGain }, elevationGain));
  } else if (elevationGain !== undefined) {
    result.push(
      againstTarget(
        'elevationGain',
        route.elevationGain - elevationGain,
        // Below this target, the floor of the match tolerance applies.
        Math.max(elevationGain, match.elevationGainFloor / match.elevationGain),
        Math.max(match.elevationGain * elevationGain, match.elevationGainFloor),
        Math.max(suggestion.elevationGain * elevationGain, suggestion.elevationGainFloor),
      ),
    );
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
  if (results.some(({ suggestion }) => !suggestion)) return undefined;
  const misses = results.filter(({ match }) => !match).map(({ criterion, gap }) => ({ criterion, gap }));
  const cells = cellsAlong(candidate.geometry, criteria.start, startRadius);
  const score =
    results.reduce((sum, { relative }) => sum + relative, 0) +
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
