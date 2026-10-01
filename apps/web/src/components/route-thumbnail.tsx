import { projectOnSnapshot, projectRoute, type MapSnapshot, type Route } from '../core/index.ts';
import { ROUTE_COLORS } from './route-colors.ts';

// Sizes in SVG user units: the drawing scales with the element that shows it.
const HEIGHT = 100;
const MARGIN = 10;
// The width of a wide thumbnail, about two and a half times its height.
const WIDE_WIDTH = 250;

/**
 * A route's shape drawn over the part of the map it runs through, cut from the snapshot the map took
 * on the device: nothing is fetched to draw it. Without a snapshot yet, the shape is on a plain
 * background. `wide` makes it as wide as its container, otherwise it is square.
 */
export function RouteThumbnail({
  geometry,
  index,
  wide = false,
  snapshot,
  testId,
}: {
  geometry: Route['geometry'];
  /** The route's position in its route set, which gives its colour. */
  index: number;
  wide?: boolean;
  /** What the map showed for the route set this route is of. */
  snapshot?: MapSnapshot;
  testId?: string;
}) {
  const box = { width: wide ? WIDE_WIDTH : HEIGHT, height: HEIGHT, margin: MARGIN };
  // A route too big for the wide box gets a narrower one, so the map shown never has a blank edge.
  const { points, image, width } = snapshot
    ? projectOnSnapshot(geometry, snapshot, box)
    : { points: projectRoute(geometry, box), image: undefined, width: box.width };
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [startX, startY] = points[0];
  return (
    <svg
      data-testid={testId}
      className={wide ? 'w-full flex-none rounded-sm' : 'size-13 flex-none rounded-sm'}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      aria-hidden
    >
      {/* The colour of the Plan IGN, under the snapshot while it is taken. */}
      <rect width={width} height={HEIGHT} fill="#f4f2ea" />
      {snapshot && image && (
        <image data-testid={testId && `${testId}-map`} href={snapshot.url} preserveAspectRatio="none" {...image} />
      )}
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
