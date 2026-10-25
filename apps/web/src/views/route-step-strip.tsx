import { Mountain } from 'lucide-react';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  formatDistance,
  formatDuration,
  formatHeight,
  routeTimeline,
  waypointPoiAt,
  type Position,
  type Route,
  type WaypointPois,
} from '../core/index.ts';
import { criteriaText, routesText, type Language } from '../i18n/index.ts';
import { legParts, StepIcon, stepName, visibleLeg } from './route-timeline.tsx';

const NO_POINTS: Position[] = [];
const NO_POIS: WaypointPois = {};

// The height of the links from the profile to the cards, in px, and the space they leave above a card.
const LINKS = 24;
const LINK_GAP = 4;

/**
 * The stops of a route as a row of cards, each as wide as its content and spread across the width, with the figures
 * of the leg that ends there. Laid under the elevation profile (`linked`), each card is joined to the place of its
 * stop on it, which the strip must be as wide as the plot for: the cards are not under their stops, as these can be
 * close together. Where the cards stand is measured, for the links and for the legs.
 */
export const RouteStepStrip = memo(function RouteStepStrip({
  route,
  language,
  waypoints = NO_POINTS,
  waypointPois = NO_POIS,
  linked = true,
}: {
  route: Route;
  language: Language;
  waypoints?: Position[] | undefined;
  waypointPois?: WaypointPois | undefined;
  /** Whether a profile is over the strip, for the cards to be joined to. */
  linked?: boolean;
}) {
  const t = routesText[language];
  const steps = useMemo(() => routeTimeline(route, waypoints), [route, waypoints]);
  const list = useRef<HTMLOListElement>(null);
  const [placed, setPlaced] = useState<{ centers: number[]; halfGaps: number[]; legWidths: number[] }>();
  // The cards are as wide as their content, so where they stand is measured: the links join their centres to the
  // profile and each leg sits in the middle of the gap before its card.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => {
      const cards = [...element.children] as HTMLElement[];
      const width = element.clientWidth;
      if (width === 0) return;
      const tenth = (value: number) => Math.round(value * 10) / 10;
      const left = cards.map((card) => card.offsetLeft);
      const size = cards.map((card) => card.offsetWidth);
      const halfGaps = left.map((x, i) => (i === 0 ? 0 : (x - left[i - 1]! - size[i - 1]!) / 2));
      // Where each leg is centred: in the gap before its card.
      const middles = left.map((x, i) => x - halfGaps[i]!);
      const next = {
        centers: left.map((x, i) => tenth(((x + size[i]! / 2) / width) * 100)),
        halfGaps: halfGaps.map(tenth),
        // As wide as the room to the neighbouring legs and to the edges, less a little air.
        legWidths: middles.map((middle, i) =>
          tenth(
            Math.min(
              i >= 2 ? middle - middles[i - 1]! : Infinity,
              i < middles.length - 1 ? middles[i + 1]! - middle : 2 * (width - middle),
              2 * middle,
            ) - 4,
          ),
        ),
      };
      // Rounded and compared, so that the observer's first call, or a pixel of jitter, does not render again.
      setPlaced((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // The cards change width with the language and the names of the points of interest, the list does not.
    for (const card of element.children) observer.observe(card);
    return () => observer.disconnect();
  }, [steps]);
  if (steps.length === 0) return null;

  const total = steps.at(-1)!.distance;
  return (
    <div className="relative" style={{ paddingTop: linked ? LINKS : 0 }}>
      {/* Percentages of the width, the same as the profile's: its plot is as wide as this row. */}
      {linked && (
        <svg
          data-testid="route-step-links"
          className="absolute inset-x-0 top-0 w-full overflow-visible"
          style={{ height: LINKS }}
          viewBox={`0 0 100 ${LINKS}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {steps.map((step, i) => {
            const from = total ? (step.distance / total) * 100 : 0;
            const to = placed?.centers[i] ?? ((i + 0.5) / steps.length) * 100;
            return (
              <path
                key={i}
                d={`M${from},0V4L${to},${LINKS - LINK_GAP}`}
                fill="none"
                className="stroke-ink-2"
                strokeOpacity="0.6"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      )}
      <ol
        ref={list}
        data-testid="route-steps"
        aria-label={t.timeline}
        className="m-0 flex list-none justify-between gap-2 p-0 pb-9"
      >
        {steps.map((step, i) => {
          const poi = step.number ? waypointPoiAt(waypointPois, waypoints[step.number - 1]!) : undefined;
          const name = stepName(step, poi, language) ?? criteriaText[language].waypointName(step.number!);
          const leg = visibleLeg(step);
          const parts = leg && legParts(leg, language);
          return (
            <li
              key={`${step.kind}-${step.number ?? ''}`}
              data-testid="route-step"
              className="relative w-max max-w-full min-w-0 rounded-sm border border-border px-2 py-1 text-center text-sm text-ink-2"
            >
              <strong className="flex items-center justify-center gap-1 text-sm text-ink">
                {/* The number on the icon of a point of interest sticks out on the right: room for it before the name. */}
                <span className="mr-1 flex flex-none items-center">
                  <StepIcon step={step} poi={poi} variant="step" />
                </span>
                <span data-testid="route-step-name" className="truncate">
                  {name}
                </span>
              </strong>
              {step.kind !== 'start' && (
                <span className="block truncate">
                  {formatDistance(step.distance, language)} · {formatDuration(step.elapsed, language)}
                </span>
              )}
              {step.height !== undefined && (
                <span className="flex items-center justify-center gap-1">
                  <Mountain size={12} aria-label={t.altitude} />
                  {formatHeight(step.height, language)}
                </span>
              )}
              {parts && (
                // Centred in the gap between this card and the previous one, under both.
                <span
                  data-testid="route-step-leg"
                  className="absolute top-full mt-1 -translate-x-1/2 bg-surface px-1 text-center leading-tight italic"
                  style={{ left: -(placed?.halfGaps[i] ?? 0), maxWidth: placed?.legWidths[i] }}
                >
                  <span className="block">{parts.figures}</span>
                  {parts.deltas && <span className="block">{parts.deltas}</span>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
});
