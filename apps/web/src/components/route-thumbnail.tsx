import { projectRoute, type Route } from '../core/index.ts';
import { ROUTE_COLORS } from './route-colors.ts';

const HEIGHT = 100;
const MARGIN = 10;

/**
 * A drawing of a route's shape on a map-like background, with no map tiles: nothing about the
 * route is sent to draw it. `wide` makes it as wide as its container, otherwise it is square.
 */
export function RouteThumbnail({
  geometry,
  index,
  wide = false,
  testId,
}: {
  geometry: Route['geometry'];
  /** The route's position in its route set, which gives its colour. */
  index: number;
  wide?: boolean;
  testId?: string;
}) {
  const width = wide ? 250 : HEIGHT;
  const points = projectRoute(geometry, { width, height: HEIGHT, margin: MARGIN });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [startX, startY] = points[0];
  // The colours of the map, which stays light: the same in dark mode.
  return (
    <svg
      data-testid={testId}
      className={wide ? 'w-full flex-none rounded-sm' : 'size-13 flex-none rounded-sm'}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      aria-hidden
    >
      <rect width={width} height={HEIGHT} fill="#f2efe6" />
      <path
        d={`M0 30 Q${width * 0.4} 45 ${width} 20 M${width * 0.2} 100 Q${width * 0.35} 50 ${width * 0.7} 0 M0 80 Q${width / 2} 70 ${width} 85`}
        stroke="#ffffff"
        strokeWidth="4"
        fill="none"
      />
      <path
        d={`M0 62 Q${width * 0.3} 55 ${width * 0.55} 70 T${width} 60`}
        stroke="#b9d7ee"
        strokeWidth="6"
        fill="none"
      />
      <polyline points={line} fill="none" stroke="#ffffff" strokeWidth="6" strokeLinejoin="round" />
      <polyline
        points={line}
        fill="none"
        stroke={ROUTE_COLORS[index % ROUTE_COLORS.length]}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <circle cx={startX} cy={startY} r="5" fill="#ffffff" stroke="#6b4f33" strokeWidth="3" />
    </svg>
  );
}
