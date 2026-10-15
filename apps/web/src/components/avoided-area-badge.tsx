import { MAP_COLORS } from './route-colors.ts';

/**
 * The number of an avoided area in a round badge, as the waypoints' pins carry theirs: the map draws it at the
 * centre of the circle, and the list in front of the area's row.
 */
export function AvoidedAreaBadge({ number }: { number: number }) {
  return (
    <span
      className="grid size-6 flex-none place-items-center rounded-full border-2 border-white text-xs leading-none font-bold text-white shadow-md"
      style={{ backgroundColor: MAP_COLORS.avoided }}
      aria-hidden
    >
      {number}
    </span>
  );
}
