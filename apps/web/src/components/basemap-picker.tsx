import { Check, Layers } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { Basemap } from '../core/index.ts';
import { FLOATING_BUTTON } from './styles.ts';

/**
 * A floating button over the map that opens a short menu of backgrounds. A click anywhere else, Escape, or
 * Tab closes it; picking one closes it too, and the arrow keys move between the backgrounds.
 */
export function BasemapPicker({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** Where the button floats: the screen decides, as it does for the other buttons over the map. */
  className: string;
  /** Names the button. */
  label: string;
  value: Basemap;
  options: { value: Basemap; label: string }[];
  onChange: (value: Basemap) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Keyboard users land on the current background when the menu opens.
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  return (
    <div
      ref={root}
      className={`fixed z-5 ${className}`}
      onKeyDown={(event) => {
        if (!open) return;
        // Tab leaves from the button, so the focus moves on to what follows the picker.
        if (event.key === 'Escape' || event.key === 'Tab') return close();
        // Arrows, Home, and End move between the backgrounds, as in a menu.
        const items = [...root.current!.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
        const index = items.indexOf(document.activeElement as HTMLElement);
        const targets: Record<string, number> = {
          ArrowDown: index + 1,
          ArrowUp: index - 1,
          Home: 0,
          End: items.length - 1,
        };
        const target = targets[event.key];
        if (target === undefined) return;
        event.preventDefault();
        items[Math.min(Math.max(target, 0), items.length - 1)].focus();
      }}
    >
      <button
        ref={button}
        type="button"
        data-testid="criteria-basemap"
        className={FLOATING_BUTTON}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Layers size={20} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          data-testid="criteria-basemap-menu"
          className="absolute right-0 bottom-[calc(100%+--spacing(2))] w-max rounded-md bg-surface p-1 shadow-float"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              data-testid={`criteria-basemap-${option.value}`}
              aria-checked={option.value === value}
              className={
                'flex min-h-touch w-full items-center justify-between gap-3 rounded-sm px-3 text-left whitespace-nowrap ' +
                'hover:bg-surface-2 ' +
                'aria-checked:bg-accent-soft aria-checked:font-semibold aria-checked:text-accent'
              }
              onClick={() => {
                onChange(option.value);
                close();
              }}
            >
              {option.label}
              {/* Room kept on every row, so the menu does not change width with the choice. */}
              <Check size={16} aria-hidden className={option.value === value ? '' : 'invisible'} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
