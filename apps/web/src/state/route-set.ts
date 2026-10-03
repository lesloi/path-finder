import { useEffect, useRef, useState } from 'react';

import type { ErrorCode } from '../contract/index.ts';
import { parseRoutes, type Route, type RouteSetRequest } from '../core/index.ts';

/**
 * Why there is no route set: an error code of the API, the API cannot be reached, or it answered
 * something that is not a route set.
 */
export type RouteSetError = ErrorCode | 'unreachable' | 'failed';

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

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && Object.hasOwn(ERROR_CODES, value);

/**
 * Asks our own API for a route set, the only request that carries the start point. Returns the
 * routes, or why there are none; reloads the page when the API runs a newer build. Rejects only
 * once `signal` aborts.
 */
export async function requestRouteSet(
  request: RouteSetRequest,
  signal?: AbortSignal,
): Promise<{ routes: Route[] } | { error: RouteSetError }> {
  const buildId: unknown = import.meta.env.VITE_BUILD_ID;
  let response: Response;
  try {
    response = await fetch('/api/v1/route-sets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Outside a build there is no id, and "undefined" would never match the API's.
        ...(typeof buildId === 'string' && { 'X-Build-Id': buildId }),
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
    // A tab left open across a deploy: the new build words the answer.
    if (code === 'stale-build') window.location.reload();
    return { error: code };
  }
  const routes = parseRoutes(body);
  return routes ? { routes } : { error: 'failed' };
}

/**
 * The route set of the last criteria the user asked for, kept in memory only: it is gone when
 * cleared or when the app closes. `onError` hears why a request gave no routes, `no-routes` when
 * the API found none.
 */
export function useRouteSet(onError: (error: RouteSetError | 'no-routes') => void) {
  const [routeSet, setRouteSet] = useState<{ request: RouteSetRequest; routes: Route[] }>();
  const [loading, setLoading] = useState(false);
  const running = useRef<AbortController>(undefined);
  const report = useRef(onError);
  useEffect(() => {
    report.current = onError;
  });

  useEffect(() => () => running.current?.abort(), []);

  function find(request: RouteSetRequest) {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setRouteSet(undefined);
    setLoading(true);
    requestRouteSet(request, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        if ('error' in result) report.current(result.error);
        else if (result.routes.length === 0) report.current('no-routes');
        else setRouteSet({ request, routes: result.routes });
      })
      // Only a request cancelled by a newer one or by `clear` rejects.
      .catch(() => {});
  }

  function clear() {
    running.current?.abort();
    setLoading(false);
    setRouteSet(undefined);
  }

  return { routeSet, loading, find, clear };
}
