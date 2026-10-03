import contract from '../../../server/contract/contract.json' with { type: 'json' };
import type { Activity, Criteria } from './criteria.ts';

// The bounds the server enforces, from the file its own tests read too.
export const MIN_TARGET_DISTANCE = contract.minDistanceKm;
export const MAX_TARGET_DISTANCE = {
  run: contract.activities.run.maxDistanceKm,
  hike: contract.activities.hike.maxDistanceKm,
} satisfies Record<Activity, number>;
export const TARGET_DURATION = { min: contract.durationMinutes.min, max: contract.durationMinutes.max };
export const MAX_TARGET_ELEVATION_GAIN = contract.maxElevationGainMetres;
export const CLIMB_PER_EFFORT_KM = contract.climbPerEffortKm;
export const HILLY_MATCH_PER_KM = contract.hillyMatchPerKm;
export const SURFACES = contract.surfaces as Criteria['surface'][];
export const ERROR_CODES = contract.errorCodes;
