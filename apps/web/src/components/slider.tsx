import type { ReactNode } from 'react';

/** A native range input, with its value in large type above it and an optional `aside` on the same line. */
export function Slider({
  label,
  value,
  shown,
  aside,
  min,
  max,
  step,
  onChange,
  onCommit,
  testId,
}: {
  label: string;
  value: number;
  /** The value as text, with its unit. */
  shown: string;
  aside?: ReactNode;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** The user lets go of the slider or of a key: the value is final, unlike the ones `onChange` hears on the way. */
  onCommit?: () => void;
  /** Prefix of the test ids: the range input, then `-value` for the value shown above it. */
  testId?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <output data-testid={testId && `${testId}-value`} className="text-xl font-bold">
          {shown}
        </output>
        {aside}
      </div>
      <input
        type="range"
        data-testid={testId}
        className="h-touch w-full accent-accent"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </div>
  );
}
