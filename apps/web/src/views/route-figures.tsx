import { ArrowDownRight, ArrowUpRight, Mountain, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { SURFACE_CLASSES } from '../components/index.ts';
import { formatDistance, formatDuration, formatHeight, type Route } from '../core/index.ts';
import type { Language } from '../i18n/index.ts';
import { criteriaText, routesText } from '../i18n/index.ts';

// The icons of a climb and of a descent, in the figures and wherever else they are shown.
export const CLIMB_ICON = ArrowUpRight;
export const DESCENT_ICON = ArrowDownRight;

/** The distance, duration, climb and descent of a route. `className` sizes it in its container. */
export function RouteFigures({
  route,
  language,
  className = '',
}: {
  route: Route;
  language: Language;
  className?: string;
}) {
  const t = { ...criteriaText[language], ...routesText[language] };
  return (
    <dl className={`m-0 grid grid-cols-2 gap-x-4 gap-y-2 ${className}`} data-testid="route-figures">
      <Figure label={t.distance} testId="route-distance">
        {formatDistance(route.distance, language)}
      </Figure>
      <Figure label={t.estimatedDuration} testId="route-duration">
        {formatDuration(route.estimatedDuration, language)}
      </Figure>
      {route.elevationGain !== undefined && (
        <Figure label={t.climb} testId="route-climb" icon={<CLIMB_ICON size={16} aria-hidden />}>
          {formatHeight(route.elevationGain, language)}
        </Figure>
      )}
      {route.elevationLoss !== undefined && (
        <Figure label={t.descent} testId="route-descent" icon={<DESCENT_ICON size={16} aria-hidden />}>
          {formatHeight(route.elevationLoss, language)}
        </Figure>
      )}
    </dl>
  );
}

/** The unpaved share of a route, kept within 0 and 1, and the paved and unpaved shares as percentages. */
export function surfaceShares({ unpavedShare }: Route, language: Language) {
  const unpaved = Math.min(1, Math.max(0, unpavedShare));
  const percent = new Intl.NumberFormat(language, { style: 'percent' });
  return { unpaved: percent.format(unpaved), paved: percent.format(1 - unpaved), unpavedShare: unpaved };
}

/** The legend of the colours of the elevation profile, with the share of each surface. */
export function SurfaceShare({ route, language }: { route: Route; language: Language }) {
  const t = criteriaText[language];
  const shares = surfaceShares(route, language);
  return (
    <p data-testid="route-surface" className="m-0 flex items-center justify-center gap-1 text-sm text-ink-2">
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
    <div className="flex flex-col-reverse items-center">
      <dt className="text-center text-sm text-ink-2">{label}</dt>
      <dd data-testid={testId} className="m-0 flex items-center justify-center gap-1 text-lg font-bold">
        {icon}
        {children}
      </dd>
    </div>
  );
}

/** A remark on a route, such as a technical stretch it holds. */
export function Marker({ icon: Icon, text, testId }: { icon: LucideIcon; text: string; testId: string }) {
  return (
    <span data-testid={testId} className="flex items-center gap-1 text-sm font-semibold text-ink">
      <Icon size={14} aria-hidden className="text-miss" />
      {text}
    </span>
  );
}

/** The technical stretches of a route, or nothing for a route without. */
export function RouteMarkers({
  route,
  language,
  className = '',
}: {
  route: Route;
  language: Language;
  className?: string;
}) {
  if (!route.technical) return null;
  return (
    <div className={`flex ${className}`}>
      <Marker icon={Mountain} text={routesText[language].technical} testId="route-technical" />
    </div>
  );
}
