/** Exclusive choices in a native dropdown, which stays compact however many there are; the label names it. */
export function SelectControl<Value extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  describedBy,
}: {
  label: string;
  value: Value;
  options: { value: Value; label: string }[];
  onChange: (value: Value) => void;
  /** Prefix of the test ids: the select, then `-<value>` for each option. */
  testId?: string;
  /** The id of the element that says more about the select, such as an error. */
  describedBy?: string;
}) {
  return (
    <select
      data-testid={testId}
      aria-label={label}
      aria-describedby={describedBy}
      value={value}
      // The values come from `options`, so the browser can only give one of them back.
      onChange={(event) => onChange(event.target.value as Value)}
      className={
        'min-h-touch rounded-md bg-surface-2 px-4 text-sm font-medium text-ink ' +
        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'
      }
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} data-testid={testId && `${testId}-${option.value}`}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
