import { projectRelief, type Route } from '../core/index.ts';
import { ROUTE_COLORS } from './route-colors.ts';

// Sizes in SVG user units: the drawing scales with the element that shows it.
const BOX = { width: 340, height: 150, margin: 12 };

/**
 * A route in perspective: its path rising and falling over its own shadow on the ground, joined
 * by a curtain that makes the climbs read. Drawn from the route's heights, so nothing is fetched;
 * without heights it shows nothing.
 */
export function RouteSketch({
  geometry,
  index,
  testId,
}: {
  geometry: Route['geometry'];
  index: number;
  testId?: string;
}) {
  const relief = projectRelief(geometry, BOX);
  if (!relief) return null;
  const color = ROUTE_COLORS[index % ROUTE_COLORS.length];
  const format = (points: [number, number][]) => points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [startX, startY] = relief.path[0];
  return (
    <svg
      data-testid={testId}
      className="w-full rounded-sm bg-surface-2"
      viewBox={`0 0 ${BOX.width} ${BOX.height}`}
      aria-hidden
    >
      {/* The curtain: the path joined to the ground below it. */}
      <polygon points={format([...relief.path, ...[...relief.ground].reverse()])} fill={color} fillOpacity={0.12} />
      <polyline points={format(relief.ground)} fill="none" stroke="#8d8f8a" strokeWidth={1} strokeDasharray="3 3" />
      <polyline points={format(relief.path)} fill="none" stroke="#ffffff" strokeWidth={4.5} strokeLinejoin="round" />
      <polyline points={format(relief.path)} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
      <circle cx={startX} cy={startY} r={3} fill="#ffffff" stroke="#6b4f33" strokeWidth={2} />
    </svg>
  );
}
