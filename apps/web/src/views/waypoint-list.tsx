import { ArrowDown, ArrowUp, MapPinCheck, MapPinPlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { WaypointPin } from '../components/waypoint-pin.tsx';
import { hint, tip } from '../components/index.ts';
import { poiLabel, waypointPoiAt, type Position, type WaypointPois } from '../core/index.ts';
import { criteriaText, type Language } from '../i18n/index.ts';

const ROW_BUTTON = 'grid size-8 flex-none place-items-center rounded-full text-ink hover:bg-surface-2';

// How long a row moved stays set apart.
const MOVED_MS = 1200;

const NAME = 'flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-sm text-ink';

const MOVES = [
  { direction: 'up', Icon: ArrowUp, label: 'moveWaypointUp', hintOf: 'moveUp' },
  { direction: 'down', Icon: ArrowDown, label: 'moveWaypointDown', hintOf: 'moveDown' },
] as const;

/**
 * The waypoints in the order the routes go through them, under the criteria: each can be moved up or down, or
 * removed.
 */
export function WaypointList({
  language,
  waypoints,
  waypointPois,
  add,
  onMove,
  onRemove,
  onCenter,
  onPoint,
}: {
  language: Language;
  waypoints: Position[];
  waypointPois: WaypointPois;
  /** The button to add waypoints; left out where another one does that job. */
  add?: {
    /** The user is placing waypoints on the map. */
    placing: boolean;
    /** No more waypoints can be added. */
    full: boolean;
    onToggle: () => void;
  };
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  /** The user asked to see a waypoint; without it, a row is no button. */
  onCenter?: (index: number) => void;
  /** The user points at a waypoint's row, or leaves it. */
  onPoint?: (index: number | undefined) => void;
}) {
  const t = criteriaText[language];
  const list = useRef<HTMLOListElement>(null);
  // The names of the rows read alike, so a move leaves the list looking the same: the row just moved is set apart for a
  // moment, and said aloud.
  // The row is told by its key, not its index: a waypoint removed or another one added meanwhile must not move the
  // highlight onto a stranger. `count` makes each move a new announcement, even to the position just announced.
  const [moved, setMoved] = useState<{ key: string; position: number; count: number }>();
  useEffect(() => {
    if (!moved) return;
    const timer = setTimeout(() => setMoved((current) => (current === moved ? undefined : current)), MOVED_MS);
    return () => clearTimeout(timer);
  }, [moved]);
  // Two waypoints can be at the very same position: the key counts the ones before.
  const keyOf = (index: number) => {
    const [lon, lat] = waypoints[index]!;
    return `${lon},${lat}#${waypoints.slice(0, index).filter((w) => w[0] === lon && w[1] === lat).length}`;
  };
  const movedStands = moved !== undefined && waypoints[moved.position - 1] && keyOf(moved.position - 1) === moved.key;
  // A row that reaches an end can no longer be moved that way: the focus goes on to the arrow that still works, so
  // that someone at the keyboard is not left on a disabled button.
  const refocus = useRef<{ index: number; direction: 'up' | 'down' }>(undefined);
  useEffect(() => {
    const target = refocus.current;
    refocus.current = undefined;
    if (!target) return;
    const row = list.current?.children[target.index];
    const pressed = row?.querySelector<HTMLButtonElement>(`[data-direction="${target.direction}"]`);
    const other = row?.querySelector<HTMLButtonElement>(
      `[data-direction="${target.direction === 'up' ? 'down' : 'up'}"]`,
    );
    (pressed?.disabled ? other : pressed)?.focus();
  }, [waypoints]);
  // The list can go away under the pointer, which then never leaves it.
  useEffect(() => () => onPoint?.(undefined), []); // eslint-disable-line react-hooks/exhaustive-deps -- only on unmount
  return (
    <section className="flex flex-col gap-2" data-testid="criteria-waypoint-list">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-2">{t.waypoints}</h2>
        {add && (
          <button
            type="button"
            data-testid="criteria-waypoint"
            // The size of its title: the section is no taller than the others.
            className="-my-1.5 mr-1 grid size-8 place-items-center rounded-full text-ink hover:bg-surface-2 aria-pressed:bg-accent! aria-pressed:text-on-accent! disabled:text-ink-2"
            {...tip(t.addWaypoint, 'bottom-end')}
            aria-pressed={add.placing}
            disabled={!add.placing && add.full}
            onClick={add.onToggle}
          >
            {add.placing ? <MapPinCheck size={18} aria-hidden /> : <MapPinPlus size={18} aria-hidden />}
          </button>
        )}
      </div>
      <p className="sr-only" role="status" data-testid="criteria-waypoint-announcement">
        {movedStands && <span key={moved.count}>{t.waypointMoved(moved.position)}</span>}
      </p>
      <ol ref={list} className="-m-1 flex max-h-36 flex-col gap-1 overflow-y-auto p-1">
        {waypoints.map((waypoint, index) => {
          const number = index + 1;
          const poi = waypointPoiAt(waypointPois, waypoint);
          // The number in the pin says the order; the name has none, as it would only change under the user's eyes.
          // The buttons are named by number, so that those of the rows do not read alike.
          const poiName = poi && poiLabel(poi, language);
          const name = poiName || t.waypointLabel;
          const buttonName = poiName || t.waypointName(number);
          const id = `criteria-waypoint-item-${number}`;
          const key = keyOf(index);
          const pinAndName = (
            <>
              <span className="grid size-7 flex-none place-items-center" aria-hidden>
                <WaypointPin number={number} variant="list" poi={poi} />
              </span>
              <span data-name className="truncate">
                {name}
              </span>
            </>
          );
          return (
            <li
              // Its position names the point as it moves.
              key={key}
              data-testid={id}
              className={`flex items-center gap-1 rounded-lg pr-1 pl-3 transition-colors duration-500 ${movedStands && moved.key === key ? 'bg-accent/25' : 'bg-surface-2/50'}`}
              // The pin goes with the row for whoever points at it, with the mouse or with the keyboard.
              onMouseEnter={() => onPoint?.(index)}
              onMouseLeave={() => onPoint?.(undefined)}
              onFocus={() => onPoint?.(index)}
              onBlur={() => onPoint?.(undefined)}
            >
              {onCenter ? (
                <button
                  type="button"
                  data-testid={`${id}-name`}
                  className={`${NAME} rounded-md`}
                  onClick={() => onCenter(index)}
                >
                  {pinAndName}
                </button>
              ) : (
                <div data-testid={`${id}-name`} className={NAME}>
                  {pinAndName}
                </div>
              )}
              {MOVES.map(({ direction, Icon, label, hintOf }) => {
                const target = index + (direction === 'up' ? -1 : 1);
                const possible = target >= 0 && target < waypoints.length;
                return (
                  <button
                    key={direction}
                    data-direction={direction}
                    type="button"
                    data-testid={`${id}-${direction}`}
                    className={`${ROW_BUTTON} disabled:opacity-40`}
                    aria-label={t[label](buttonName)}
                    // A tooltip on a button that cannot be pressed would say what it cannot do.
                    {...(possible && hint(t[hintOf], 'left'))}
                    disabled={!possible}
                    onClick={() => {
                      refocus.current = { index: target, direction };
                      onMove(index, target);
                      setMoved({ key: keyOf(index), position: target + 1, count: (moved?.count ?? 0) + 1 });
                    }}
                  >
                    <Icon size={16} aria-hidden />
                  </button>
                );
              })}
              <button
                type="button"
                data-testid={`${id}-remove`}
                className={ROW_BUTTON}
                aria-label={t.removeWaypointNamed(buttonName)}
                {...hint(t.removeWaypoint, 'left')}
                onClick={() => onRemove(index)}
              >
                <X size={16} aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
