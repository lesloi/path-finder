import { projectRoute, type Route } from '../core/index.ts';
import { ROUTE_COLORS } from './route-colors.ts';

const HEIGHT = 100;

// Streets of a made-up town, so the thumbnail reads as a map without showing the real one.
const STREETS = (width: number) =>
  [0.15, 0.35, 0.55, 0.75, 0.9].map((x) => `M${width * x} 0 L${width * (x + 0.06)} 100`).join(' ') +
  ' M0 12 L' +
  width +
  ' 8 M0 48 L' +
  width +
  ' 54 M0 82 L' +
  width +
  ' 78';
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
      <rect width={width} height={HEIGHT} fill="#f4f2ea" />
      {/* Green areas and water, as the Plan IGN draws them. */}
      <rect x={width * 0.08} y="12" width={width * 0.28} height="26" rx="6" fill="#dfe9d2" />
      <rect x={width * 0.62} y="58" width={width * 0.3} height="30" rx="8" fill="#dfe9d2" />
      <path
        d={`M0 66 Q${width * 0.3} 52 ${width * 0.55} 70 T${width} 58`}
        stroke="#bcd8ec"
        strokeWidth="7"
        fill="none"
      />
      {/* A grid of streets: light grey with a white core. */}
      <path d={STREETS(width)} stroke="#d6d3c8" strokeWidth="3.5" fill="none" />
      <path d={STREETS(width)} stroke="#ffffff" strokeWidth="2" fill="none" />
      {/* A main road, in the map's orange. */}
      <path d={`M0 28 Q${width * 0.4} 42 ${width} 18`} stroke="#d99a4c" strokeWidth="5" fill="none" />
      <path d={`M0 28 Q${width * 0.4} 42 ${width} 18`} stroke="#f6c97d" strokeWidth="3" fill="none" />
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
