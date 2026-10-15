import type { WaypointPoi } from '../core/index.ts';
import { PoiBadge } from './poi-badge.tsx';
import { MAP_INK } from './route-colors.ts';
import { hint } from './styles.ts';

// The pin of the waypoint button's icon, cropped to the pin so that its tip is at the bottom of the box.
const PIN_VIEW_BOX = '3 1 18 22';
const PIN_PATH = 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0';

// Each class is written whole for Tailwind. The map's pin carries its own shadow; the profile's sits where its parent puts it.
const PLACED_POI = { poi: 'absolute top-0 left-0 h-[22px] w-[18px]', badge: 'absolute top-0 left-0 size-[18px]' };
const VARIANTS = {
  map: { box: 'relative block h-[29px] w-6 drop-shadow-md', number: 'top-[6px] text-xs', ...PLACED_POI },
  profile: { box: 'absolute top-0 left-0 h-[22px] w-[18px]', number: 'top-[3px] text-[11px]', ...PLACED_POI },
  // In a row of the list, which centres it: in the flow, not placed.
  list: {
    box: 'relative block h-6 w-5',
    number: 'top-[5px] text-[11px]',
    poi: 'relative block size-6',
    badge: 'absolute top-0 left-0 size-6',
  },
};

/**
 * The pin of a waypoint, white with a dark outline and its number in the head, which the map and the elevation profile
 * both draw. The ink is dark in both themes, as the fill is white.
 */
export function WaypointPin({
  number,
  variant,
  poi,
  poiLabel,
  tipSide = 'top-start',
  highlighted = false,
}: {
  number: number;
  variant: keyof typeof VARIANTS;
  /** The point of interest the waypoint was made from: its icon takes the place of the pin, the number in a corner. */
  poi?: WaypointPoi | undefined;
  /** What the point of interest is called: the tooltip over its icon. */
  poiLabel?: string;
  /** Where the tooltip opens: toward the middle of the profile, which the screen does not cut. */
  tipSide?: Parameters<typeof hint>[1];
  /** The pin is set apart, larger and in the accent colour, as the user points at its row in the list. */
  highlighted?: boolean;
}) {
  const classes = VARIANTS[variant];
  if (poi) {
    return (
      <span
        className={`pointer-events-auto ${classes.poi}`}
        {...(poiLabel && hint(poiLabel, tipSide))}
      >
        <PoiBadge category={poi.category} seasonal={poi.seasonal} className={classes.badge} />
        <span
          className="absolute right-[-4px] bottom-0 min-w-[11px] rounded-full bg-white text-center text-[9px] leading-[11px] font-bold"
          style={{ color: MAP_INK }}
        >
          {number}
        </span>
      </span>
    );
  }
  return (
    <span
      className={`${classes.box} origin-bottom transition-transform ${highlighted ? 'scale-125' : ''}`}
      {...(highlighted && { 'data-highlighted': '' })}
    >
      <svg
        viewBox={PIN_VIEW_BOX}
        className={`size-full ${highlighted ? 'fill-accent' : 'fill-white'}`}
        stroke={MAP_INK}
        strokeWidth="2"
        aria-hidden
      >
        <path d={PIN_PATH} />
      </svg>
      <span
        className={`absolute inset-x-0 text-center leading-none font-bold ${classes.number}`}
        style={{ color: highlighted ? 'var(--color-on-accent)' : MAP_INK }}
      >
        {number}
      </span>
    </span>
  );
}
