import type { ReactNode } from 'react';

/** A native range input, with its value in large type above it and an optional `aside` on the same line. */
export function Slider({
  label,
  value,
  shown,
  leading,
  aside,
  min,
  max,
  step,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  /** The value as text, with its unit. */
  shown: string;
  /** Before the value, on the same line. */
  leading?: ReactNode;
  aside?: ReactNode;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Prefix of the test ids: the range input, then `-value` for the value shown above it. */
  testId?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {leading}
          <output data-testid={testId && `${testId}-value`} className="text-xl font-bold">
            {shown}
          </output>
        </div>
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
      />
    </div>
  );
}
