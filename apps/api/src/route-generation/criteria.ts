import type { Activity } from './candidates.ts';
import { MAX_TARGET_DISTANCE, MAX_TARGET_ELEVATION_GAIN, MIN_TARGET_DISTANCE, TARGET_DURATION } from './constants.ts';
import { targetDistance, type Criteria } from './route-set.ts';

const SURFACES: Criteria['surface'][] = ['paved', 'unpaved', 'any'];

// Messages name the field, never its value: the API logs no locations.
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new RangeError(message);
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const within = (value: unknown, min: number, max: number): value is number =>
  isNumber(value) && value >= min && value <= max;

/**
 * Criteria and activity from a request body, within the #7 bounds. Throws a `RangeError`
 * on anything else, including a target duration too short for the target elevation gain
 * or too long for the activity at the user's pace. Without `countElevationGain`, the target
 * elevation gain is checked but dropped.
 */
export function parseCriteria(
  body: unknown,
  { countElevationGain = true } = {},
): { criteria: Criteria; activity: Activity } {
  check(isObject(body), 'Criteria must be an object');
  const { start, activity, target, elevationGain, surface, pace } = body;

  check(
    Array.isArray(start) && start.length === 2 && within(start[0], -180, 180) && within(start[1], -90, 90),
    'start must be a longitude and a latitude',
  );
  check(typeof activity === 'string' && Object.hasOwn(MAX_TARGET_DISTANCE, activity), 'Unknown activity');
  const maxDistance = MAX_TARGET_DISTANCE[activity as Activity];

  check(isObject(target) && Object.keys(target).length === 1, 'target must be a distance or a duration');
  let parsedTarget: Criteria['target'];
  if ('distance' in target) {
    check(within(target.distance, MIN_TARGET_DISTANCE, maxDistance), 'Target distance out of bounds');
    parsedTarget = { distance: target.distance };
  } else {
    check(within(target.duration, TARGET_DURATION.min, TARGET_DURATION.max), 'Target duration out of bounds');
    parsedTarget = { duration: target.duration };
  }

  check(
    elevationGain === undefined ||
      elevationGain === 'flat' ||
      elevationGain === 'hilly' ||
      within(elevationGain, 0, MAX_TARGET_ELEVATION_GAIN),
    'Target elevation gain out of bounds',
  );
  check(SURFACES.includes(surface as Criteria['surface']), 'Unknown surface preference');
  check(isNumber(pace) && pace > 0, 'pace must be a positive number');

  const criteria: Criteria = {
    start: [start[0], start[1]],
    target: parsedTarget,
    ...(countElevationGain && elevationGain !== undefined && { elevationGain: elevationGain as Criteria['elevationGain'] }),
    surface: surface as Criteria['surface'],
    pace,
  };
  // With a target duration, bounds the distance it makes at this pace too.
  check(targetDistance(criteria) <= maxDistance, 'Target duration makes too long a route at this pace');
  return { criteria, activity: activity as Activity };
}
