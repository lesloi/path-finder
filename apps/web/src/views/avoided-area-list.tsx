import { CircleCheck, CirclePlus, X } from 'lucide-react';

import { AVOIDED_AREA_RADIUS, type AvoidedArea } from '../contract/index.ts';
import { hint, Slider, tip } from '../components/index.ts';
import { criteriaText, type Language } from '../i18n/index.ts';

const RADIUS_STEP = 50;

/** The areas routes keep out of, under the waypoints: each has its radius, and can be removed. */
export function AvoidedAreaList({
  language,
  areas,
  placing,
  full,
  onToggle,
  onResize,
  onRemove,
}: {
  language: Language;
  areas: AvoidedArea[];
  /** The user is placing areas on the map. */
  placing: boolean;
  /** No more areas can be added. */
  full: boolean;
  onToggle: () => void;
  onResize: (index: number, radius: number) => void;
  onRemove: (index: number) => void;
}) {
  const t = criteriaText[language];
  return (
    <section className="flex flex-col gap-2" data-testid="criteria-avoided-list">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-2">{t.avoidedAreas}</h2>
        <button
          type="button"
          data-testid="criteria-avoided"
          className="-my-1.5 mr-1 grid size-8 place-items-center rounded-full text-ink hover:bg-surface-2 aria-pressed:bg-accent! aria-pressed:text-on-accent! disabled:text-ink-2"
          {...tip(t.addAvoidedArea, 'bottom-end')}
          aria-pressed={placing}
          disabled={!placing && full}
          onClick={onToggle}
        >
          {placing ? <CircleCheck size={18} aria-hidden /> : <CirclePlus size={18} aria-hidden />}
        </button>
      </div>
      <ol className="-m-1 flex max-h-48 flex-col gap-1 overflow-y-auto p-1">
        {areas.map((area, index) => {
          const name = t.avoidedAreaName(index + 1);
          const id = `criteria-avoided-item-${index + 1}`;
          return (
            <li
              key={index}
              data-testid={id}
              className="flex items-center gap-1 rounded-lg bg-surface-2/50 py-1 pr-1 pl-3"
            >
              <div className="min-w-0 flex-1">
                <Slider
                  testId={`${id}-radius`}
                  label={t.avoidedAreaRadiusOf(name)}
                  value={area.radius}
                  shown={t.avoidedAreaRadius(area.radius)}
                  leading={<span className="text-sm text-ink">{name}</span>}
                  min={AVOIDED_AREA_RADIUS.min}
                  max={AVOIDED_AREA_RADIUS.max}
                  step={RADIUS_STEP}
                  onChange={(radius) => onResize(index, radius)}
                />
              </div>
              <button
                type="button"
                data-testid={`${id}-remove`}
                className="grid size-8 flex-none place-items-center rounded-full text-ink hover:bg-surface-2"
                aria-label={t.removeAvoidedAreaNamed(name)}
                {...hint(t.removeAvoidedArea, 'left')}
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
