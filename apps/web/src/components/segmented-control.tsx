import { useId } from 'react';

/** Exclusive choices side by side, as native radio buttons; the label names the group. */
export function SegmentedControl<Value extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: Value;
  options: { value: Value; label: string }[];
  onChange: (value: Value) => void;
  /** Prefix of the test ids: the group, then `-<value>` for each radio button. */
  testId?: string;
}) {
  const name = useId();
  return (
    <div role="radiogroup" data-testid={testId} aria-label={label} className="flex rounded-full bg-surface-2 p-1">
      {options.map((option) => (
        <label
          key={option.value}
          className={
            'flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-full px-3 text-center ' +
            'text-sm font-semibold text-ink-2 has-checked:bg-surface has-checked:text-ink ' +
            'has-checked:shadow-float has-focus-visible:ring-2 has-focus-visible:ring-accent'
          }
        >
          <input
            type="radio"
            data-testid={testId && `${testId}-${option.value}`}
            className="sr-only"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
