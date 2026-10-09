import contract from '../../../server/contract/contract.json' with { type: 'json' };
import type { Criteria } from './criteria.ts';

// The bounds the server enforces, from the file its own tests read too.
export const MIN_TARGET_DISTANCE = contract.minDistanceKm;
export const MAX_TARGET_DISTANCE = contract.maxDistanceKm;
export const TARGET_DURATION = { min: contract.durationMinutes.min, max: contract.durationMinutes.max };
export const MAX_TARGET_ELEVATION_GAIN = contract.maxElevationGainMetres;
export const CLIMB_PER_EFFORT_KM = contract.climbPerEffortKm;
export const HILLY_MATCH_PER_KM = contract.hillyMatchPerKm;
// Cells to the degree of the grid the coverage is drawn on: the server computes the cells on the same one.
export const COVERAGE_CELLS_PER_DEGREE = Math.round(1 / contract.coverageCellDegrees);
export const SURFACES = contract.surfaces as Criteria['surface'][];
export const ERROR_CODES = contract.errorCodes;
