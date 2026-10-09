import { useEffect, useState } from 'react';

import { parseCoverage, type CoverageCell } from '../core/index.ts';
import { buildIdHeader } from './api.ts';

/**
 * Asks our own API where it can route: the cells of a grid that hold a way. Nothing about the user is sent.
 * Returns none when it cannot tell (offline, an error, an answer that is not one): the map then greys nothing and
 * the API still refuses a start point it cannot serve. Reloads the page when the API runs a newer build.
 */
export async function requestCoverage(signal?: AbortSignal): Promise<CoverageCell[] | undefined> {
  try {
    const response = await fetch('/api/v1/coverage', { headers: buildIdHeader(), ...(signal && { signal }) });
    // A tab left open across a deploy: the new build asks again.
    if (response.status === 426) window.location.reload();
    return response.ok ? parseCoverage(await response.json()) : undefined;
  } catch {
    return undefined;
  }
}

/** The cells where the API can route, once it has said; none until then, or if it could not. */
export function useCoverage(): CoverageCell[] | undefined {
  const [cells, setCells] = useState<CoverageCell[]>();
  useEffect(() => {
    const controller = new AbortController();
    void requestCoverage(controller.signal).then((found) => {
      if (!controller.signal.aborted) setCells(found);
    });
    return () => controller.abort();
  }, []);
  return cells;
}
