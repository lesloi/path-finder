import { useState, type PointerEvent } from 'react';

import {
  elevationProfile,
  formatDistance,
  formatHeight,
  gradeAt,
  positionAt,
  surfaceAt,
  type Position,
  type Route,
  type Display,
} from '../core/index.ts';
import { routesText } from '../i18n/index.ts';
import { profileScale } from './profile-scale.ts';
import { SURFACE_CLASSES } from './surface-colors.ts';

const WIDTH = 300;
const HEIGHT = 60;
// Space kept above and below the profile, in viewBox units.
const PAD = 8;

/**
 * The altitude along a route, coloured by the surface it runs on. Hovering or dragging along it, or the arrow
 * keys on its slider, give the distance, altitude and grade there, and `onHover` the place on the map (undefined when the pointer leaves).
 * Renders nothing for a route without heights.
 */
export function ElevationProfile({
  route,
  display,
  onHover,
  testId,
}: {
  route: Route;
  display: Display;
  onHover: (position: Position | undefined) => void;
  testId?: string;
}) {
  const t = routesText[display.language];
  const [at, setAt] = useState<number>();
  const profile = elevationProfile(route.geometry);
  if (!profile) return null;

  const { total, min, max, x, y } = profileScale(profile, { width: WIDTH, height: HEIGHT, pad: PAD });
  const middle = (min + max) / 2;

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
  // The keyboard moves along the profile one point at a time, as a pointer does.
  function step(index: number) {
    const fraction = index / (profile!.length - 1);
    setAt(fraction);
    onHover(positionAt(route.geometry, fraction * total));
  }

  const hovered = at === undefined ? undefined : profile[Math.round(at * (profile.length - 1))];
  const grade =
    at === undefined
      ? ''
      : `${new Intl.NumberFormat(display.language, { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(gradeAt(profile, at))} %`;
  return (
    <figure
      data-testid={testId}
      className="m-0"
      aria-label={t.profile(formatHeight(min, display), formatHeight(max, display))}
    >
      <figcaption data-testid={testId && `${testId}-title`} className="mb-1 text-sm font-semibold text-ink-2">
        {t.altitude}
      </figcaption>
      <div className="flex gap-2">
        {/* The altitudes of the top, the middle and the bottom of the plot, beside it and not over the trace. */}
        <div className="relative h-24 flex-none text-right text-sm text-ink-2" aria-hidden>
          {/* As wide as the widest altitude, which the others are placed in. */}
          <span className="invisible block h-0 overflow-hidden whitespace-nowrap">{formatHeight(max, display)}</span>
          {[
            { name: 'max', height: max },
            { name: 'mid', height: middle },
            { name: 'min', height: min },
          ].map(({ name, height }) => (
            <span
              key={name}
              data-testid={testId && `${testId}-${name}`}
              className="absolute right-0 -translate-y-1/2 leading-none"
              style={{ top: `${(y(height) / HEIGHT) * 100}%` }}
            >
              {formatHeight(height, display)}
            </span>
          ))}
        </div>
        <div
          data-testid={testId && `${testId}-plot`}
          className="relative h-24 min-w-0 flex-1 touch-none select-none"
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
            {/* The highest and the middle altitude, across the whole plot. */}
            {[max, middle].map((height) => (
              <line
                key={height}
                x1="0"
                x2={WIDTH}
                y1={y(height)}
                y2={y(height)}
                className="stroke-border"
                strokeWidth="1"
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {profile.slice(0, -1).map((from, k) => {
              const to = profile[k + 1];
              const surface = surfaceAt(
                route.surfaces,
                total ? ((from.distance + to.distance) / 2 / total) * route.distance : 0,
              );
              const [x0, x1] = [x(from.distance), x(to.distance)];
              return (
                <g key={k} data-surface={surface}>
                  <polygon
                    points={`${x0},${HEIGHT} ${x0},${y(from.height)} ${x1},${y(to.height)} ${x1},${HEIGHT}`}
                    className={`${SURFACE_CLASSES[surface].fill} opacity-30`}
                  />
                  <line
                    x1={x0}
                    y1={y(from.height)}
                    x2={x1}
                    y2={y(to.height)}
                    className={SURFACE_CLASSES[surface].stroke}
                    strokeWidth="2.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </svg>
          {/* The keyboard's way along the profile: a native slider, hidden, whose ring shows on the plot. */}
          <input
            type="range"
            data-testid={testId && `${testId}-cursor`}
            className="peer sr-only"
            aria-label={t.profileCursor}
            aria-valuetext={
              hovered
                ? `${formatDistance(hovered.distance, display)}, ${formatHeight(hovered.height, display)}, ${t.slope} ${grade}`
                : undefined
            }
            min={0}
            max={profile.length - 1}
            step={1}
            value={at === undefined ? 0 : Math.round(at * (profile.length - 1))}
            onFocus={(event) => step(Number(event.target.value))}
            onChange={(event) => step(Number(event.target.value))}
            onBlur={leave}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
          />
          {at !== undefined && hovered && (
            <>
              <span className="absolute inset-y-0 w-px bg-ink" style={{ left: `${at * 100}%` }} />
              <span
                data-testid={testId && `${testId}-tip`}
                className="absolute top-0 -translate-x-1/2 rounded-sm bg-surface px-2 text-center text-sm whitespace-nowrap shadow-float"
                style={{ left: `${Math.min(80, Math.max(20, at * 100))}%` }}
              >
                {formatDistance(hovered.distance, display)} · {formatHeight(hovered.height, display)}
                <br />
                <span data-testid={testId && `${testId}-grade`}>
                  {t.slope} {grade}
                </span>
              </span>
            </>
          )}
        </div>
      </div>
    </figure>
  );
}
