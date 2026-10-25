import { ArrowDownToLine, ArrowUpToLine, Flag, Mountain, Play } from 'lucide-react';
import { Fragment, useMemo, type ReactNode } from 'react';

import { WaypointPin } from '../components/waypoint-pin.tsx';
import {
  formatDistance,
  formatDuration,
  formatHeight,
  oneDecimal,
  poiLabel,
  routeTimeline,
  waypointPoiAt,
  type Position,
  type Route,
  type TimelineStep,
  type WaypointPois,
} from '../core/index.ts';
import { routesText, type Language } from '../i18n/index.ts';
import { CLIMB_ICON, DESCENT_ICON } from './route-figures.tsx';

const NO_POIS: WaypointPois = {};

// A leg shorter than this reads "0,0 km": two stops at the same place, with nothing between them to say.
const MIN_LEG_KM = 0.05;

/** The leg that ends at a stop, unless there is none or it is too short to say anything. */
export const visibleLeg = ({ leg }: TimelineStep) => (leg && leg.distance >= MIN_LEG_KM ? leg : undefined);

// The line that joins the icons, in a row's own box. It runs on through the gap above and below, to the next row.
const LINE = 'relative before:absolute before:left-3 before:-top-2 before:-bottom-2 before:w-px before:bg-ink-2';

// The climb or descent of a leg, its label for a screen reader.
function Delta({
  icon: Icon,
  label,
  metres,
  language,
}: {
  icon: typeof CLIMB_ICON;
  label: string;
  metres: number;
  language: Language;
}) {
  return (
    <span className="whitespace-nowrap">
      <Icon size={12} className="mr-0.5 inline align-[-1.5px]" aria-hidden />
      <span className="sr-only">{label}</span>
      {formatHeight(metres, language)}
    </span>
  );
}

/** What a stop is called: its kind, or for a waypoint the point of interest it was made from, if any. */
export function stepName(
  step: TimelineStep,
  poi: ReturnType<typeof waypointPoiAt>,
  language: Language,
): string | undefined {
  const t = routesText[language];
  if (step.kind === 'start') return t.timelineStart;
  if (step.kind === 'finish') return t.timelineFinish;
  if (step.kind === 'summit') return t.timelineSummit;
  if (step.kind === 'lowest') return t.timelineLowest;
  return poi && poiLabel(poi, language);
}

/** The icon of a stop: the pin of a waypoint, as on the map and the profile. */
export function StepIcon({
  step,
  poi,
  variant = 'list',
}: {
  step: TimelineStep;
  poi: ReturnType<typeof waypointPoiAt>;
  /** `step` is the size of the icons beside the names on the cards of the step strip. */
  variant?: 'list' | 'step';
}) {
  const size = variant === 'step' ? 14 : 16;
  if (step.kind === 'start') return <Play size={size} aria-hidden />;
  if (step.kind === 'finish') return <Flag size={size} aria-hidden />;
  if (step.kind === 'summit') return <ArrowUpToLine size={size} aria-hidden />;
  if (step.kind === 'lowest') return <ArrowDownToLine size={size} aria-hidden />;
  return <WaypointPin number={step.number!} variant={variant} poi={poi} />;
}

/**
 * What a leg says, in two parts for the views to lay out: its distance and time, and its climb and descent, if it has
 * any. A leg shorter than `visibleLeg` allows is left to the caller.
 */
export function legParts(
  leg: NonNullable<TimelineStep['leg']>,
  language: Language,
): { figures: string; deltas: ReactNode } {
  const t = routesText[language];
  // Zero metres is left out.
  const climb = leg.climb !== undefined && Math.round(leg.climb) > 0 ? leg.climb : undefined;
  const descent = leg.descent !== undefined && Math.round(leg.descent) > 0 ? leg.descent : undefined;
  return {
    figures: `${formatDistance(leg.distance, language)} · ${formatDuration(leg.duration, language)}`,
    deltas: (climb !== undefined || descent !== undefined) && (
      <>
        {climb !== undefined && <Delta icon={CLIMB_ICON} label={t.climb} metres={climb} language={language} />}
        {climb !== undefined && descent !== undefined && ' '}
        {descent !== undefined && <Delta icon={DESCENT_ICON} label={t.descent} metres={descent} language={language} />}
      </>
    ),
  };
}

/**
 * The start, the waypoints, the highest and lowest points and the finish of a route, each with the distance
 * since the start and the altitude, joined by a line that carries the distance, time, climb and descent of each leg.
 */
export function RouteTimeline({
  route,
  language,
  waypoints,
  waypointPois = NO_POIS,
}: {
  route: Route;
  language: Language;
  waypoints: Position[] | undefined;
  waypointPois?: WaypointPois | undefined;
}) {
  const t = routesText[language];
  const points = useMemo(() => waypoints ?? [], [waypoints]);
  const steps = useMemo(() => routeTimeline(route, points), [route, points]);
  if (steps.length === 0) return null;

  return (
    <section data-testid="route-timeline" aria-label={t.timeline}>
      <h3 className="mb-1 text-sm font-semibold text-ink-2">{t.timeline}</h3>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {steps.map((step) => {
          const poi = step.number ? waypointPoiAt(waypointPois, points[step.number - 1]!) : undefined;
          const name = stepName(step, poi, language);
          const leg = visibleLeg(step);
          const parts = leg && legParts(leg, language);
          return (
            <Fragment key={`${step.kind}-${step.number ?? ''}`}>
              {parts && (
                <li data-testid="route-timeline-leg" className={`${LINE} pl-5 text-sm text-ink-2 italic`}>
                  {/* Plain inline text, so that every separator is one space, as in the step rows. */}
                  {parts.figures}
                  {/* Kept together, so that the dot never ends a line. */}
                  {parts.deltas && (
                    <>
                      {' '}
                      <span className="whitespace-nowrap">
                        <span aria-hidden>·</span> {parts.deltas}
                      </span>
                    </>
                  )}
                </li>
              )}
              <li
                data-testid="route-timeline-step"
                // The line starts and ends in the middle of the icons of the first and the last row.
                className={`${LINE} flex items-center gap-2 first:before:top-1/2 last:before:bottom-1/2`}
              >
                <span
                  className="relative flex size-6 flex-none items-center justify-center bg-surface text-ink-2"
                  aria-hidden
                >
                  <StepIcon step={step} poi={poi} />
                </span>
                <span className="flex min-w-0 flex-col text-sm">
                  {name && <strong className="truncate">{name}</strong>}
                  <span className="text-ink-2">
                    {/* The start is at no distance and no time: nothing to say of it but where it is. */}
                    {step.kind !== 'start' && (
                      <>
                        km {oneDecimal(language).format(step.distance)} · {formatDuration(step.elapsed, language)}
                        {step.height !== undefined && ' · '}
                      </>
                    )}
                    {step.height !== undefined && (
                      <>
                        <Mountain size={14} className="mr-0.5 mb-0.5 inline" aria-label={t.altitude} />
                        {formatHeight(step.height, language)}
                      </>
                    )}
                  </span>
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}
