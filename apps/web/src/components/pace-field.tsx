import { useState } from 'react';

import { formatPace, paceUnit, parsePace, type Units } from '../core/index.ts';

/**
 * A pace as minutes per distance ("5:30"), edited as text: the pace changes once the text reads as one,
 * when the user leaves the field or presses Enter, so a search a change starts runs once.
 */
export function PaceField({
  label,
  pace,
  units,
  testId,
  autoFocus = false,
  onChange,
  onDone,
}: {
  label: string;
  /** Minutes per km. */
  pace: number;
  units: Units;
  testId: string;
  autoFocus?: boolean;
  onChange: (pace: number) => void;
  /** The user is through with the field, whether or not the pace changed. */
  onDone?: () => void;
}) {
  const shown = formatPace(pace, units);
  const [draft, setDraft] = useState(shown);
  const [shownBefore, setShownBefore] = useState(shown);
  // A pace set elsewhere, or other units, replaces what is typed.
  if (shown !== shownBefore) {
    setShownBefore(shown);
    setDraft(shown);
  }

  function commit() {
    const parsed = parsePace(draft, units);
    // The same pace again is not a change: it would only start a search.
    if (parsed !== undefined && formatPace(parsed, units) !== shown) onChange(parsed);
    else setDraft(shown);
    onDone?.();
  }

  return (
    <label className="flex min-h-touch items-center justify-between gap-3 text-sm text-ink-2">
      {`${label} (${paceUnit(units)})`}
      <input
        data-testid={testId}
        className="min-h-touch w-22 rounded-sm bg-surface-2 px-3 text-right text-base text-ink"
        inputMode="decimal"
        // The field opens where the user asked to edit.
        autoFocus={autoFocus}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(shown);
            onDone?.();
          }
        }}
      />
    </label>
  );
}
