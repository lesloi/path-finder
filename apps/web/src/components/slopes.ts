import type { SlopeClass } from '../core/index.ts';

// Whole class names, which Tailwind finds only when written out.
/** The stroke of a uphill grade class, as the `slope-*` colours. */
export const SLOPE_STROKES: Record<SlopeClass, string> = {
  1: 'stroke-slope-1',
  2: 'stroke-slope-2',
  3: 'stroke-slope-3',
  4: 'stroke-slope-4',
};
/** The fill under the profile of a grade class. */
export const SLOPE_FILLS: Record<SlopeClass, string> = {
  1: 'fill-slope-1',
  2: 'fill-slope-2',
  3: 'fill-slope-3',
  4: 'fill-slope-4',
};
/** The dot of a grade class in the legend. */
export const SLOPE_DOTS: Record<SlopeClass, string> = {
  1: 'bg-slope-1',
  2: 'bg-slope-2',
  3: 'bg-slope-3',
  4: 'bg-slope-4',
};
/** The grade bounds of each class, as DESIGN.md gives them, the same in every language. */
export const SLOPE_LABELS: Record<SlopeClass, string> = { 1: '< 3 %', 2: '3–6 %', 3: '6–10 %', 4: '> 10 %' };
