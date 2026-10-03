import type { CriteriaField } from './criteria.ts';

/** Why the server refused a request. It sends no text: the web app words each code in the user's language. */
export type ErrorCode =
  'invalid-json' | 'invalid-criteria' | 'stale-build' | 'rate-limited' | 'overloaded' | 'generation-timeout';

/**
 * The body of every refusal: the code, and for `invalid-criteria` the field of the criteria that
 * failed. Never a value, as the server keeps no location. A wait comes in the `Retry-After` header.
 */
export type ApiError =
  { error: Exclude<ErrorCode, 'invalid-criteria'> } | { error: 'invalid-criteria'; field: CriteriaField };

/** A part of a route on one surface, with its share of the route's length (0 to 1). */
export type SurfaceStretch = { surface: 'paved' | 'unpaved'; share: number };

/** `gap` is in the criterion's unit: kilometres, minutes, or metres. */
export type Miss = { criterion: 'distance' | 'duration' | 'elevationGain'; gap: number };
