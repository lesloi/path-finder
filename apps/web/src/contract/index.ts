// What the web app shares with the server: the criteria vocabulary and its bounds, the error codes it
// words, and the parts of a route it reads. The bounds come from `apps/server/contract/contract.json`.
export { CriteriaError, parseCriteria, type Criteria, type CriteriaField, type Position } from './criteria.ts';
export type { ApiError, ErrorCode, Miss, SurfaceStretch } from './errors.ts';
export {
  CLIMB_PER_EFFORT_KM,
  ERROR_CODES,
  MAX_TARGET_DISTANCE,
  MAX_TARGET_ELEVATION_GAIN,
  MIN_TARGET_DISTANCE,
  SURFACES,
  TARGET_DURATION,
} from './limits.ts';
