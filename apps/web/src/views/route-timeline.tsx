import { ArrowDownToLine, ArrowUpToLine, Flag, Mountain, Play } from 'lucide-react';
import { Fragment, useMemo } from 'react';

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
    <span className="flex items-center">
      <Icon size={12} aria-hidden />
      <span className="sr-only">{label}</span>
      {formatHeight(metres, language)}
    </span>
  );
}

/**
 * The start, the waypoints, the highest and lowest points and the finish of a route, each with the distance
 * since the start and the altitude, joined by a line that carries the distance, time, climb and descent of each leg.
 */
export function RouteTimeline({
  route,
  language,
  pace,
  waypoints,
  waypointPois = NO_POIS,
}: {
  route: Route;
  language: Language;
  /** Minutes per km, the pace of the route's duration. */
  pace: number;
  waypoints: Position[] | undefined;
  waypointPois?: WaypointPois | undefined;
}) {
  const t = routesText[language];
  const points = useMemo(() => waypoints ?? [], [waypoints]);
  const steps = useMemo(() => routeTimeline(route, points, pace), [route, points, pace]);
  if (steps.length === 0) return null;

  function nameOf(step: TimelineStep, poi: ReturnType<typeof waypointPoiAt>) {
    if (step.kind === 'start') return t.timelineStart;
    if (step.kind === 'finish') return t.timelineFinish;
    if (step.kind === 'summit') return t.timelineSummit;
    if (step.kind === 'lowest') return t.timelineLowest;
    return poi && poiLabel(poi, language);
  }
  return (
    <section data-testid="route-timeline" aria-label={t.timeline}>
      <h3 className="mb-1 text-sm font-semibold text-ink-2">{t.timeline}</h3>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {steps.map((step) => {
          const poi = step.number ? waypointPoiAt(waypointPois, points[step.number - 1]!) : undefined;
          const name = nameOf(step, poi);
          const { leg } = step;
          // Zero metres is left out, and the dot after the duration only goes with what follows it.
          const climb = leg?.climb !== undefined && Math.round(leg.climb) > 0 ? leg.climb : undefined;
          const descent = leg?.descent !== undefined && Math.round(leg.descent) > 0 ? leg.descent : undefined;
          return (
            <Fragment key={`${step.kind}-${step.number ?? ''}`}>
              {leg && leg.distance >= MIN_LEG_KM && (
                <li data-testid="route-timeline-leg" className={`${LINE} flex gap-2 pl-5 text-xs text-ink-2 italic`}>
                  <span>
                    {formatDistance(leg.distance, language)} · {formatDuration(leg.duration, language)}
                  </span>
                  {(climb !== undefined || descent !== undefined) && <span aria-hidden>·</span>}
                  {climb !== undefined && (
                    <Delta icon={CLIMB_ICON} label={t.climb} metres={climb} language={language} />
                  )}
                  {descent !== undefined && (
                    <Delta icon={DESCENT_ICON} label={t.descent} metres={descent} language={language} />
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
                  {step.kind === 'start' && <Play size={16} />}
                  {step.kind === 'finish' && <Flag size={16} />}
                  {step.kind === 'summit' && <ArrowUpToLine size={16} />}
                  {step.kind === 'lowest' && <ArrowDownToLine size={16} />}
                  {step.kind === 'waypoint' && <WaypointPin number={step.number!} variant="list" poi={poi} />}
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
