import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** One choice of a dropdown, with an optional icon before its label. */
export type DropdownOption<Value extends string> = { value: Value; label: string; icon?: ReactNode };

/**
 * A label and a button that opens a list of options and reports the one picked. A native
 * `<select>` cannot show icons, such as the language flags.
 */
export function Dropdown<Value extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: Value;
  options: DropdownOption<Value>[];
  onChange: (value: Value) => void;
  /** Prefix of the test ids: the button, then `-list` and `-<value>` for the list and its options. */
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const buttonId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const selected = options.find((option) => option.value === value)!;

  // Keyboard users land on the current option when the list opens.
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  function pick(picked: Value) {
    onChange(picked);
    close();
  }

  // Arrows, Home, and End move between options, as in a native select.
  function move(event: KeyboardEvent) {
    const items = [...list.current!.querySelectorAll<HTMLElement>('[role="option"]')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const targets: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: items.length - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    items[Math.min(Math.max(target, 0), items.length - 1)].focus();
  }

  return (
    <>
      <span id={labelId}>{label}</span>
      <span
        className="relative"
        // Tab leaves from the button, so the focus moves on to what follows the dropdown.
        onKeyDown={(event) => {
          if (!open || (event.key !== 'Escape' && event.key !== 'Tab')) return;
          // Escape closes the list only, not the dialog around it.
          if (event.key === 'Escape') event.preventDefault();
          close();
        }}
      >
        <button
          ref={button}
          id={buttonId}
          data-testid={testId}
          type="button"
          className="inline-flex min-h-touch items-center gap-2 rounded-sm bg-surface-2 px-3"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${labelId} ${buttonId}`}
          onClick={() => setOpen(!open)}
        >
          {selected.icon}
          {selected.label}
          <ChevronDown size={16} aria-hidden />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-11" onClick={close} />
            <ul
              ref={list}
              className={
                'absolute top-[calc(100%+--spacing(1))] right-0 z-12 min-w-50 rounded-md bg-surface p-1 ' +
                'shadow-float'
              }
              role="listbox"
              data-testid={testId && `${testId}-list`}
              aria-labelledby={labelId}
              onKeyDown={move}
            >
              {options.map((option) => (
                <li
                  key={option.value}
                  className={
                    'flex min-h-touch cursor-pointer items-center gap-2 rounded-sm px-3 outline-none hover:bg-surface-2 ' +
                    'focus:bg-surface-2 aria-selected:bg-accent-soft aria-selected:font-semibold ' +
                    'aria-selected:text-accent'
                  }
                  role="option"
                  data-testid={testId && `${testId}-${option.value}`}
                  aria-selected={option.value === value}
                  tabIndex={-1}
                  onClick={() => pick(option.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    pick(option.value);
                  }}
                >
                  {option.icon}
                  {option.label}
                  {option.value === value && <Check size={16} aria-hidden className="ml-auto" />}
                </li>
              ))}
            </ul>
          </>
        )}
      </span>
    </>
  );
}
