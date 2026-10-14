import { MAP_INK } from './route-colors.ts';

// The pin of the waypoint button's icon, cropped to the pin so that its tip is at the bottom of the box.
const PIN_VIEW_BOX = '3 1 18 22';
const PIN_PATH = 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0';

// Each class is written whole for Tailwind. The map's pin carries its own shadow; the profile's sits where its parent puts it.
const VARIANTS = {
  map: { box: 'relative block h-[29px] w-6 drop-shadow-md', number: 'top-[6px] text-xs' },
  profile: { box: 'absolute top-0 left-0 h-[22px] w-[18px]', number: 'top-[3px] text-[11px]' },
};

/**
 * The pin of a waypoint, white with a dark outline and its number in the head, which the map and the elevation profile
 * both draw. The ink is dark in both themes, as the fill is white.
 */
export function WaypointPin({ number, variant }: { number: number; variant: keyof typeof VARIANTS }) {
  const classes = VARIANTS[variant];
  return (
    <span className={classes.box}>
      <svg viewBox={PIN_VIEW_BOX} className="size-full fill-white" stroke={MAP_INK} strokeWidth="2" aria-hidden>
        <path d={PIN_PATH} />
      </svg>
      <span
        className={`absolute inset-x-0 text-center leading-none font-bold ${classes.number}`}
        style={{ color: MAP_INK }}
      >
        {number}
      </span>
    </span>
  );
}
