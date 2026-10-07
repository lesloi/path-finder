/** An on/off choice, as a native checkbox with the semantics of a switch. */
export function Switch({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="flex min-h-touch cursor-pointer items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        data-testid={testId}
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className={
          'relative h-6 w-10 flex-none rounded-full bg-surface-2 ring-1 ring-border transition-colors ' +
          'after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-ink-2 ' +
          'after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-4 ' +
          'peer-checked:after:bg-surface peer-focus-visible:ring-2 peer-focus-visible:ring-accent'
        }
      />
    </label>
  );
}
