import { AVOIDED_AREA_RADIUS, type AvoidedArea } from '../contract/index.ts';
import type { Position } from './coordinates.ts';

const METRES_PER_DEGREE = 111_194.9;

/** The radius of a new area, in metres. */
export const DEFAULT_AVOIDED_RADIUS = Math.min(AVOIDED_AREA_RADIUS.max, Math.max(AVOIDED_AREA_RADIUS.min, 400));

/** The ring of a polygon that draws the area, closed on its first point. */
export function circlePolygon({ center, radius }: AvoidedArea, steps = 64): Position[] {
  const [lon, lat] = center;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return Array.from({ length: steps + 1 }, (_, i): Position => {
    const angle = ((i % steps) / steps) * 2 * Math.PI;
    return [
      lon + (radius * Math.cos(angle)) / (METRES_PER_DEGREE * cosLat),
      lat + (radius * Math.sin(angle)) / METRES_PER_DEGREE,
    ];
  });
}
