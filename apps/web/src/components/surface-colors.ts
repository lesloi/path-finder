import type { SurfaceStretch } from '../../../api/src/contract.ts';

// Whole class names, which Tailwind finds only when written out.
/** The stroke of a route's trace on a surface, as the `paved` and `unpaved` colours. */
export const SURFACE_STROKES: Record<SurfaceStretch['surface'], string> = {
  paved: 'stroke-paved',
  unpaved: 'stroke-unpaved',
};
/** The fill under a route's trace on a surface. */
export const SURFACE_FILLS: Record<SurfaceStretch['surface'], string> = {
  paved: 'fill-paved',
  unpaved: 'fill-unpaved',
};
/** The dot of a surface in a legend. */
export const SURFACE_DOTS: Record<SurfaceStretch['surface'], string> = {
  paved: 'bg-paved',
  unpaved: 'bg-unpaved',
};
