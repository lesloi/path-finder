import type { CriteriaField } from '../route-generation/index.ts';

/** Why the API refused a request. It sends no text: the web app words each code in the user's language. */
export type ErrorCode =
  'invalid-json' | 'invalid-criteria' | 'stale-build' | 'rate-limited' | 'overloaded' | 'generation-timeout';

/**
 * The body of every refusal: the code, and for `invalid-criteria` the field of the criteria that
 * failed. Never a value, as the API keeps no location. A wait comes in the `Retry-After` header.
 */
export type ApiError =
  { error: Exclude<ErrorCode, 'invalid-criteria'> } | { error: 'invalid-criteria'; field: CriteriaField };
