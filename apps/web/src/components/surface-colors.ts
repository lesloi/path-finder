import type { SurfaceStretch } from '../contract/index.ts';

// Whole class names, which Tailwind finds only when written out.
/**
 * How each surface is painted from the `paved` and `unpaved` colours: the stroke of a route's trace, the
 * fill under it, and the dot of the legend.
 */
export const SURFACE_CLASSES: Record<SurfaceStretch['surface'], { stroke: string; fill: string; dot: string }> = {
  paved: { stroke: 'stroke-paved', fill: 'fill-paved', dot: 'bg-paved' },
  unpaved: { stroke: 'stroke-unpaved', fill: 'fill-unpaved', dot: 'bg-unpaved' },
};
