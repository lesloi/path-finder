import { useEffect } from 'react';
import { CircleCheck, CirclePlus, X } from 'lucide-react';

import { MAX_AVOIDED_AREAS, type AvoidedArea } from '../contract/index.ts';
import { CountOfMax } from '../components/count-of-max.tsx';
import { AvoidedAreaBadge } from '../components/avoided-area-badge.tsx';
import { hint, tip } from '../components/index.ts';
import { criteriaText, type Language } from '../i18n/index.ts';

// The badge and the name as one target, as in the waypoints' list.
const ROW_NAME = 'flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-sm text-ink';

/**
 * The areas routes keep out of, under the waypoints: each shows its radius, and can be removed. The radius itself is
 * set in the bubble of the area's badge on the map, where the circle stays in sight.
 */
export function AvoidedAreaList({
  language,
  areas,
  add,
  onRemove,
  onCenter,
  onPoint,
}: {
  language: Language;
  areas: AvoidedArea[];
  /** The button that draws a new area; left out where the map's own button does that job. */
  add?: {
    /** The user is placing areas on the map. */
    placing: boolean;
    /** No more areas can be added. */
    full: boolean;
    onToggle: () => void;
  };
  onRemove: (index: number) => void;
  /** The user asked to see an area; without it, a badge is no button. */
  onCenter?: (index: number) => void;
  /** The user points at an area's row, or leaves it. */
  onPoint?: (index: number | undefined) => void;
}) {
  const t = criteriaText[language];
  // The list can go away under the pointer, which then never leaves it.
  useEffect(() => () => onPoint?.(undefined), []); // eslint-disable-line react-hooks/exhaustive-deps -- only on unmount
  return (
    <section className="flex flex-col gap-2" data-testid="criteria-avoided-list">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-ink-2">{t.avoidedAreas}</h2>
          <CountOfMax
            language={language}
            count={areas.length}
            max={MAX_AVOIDED_AREAS}
            testId="criteria-avoided-count"
          />
        </div>
        {add && (
          <button
            type="button"
            data-testid="criteria-avoided"
            className="-my-1.5 mr-1 grid size-8 place-items-center rounded-full text-ink hover:bg-surface-2 aria-pressed:bg-accent! aria-pressed:text-on-accent! disabled:text-ink-2"
            {...tip(t.addAvoidedArea, 'bottom-end')}
            aria-pressed={add.placing}
            disabled={!add.placing && add.full}
            onClick={add.onToggle}
          >
            {add.placing ? <CircleCheck size={18} aria-hidden /> : <CirclePlus size={18} aria-hidden />}
          </button>
        )}
      </div>
      <ol className="-m-1 flex max-h-48 flex-col gap-1 overflow-y-auto p-1">
        {areas.map((area, index) => {
          const name = t.avoidedAreaName(index + 1);
          const id = `criteria-avoided-item-${index + 1}`;
          return (
            <li
              key={index}
              data-testid={id}
              // The circle goes with the row for whoever points at it, with the mouse or with the keyboard.
              onMouseEnter={() => onPoint?.(index)}
              onMouseLeave={() => onPoint?.(undefined)}
              onFocus={() => onPoint?.(index)}
              onBlur={() => onPoint?.(undefined)}
              className="flex items-center gap-2 rounded-lg bg-surface-2/50 py-1 pr-1 pl-3"
            >
              {onCenter ? (
                <button
                  type="button"
                  data-testid={`${id}-name`}
                  className={`${ROW_NAME} rounded-md`}
                  aria-label={name}
                  onClick={() => onCenter(index)}
                >
                  <span className="grid size-7 flex-none place-items-center" aria-hidden>
                    <AvoidedAreaBadge number={index + 1} />
                  </span>
                  <span data-name className="truncate">
                    {name}
                  </span>
                </button>
              ) : (
                <div data-testid={`${id}-name`} className={ROW_NAME}>
                  <span className="grid size-7 flex-none place-items-center" aria-hidden>
                    <AvoidedAreaBadge number={index + 1} />
                  </span>
                  <span data-name className="truncate">
                    {name}
                  </span>
                </div>
              )}
              <span data-testid={`${id}-radius`} className="w-14 flex-none text-right text-xs text-ink-2 tabular-nums">
                {t.avoidedAreaRadius(area.radius)}
              </span>
              <button
                type="button"
                data-testid={`${id}-remove`}
                className="grid size-8 flex-none place-items-center rounded-full text-ink hover:bg-surface-2"
                aria-label={t.removeAvoidedAreaNamed(name)}
                {...hint(t.removeAvoidedArea, 'left')}
                onClick={() => {
                  onPoint?.(undefined);
                  onRemove(index);
                }}
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
