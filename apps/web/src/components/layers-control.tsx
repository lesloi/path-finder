import { Layers } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { POI_LAYER_KEYS, type PoiLayers } from '../core/index.ts';
import { criteriaText, type Language } from '../i18n/index.ts';
import { PoiBadge } from './poi-badge.tsx';
import { FLOATING_BUTTON, tip } from './styles.ts';

const LABELS = { water: 'poiWater', viewpoint: 'poiViewpoint', seasonal: 'poiSeasonal' } as const;

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
        {...tip(t.layers, 'stack')}
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
          {POI_LAYER_KEYS.map((key) => {
            const seasonal = key === 'seasonal';
            // Seasonal points are water points: with the water off, there is none to hide.
            const disabled = seasonal && !layers.water;
            return (
              <label
                key={key}
                className={
                  'flex min-h-touch items-center gap-3 rounded-md px-3 text-sm font-medium text-ink ' +
                  (disabled ? 'opacity-50' : 'cursor-pointer hover:bg-surface-2')
                }
              >
                <input
                  type="checkbox"
                  data-testid={`layers-${key}`}
                  className="size-4 flex-none accent-accent"
                  checked={layers[key]}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...layers, [key]: event.target.checked })}
                />
                <PoiBadge category={seasonal ? 'water' : key} seasonal={seasonal} />
                {t[LABELS[key]]}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
