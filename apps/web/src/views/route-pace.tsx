import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { PaceSlider } from '../components/index.ts';
import { formatPace, type Display } from '../core/index.ts';
import { criteriaText, routesText } from '../i18n/index.ts';

// The pace the durations are estimated at, and, with `onChange`, a pencil that opens a slider to change it and
// closes it again.
export function RoutePace({
  display,
  pace,
  onChange,
}: {
  display: Display;
  pace: number;
  onChange?: (pace: number) => void;
}) {
  const t = { ...criteriaText[display.language], ...routesText[display.language] };
  const [editing, setEditing] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  // The focus goes to the slider where the user asked to edit, and back to the pencil, which is a new one, when they close it.
  useEffect(() => {
    if (editing) editor.current?.querySelector('input')?.focus();
    else if (wasEditing.current) edit.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const pencil = onChange && (
    <button
      type="button"
      ref={edit}
      data-testid="routes-pace-edit"
      className="grid size-touch flex-none place-items-center rounded-full text-ink hover:bg-surface-2 aria-pressed:text-accent"
      aria-label={t.editPace}
      aria-pressed={editing}
      onClick={() => setEditing(!editing)}
    >
      <Pencil size={18} aria-hidden />
    </button>
  );
  // The pencil stays where it is: before the pace, which the slider then spans the width under.
  if (editing && onChange) {
    return (
      <div ref={editor} data-testid="routes-pace" className="text-sm text-ink-2">
        <PaceSlider
          label={t.pace}
          pace={pace}
          units={display.units}
          testId="routes-pace-input"
          leading={pencil}
          onChange={onChange}
        />
      </div>
    );
  }
  return (
    <div data-testid="routes-pace" className="flex items-center gap-2 text-sm text-ink-2">
      {pencil}
      <span className="flex min-h-touch items-center">{t.estimatedPace(formatPace(pace, display.units))}</span>
    </div>
  );
}
