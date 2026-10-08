import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { SURFACE_CLASSES } from '../components/index.ts';
import { formatDistance, formatDuration, formatHeight, type Display, type Route } from '../core/index.ts';
import { criteriaText, routesText } from '../i18n/index.ts';

/** The distance, duration, climb and descent of a route. */
export function RouteFigures({ route, display }: { route: Route; display: Display }) {
  const t = { ...criteriaText[display.language], ...routesText[display.language] };
  return (
    <dl className="m-0 grid flex-1 grid-cols-2 gap-x-4 gap-y-2" data-testid="route-figures">
      <Figure label={t.distance} testId="route-distance">
        {formatDistance(route.distance, display)}
      </Figure>
      <Figure label={t.estimatedDuration} testId="route-duration">
        {formatDuration(route.estimatedDuration, display.language)}
      </Figure>
      {route.elevationGain !== undefined && (
        <Figure label={t.climb} testId="route-climb" icon={<ArrowUpRight size={16} aria-hidden />}>
          {formatHeight(route.elevationGain, display)}
        </Figure>
      )}
      {route.elevationLoss !== undefined && (
        <Figure label={t.descent} testId="route-descent" icon={<ArrowDownRight size={16} aria-hidden />}>
          {formatHeight(route.elevationLoss, display)}
        </Figure>
      )}
    </dl>
  );
}

/** The unpaved share of a route, kept within 0 and 1, and the paved and unpaved shares as percentages. */
export function surfaceShares({ unpavedShare }: Route, { language }: Display) {
  const unpaved = Math.min(1, Math.max(0, unpavedShare));
  const percent = new Intl.NumberFormat(language, { style: 'percent' });
  return { unpaved: percent.format(unpaved), paved: percent.format(1 - unpaved), unpavedShare: unpaved };
}

/** The legend of the colours of the elevation profile, with the share of each surface. */
export function SurfaceShare({ route, display }: { route: Route; display: Display }) {
  const t = criteriaText[display.language];
  const shares = surfaceShares(route, display);
  return (
    <p data-testid="route-surface" className="m-0 flex items-center gap-1 text-sm text-ink-2">
      <i className={`size-2 rounded-full ${SURFACE_CLASSES.paved.dot}`} aria-hidden />
      {t.paved} {shares.paved}
      <span className="whitespace-pre"> · </span>
      <i className={`size-2 rounded-full ${SURFACE_CLASSES.unpaved.dot}`} aria-hidden />
      {t.unpaved} {shares.unpaved}
    </p>
  );
}

function Figure({
  label,
  icon,
  testId,
  children,
}: {
  label: string;
  icon?: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd data-testid={testId} className="m-0 flex items-center gap-1 text-lg font-bold">
        {icon}
        {children}
      </dd>
    </div>
  );
}
