import type { ReactNode } from 'react';

import { commonText, type Language } from '../i18n/index.ts';
import { ICON_BUTTON } from './styles.ts';

const STEP_BUTTON = `${ICON_BUTTON} desktop:pointer-fine:hidden text-xl font-bold disabled:opacity-30`;

/**
 * A native range input between a minus and a plus button, because a finger cannot be precise on a range input; a wide
 * screen with a mouse hides them. Its value is in large type above it, with an optional `aside` on the same line.
 */
export function Slider({
  label,
  language,
  value,
  shown,
  leading,
  aside,
  align = 'start',
  compact = false,
  min,
  max,
  step,
  onChange,
  testId,
}: {
  label: string;
  language: Language;
  value: number;
  /** The value as text, with its unit. */
  shown: string;
  /** Before the value, on the same line. */
  leading?: ReactNode;
  aside?: ReactNode;
  /** Where the value sits: over the middle of the range, as where the range is the only thing to read. */
  align?: 'start' | 'center';
  /** A value in smaller type, as in a bubble over the map where room is short. */
  compact?: boolean;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Prefix of the test ids: the range input, then `-value` for the value shown above it, `-minus` and `-plus` for
   * the buttons. */
  testId?: string;
}) {
  const t = commonText[language];
  // Rounded to the step's decimals, so that 0.1 + 0.2 does not become 0.30000000000000004.
  const decimals = (String(step).split('.')[1] ?? '').length;
  // Snapped to the grid the thumb sits on, so that a value off it joins the grid instead of staying off by a step.
  const move = (direction: 1 | -1) => {
    const snapped = min + Math.round((value + direction * step - min) / step) * step;
    onChange(Number(Math.min(Math.max(snapped, min), max).toFixed(decimals)));
  };
  return (
    <div>
      <div className={`flex items-center gap-2 ${align === 'center' ? 'justify-center' : 'justify-between'}`}>
        <div className="flex items-center gap-2">
          {leading}
          <output data-testid={testId && `${testId}-value`} className={`font-bold ${compact ? 'text-lg' : 'text-xl'}`}>
            {shown}
          </output>
        </div>
        {aside}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid={testId && `${testId}-minus`}
          className={STEP_BUTTON}
          aria-label={`${t.decrease} (${label})`}
          disabled={value <= min}
          onClick={() => move(-1)}
        >
          −
        </button>
        <input
          type="range"
          data-testid={testId}
          className="h-touch min-w-0 flex-1 accent-accent"
          aria-label={label}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <button
          type="button"
          data-testid={testId && `${testId}-plus`}
          className={STEP_BUTTON}
          aria-label={`${t.increase} (${label})`}
          disabled={value >= max}
          onClick={() => move(1)}
        >
          +
        </button>
      </div>
    </div>
  );
}
