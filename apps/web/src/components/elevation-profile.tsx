import { useState, type PointerEvent } from 'react';

import {
  elevationProfile,
  formatDistance,
  formatHeight,
  positionAt,
  slopeClass,
  type Position,
  type Route,
  type SlopeClass,
  type Units,
} from '../core/index.ts';
import { routesText, type Language } from '../i18n/index.ts';

const WIDTH = 300;
const HEIGHT = 60;
// Space kept above and below the profile, in viewBox units.
const PAD = 8;

// Whole class names, which Tailwind finds only when written out.
const SLOPE_STROKES: Record<SlopeClass, string> = {
  1: 'stroke-slope-1',
  2: 'stroke-slope-2',
  3: 'stroke-slope-3',
  4: 'stroke-slope-4',
};
const SLOPE_FILLS: Record<SlopeClass, string> = {
  1: 'fill-slope-1',
  2: 'fill-slope-2',
  3: 'fill-slope-3',
  4: 'fill-slope-4',
};
/** The grade bounds of each class, as DESIGN.md gives them. */
export const SLOPE_LABELS: Record<SlopeClass, string> = { 1: '< 3 %', 2: '3–6 %', 3: '6–10 %', 4: '> 10 %' };
export const SLOPE_DOTS: Record<SlopeClass, string> = {
  1: 'bg-slope-1',
  2: 'bg-slope-2',
  3: 'bg-slope-3',
  4: 'bg-slope-4',
};

/**
 * The altitude along a route, coloured by uphill grade. Hovering or dragging along it gives the
 * distance and altitude there, and `onHover` the place on the map (undefined when the pointer leaves).
 * Renders nothing for a route without heights.
 */
export function ElevationProfile({
  route,
  units,
  language,
  onHover,
  testId,
}: {
  route: Route;
  units: Units;
  language: Language;
  onHover: (position: Position | undefined) => void;
  testId?: string;
}) {
  const t = routesText[language];
  const [at, setAt] = useState<number>();
  const profile = elevationProfile(route.geometry);
  if (!profile) return null;

  const total = profile.at(-1)!.distance;
  const heights = profile.map(({ height }) => height);
  const [min, max] = [Math.min(...heights), Math.max(...heights)];
  const x = (distance: number) => (total ? (distance / total) * WIDTH : 0);
  const y = (height: number) => HEIGHT - PAD - ((height - min) / (max - min || 1)) * (HEIGHT - 2 * PAD);

  function move(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / (box.width || 1)));
    setAt(fraction);
    onHover(positionAt(route.geometry, fraction * total));
  }
  function leave() {
    setAt(undefined);
    onHover(undefined);
  }

  const hovered = at === undefined ? undefined : profile[Math.round(at * (profile.length - 1))];
  return (
    <figure
      data-testid={testId}
      className="m-0"
      aria-label={t.profile(formatHeight(min, units, language), formatHeight(max, units, language))}
    >
      <div
        data-testid={testId && `${testId}-plot`}
        className="relative h-24 touch-none select-none"
        onPointerDown={(event) => {
          // A drag along the profile is not a swipe to another route.
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          move(event);
        }}
        onPointerMove={move}
        onPointerUp={leave}
        onPointerCancel={leave}
        onPointerLeave={leave}
      >
        <svg className="size-full" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden>
          {profile.slice(0, -1).map((from, k) => {
            const to = profile[k + 1];
            const grade = ((to.height - from.height) / ((to.distance - from.distance) * 1000)) * 100;
            const slope = slopeClass(grade);
            const [x0, x1] = [x(from.distance), x(to.distance)];
            return (
              <g key={k} data-slope={slope}>
                <polygon
                  points={`${x0},${HEIGHT} ${x0},${y(from.height)} ${x1},${y(to.height)} ${x1},${HEIGHT}`}
                  className={`${SLOPE_FILLS[slope]} opacity-30`}
                />
                <line
                  x1={x0}
                  y1={y(from.height)}
                  x2={x1}
                  y2={y(to.height)}
                  className={SLOPE_STROKES[slope]}
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>
        <span data-testid={testId && `${testId}-max`} className="absolute top-0 left-0 text-sm text-ink-2">
          {formatHeight(max, units, language)}
        </span>
        <span data-testid={testId && `${testId}-min`} className="absolute bottom-0 left-0 text-sm text-ink-2">
          {formatHeight(min, units, language)}
        </span>
        {at !== undefined && hovered && (
          <>
            <span className="absolute inset-y-0 w-px bg-ink" style={{ left: `${at * 100}%` }} />
            <span
              data-testid={testId && `${testId}-tip`}
              className="absolute top-0 -translate-x-1/2 rounded-sm bg-surface px-2 text-sm whitespace-nowrap shadow-float"
              style={{ left: `${Math.min(80, Math.max(20, at * 100))}%` }}
            >
              {formatDistance(hovered.distance, units, language)} · {formatHeight(hovered.height, units, language)}
            </span>
          </>
        )}
      </div>
    </figure>
  );
}
