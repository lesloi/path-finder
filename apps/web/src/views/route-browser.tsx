import { LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { TOAST } from '../components/index.ts';
import type { Position, RouteSetRequest } from '../core/index.ts';
import { errorText, routesText, type Language } from '../i18n/index.ts';
import { useRouteSet, type RouteSetError } from '../state/index.ts';

const TOAST_MS = 6_000;

/**
 * What the user does with a route set: asking for it, the route selected, whether its detail is open,
 * and the place they point at on its elevation profile. The route set is gone once cleared.
 */
export function useRouteBrowser() {
  const [error, setError] = useState<RouteSetError | 'no-routes'>();
  const { routeSet, loading, find, clear } = useRouteSet(setError);
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState(false);
  const [hover, setHover] = useState<Position>();
  // Kept while the route set does, so the map's effects only run for a new one.
  const geometries = useMemo(
    () => routeSet?.routes.map(({ geometry }) => geometry.map(([lon, lat]): Position => [lon, lat])),
    [routeSet],
  );

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(undefined), TOAST_MS);
    return () => clearTimeout(timer);
  }, [error]);

  return {
    routeSet,
    loading,
    error,
    selected,
    detail,
    hover,
    geometries,
    select: setSelected,
    setHover,
    dismissError: () => setError(undefined),
    ask(request: RouteSetRequest) {
      setError(undefined);
      setSelected(0);
      setDetail(false);
      find(request);
    },
    /** Back to the criteria, dropping the route set or the request still running. */
    cancel() {
      clear();
      setDetail(false);
      setHover(undefined);
    },
    openDetail(open: boolean) {
      setDetail(open);
      setHover(undefined);
    },
  };
}

/** What replaces the criteria while the API works: a status, and a way back. */
export function SearchingPanel({ language, onCancel }: { language: Language; onCancel: () => void }) {
  const t = routesText[language];
  return (
    <div className="flex flex-col gap-3">
      <p
        role="status"
        data-testid="routes-loading"
        className="m-0 flex min-h-touch items-center justify-center gap-2 text-ink-2"
      >
        <LoaderCircle size={20} aria-hidden className="animate-spin" />
        {t.finding}
      </p>
      <button
        type="button"
        data-testid="routes-cancel"
        className="min-h-touch rounded-full text-accent"
        onClick={onCancel}
      >
        {t.criteria}
      </button>
    </div>
  );
}

/** Why a request gave no routes, in the user's language; a click drops it. */
export function RouteErrorToast({
  language,
  error,
  onDismiss,
}: {
  language: Language;
  error: RouteSetError | 'no-routes';
  onDismiss: () => void;
}) {
  const t = routesText[language];
  const lines =
    error === 'no-routes'
      ? [t.noRoutes, t.noRoutesHint]
      : error === 'unreachable'
        ? [t.unreachable, t.unreachableHint]
        : [errorText[language][error]];
  return (
    <p className={TOAST} role="alert" data-testid="routes-toast" onClick={onDismiss}>
      {lines[0]}
      {lines[1] && (
        <>
          <br />
          {lines[1]}
        </>
      )}
    </p>
  );
}
