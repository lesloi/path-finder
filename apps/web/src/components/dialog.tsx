import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

import { ICON_BUTTON } from './styles.ts';

/**
 * A modal over the sheet that shows one thing and applies changes as they are made: it closes
 * with its cross, Escape, or a click on the scrim, and has no OK button.
 */
export function Dialog({
  title,
  closeLabel,
  onClose,
  testId,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  /** Prefix of the test ids: the dialog, then `-close` for its cross. */
  testId?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      data-testid={testId}
      aria-labelledby={headingId}
      className={
        'fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none rounded-t-lg bg-surface p-0 text-ink ' +
        'backdrop:bg-scrim'
      }
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click outside the box lands on the dialog itself, over its scrim: the padding is on the child.
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="p-4 pb-safe-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 id={headingId} className="text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            className={ICON_BUTTON}
            data-testid={testId && `${testId}-close`}
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
