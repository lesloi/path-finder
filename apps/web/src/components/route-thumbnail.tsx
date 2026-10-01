import { planImageUrl, projectRoute, type Route } from '../core/index.ts';
import { ROUTE_COLORS } from './route-colors.ts';

const HEIGHT = 100;
const MARGIN = 10;

// Image pixels per viewBox unit: sharp on a high-density screen.
const IMAGE_SCALE = 1.6;

/**
 * A route's shape drawn over the Plan IGN of the place it runs through, from the IGN Géoplateforme,
 * the map's own provider: it sees nothing the map does not show it already. `wide` makes it as wide
 * as its container, otherwise it is square.
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
  const { points, bounds } = projectRoute(geometry, { width, height: HEIGHT, margin: MARGIN });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [startX, startY] = points[0];
  return (
    <svg
      data-testid={testId}
      className={wide ? 'w-full flex-none rounded-sm' : 'size-13 flex-none rounded-sm'}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      aria-hidden
    >
      {/* The colour of the Plan IGN under its image, while it loads or if it cannot. */}
      <rect width={width} height={HEIGHT} fill="#f4f2ea" />
      <image
        data-testid={testId && `${testId}-map`}
        href={planImageUrl(bounds, Math.round(width * IMAGE_SCALE), Math.round(HEIGHT * IMAGE_SCALE))}
        width={width}
        height={HEIGHT}
        preserveAspectRatio="none"
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
