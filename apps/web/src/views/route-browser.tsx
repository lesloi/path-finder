import { ChevronRight, LoaderCircle, Route } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { LIST_ROW_CHEVRON, TOAST } from '../components/index.ts';
import type { MapSnapshot, Position, RouteSetRequest } from '../core/index.ts';
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
  // Whether the route set is shown rather than the criteria: leaving it for the criteria keeps it.
  const [showing, setShowing] = useState(false);
  const [mapSnapshot, setSnapshot] = useState<MapSnapshot>();
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

  // A snapshot of another route set would draw the wrong places.
  const snapshot = mapSnapshot?.of === geometries ? mapSnapshot : undefined;

  return {
    routeSet,
    showing: showing && Boolean(routeSet),
    snapshot,
    setSnapshot,
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
      setShowing(true);
      find(request);
    },
    /** Back to the criteria: the routes stay on the map, and can be shown again. */
    leave() {
      setShowing(false);
      setDetail(false);
      setHover(undefined);
    },
    show() {
      setShowing(true);
    },
    /** Forgets the route set, such as when a new start point makes it stale. */
    drop() {
      clear();
      setShowing(false);
      setDetail(false);
      setHover(undefined);
    },
    openDetail(open: boolean) {
      setDetail(open);
      setHover(undefined);
    },
  };
}

/** A way back to the routes found, above the criteria that were left for them. */
export function RoutesFoundButton({
  language,
  count,
  onClick,
}: {
  language: Language;
  count: number;
  onClick: () => void;
}) {
  const t = routesText[language];
  return (
    <button
      type="button"
      data-testid="criteria-routes"
      className="flex min-h-touch w-full flex-none items-center gap-3 rounded-md bg-accent-soft px-3 text-left font-semibold text-accent"
      aria-label={t.showRoutes(count)}
      onClick={onClick}
    >
      <Route size={18} aria-hidden className="flex-none" />
      <span className="flex-1">{t.routeCount(count)}</span>
      <ChevronRight size={18} aria-hidden className={LIST_ROW_CHEVRON} />
    </button>
  );
}

/** What replaces the criteria while the API works. */
export function SearchingPanel({ language }: { language: Language }) {
  return (
    <p
      role="status"
      data-testid="routes-loading"
      className="m-0 flex min-h-touch items-center justify-center gap-2 text-ink-2"
    >
      <LoaderCircle size={20} aria-hidden className="animate-spin" />
      {routesText[language].finding}
    </p>
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
