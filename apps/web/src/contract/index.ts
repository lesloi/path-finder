// What the web app shares with the server: the criteria vocabulary and its bounds, the error codes it
// words, and the parts of a route it reads. The bounds come from `apps/server/contract/contract.json`.
export {
  areaContains,
  byDuration,
  METRES_PER_DEGREE,
  CRITERIA_FIELDS,
  CriteriaError,
  isCriteriaField,
  parseCriteria,
  type AvoidedArea,
  type Criteria,
  type CriteriaField,
  type LoopCriteria,
  type OutAndBackCriteria,
  type Position,
} from './criteria.ts';
export type { ApiError, ErrorCode, SurfaceStretch, TechnicalStretch } from './errors.ts';
export {
  AVOIDED_AREA_RADIUS,
  CLIMB_PER_EFFORT_KM,
  SLOPE_EFFORT,
  ERROR_CODES,
  MAX_AVOIDED_AREAS,
  MAX_TARGET_DISTANCE,
  MAX_TARGET_ELEVATION_GAIN,
  MAX_WAYPOINTS,
  MIN_TARGET_DISTANCE,
  POI_TILE_ZOOM,
  SURFACES,
  TARGET_DURATION,
} from './limits.ts';
