import { MAP_COLORS } from './route-colors.ts';

/**
 * The number of an avoided area in a round badge, as the waypoints' pins carry theirs: the map draws it at the
 * centre of the circle, and the list in front of the area's row. `highlighted` sets it apart, as the user points at
 * its row or at the circle.
 */
export function AvoidedAreaBadge({ number, highlighted = false }: { number: number; highlighted?: boolean }) {
  return (
    <span
      className={`grid size-6 flex-none place-items-center rounded-full border-2 border-white text-xs leading-none font-bold text-white shadow-md transition-transform ${highlighted ? 'scale-125' : ''}`}
      style={{ backgroundColor: MAP_COLORS.avoided }}
      aria-hidden
    >
      {number}
    </span>
  );
}
