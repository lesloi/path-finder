import { Check, ChevronDown } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

const TYPEAHEAD_MS = 500;

/**
 * Exclusive choices in a dropdown, which stays compact however many there are; the label names it. It is drawn by
 * the app, not the browser, so it looks the same everywhere (a native list cannot be styled in Firefox): the
 * select-only combobox of the WAI-ARIA authoring practices. The focus stays on the button; `aria-activedescendant`
 * says which option is active.
 */
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
  options: { value: Value; label: string; /** Decorative, before the label. */ icon?: ReactNode }[];
  onChange: (value: Value) => void;
  /** Prefix of the test ids: the button, then `-<value>` for each option. */
  testId?: string;
  /** The id of the element that says more about the select, such as an error. */
  describedBy?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef({ text: '', at: 0 });
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  // Undefined when there are no options: the button is then empty and the list never opens.
  const current: (typeof options)[number] | undefined = options[selected];

  const show = (index: number) => {
    if (options.length === 0) return;
    setActive(index);
    setOpen(true);
  };
  const pick = (index: number) => {
    onChange(options[index]!.value);
    setOpen(false);
  };
  const optionId = (index: number) => `${id}-${index}`;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    // Tab keeps what the native select did: it picks the active option, and the focus moves on.
    if (open && event.key === 'Tab') return pick(active);
    const now = Date.now();
    // Letters typed in a row make one prefix; a pause starts a new one.
    const prefix = now - typed.current.at < TYPEAHEAD_MS ? typed.current.text : '';
    const last = options.length - 1;
    const keys: Record<string, () => void> = open
      ? {
          ArrowDown: () => setActive(Math.min(active + 1, last)),
          ArrowUp: () => setActive(Math.max(active - 1, 0)),
          Home: () => setActive(0),
          End: () => setActive(last),
          Enter: () => pick(active),
          ' ': () => pick(active),
          // Escape closes the list and goes no further: on a page, it would otherwise go back too.
          Escape: () => setOpen(false),
        }
      : {
          ArrowDown: () => show(selected),
          ArrowUp: () => show(selected),
          Enter: () => show(selected),
          ' ': () => show(selected),
        };
    // A space inside a prefix is part of a word; alone, it picks.
    const action = event.key === ' ' && prefix ? undefined : keys[event.key];
    if (action) {
      event.preventDefault();
      typed.current = { text: '', at: 0 };
      action();
      return;
    }
    if (event.key.length !== 1 || event.altKey) return;
    const text = prefix + event.key.toLowerCase();
    typed.current = { text, at: now };
    const match = options.findIndex((option) => option.label.toLowerCase().startsWith(text));
    if (match >= 0) show(match);
    else if (!open) show(selected);
  };

  return (
    <div className="relative">
      <button
        type="button"
        role="combobox"
        data-testid={testId}
        aria-label={label}
        aria-describedby={describedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? optionId(active) : undefined}
        // Safari and Firefox on a Mac do not focus a button on a click, and without the focus the keys and the close
        // on blur never reach it.
        onClick={(event) => {
          event.currentTarget.focus();
          if (open) setOpen(false);
          else show(selected);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => event.key === ' ' && event.preventDefault()}
        className={
          'flex min-h-touch cursor-pointer items-center gap-3 rounded-md border border-border bg-surface-2 px-4 ' +
          'text-sm font-medium text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'
        }
      >
        <span className="flex items-center gap-2">
          {current?.icon}
          {current?.label}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={`flex-none text-ink-2 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className={
            'absolute top-full right-0 z-10 mt-2 min-w-full rounded-lg border border-border bg-surface p-2 ' +
            'shadow-float'
          }
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              data-testid={testId && `${testId}-${option.value}`}
              // The button keeps the focus: a click on an option must not blur it, which would close the list first.
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(index)}
              onClick={() => pick(index)}
              className={
                'flex min-h-touch cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium text-ink ' +
                'whitespace-nowrap ' +
                (index === active ? 'bg-surface-2' : '')
              }
            >
              {option.icon}
              <span className="mr-6">{option.label}</span>
              <Check
                size={16}
                aria-hidden
                className={`ml-auto flex-none text-ink-2 ${option.value === value ? '' : 'invisible'}`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
