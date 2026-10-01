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
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
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
      aria-labelledby={headingId}
      className={
        'fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none rounded-t-lg bg-surface p-4 pb-safe-4 text-ink ' +
        'backdrop:bg-scrim'
      }
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click outside the content lands on the dialog itself, over its scrim.
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 id={headingId} className="text-lg font-bold">
          {title}
        </h2>
        <button type="button" className={ICON_BUTTON} aria-label={closeLabel} onClick={onClose}>
          <X aria-hidden />
        </button>
      </div>
      {children}
    </dialog>
  );
}
