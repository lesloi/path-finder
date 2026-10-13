import type { PoiCategory } from '../core/index.ts';
import { POI_COLORS } from './route-colors.ts';

const GLYPHS: Record<PoiCategory, string> = {
  water: 'M12 5.5C12 5.5 7.5 10.3 7.5 13.6a4.5 4.5 0 0 0 9 0C16.5 10.3 12 5.5 12 5.5Z',
  viewpoint: 'M4.5 12Q12 5 19.5 12Q12 19 4.5 12ZM12 9.8a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4Z',
};

/** The badge the map draws for a point of interest (see `poi-image.ts`), for the popover; hollow for a seasonal one. */
export function PoiBadge({ category, seasonal = false }: { category: PoiCategory; seasonal?: boolean }) {
  const colour = POI_COLORS[category];
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6 flex-none">
      <circle
        cx="12"
        cy="12"
        r="10.5"
        fill={seasonal ? '#ffffff' : colour}
        stroke={seasonal ? colour : '#ffffff'}
        strokeWidth="2"
      />
      <path d={GLYPHS[category]} fill={seasonal ? colour : '#ffffff'} fillRule="evenodd" />
    </svg>
  );
}
