import type { ReactNode } from 'react';

import type { Language } from '../i18n/index.ts';
import { formatPace, invertPace, paceFromSeconds, paceSeconds, type PaceUnit } from '../core/index.ts';
import { Slider } from './slider.tsx';

// From 3:00 to 12:00 per km in seconds per km, and what that is in km/h.
const RANGE = {
  'min/km': { min: 180, max: 720, step: 5 },
  'km/h': { min: 5, max: 20, step: 0.5 },
};

/** A pace as a slider, in minutes per km or in km/h, which changes as the slider moves. */
export function PaceSlider({
  label,
  pace,
  paceUnit,
  language,
  testId,
  leading,
  onChange,
}: {
  label: string;
  /** Minutes per km. */
  pace: number;
  paceUnit: PaceUnit;
  language: Language;
  testId: string;
  /** Before the pace shown above the slider. */
  leading?: ReactNode;
  onChange: (pace: number) => void;
}) {
  const { min, max, step } = RANGE[paceUnit];
  const speed = paceUnit === 'km/h';
  const raw = speed ? invertPace(pace) : paceSeconds(pace);
  // Snapped to the step, as the range input does, so that the thumb and the pace shown agree.
  const value = min + Math.round((Math.min(Math.max(raw, min), max) - min) / step) * step;
  const toPace = speed ? invertPace : paceFromSeconds;
  return (
    <Slider
      testId={testId}
      leading={leading}
      label={label}
      language={language}
      value={value}
      shown={formatPace(toPace(value), paceUnit, language)}
      min={min}
      max={max}
      step={step}
      onChange={(next) => onChange(toPace(next))}
    />
  );
}
