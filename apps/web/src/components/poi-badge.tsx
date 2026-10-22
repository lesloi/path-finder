import type { PoiCategory } from '../core/index.ts';
import { POI_COLORS } from './route-colors.ts';

const GLYPHS: Record<PoiCategory, string> = {
  water: 'M12 5.5C12 5.5 7.5 10.3 7.5 13.6a4.5 4.5 0 0 0 9 0C16.5 10.3 12 5.5 12 5.5Z',
  viewpoint:
    'M4.5 10a2 2 0 0 1 2-2h1.8l1-1.6h5.4l1 1.6h1.8a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2ZM12 10.6a2.9 2.9 0 1 0 0 5.8a2.9 2.9 0 1 0 0-5.8Z',
  toilets:
    'M8.5 6a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2ZM6.3 10.4h4.4v7.1H6.3ZM15.5 6a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2ZM13.3 10.4h4.4v7.1h-4.4Z',
  shelter: 'M12 5.8 4.2 12.6h2.1v5.6h11.4v-5.6h2.1ZM10.4 18.2v-3.6h3.2v3.6Z',
};

/** The badge the map draws for a point of interest (see `poi-image.ts`), for the popover; hollow for a seasonal one. */
export function PoiBadge({
  category,
  seasonal = false,
  className = 'size-6 flex-none',
}: {
  category: PoiCategory;
  seasonal?: boolean;
  className?: string;
}) {
  const colour = POI_COLORS[category];
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <circle
        cx="12"
        cy="12"
        r="10.5"
        fill={seasonal ? '#ffffff' : colour}
        stroke={seasonal ? colour : '#ffffff'}
        strokeWidth="2"
      />
      <path
        transform={category === 'viewpoint' ? 'translate(12 12) scale(0.8) translate(-12 -12)' : undefined}
        d={GLYPHS[category]}
        fill={seasonal ? colour : '#ffffff'}
        fillRule="evenodd"
      />
    </svg>
  );
}
