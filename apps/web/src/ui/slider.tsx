/** A native range input, with its value in large type above it. */
export function Slider({
  label,
  value,
  shown,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  /** The value as text, with its unit. */
  shown: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <output className="block text-xl font-bold">{shown}</output>
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
