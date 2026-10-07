import {
  CLIMB_PER_EFFORT_KM,
  HILLY_MATCH_PER_KM,
  MAX_TARGET_DISTANCE,
  MAX_TARGET_ELEVATION_GAIN,
  MIN_TARGET_DISTANCE,
  SURFACES,
  TARGET_DURATION,
} from './limits.ts';

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
  /** Allows the ways tagged technical. Never assumed: without it the server refuses the criteria. */
  includeTechnical: boolean;
};

/** The criteria fields `parseCriteria` checks, so a form can say which one is wrong. */
export type CriteriaField = 'start' | 'target' | 'elevationGain' | 'surface' | 'pace' | 'includeTechnical';

/** Criteria that are not valid, with the field that failed. */
export class CriteriaError extends RangeError {
  readonly field: CriteriaField;

  constructor(field: CriteriaField, message: string) {
    super(message);
    this.name = 'CriteriaError';
    this.field = field;
  }
}

function check(condition: boolean, field: CriteriaField, message: string): asserts condition {
  if (!condition) throw new CriteriaError(field, message);
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const within = (value: unknown, min: number, max: number): value is number =>
  isNumber(value) && value >= min && value <= max;

/**
 * The distance the criteria make, in kilometres. Throws a `RangeError` when a target duration is
 * too short for the target elevation gain.
 */
function targetDistance(criteria: Criteria): number {
  if ('distance' in criteria.target) return criteria.target.distance;
  const effort = criteria.target.duration / criteria.pace;
  const { elevationGain } = criteria;
  let distance: number;
  if (elevationGain === 'hilly') {
    distance = effort / (1 + HILLY_MATCH_PER_KM / CLIMB_PER_EFFORT_KM);
  } else {
    distance = effort - (typeof elevationGain === 'number' ? elevationGain : 0) / CLIMB_PER_EFFORT_KM;
  }
  if (distance < MIN_TARGET_DISTANCE) {
    throw new RangeError(`Target duration leaves ${distance} km, under ${MIN_TARGET_DISTANCE} km`);
  }
  return distance;
}

/**
 * Checks criteria as the server does, to tell the user early which field is wrong. The server
 * checks them again and has the last word: it shares the bounds and the cases of its tests with
 * this check, and nothing else.
 */
export function parseCriteria(body: unknown, { countElevationGain = true } = {}): Criteria {
  check(isObject(body), 'start', 'Criteria must be an object');
  const { start, target, elevationGain, surface, pace, includeTechnical } = body;

  check(
    Array.isArray(start) && start.length === 2 && within(start[0], -180, 180) && within(start[1], -90, 90),
    'start',
    'start must be a longitude and a latitude',
  );

  check(isObject(target) && Object.keys(target).length === 1, 'target', 'target must be a distance or a duration');
  let parsedTarget: Criteria['target'];
  if ('distance' in target) {
    check(within(target.distance, MIN_TARGET_DISTANCE, MAX_TARGET_DISTANCE), 'target', 'Target distance out of bounds');
    parsedTarget = { distance: target.distance };
  } else {
    check(within(target.duration, TARGET_DURATION.min, TARGET_DURATION.max), 'target', 'Target duration out of bounds');
    parsedTarget = { duration: target.duration };
  }

  check(
    elevationGain === undefined ||
      elevationGain === 'flat' ||
      elevationGain === 'hilly' ||
      within(elevationGain, 0, MAX_TARGET_ELEVATION_GAIN),
    'elevationGain',
    'Target elevation gain out of bounds',
  );
  check(SURFACES.includes(surface as Criteria['surface']), 'surface', 'Unknown surface preference');
  check(isNumber(pace) && pace > 0, 'pace', 'pace must be a positive number');
  check(typeof includeTechnical === 'boolean', 'includeTechnical', 'includeTechnical must be true or false');

  const criteria: Criteria = {
    start: [start[0], start[1]],
    target: parsedTarget,
    ...(countElevationGain &&
      elevationGain !== undefined && { elevationGain: elevationGain as Criteria['elevationGain'] }),
    surface: surface as Criteria['surface'],
    pace,
    // A paved request excludes them whatever it sends, as the server does.
    includeTechnical: includeTechnical && surface !== 'paved',
  };
  let distance: number;
  try {
    distance = targetDistance(criteria);
  } catch (error) {
    throw new CriteriaError('target', (error as Error).message);
  }
  check(distance <= MAX_TARGET_DISTANCE, 'target', 'Target duration makes too long a route at this pace');
  return criteria;
}
