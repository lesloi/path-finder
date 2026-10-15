import { ArrowDown, ArrowUp, MapPinCheck, MapPinPlus, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { WaypointPin } from '../components/waypoint-pin.tsx';
import { hint, tip } from '../components/index.ts';
import { poiLabel, waypointPoiAt, type Position, type WaypointPois } from '../core/index.ts';
import { criteriaText, type Language } from '../i18n/index.ts';

const ROW_BUTTON = 'grid size-8 flex-none place-items-center rounded-full text-ink hover:bg-surface-2';

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
  placing,
  full,
  onTogglePlacing,
  onMove,
  onRemove,
  onCenter,
  onPoint,
}: {
  language: Language;
  waypoints: Position[];
  waypointPois: WaypointPois;
  /** The user is placing waypoints on the map. */
  placing: boolean;
  /** No more waypoints can be added. */
  full: boolean;
  onTogglePlacing: () => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  /** The user asked to see a waypoint. */
  onCenter: (index: number) => void;
  /** The user points at a waypoint's row, or leaves it. */
  onPoint: (index: number | undefined) => void;
}) {
  const t = criteriaText[language];
  const list = useRef<HTMLOListElement>(null);
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
  useEffect(() => () => onPoint(undefined), []); // eslint-disable-line react-hooks/exhaustive-deps -- only on unmount
  return (
    <section className="flex flex-col gap-2" data-testid="criteria-waypoint-list">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-2">{t.waypoints}</h2>
        <button
          type="button"
          data-testid="criteria-waypoint"
          // The size of its title: the section is no taller than the others.
          className="-my-1.5 mr-1 grid size-8 place-items-center rounded-full text-ink hover:bg-surface-2 aria-pressed:bg-accent! aria-pressed:text-on-accent! disabled:text-ink-2"
          {...tip(t.addWaypoint, 'bottom-end')}
          aria-pressed={placing}
          disabled={!placing && full}
          onClick={onTogglePlacing}
        >
          {placing ? <MapPinCheck size={18} aria-hidden /> : <MapPinPlus size={18} aria-hidden />}
        </button>
      </div>
      <ol ref={list} className="-m-1 flex max-h-36 flex-col gap-1 overflow-y-auto p-1">
        {waypoints.map((waypoint, index) => {
          const number = index + 1;
          const poi = waypointPoiAt(waypointPois, waypoint);
          const name = poi ? poiLabel(poi, language) : t.waypointName(number);
          const id = `criteria-waypoint-item-${number}`;
          // Two waypoints can be at the very same position: the key counts the ones before.
          const key = `${waypoint.join(',')}#${waypoints.slice(0, index).filter((w) => w[0] === waypoint[0] && w[1] === waypoint[1]).length}`;
          return (
            <li
              // Its position names the point as it moves.
              key={key}
              data-testid={id}
              className="flex items-center gap-1 rounded-lg bg-surface-2/50 pr-1 pl-3"
              // The pin goes with the row for whoever points at it, with the mouse or with the keyboard.
              onMouseEnter={() => onPoint(index)}
              onMouseLeave={() => onPoint(undefined)}
              onFocus={() => onPoint(index)}
              onBlur={() => onPoint(undefined)}
            >
              <button
                type="button"
                data-testid={`${id}-name`}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-sm text-ink"
                onClick={() => onCenter(index)}
              >
                <span className="relative block h-[29px] w-6 flex-none" aria-hidden>
                  <WaypointPin number={number} variant="map" poi={poi} />
                </span>
                <span data-name className="truncate">
                  {name}
                </span>
              </button>
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
                    aria-label={t[label](name)}
                    // A tooltip on a button that cannot be pressed would say what it cannot do.
                    {...(possible && hint(t[hintOf], 'top-end'))}
                    disabled={!possible}
                    onClick={() => {
                      refocus.current = { index: target, direction };
                      onMove(index, target);
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
                aria-label={t.removeWaypointNamed(name)}
                {...hint(t.removeWaypoint, 'top-end')}
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
