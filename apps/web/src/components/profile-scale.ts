import type { ProfilePoint } from '../core/index.ts';

/**
 * How an elevation profile maps onto a drawing `width` by `height` units, with `pad` kept above and
 * below: the lowest and highest heights, and where a distance and a height fall. A flat profile sits in
 * the middle rather than on an edge.
 */
export function profileScale(
  profile: ProfilePoint[],
  { width, height, pad }: { width: number; height: number; pad: number },
) {
  const total = profile.at(-1)!.distance;
  const heights = profile.map((point) => point.height);
  const [min, max] = [Math.min(...heights), Math.max(...heights)];
  return {
    total,
    min,
    max,
    x: (distance: number) => (total ? (distance / total) * width : 0),
    y: (value: number) =>
      max === min ? height / 2 : height - pad - ((value - min) / (max - min)) * (height - 2 * pad),
  };
}
