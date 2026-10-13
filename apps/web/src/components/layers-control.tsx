import { Layers } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { POI_CATEGORIES, type PoiCategory, type PoiLayers } from '../core/index.ts';
import { criteriaText, type Language } from '../i18n/index.ts';
import { POI_COLORS } from './route-colors.ts';
import { FLOATING_BUTTON } from './styles.ts';

const LABELS = { water: 'poiWater', viewpoint: 'poiViewpoint' } as const satisfies Record<PoiCategory, string>;

// A swatch of the map's marker: filled, or hollow for a seasonal point.
function Swatch({ category, hollow = false }: { category: PoiCategory; hollow?: boolean }) {
  return (
    <span
      aria-hidden
      className="size-3.5 flex-none rounded-full border-2"
      style={{ borderColor: POI_COLORS[category], backgroundColor: hollow ? '#ffffff' : POI_COLORS[category] }}
    />
  );
}

/**
 * The button over the map that opens the popover of layers: one checkbox per category of points of interest.
 * The popover opens upward, as the button sits at the bottom of the map, and closes on Escape or a click outside.
 */
export function LayersControl({
  language,
  layers,
  onChange,
  className,
}: {
  language: Language;
  layers: PoiLayers;
  onChange: (layers: PoiLayers) => void;
  /** Where the control sits on the map. */
  className: string;
}) {
  const t = criteriaText[language];
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  return (
    <div
      ref={root}
      className={className}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        data-testid="criteria-layers"
        className={FLOATING_BUTTON}
        aria-label={t.layers}
        aria-expanded={open}
        aria-controls={`${id}-popover`}
        onClick={() => setOpen(!open)}
      >
        <Layers size={20} aria-hidden />
      </button>
      {open && (
        <div
          id={`${id}-popover`}
          role="group"
          aria-label={t.layers}
          className="absolute right-0 bottom-full mb-2 w-max max-w-[calc(100vw-2*--spacing(4))] rounded-lg border border-border bg-surface p-2 shadow-float"
        >
          {POI_CATEGORIES.map((category) => (
            <label
              key={category}
              className="flex min-h-touch cursor-pointer items-center gap-3 rounded-md px-3 text-sm font-medium text-ink hover:bg-surface-2"
            >
              <input
                type="checkbox"
                data-testid={`layers-${category}`}
                className="size-4 flex-none accent-accent"
                checked={layers[category]}
                onChange={(event) => onChange({ ...layers, [category]: event.target.checked })}
              />
              <Swatch category={category} />
              {t[LABELS[category]]}
            </label>
          ))}
          <p className="flex items-center gap-2 px-3 pt-1 pb-1 text-xs text-ink-2">
            <Swatch category="water" hollow />
            {t.poiSeasonalLegend}
          </p>
        </div>
      )}
    </div>
  );
}
