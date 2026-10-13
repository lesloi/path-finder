import { useEffect, useRef, useState } from 'react';

import type { CriteriaField, ErrorCode } from '../contract/index.ts';
import { parseRoutes, type Route, type RouteSetRequest } from '../core/index.ts';
import { buildIdHeader } from './api.ts';

/**
 * Why there is no route set: an error code of the API, the API cannot be reached, or it answered
 * something that is not a route set.
 */
export type RouteSetError = ErrorCode | 'unreachable' | 'failed';

/** What an `invalid-criteria` refusal names: the field, and for a waypoint its number counted from 1. */
export type InvalidCriteria = { field: CriteriaField; waypoint?: number };

// A gateway or a proxy answers these when the API behind it is down.
const GATEWAY_STATUSES = [502, 503, 504];

// Every code, so a new one fails the typecheck until it is known here.
const ERROR_CODES = {
  'invalid-json': true,
  'invalid-criteria': true,
  'stale-build': true,
  'rate-limited': true,
  overloaded: true,
  'generation-timeout': true,
} satisfies Record<ErrorCode, true>;

const FIELDS = {
  start: true,
  target: true,
  elevationGain: true,
  surface: true,
  pace: true,
  waypoints: true,
} satisfies Record<CriteriaField, true>;

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && Object.hasOwn(ERROR_CODES, value);

// The field and waypoint of a refusal, or none when the body names a field this build does not know.
function invalidCriteria(body: object): InvalidCriteria | undefined {
  const { field, waypoint } = body as { field?: unknown; waypoint?: unknown };
  if (typeof field !== 'string' || !Object.hasOwn(FIELDS, field)) return undefined;
  const known = field as CriteriaField;
  return known === 'waypoints' && typeof waypoint === 'number' && Number.isInteger(waypoint) && waypoint > 0
    ? { field: known, waypoint }
    : { field: known };
}

/**
 * Asks our own API for a route set, the only request that carries the start point. Returns the
 * routes, or why there are none (`stale-build` when the API runs a newer build), with the field at fault
 * for `invalid-criteria`. Rejects only once `signal` aborts.
 */
export async function requestRouteSet(
  request: RouteSetRequest,
  signal?: AbortSignal,
): Promise<{ routes: Route[] } | { error: RouteSetError; retryAfter?: number; invalid?: InvalidCriteria }> {
  let response: Response;
  try {
    response = await fetch('/api/v1/route-sets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildIdHeader(),
      },
      body: JSON.stringify(request),
      ...(signal && { signal }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { error: 'unreachable' };
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;
    if (!isErrorCode(code)) return { error: GATEWAY_STATUSES.includes(response.status) ? 'unreachable' : 'failed' };
    // Seconds the server asks to wait, which it sets for `overloaded` and `rate-limited`.
    const retryAfter = Number(response.headers.get('Retry-After'));
    const invalid = code === 'invalid-criteria' ? invalidCriteria(body as object) : undefined;
    return { error: code, ...(retryAfter > 0 && { retryAfter }), ...(invalid && { invalid }) };
  }
  const routes = parseRoutes(body);
  return routes ? { routes } : { error: 'failed' };
}

// Times to ask again when the server is busy: a slot frees in well under a second, so most users never see it.
const MAX_RETRIES = 2;
// The longest wait the server may ask for before a retry, in seconds, beyond which the user decides.
const MAX_RETRY_AFTER = 5;

/**
 * Milliseconds to wait before asking again: what the server asked for (a second by default) plus up to a
 * second at random, so the users it refused together do not all come back together.
 */
export function retryDelay(retryAfter = 1): number {
  return (Math.min(retryAfter, MAX_RETRY_AFTER) + Math.random()) * 1000;
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Asks for a route set, and asks again after a short wait while the server says it is busy (`overloaded`),
 * up to `MAX_RETRIES` times. Other refusals come back at once: `rate-limited` lasts minutes, and a retry
 * would only add to it. Rejects only once `signal` aborts, also while it waits.
 */
async function requestWithRetries(request: RouteSetRequest, signal: AbortSignal) {
  let result = await requestRouteSet(request, signal);
  for (let retry = 0; retry < MAX_RETRIES && 'error' in result && result.error === 'overloaded'; retry++) {
    await pause(retryDelay(result.retryAfter), signal);
    result = await requestRouteSet(request, signal);
  }
  return result;
}

/**
 * The route set of the last criteria the user asked for, kept in memory only: it is gone when
 * cleared or when the app closes. `onError` hears why a request gave no routes, `no-routes` when
 * the API found none; after an error the routes shown before the request come back.
 */
export function useRouteSet(onError: (error: RouteSetError | 'no-routes', invalid?: InvalidCriteria) => void) {
  const [routeSet, setRouteSet] = useState<{ request: RouteSetRequest; routes: Route[] }>();
  const [loading, setLoading] = useState(false);
  const running = useRef<AbortController>(undefined);
  // What was shown when a request started: given back if the request gives no routes, so a refusal loses nothing.
  const previous = useRef<{ request: RouteSetRequest; routes: Route[] }>(undefined);
  const report = useRef(onError);
  useEffect(() => {
    report.current = onError;
  });

  useEffect(() => () => running.current?.abort(), []);

  function find(request: RouteSetRequest) {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    if (routeSet) previous.current = routeSet;
    setRouteSet(undefined);
    setLoading(true);
    requestWithRetries(request, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        if ('error' in result) {
          setRouteSet(previous.current);
          if (result.invalid) report.current(result.error, result.invalid);
          else report.current(result.error);
        } else if (result.routes.length === 0) {
          previous.current = undefined;
          report.current('no-routes');
        } else {
          previous.current = undefined;
          setRouteSet({ request, routes: result.routes });
        }
      })
      // Only a request cancelled by a newer one or by `clear` rejects.
      .catch(() => {});
  }

  function clear() {
    running.current?.abort();
    previous.current = undefined;
    setLoading(false);
    setRouteSet(undefined);
  }

  return { routeSet, loading, find, clear };
}
