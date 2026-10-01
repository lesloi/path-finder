import { elevationProfile, type Route } from '../core/index.ts';
import { profileScale } from './profile-scale.ts';
import { routeColor } from './route-colors.ts';

const WIDTH = 100;
const HEIGHT = 30;
// Space kept above and below the line, in viewBox units, so its stroke is not cut.
const PAD = 3;

/**
 * The shape of a route's elevation in one colour, the route's own, with no axis or figure: a glance at
 * where it climbs. Renders nothing for a route without heights.
 */
export function ProfileSparkline({
  geometry,
  index,
  testId,
}: {
  geometry: Route['geometry'];
  /** The route's position in its route set, which gives its colour. */
  index: number;
  testId?: string;
}) {
  const profile = elevationProfile(geometry);
  if (!profile) return null;
  const { x, y } = profileScale(profile, { width: WIDTH, height: HEIGHT, pad: PAD });
  const points = profile.map(({ distance, height }) => `${x(distance).toFixed(1)},${y(height).toFixed(1)}`);
  const color = routeColor(index);
  return (
    <svg
      data-testid={testId}
      className="h-8 min-w-0 flex-1"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon points={`0,${HEIGHT} ${points.join(' ')} ${WIDTH},${HEIGHT}`} fill={color} fillOpacity="0.18" />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
