// What the web app may import from the API: the criteria vocabulary and its bounds, which it
// validates with before sending, the error codes it words, and the parts of a route it reads from
// an answer. Anything else in `apps/api` is internal.
export type { ApiError, ErrorCode } from './http/errors.ts';
export {
  CriteriaError,
  parseCriteria,
  type Activity,
  type Criteria,
  type CriteriaField,
  type Miss,
  type SurfaceStretch,
} from './route-generation/index.ts';
export {
  MAX_TARGET_DISTANCE,
  MAX_ROUTES,
  MAX_TARGET_ELEVATION_GAIN,
  MIN_TARGET_DISTANCE,
  TARGET_DURATION,
} from './route-generation/constants.ts';
