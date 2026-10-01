// What the web app may import from the API: the criteria vocabulary and its bounds, which it
// validates with before sending. Anything else in `apps/api` is internal.
export {
  CriteriaError,
  parseCriteria,
  type Activity,
  type Criteria,
  type CriteriaField,
} from './route-generation/index.ts';
export {
  MAX_TARGET_DISTANCE,
  MAX_TARGET_ELEVATION_GAIN,
  MIN_TARGET_DISTANCE,
  TARGET_DURATION,
} from './route-generation/constants.ts';
