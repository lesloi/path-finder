import type { ReactNode } from 'react';

import { formatPace, paceFromSeconds, paceSeconds, type Units } from '../core/index.ts';
import { Slider } from './slider.tsx';

// Seconds per km or per mile, in the user's units: from 3:00 to 12:00 per km, and what that is per mile, rounded.
const RANGE = {
  metric: { min: 180, max: 720, step: 5 },
  imperial: { min: 300, max: 1140, step: 10 },
};

/** A pace as a slider, in minutes per distance, which changes as the slider moves. */
export function PaceSlider({
  label,
  pace,
  units,
  testId,
  leading,
  onChange,
}: {
  label: string;
  /** Minutes per km. */
  pace: number;
  units: Units;
  testId: string;
  /** Before the pace shown above the slider. */
  leading?: ReactNode;
  onChange: (pace: number) => void;
}) {
  const { min, max, step } = RANGE[units];
  const seconds = Math.min(Math.max(paceSeconds(pace, units), min), max);
  return (
    <Slider
      testId={testId}
      leading={leading}
      label={label}
      value={seconds}
      shown={formatPace(paceFromSeconds(seconds, units), units)}
      min={min}
      max={max}
      step={step}
      onChange={(value) => onChange(paceFromSeconds(value, units))}
    />
  );
}
