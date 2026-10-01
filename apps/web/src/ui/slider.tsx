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
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <output className="text-xl font-bold">{shown}</output>
        {aside}
      </div>
      <input
        type="range"
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
