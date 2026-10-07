import { useState } from 'react';

import { formatPace, KM_PER_MILE, paceUnit, type Units } from '../core/index.ts';
import { Slider } from './slider.tsx';

// Seconds per km or per mile, in the user's units: from 3:00 to 12:00 per km, and what that is per mile, rounded.
const RANGE = {
  metric: { min: 180, max: 720, step: 5 },
  imperial: { min: 300, max: 1140, step: 10 },
};

const perUnit = (units: Units) => (units === 'metric' ? 1 : KM_PER_MILE);

/**
 * A pace as a slider, in minutes per distance. What the slider shows moves with it; the pace changes once
 * the user lets go of it or leaves it, so a search that a change starts runs once.
 */
export function PaceSlider({
  label,
  pace,
  units,
  testId,
  onChange,
  onDone,
}: {
  label: string;
  /** Minutes per km. */
  pace: number;
  units: Units;
  testId: string;
  onChange: (pace: number) => void;
  /** The user has left the slider, whether or not the pace changed. */
  onDone?: () => void;
}) {
  const { min, max, step } = RANGE[units];
  const seconds = Math.min(Math.max(Math.round(pace * perUnit(units) * 60), min), max);
  const [draft, setDraft] = useState(seconds);
  const [secondsBefore, setSecondsBefore] = useState(seconds);
  // A pace set elsewhere, or other units, replaces what the slider shows.
  if (seconds !== secondsBefore) {
    setSecondsBefore(seconds);
    setDraft(seconds);
  }

  function commit() {
    // The same pace again is not a change: it would only start a search.
    if (draft !== seconds) onChange(draft / 60 / perUnit(units));
  }

  return (
    <div
      onBlur={() => {
        commit();
        onDone?.();
      }}
    >
      <Slider
        testId={testId}
        label={label}
        value={draft}
        shown={`${formatPace(draft / 60 / perUnit(units), units)} ${paceUnit(units)}`}
        min={min}
        max={max}
        step={step}
        onChange={setDraft}
        onCommit={commit}
      />
    </div>
  );
}
